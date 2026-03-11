import os
import sys
import io
import threading
from datetime import datetime, timedelta
from collections import OrderedDict
from typing import Dict, Any, Optional, List
from PIL import Image

COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if COMMAND_CENTER_DIR not in sys.path:
    sys.path.insert(0, COMMAND_CENTER_DIR)

from storage.minio_client import get_minio

try:
    from .logging_handler import logger
    from .utils import get_db, send_chunk_ack, send_chunk_nack
    from .corruption_tracker import get_corruption_tracker
except ImportError:
    from logging_handler import logger
    from utils import get_db, send_chunk_ack, send_chunk_nack
    from corruption_tracker import get_corruption_tracker

metadata_buffers: Dict[str, Dict] = {}
_metadata_buffers_lock = threading.Lock()
_metadata_buffer_timestamps: Dict[str, datetime] = {}  
METADATA_BUFFER_TTL_MINUTES = 30  

def get_metadata_buffer(transfer_id: str) -> Optional[Dict]:
    with _metadata_buffers_lock:
        return metadata_buffers.get(transfer_id)

def set_metadata_buffer(transfer_id: str, data: Dict):
    with _metadata_buffers_lock:
        metadata_buffers[transfer_id] = data
        _metadata_buffer_timestamps[transfer_id] = datetime.now()

def delete_metadata_buffer(transfer_id: str):
    with _metadata_buffers_lock:
        metadata_buffers.pop(transfer_id, None)
        _metadata_buffer_timestamps.pop(transfer_id, None)

def cleanup_stale_metadata_buffers():
    now = datetime.now()
    ttl = timedelta(minutes=METADATA_BUFFER_TTL_MINUTES)
    stale_keys = []

    with _metadata_buffers_lock:
        for key, timestamp in _metadata_buffer_timestamps.items():
            if now - timestamp > ttl:
                stale_keys.append(key)

        for key in stale_keys:
            metadata_buffers.pop(key, None)
            _metadata_buffer_timestamps.pop(key, None)

    if stale_keys:
        logger.info(f"Cleaned up {len(stale_keys)} stale metadata buffers")


