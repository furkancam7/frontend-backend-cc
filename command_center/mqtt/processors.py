import os
import sys
import uuid
from io import BytesIO
from typing import Dict, List, Optional

from PIL import Image

COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if COMMAND_CENTER_DIR not in sys.path:
    sys.path.insert(0, COMMAND_CENTER_DIR)

from storage.minio_client import get_minio

try:
    from .logging_handler import logger
    from .utils import get_db
    from .payload_extractor import PayloadExtractor, parse_location, parse_battery
    from .data_lake import save_json_to_data_lake, save_image_to_data_lake
except ImportError:
    from logging_handler import logger
    from utils import get_db
    from payload_extractor import PayloadExtractor, parse_location, parse_battery
    from data_lake import save_json_to_data_lake, save_image_to_data_lake


def _process_crops_for_existing_record(record_id: str, payload: Dict, img_path: str, filename: str, topic: str):
    db = get_db()
    if not db:
        return
    try:
        extractor = PayloadExtractor(payload)
        pil_image = None
        if img_path.startswith("minio://"):
            minio = get_minio()
            if minio:
                object_name = img_path.replace("minio://", "")
                image_data = minio.download_file(object_name)
                if image_data:
                    try:
                        pil_image = Image.open(BytesIO(image_data))
                    except Exception as e:
                        logger.warning(f"Image parse failed: {e}")
        
        if not pil_image:
            logger.warning(f"Could not load image for crop processing: {img_path}")
            return
        detected_objects = extractor.get_detected_objects()
        _process_crops(db, pil_image, img_path, filename, topic, record_id, detected_objects,
                       device_id=extractor.device_id)
        file_hash = uuid.uuid4().hex
        file_size = 0
        if img_path.startswith("minio://"):
            minio = get_minio()
            if minio:
                object_name = img_path.replace("minio://", "")
                image_data = minio.download_file(object_name)
                if image_data:
                    file_size = len(image_data)
        db.save_image_metadata(record_id, 'original', img_path, file_size, file_hash)
        
        logger.info(f"Crops processed for existing record: {record_id}")
        
    except Exception as e:
        logger.exception(f"Crop processing error for record {record_id}: {e}")

def process_metadata_and_image(topic: str, payload: Dict, img_path: str, filename: str):
    save_json_to_data_lake(topic, payload)
    save_image_to_data_lake(topic, filename, img_path)    
    db = get_db()
    if not db:
        return
    is_minio_path = img_path.startswith("minio://")
    try:
        extractor = PayloadExtractor(payload)
        
        # Validate: device_id is required
        if not extractor.is_valid:
            logger.warning(f"Payload rejected: missing device_id. Topic: {topic}")
            return
        
        image_metadata = payload.get("image_metadata") or {}
        original_meta = image_metadata.get("original") or {}
        pil_image = None
        img_info = extractor.image_info
        width = img_info.get('width') or original_meta.get('width', 0)
        height = img_info.get('height') or original_meta.get('height', 0)
        channels = img_info.get('channels') or original_meta.get('channels', 3)
        file_size = 0
        
        if is_minio_path:
            minio = get_minio()
            if minio:
                object_name = img_path.replace("minio://", "")
                image_data = minio.download_file(object_name)
                if image_data:
                    file_size = len(image_data)
                    try:
                        pil_image = Image.open(BytesIO(image_data))
                        width, height = pil_image.size
                        channels = len(pil_image.getbands())
                    except Exception as e:
                        logger.warning(f"Image parse failed: {e}")
        else:
            try:
                pil_image = Image.open(img_path)
                width, height = pil_image.size
                channels = len(pil_image.getbands())
                file_size = os.path.getsize(img_path)
            except (IOError, OSError) as e:
                logger.warning(f"Image open failed: {e}")

        model = extractor.model_info

        record_data = {
            'image_info': {'height': height, 'width': width, 'channels': channels},
            'model': {'name': model.get("name", 'yolo11n.pt'), 'confidence_threshold': model.get("confidence_threshold", 0.25)},
            'timestamp': payload.get('timestamp') or payload.get('transfer_timestamp'),
            'detection_time_ms': extractor.detection_time_ms,
            'detection_count': extractor.detection_count,
            'source': img_path,
            'device_id': extractor.device_id,
            'device_type': 'tower',
            'transfer_id': payload.get('transfer_id'),
            'location': extractor.location
        }

        _save_device_info(db, extractor.get_device_info_dict(), extractor.device_id)
            
        record_id = db.save_detection_record(record_data)
        if record_id:
            file_hash = uuid.uuid4().hex  
            db.save_image_metadata(record_id, 'original', img_path, file_size, file_hash)
            if pil_image:
                detected_objects = extractor.get_detected_objects()
                _process_crops(db, pil_image, img_path, filename, topic, record_id, detected_objects,
                               device_id=extractor.device_id)
                
    except Exception as e:
        logger.exception(f"Relational DB save error: {e}")

