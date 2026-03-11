from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)

# Only fire and smoke classes are accepted through the notification/detection pipeline
ALLOWED_DETECTION_CLASSES = {'fire', 'smoke'}

class PayloadExtractor:
  
    def __init__(self, payload: Dict):
        self.payload = payload
        self._detection = payload.get('detection') or {}
        self._device_info = payload.get('device_info') or {}
        self._hub_info = payload.get('hub_info') or {}
        self._image_metadata = payload.get('image_metadata') or {}
    
    def get(self, *keys, default=None):
        for key in keys:
            val = self.payload.get(key)
            if val is not None:
                return val
            val = self._detection.get(key)
            if val is not None:
                return val
        return default
    
    @property
    def device_id(self) -> str:
        """Single device identifier. Backward compat: maps solo_id/hub_id -> device_id."""
        candidates = [
            self.payload.get('device_id'),
            self.payload.get('solo_id'),
            self.payload.get('hub_id'),
            self._detection.get('device_id'),
            self._device_info.get('id'),
        ]
        for c in candidates:
            if c and c != 'UNKNOWN':
                return c
        return 'UNKNOWN'
    
    @property
    def device_type(self) -> str:
        """Device type is always 'tower'."""
        return 'tower'
    
    @property
    def is_valid(self) -> bool:
        """Payload is valid only if device_id is present and not UNKNOWN."""
        return self.device_id != 'UNKNOWN'
    
    @property
    def transfer_id(self) -> Optional[str]:
        return self.payload.get('transfer_id')
    
    @property
    def timestamp(self) -> Optional[str]:
        return self.payload.get('timestamp') or self.payload.get('transfer_timestamp')
    
    @property
    def location(self) -> Dict:
        return (
            self.payload.get('location') or
            self._detection.get('location') or
            self._device_info.get('location') or
            self._hub_info.get('location') or
            {}
        )
    
    @property
    def battery(self) -> Dict:
        return (
            self.payload.get('battery') or
            self._detection.get('battery') or
            self._device_info.get('battery_condition') or
            {}
        )
    
    @property
    def detections(self) -> List[Dict]:
        return (
            self.payload.get('detections') or
            self._detection.get('detections') or
            []
        )
    
    @property
    def detection_count(self) -> int:
        return (
            self.payload.get('detection_count') or
            self._detection.get('detection_count') or
            len(self.detections)
        )
    
    @property
    def model_info(self) -> Dict:
        return (
            self.payload.get('model') or
            self._detection.get('model') or
            {'name': 'yolo11n.pt', 'confidence_threshold': 0.25}
        )
    
    @property
    def image_info(self) -> Dict:
        return (
            self.payload.get('image_info') or
            self._detection.get('image_info') or
            {}
        )
    
    @property
    def detection_time_ms(self) -> float:
        return (
            self.payload.get('detection_time_ms') or
            self._detection.get('detection_time_ms') or
            self._detection.get('detection_time_seconds', 0) * 1000
        )
    
    def get_device_info_dict(self) -> Dict:
        return {
            'id': self.device_id,
            'device_id': self.device_id,
            'type': 'tower',
            'device_type': 'tower',
            'location': self.location,
        }
    
    def get_detected_objects(self) -> List[Dict]:
        result = []
        for d in self.detections:
            bbox = d.get('bbox', {})
            class_name = d.get('class_name', '')
            result.append({
                "bbox": [bbox.get('x1', 0), bbox.get('y1', 0), bbox.get('x2', 0), bbox.get('y2', 0)],
                "label": class_name,
                "confidence": d.get('confidence'),
                "class_id": d.get('class_id')
            })
        return result
    
    def get_allowed_detections(self) -> List[Dict]:
        """Return only detections with allowed classes (fire, smoke)."""
        return [
            d for d in self.get_detected_objects()
            if d.get('label', '').lower() in ALLOWED_DETECTION_CLASSES
        ]

def parse_location(location_data) -> Dict:
    if not location_data:
        return {'latitude': None, 'longitude': None, 'address': ''}
    
    if isinstance(location_data, dict):
        return {
            'latitude': location_data.get('latitude'),
            'longitude': location_data.get('longitude'),
            'address': location_data.get('address', '')
        }
    
    return {'latitude': None, 'longitude': None, 'address': str(location_data)}

def parse_battery(battery_data) -> Dict:
    if not battery_data:
        return {'percentage': None, 'remaining_days': None}
    
    if isinstance(battery_data, dict):
        return {
            'percentage': battery_data.get('percentage'),
            'remaining_days': battery_data.get('remaining_days')
        }
    
    return {'percentage': None, 'remaining_days': None}
