import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Callable
from storage.minio_client import get_minio

class ImageCorruptionTracker:
    
    def __init__(self):
        self.corruption_log: List[Dict] = []
        self.alert_handlers: List[Callable] = []
        self.stats: Dict[str, Dict] = {}  
        self._alert_cooldown: Dict[str, datetime] = {}
        self.ALERT_COOLDOWN_MINUTES = 5  
        
    def register_alert_handler(self, handler: Callable):
        self.alert_handlers.append(handler)
    
    def record_corruption(
        self,
        transfer_id: str,
        reason: str,
        hub_id: str = None,
        device_id: str = None,
        raw_data_sample: bytes = None,
        severity: str = "warning" 
    ):
        timestamp = datetime.now()
        
        event = {
            "transfer_id": transfer_id,
            "hub_id": hub_id or "UNKNOWN",
            "device_id": device_id or "UNKNOWN",
            "reason": reason,
            "severity": severity,
            "timestamp": timestamp.isoformat(),
            "raw_sample_hex": raw_data_sample[:32].hex() if raw_data_sample else None
        }
        
        self.corruption_log.append(event)
        if len(self.corruption_log) > 1000:
            self.corruption_log = self.corruption_log[-1000:]
        
        key = f"{hub_id}:{device_id}"
        if key not in self.stats:
            self.stats[key] = {"count": 0, "first_seen": timestamp, "last_seen": None}
        self.stats[key]["count"] += 1
        self.stats[key]["last_seen"] = timestamp
        
        log_msg = f"Image corruption detected: {reason} (HUB: {hub_id}, Device: {device_id}, Transfer: {transfer_id})"
        logger = logging.getLogger("MQTTReceiver")
        if severity == "critical":
            logger.error(log_msg)
        elif severity == "error":
            logger.error(log_msg)
        else:
            logger.warning(log_msg)
        
        self._trigger_alerts(event)
        
        return event
    
    def _trigger_alerts(self, event: Dict):
        key = f"{event['hub_id']}:{event['device_id']}"
        if key in self._alert_cooldown:
            if datetime.now() - self._alert_cooldown[key] < timedelta(minutes=self.ALERT_COOLDOWN_MINUTES):
                return  
        
        self._alert_cooldown[key] = datetime.now()
        event["stats"] = self.stats.get(key, {})
        
        for handler in self.alert_handlers:
            try:
                handler(event)
            except Exception as e:
                logging.getLogger("MQTTReceiver").warning(f"Alert handler failed: {e}")
    
    def get_stats(self) -> Dict:
        return {
            "total_events": len(self.corruption_log),
            "by_source": self.stats,
            "recent_events": self.corruption_log[-10:]
        }
    
    def mark_record_corrupted(
        self,
        record_id: str,
        reason: str,
        db = None
    ):
        if not db:
            from .utils import get_db
            db = get_db()
        if not db:
            return
        
        try:
            existing = db.get(f"detection:{record_id}")
            if existing:
                existing['image_status'] = 'corrupted'
                existing['corruption_reason'] = reason
                existing['corruption_detected_at'] = datetime.now().isoformat()
                db.set(f"detection:{record_id}", "detection", existing)
                logging.getLogger("MQTTReceiver").info(
                    f"Marked detection {record_id} as corrupted: {reason}"
                )
        except Exception as e:
            logging.getLogger("MQTTReceiver").warning(
                f"Failed to mark record {record_id} as corrupted: {e}"
            )

_corruption_tracker = ImageCorruptionTracker()

def get_corruption_tracker() -> ImageCorruptionTracker:
    return _corruption_tracker

def _default_corruption_alert_handler(event: Dict):
    minio = get_minio()
    if minio and minio.is_connected:
        try:
            filename = f"corruption_alert_{event['timestamp'].replace(':', '-')}.json"
            minio.upload_json(event, filename, folder="alerts/corruption")
        except Exception:
            pass  

_corruption_tracker.register_alert_handler(_default_corruption_alert_handler)