def _save_device_info(db, device_info_payload: Dict, device_id: str):
    try:
        location = parse_location(device_info_payload.get('location'))
        device_data = {
            'id': device_id,
            'device_id': device_id,
            'type': 'tower',
            'device_type': 'tower',
            'location': location
        }
        db.save_device_info(device_data)
        logger.info(f"Device info saved: {device_id} (type=tower)")
    except Exception as e:
        logger.warning(f"Device info save failed: {e}")

def _process_crops(db, pil_image, img_path: str, filename: str, topic: str, 
                   record_id: int, detected_objects: List[Dict],
                   device_id: str = None):
    try:
        if not pil_image:
            pil_image = Image.open(img_path)
        
        for idx, obj in enumerate(detected_objects):
            bbox = obj.get("bbox", [])
            label = obj.get("label")
            confidence = obj.get("confidence")
            crop_rel_path = None
            
            if bbox and len(bbox) == 4:
                try:
                    x1, y1, x2, y2 = [int(float(v)) for v in bbox]
                    x1 = max(0, min(x1, pil_image.width - 1))
                    y1 = max(0, min(y1, pil_image.height - 1))
                    x2 = max(0, min(x2, pil_image.width))
                    y2 = max(0, min(y2, pil_image.height))
                    
                    if x2 > x1 and y2 > y1:
                        crop_img = pil_image.crop((x1, y1, x2, y2))
                        crop_filename = f"{os.path.splitext(filename)[0]}_crop_{idx}.jpg"
                        minio = get_minio()
                        if minio:
                            crop_buffer = BytesIO()
                            crop_img.save(crop_buffer, format='JPEG', quality=90)
                            crop_bytes = crop_buffer.getvalue()
                            
                            minio_crop_path = minio.upload_image(
                                crop_bytes, 
                                crop_filename, 
                                "images/crops",
                                "image/jpeg",
                                device_id=device_id
                            )
                            if minio_crop_path:
                                logger.info(f"Crop uploaded to MinIO: {minio_crop_path}")
                                crop_rel_path = f"minio://{minio_crop_path}"
                except (ValueError, TypeError) as e:
                    logger.warning(f"Crop processing error: {e} (bbox: {bbox})")
            
            det_detail = {
                'id': idx,
                'class_id': obj.get('class_id', 0),
                'class_name': label,
                'confidence': confidence,
                'bbox': {
                    'x1': bbox[0] if bbox else 0,
                    'y1': bbox[1] if bbox else 0,
                    'x2': bbox[2] if bbox else 0,
                    'y2': bbox[3] if bbox else 0,
                    'width': (bbox[2]-bbox[0]) if bbox else 0,
                    'height': (bbox[3]-bbox[1]) if bbox else 0,
                    'center_x': ((bbox[0]+bbox[2])/2) if bbox else 0,
                    'center_y': ((bbox[1]+bbox[3])/2) if bbox else 0
                }
            }
            db.save_detection_detail(record_id, det_detail, crop_rel_path)
            
    except (IOError, OSError) as e:
        logger.error(f"Image processing error: {e}")