class TransferManager:
    STALE_TIMEOUT_HOURS = 0.5
    MAX_COMPLETED_TRANSFERS = 500
    MAX_ACTIVE_TRANSFERS = 100  

    def __init__(self):
        self.transfers: Dict[str, Dict[str, Any]] = {}
        self.completed_transfers: OrderedDict = OrderedDict()
        self._lock = threading.Lock() 
        from Database.transfer_state_db import get_transfer_state_db
        self._state_db = get_transfer_state_db()
    
    def _save_state(self, transfer_id: str = None):
        try:
            if transfer_id and transfer_id in self.transfers:
                tdata = self.transfers[transfer_id]
                self._state_db.register_transfer(
                    transfer_id=transfer_id,
                    filename=tdata.get('filename', 'unknown'),
                    chunk_total=tdata.get('chunk_total', 0),
                    record_id=tdata.get('metadata', {}).get('_pending_record_id') if tdata.get('metadata') else None,
                    hub_id=tdata.get('metadata', {}).get('hub_id') if tdata.get('metadata') else None,
                    solo_id=tdata.get('metadata', {}).get('solo_id') if tdata.get('metadata') else None,
                    metadata=tdata.get('metadata')
                )
                self._state_db.update_chunk_count(
                    transfer_id, 
                    len(tdata.get('received', set()))
                )
            else:
                for tid, tdata in self.transfers.items():
                    self._state_db.register_transfer(
                        transfer_id=tid,
                        filename=tdata.get('filename', 'unknown'),
                        chunk_total=tdata.get('chunk_total', 0),
                        record_id=tdata.get('metadata', {}).get('_pending_record_id') if tdata.get('metadata') else None,
                        metadata=tdata.get('metadata')
                    )
                    self._state_db.update_chunk_count(
                        tid, 
                        len(tdata.get('received', set()))
                    )
        except Exception as e:
            logger.warning(f"Failed to save transfer state: {e}")

    def _build_transfer_update(self, transfer_id: str, transfer: Dict, status: str = 'receiving', extra: Optional[Dict] = None) -> Dict[str, Any]:
        metadata = transfer.get('metadata') or {}
        chunks_total = transfer.get('chunk_total', 0)
        chunks_received = len(transfer.get('received', set()))
        percent = round((chunks_received / chunks_total) * 100, 1) if chunks_total > 0 else 0

        payload = {
            'transfer_id': transfer_id,
            'filename': transfer.get('filename', 'unknown'),
            'chunks_received': chunks_received,
            'chunks_total': chunks_total,
            'percent': min(99.9, percent) if status == 'receiving' and chunks_received < chunks_total else min(100.0, percent),
            'status': status,
            'started_at': transfer.get('started_at').isoformat() if isinstance(transfer.get('started_at'), datetime) else transfer.get('started_at'),
            'record_id': metadata.get('_pending_record_id'),
            'hub_id': metadata.get('hub_id'),
            'solo_id': metadata.get('solo_id') or metadata.get('device_id'),
        }
        if extra:
            payload.update(extra)
        return payload

    def _notify_transfer_update(self, transfer_id: str, transfer: Dict, status: str = 'receiving', extra: Optional[Dict] = None) -> None:
        try:
            from app import notify_transfer_update
            notify_transfer_update(self._build_transfer_update(transfer_id, transfer, status=status, extra=extra))
        except Exception as e:
            logger.debug(f"Transfer websocket notify skipped for {transfer_id}: {e}")
    
    def register_chunk(
        self,
        transfer_id: str,
        chunk_index: int,
        chunk_total: int,
        chunk_data: bytes,
        filename: str,
        metadata: Optional[Dict] = None
    ) -> Optional[bytes]:
        
        if chunk_index < 0 or chunk_index >= chunk_total:
            logger.warning(f"Invalid chunk_index: {chunk_index} (total: {chunk_total})")
            return None
                
        if transfer_id in self.completed_transfers:
            logger.debug(f"Duplicate transfer ignored: {transfer_id}")
            return None

        if transfer_id not in self.transfers:
            if len(self.transfers) >= self.MAX_ACTIVE_TRANSFERS:
                self.cleanup_stale_transfers()

                if len(self.transfers) >= self.MAX_ACTIVE_TRANSFERS:
                    logger.warning(
                        f"Active transfer limit reached ({self.MAX_ACTIVE_TRANSFERS}). "
                        f"Rejecting new transfer: {transfer_id}"
                    )
                    return None

        if transfer_id not in self.transfers:
            self.transfers[transfer_id] = {
                'chunks': [None] * chunk_total,
                'received': set(),
                'chunk_total': chunk_total,
                'filename': filename,
                'metadata': metadata,
                'started_at': datetime.now(),
                'last_preview_chunk': 0
            }
        
        transfer = self.transfers[transfer_id]
        
        if metadata and not transfer['metadata']:
            transfer['metadata'] = metadata
            
        if chunk_index in transfer['received']:
            logger.debug(f"Duplicate chunk ignored: {transfer_id}[{chunk_index}]")
            return None
        
        transfer['chunks'][chunk_index] = chunk_data
        transfer['received'].add(chunk_index)
        transfer['last_activity'] = datetime.now() 
        self._save_state(transfer_id)
        received_count = len(transfer['received'])
        self._notify_transfer_update(transfer_id, transfer)
        logger.debug(
            f"Chunk received: {transfer_id}[{chunk_index+1}/{chunk_total}] "
            f"({received_count}/{chunk_total} total)"
        )
        
        hub_id = None
        device_id = None
        if metadata:
            hub_id = metadata.get('hub_id')
            device_id = metadata.get('solo_id') or metadata.get('device_id')
        
        if received_count % 10 == 0 or received_count == chunk_total:
            if hub_id and device_id:
                last_contiguous = -1
                for i in range(chunk_total):
                    if i in transfer['received']:
                        last_contiguous = i
                    else:
                        break
                
                send_chunk_ack(hub_id, device_id, transfer_id, last_contiguous)
        
        if chunk_index > 0 and (chunk_index - 1) not in transfer['received']:
            missing = []
            for i in range(chunk_index):
                if i not in transfer['received']:
                    missing.append(i)
            
            if len(missing) >= 2 and hub_id and device_id:
                logger.warning(f"Gap detected in {transfer_id}: missing chunks {missing[:10]}...")
                send_chunk_nack(hub_id, device_id, transfer_id, missing)
        
        channel_config = None
        preview_interval = 10  
        
        if transfer['metadata']:
            if 'channel_config' in transfer['metadata']:
                channel_config = transfer['metadata']['channel_config']
                preview_interval = channel_config.get('preview_interval', 10)
                logger.debug(f"Using channel config: {channel_config.get('channel', 'unknown')} (interval={preview_interval})")
            elif 'satellite_config' in transfer['metadata']:
                sat_config = transfer['metadata']['satellite_config']
                preview_interval = sat_config.get('preview_interval', 10)
                logger.debug(f"Using legacy satellite config (interval={preview_interval})")
        
        if received_count % preview_interval == 0 and received_count < chunk_total:
            logger.info(f"Preview check triggered: {received_count}/{chunk_total} chunks (interval={preview_interval})")
        
            valid_chunks = []
            for i in range(chunk_total):
                if transfer['chunks'][i] is not None:
                    valid_chunks.append(transfer['chunks'][i])
                else:
                    break
            
            logger.info(f"Contiguous chunks available: {len(valid_chunks)} (from start)")
            
            if valid_chunks:
                partial_data = b''.join(valid_chunks)
                if len(valid_chunks) > transfer['last_preview_chunk']:
                    logger.info(f"Attempting partial decode with {len(partial_data)} bytes...")
                    success = self._try_partial_decode(transfer_id, partial_data, filename)
                    transfer['last_preview_chunk'] = len(valid_chunks)
                    if not success:
                        logger.warning(f"Partial decode failed - WebP may need more data")
        
        if len(transfer['received']) == chunk_total:
            full_data = b''.join(transfer['chunks'])

            try:
                self._notify_transfer_update(transfer_id, transfer, status='completed', extra={'percent': 100.0})
                self._state_db.complete_transfer(transfer_id)
                self._add_completed(transfer_id)
                del self.transfers[transfer_id]
                logger.info(f"Transfer completed: {transfer_id} ({len(full_data)} bytes)")
            except Exception as e:
                logger.error(f"Failed to complete transfer state for {transfer_id}: {e}")

            return full_data

        return None

    def _recover_webp_data(
        self, 
        img_data: bytes, 
        transfer_id: str = None,
        hub_id: str = None,
        device_id: str = None
    ) -> tuple:
    
        import struct
        corruption_tracker = get_corruption_tracker()
        corruption_info = None
        
        if len(img_data) < 12:
            corruption_info = {
                "reason": "Data too short for WebP header",
                "severity": "error",
                "expected_min": 12,
                "actual": len(img_data)
            }
            if transfer_id:
                corruption_tracker.record_corruption(
                    transfer_id=transfer_id,
                    reason=corruption_info["reason"],
                    hub_id=hub_id,
                    device_id=device_id,
                    raw_data_sample=img_data,
                    severity="error"
                )
            return img_data, corruption_info
            
        try:
            if img_data[0:4] != b'RIFF' or img_data[8:12] != b'WEBP':
                corruption_info = {
                    "reason": "Invalid WebP header (expected RIFF...WEBP)",
                    "severity": "error",
                    "actual_header": img_data[:12].hex()
                }
                logger.debug(f"Not a valid WebP header: {img_data[:12]}")
                
                if transfer_id:
                    corruption_tracker.record_corruption(
                        transfer_id=transfer_id,
                        reason=corruption_info["reason"],
                        hub_id=hub_id,
                        device_id=device_id,
                        raw_data_sample=img_data,
                        severity="error"
                    )
                return img_data, corruption_info
                
            file_size = struct.unpack('<I', img_data[4:8])[0]
            total_size = file_size + 8
            
            if len(img_data) < total_size:
                missing_bytes = total_size - len(img_data)
                missing_percent = round((missing_bytes / total_size) * 100, 1)
                
                corruption_info = {
                    "reason": "Truncated WebP data (padded for recovery)",
                    "severity": "warning",
                    "expected_size": total_size,
                    "actual_size": len(img_data),
                    "missing_bytes": missing_bytes,
                    "missing_percent": missing_percent
                }
                
                logger.info(f"WebP recovery: Expected {total_size} bytes, got {len(img_data)}. Padding with zeros.")
                padding = b'\x00' * missing_bytes
                
                if transfer_id and missing_percent > 10:  
                    corruption_tracker.record_corruption(
                        transfer_id=transfer_id,
                        reason=f"Truncated WebP: {missing_percent}% data missing",
                        hub_id=hub_id,
                        device_id=device_id,
                        severity="warning"
                    )
                
                return img_data + padding, corruption_info
                
        except Exception as e:
            corruption_info = {
                "reason": f"WebP recovery error: {str(e)}",
                "severity": "error"
            }
            logger.warning(f"WebP recovery error: {e}")
            
            if transfer_id:
                corruption_tracker.record_corruption(
                    transfer_id=transfer_id,
                    reason=corruption_info["reason"],
                    hub_id=hub_id,
                    device_id=device_id,
                    severity="error"
                )
            
        return img_data, corruption_info

    def _try_partial_decode(self, transfer_id: str, data: bytes, filename: str) -> bool:
        corruption_tracker = get_corruption_tracker()
        hub_id = None
        device_id = None
        
        try:
            metadata = {}
            if transfer_id in self.transfers:
                metadata = self.transfers[transfer_id].get('metadata', {}) or {}
            hub_id = metadata.get('hub_id')
            device_id = metadata.get('solo_id') or metadata.get('device_id')
            recovered_data, corruption_info = self._recover_webp_data(
                data, 
                transfer_id=transfer_id,
                hub_id=hub_id,
                device_id=device_id
            )
            
            with Image.open(io.BytesIO(recovered_data)) as img:
                img.load() 
                
                minio = get_minio()
                if minio:
                    preview_filename = f"preview_{transfer_id}.webp"
                    minio_path = minio.upload_image(recovered_data, preview_filename, "previews", "image/webp")
                    
                    if minio_path:
                        logger.info(f"Preview generated for {transfer_id} ({len(data)} bytes)")

                        record_id = None
                        with _metadata_buffers_lock:
                            if transfer_id in metadata_buffers:
                                record_id = metadata_buffers[transfer_id].get('_pending_record_id')

                        if record_id:
                                db = get_db()
                                if db:
                                    try:
                                        existing = db.get(f"detection:{record_id}")
                                        if existing:
                                            existing['source'] = f"minio://{minio_path}"
                                            if corruption_info and corruption_info.get('severity') == 'warning':
                                                existing['image_status'] = 'partial'
                                            elif corruption_info and corruption_info.get('severity') == 'error':
                                                existing['image_status'] = 'corrupted'
                                            else:
                                                existing['image_status'] = 'partial'
                                            from datetime import datetime as dt
                                            existing['updated_at'] = dt.now().isoformat()
                                            db.set(f"detection:{record_id}", "detection", existing)
                                            logger.info(f"Updated pending detection {record_id} -> {existing['image_status']}")

                                            try:
                                                from app import notify_detection_update
                                                transfer_data = self.transfers.get(transfer_id, {})
                                                received = len(transfer_data.get('received', set()))
                                                total = transfer_data.get('chunk_total', 0)
                                                notify_detection_update({
                                                    "record_id": record_id,
                                                    "is_update": True,
                                                    "image_status": existing['image_status'],
                                                    "updated_at": existing['updated_at'],
                                                    "chunks_received": received,
                                                    "chunks_total": total
                                                })
                                                logger.info(f"WebSocket notification sent for partial preview: {record_id}")
                                            except Exception as ws_err:
                                                logger.warning(f"Failed to send WebSocket notification for preview: {ws_err}")

                                            self._notify_transfer_update(
                                                transfer_id,
                                                self.transfers.get(transfer_id, {}),
                                                extra={
                                                    'image_status': existing['image_status'],
                                                    'updated_at': existing['updated_at'],
                                                }
                                            )
                                    except Exception as e:
                                        logger.warning(f"Failed to update preview record: {e}")
            return True
        except Exception as e:
            logger.warning(f"Partial decode failed for {transfer_id}: {e}")

            corruption_tracker.record_corruption(
                transfer_id=transfer_id,
                reason=f"Pillow decode failed: {str(e)}",
                hub_id=hub_id,
                device_id=device_id,
                severity="error"
            )

            record_id = None
            with _metadata_buffers_lock:
                if transfer_id in metadata_buffers:
                    record_id = metadata_buffers[transfer_id].get('_pending_record_id')

            if record_id:
                corruption_tracker.mark_record_corrupted(
                    record_id=record_id,
                    reason=f"Decode failed: {str(e)}"
                )

            return False
    
    def _add_completed(self, transfer_id: str):
        self.completed_transfers[transfer_id] = datetime.now()
        while len(self.completed_transfers) > self.MAX_COMPLETED_TRANSFERS:
            self.completed_transfers.popitem(last=False)
    
    def _save_partial_image(self, transfer_id: str, transfer: Dict) -> Optional[str]:
        try:
            chunks_data = []
            for i in range(transfer['chunk_total']):
                if transfer['chunks'][i] is not None:
                    chunks_data.append(transfer['chunks'][i])
                else:
                    break
            
            if not chunks_data:
                logger.warning(f"No contiguous chunks available for partial save: {transfer_id}")
                return None
            
            partial_data = b''.join(chunks_data)
            received_count = len(transfer['received'])
            total_count = transfer['chunk_total']
            percent = round((received_count / total_count) * 100, 1)
            
            logger.info(
                f"Saving partial image for {transfer_id}: "
                f"{received_count}/{total_count} chunks ({percent}%), "
                f"{len(partial_data)} bytes"
            )
            
            recovered_data, _ = self._recover_webp_data(partial_data)
            
            minio = get_minio()
            if not minio:
                logger.error(f"MinIO not available for partial save: {transfer_id}")
                return None
            
            filename = transfer.get('filename', f'{transfer_id}.webp')
            base, ext = os.path.splitext(filename)
            partial_filename = f"{base}_partial_{percent}pct{ext}"
            
            metadata = transfer.get('metadata', {})
            device_id = metadata.get('solo_id') or metadata.get('device_id')
            hub_id = metadata.get('hub_id')
            
            minio_path = minio.upload_image(
                data=recovered_data,
                filename=partial_filename,
                folder="images/partial",
                content_type="image/webp",
                device_id=device_id,
                hub_id=hub_id
            )
            
            if minio_path:
                logger.info(f"Partial image saved: {minio_path}")
                
                record_id = metadata.get('_pending_record_id')
                if record_id:
                    db = get_db()
                    if db:
                        try:
                            existing = db.get(f"detection:{record_id}")
                            if existing:
                                existing['source'] = f"minio://{minio_path}"
                                existing['image_status'] = 'partial'
                                existing['chunks_received'] = received_count
                                existing['chunks_total'] = total_count
                                existing['partial_percent'] = percent
                                db.set(f"detection:{record_id}", "detection", existing)
                                logger.info(f"Updated detection {record_id} with partial image status")
                        except Exception as e:
                            logger.warning(f"Failed to update partial record: {e}")
                
                self._state_db.mark_partial(transfer_id, minio_path, percent)
                self._notify_transfer_update(
                    transfer_id,
                    transfer,
                    extra={
                        'partial_path': minio_path,
                        'partial_percent': percent,
                        'image_status': 'partial',
                    }
                )
                
                return minio_path
            
            return None
            
        except Exception as e:
            logger.error(f"Failed to save partial image for {transfer_id}: {e}")
            return None
    
    def cleanup_stale_transfers(self):
        now = datetime.now()
        stale_timeout = timedelta(hours=self.STALE_TIMEOUT_HOURS)
        stale = []
        
        for tid, t in self.transfers.items():
            last_activity = t.get('last_activity', t['started_at'])
            if now - last_activity > stale_timeout:
                stale.append((tid, t))
        
        for tid, transfer in stale:
            received = len(transfer.get('received', set()))
            total = transfer.get('chunk_total', 0)
            percent = round((received / total * 100), 1) if total > 0 else 0
            
            logger.warning(
                f"Stale transfer detected (no activity in {self.STALE_TIMEOUT_HOURS}h): "
                f"{tid} - {received}/{total} chunks ({percent}%)"
            )
            
            if received > 0:
                minio_path = self._save_partial_image(tid, transfer)
                if minio_path:
                    logger.info(f"Partial image preserved for stale transfer {tid}: {minio_path}")
                else:
                    logger.warning(f"Could not save partial image for {tid}")
            self._notify_transfer_update(tid, transfer, status='stale')
            
            del self.transfers[tid]
            
            try:
                self._state_db.complete_transfer(tid)
            except Exception as e:
                logger.warning(f"Failed to cleanup SQLite state for {tid}: {e}")
    
    def get_missing_chunks(self, transfer_id: str) -> List[int]:
        if transfer_id not in self.transfers:
            return []
        
        transfer = self.transfers[transfer_id]
        all_indices = set(range(transfer['chunk_total']))
        return list(all_indices - transfer['received'])
    
    def get_transfer_progress(self, transfer_id: str) -> Optional[Dict]:
        if transfer_id not in self.transfers:
            return None
        
        transfer = self.transfers[transfer_id]
        received = len(transfer['received'])
        total = transfer['chunk_total']
        
        return {
            'transfer_id': transfer_id,
            'received': received,
            'total': total,
            'percent': round((received / total * 100), 1) if total > 0 else 0,
            'missing_chunks': self.get_missing_chunks(transfer_id),
            'started_at': transfer['started_at'].isoformat(),
            'last_activity': transfer.get('last_activity', transfer['started_at']).isoformat()
        }

_transfer_manager = TransferManager()

def get_transfer_manager() -> TransferManager:
    return _transfer_manager

def get_metadata_buffers() -> Dict[str, Dict]:
    with _metadata_buffers_lock:
        return metadata_buffers.copy()
