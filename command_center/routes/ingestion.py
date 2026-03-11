import os
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from PIL import Image
from routes.utils import get_db, logger

router = APIRouter(prefix="/api", tags=["Ingest"])


def _notify_detection_websocket(record_id: str, detection_data: dict, is_update: bool = False, image_status: str = None):
    try:
        from app import notify_detection_update
        notify_detection_update({
            "record_id": record_id,
            "is_update": is_update,
            "detection_data": detection_data,
            "image_status": image_status or ("ready" if is_update else "pending"),
            "updated_at": datetime.now().isoformat()
        })
        logger.info(f"WebSocket notification sent for record: {record_id}, image_status: {image_status}")
    except Exception as e:
        logger.warning(f"Failed to send WebSocket notification: {e}")


@router.post("/ingest/kapan/metadata")
async def ingest_kapan_metadata(data: str = Form(...)):
    db = get_db()
    try:
        payload = json.loads(data)
        logger.info(f"Kapan METADATA-ONLY received. Keys: {payload.keys()}")
        
        meta_data = payload.get('meta_data')
        detection_wrapper = payload.get('detection', {})
        
        try:
            detection_json_raw = detection_wrapper.get('detection_json') or payload.get('detection_json')
            device_info_json_raw = detection_wrapper.get('device_info_json') or payload.get('device_info_json')
            
            if isinstance(detection_json_raw, str):
                detection_data = json.loads(detection_json_raw)
            elif isinstance(detection_json_raw, dict):
                detection_data = detection_json_raw
            else:
                detection_data = {}
            
            if isinstance(device_info_json_raw, str):
                device_info_data = json.loads(device_info_json_raw)
            elif isinstance(device_info_json_raw, dict):
                device_info_data = device_info_json_raw
            else:
                device_info_data = {}
                
        except Exception as e:
            logger.error(f"Data Parse Error: {e}")
            raise HTTPException(status_code=400, detail=f"Error parsing data: {e}")

        if device_info_data:
            db.save_device_info(device_info_data)
            logger.info("Device info saved from metadata.")

        existing_record = None
        if meta_data:
            existing_record = db.get_by_metadata(meta_data)
        
        if existing_record:
            logger.info(f"Record already exists for meta_data: {meta_data}")
            return {"success": True, "message": "Record already exists", "record_id": existing_record.get('_meta', {}).get('id')}

        detection_data['source'] = f"pending://{meta_data or 'unknown'}"
        detection_data['is_partial'] = True
        detection_data['image_status'] = 'pending'
        detection_data['meta_data'] = meta_data
        
        if 'device_id' not in detection_data:
            detection_data['device_id'] = device_info_data.get('id', 'UNKNOWN')

        record_id = db.save_detection_record(detection_data)
        
        if record_id:
            logger.info(f"PENDING detection created with ID: {record_id}")
            
            detections = detection_data.get('detections', [])
            for idx, det in enumerate(detections):
                det['crop_status'] = 'pending'
                db.save_detection_detail(record_id, det, crop_path=None)
            
            logger.info(f"Saved {len(detections)} detection details (pending crops)")
            
            return {
                "success": True, 
                "message": "Metadata saved, waiting for image", 
                "record_id": record_id,
                "image_status": "pending",
                "detection_count": len(detections)
            }
        else:
            return {"success": False, "message": "Failed to create pending record"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Kapan metadata ingest error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/ingest/kapan")
async def ingest_kapan_data(data: str = Form(...), image: UploadFile = File(...)):
    db = get_db()
    try:
        payload = json.loads(data)
        logger.info(f"Kapan Data Received Payload Keys: {payload.keys()}")
        
        is_partial = payload.get('is_partial', False)
        meta_data = payload.get('meta_data')
        detection_wrapper = payload.get('detection', {})
        
        try:
            detection_json_raw = detection_wrapper.get('detection_json') or payload.get('detection_json')
            device_info_json_raw = detection_wrapper.get('device_info_json') or payload.get('device_info_json')
            
            if isinstance(detection_json_raw, str):
                detection_data = json.loads(detection_json_raw)
            elif isinstance(detection_json_raw, dict):
                detection_data = detection_json_raw
            else:
                detection_data = {}
            
            if isinstance(device_info_json_raw, str):
                device_info_data = json.loads(device_info_json_raw)
            elif isinstance(device_info_json_raw, dict):
                device_info_data = device_info_json_raw
            else:
                device_info_data = {}
            
            logger.info(f"Parsed Detection Data Keys: {detection_data.keys()}")
            logger.info(f"is_partial: {is_partial}, meta_data: {meta_data}")
            
        except Exception as e:
            logger.error(f"Data Parse Error: {e}")
            raise HTTPException(status_code=400, detail=f"Error parsing data: {e}")

        if device_info_data:
            db.save_device_info(device_info_data)
            logger.info("Device info saved.")

        content = await image.read()
        file_size = len(content)
        import uuid
        file_hash = uuid.uuid4().hex
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        ext = os.path.splitext(image.filename)[1] or ".webp"
        filename = f"kapan_{timestamp}_{meta_data or uuid.uuid4().hex[:8]}{ext}"
        from storage.minio_client import get_minio
        minio = get_minio()
        minio_path = None
        
        if minio:
            minio_path = minio.upload_image(content, filename, folder="images", content_type="image/webp")
            if minio_path:
                logger.info(f"Image uploaded to MinIO: {minio_path}")
                file_path = minio_path  
            else:
                images_dir = os.getenv('IMAGES_DIR', 'final_images')
                os.makedirs(images_dir, exist_ok=True)
                file_path = os.path.join(images_dir, filename)
                with open(file_path, "wb") as buffer:
                    buffer.write(content)
                logger.info(f"Image saved locally (MinIO failed): {file_path}")
        else:
            images_dir = os.getenv('IMAGES_DIR', 'final_images')
            os.makedirs(images_dir, exist_ok=True)
            file_path = os.path.join(images_dir, filename)
            with open(file_path, "wb") as buffer:
                buffer.write(content)
            logger.info(f"Image saved locally (no MinIO): {file_path}")
        existing_record = None
        if meta_data:
            existing_record = db.get_by_metadata(meta_data)
        
        if existing_record:
            return await _update_existing_record(db, existing_record, payload, detection_data, file_path, file_size, file_hash, filename, is_partial)
        else:
            return await _create_new_record(db, detection_data, device_info_data, file_path, file_size, file_hash, filename, is_partial, meta_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Kapan ingest error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

async def _update_existing_record(db, existing_record, payload, detection_data, file_path, file_size, file_hash, filename, is_partial):
    record_id = existing_record.get('detection_id') or existing_record.get('_meta', {}).get('id')
    logger.info(f"Found existing record, record_id: {record_id}")
    old_image_path = existing_record.get('source_image_path') or existing_record.get('source')
    was_partial = existing_record.get('is_partial', True)
    was_pending = existing_record.get('image_status') == 'pending'
    is_partial_in_payload = 'is_partial' in payload
    
    if was_pending:
        logger.info(f"Updating PENDING record {record_id} with actual image")
        is_partial = False  
    elif not is_partial_in_payload and was_partial and old_image_path and os.path.exists(old_image_path):
        try:
            old_size = os.path.getsize(old_image_path)
            size_increase_ratio = file_size / old_size if old_size > 0 else 1
            if size_increase_ratio >= 1.2:
                logger.info(f"Image size increased {size_increase_ratio:.2f}x - marking as COMPLETE")
                is_partial = False
        except Exception as e:
            logger.warning(f"Could not compare image sizes: {e}")
    
    if old_image_path and not old_image_path.startswith('pending://') and os.path.exists(old_image_path):
        try:
            os.remove(old_image_path)
            logger.info(f"Deleted old image: {old_image_path}")
        except Exception as e:
            logger.warning(f"Could not delete old image: {e}")
    
    updates = {
        'source_image_path': file_path,
        'source': file_path,
        'is_partial': is_partial,
        'image_status': 'ready',  
        'updated_at': datetime.now().isoformat()
    }
    
    if db.update_detection_record(record_id, updates):
        db.save_image_metadata(record_id, 'fullframe', file_path, file_size, file_hash)
        status_msg = "partial" if is_partial else "complete"
        logger.info(f"Detection record UPDATED ({status_msg}) with ID: {record_id}")

        _regenerate_crops(db, record_id, detection_data, file_path, filename)

        _notify_detection_websocket(record_id, detection_data, is_update=True, image_status="ready")

        return {"success": True, "message": f"Image updated to {status_msg}", "record_id": record_id, "is_update": True, "image_status": "ready"}
    else:
        return {"success": False, "message": "Failed to update detection record"}

async def _create_new_record(db, detection_data, device_info_data, file_path, file_size, file_hash, filename, is_partial, meta_data):
    from storage.minio_client import get_minio
    
    detection_data['source'] = file_path
    detection_data['source_image_path'] = file_path
    detection_data['is_partial'] = is_partial
    detection_data['meta_data'] = meta_data
    
    if 'device_id' not in detection_data:
        detection_data['device_id'] = device_info_data.get('id', 'UNKNOWN')

    record_id = db.save_detection_record(detection_data)
    
    if record_id:
        status_msg = "partial" if is_partial else "complete"
        logger.info(f"Detection record CREATED ({status_msg}) with ID: {record_id}")
        db.save_image_metadata(record_id, 'fullframe', file_path, file_size, file_hash)
        
        minio = get_minio()
        if minio:
            json_filename = f"{record_id}_detection.json"
            json_path = minio.upload_json(detection_data, json_filename, folder="jsons")
            if json_path:
                logger.info(f"Detection JSON uploaded to MinIO: {json_path}")
            
            if device_info_data:
                device_json_filename = f"{record_id}_device.json"
                device_json_path = minio.upload_json(device_info_data, device_json_filename, folder="jsons")
                if device_json_path:
                    logger.info(f"Device JSON uploaded to MinIO: {device_json_path}")
        
        _process_crops(db, record_id, detection_data, file_path, filename)

        _notify_detection_websocket(record_id, detection_data, is_update=False, image_status="ready")

        return {"success": True, "message": f"Data ingested ({status_msg})", "record_id": record_id, "is_update": False}
    else:
        return {"success": False, "message": "Failed to create detection record"}


def _regenerate_crops(db, record_id, detection_data, file_path, filename):
    try:
        pil_image = Image.open(file_path)
        actual_width, actual_height = pil_image.size
        existing_details = db.get_detection_details(record_id)
        
        if not existing_details or not pil_image:
            return
        image_info = detection_data.get('image_info', {})
        original_width = image_info.get('original_width', 0) or image_info.get('width', 0)
        original_height = image_info.get('original_height', 0) or image_info.get('height', 0)
        logger.info(f"Crop regeneration: Original image={original_width}x{original_height}, Received image={actual_width}x{actual_height}")
        scale_x, scale_y = 1.0, 1.0
        if original_width > 0 and original_height > 0:
            scale_x = actual_width / original_width
            scale_y = actual_height / original_height
        
        logger.info(f"Scale factors: x={scale_x:.4f}, y={scale_y:.4f}")
        crops_dir = os.getenv('CROPS_DIR', 'crops')
        os.makedirs(crops_dir, exist_ok=True)
        
        for i, det_row in enumerate(existing_details):
            try:
                det_data = det_row.get('detection_data', {})
                bbox = det_data.get('bbox', {})
                
                if isinstance(bbox, dict):
                    x1 = float(bbox.get('x1', 0))
                    y1 = float(bbox.get('y1', 0))
                    x2 = float(bbox.get('x2', 0))
                    y2 = float(bbox.get('y2', 0))
                elif isinstance(bbox, list) and len(bbox) == 4:
                    x1, y1, x2, y2 = [float(v) for v in bbox]
                else:
                    continue
                x1 = int(x1 * scale_x)
                y1 = int(y1 * scale_y)
                x2 = int(x2 * scale_x)
                y2 = int(y2 * scale_y)
                x1 = max(0, min(x1, pil_image.width - 1))
                y1 = max(0, min(y1, pil_image.height - 1))
                x2 = max(0, min(x2, pil_image.width))
                y2 = max(0, min(y2, pil_image.height))
                
                logger.debug(f"Crop {i} bbox: ({x1},{y1})-({x2},{y2}) scale=({scale_x:.3f},{scale_y:.3f})")
                
                if x2 > x1 and y2 > y1:
                    crop_img = pil_image.crop((x1, y1, x2, y2))
                    
                    import numpy as np
                    crop_array = np.array(crop_img)
                    mean_pixel = np.mean(crop_array)
                    std_pixel = np.std(crop_array)
                    
                    if mean_pixel < 15 or std_pixel < 15:
                        logger.info(f"Skipping crop regeneration {i} - bbox area incomplete (mean:{mean_pixel:.1f}, std:{std_pixel:.1f})")
                        continue
                    
                    logger.info(f"Valid crop {i} regenerated (mean:{mean_pixel:.1f}, std:{std_pixel:.1f})")
                    
                    old_crop_path = det_row.get('crop_path')
                    if old_crop_path:
                        old_crop_full = os.path.join(crops_dir, old_crop_path)
                        if os.path.exists(old_crop_full):
                            os.remove(old_crop_full)
                    
                    crop_filename = f"{os.path.splitext(filename)[0]}_crop_{i}.jpg"
                    crop_full_path = os.path.join(crops_dir, crop_filename)
                    crop_img.save(crop_full_path, quality=95)
                    
                    db.update_detection_detail_crop(det_row['id'], crop_filename)
                    logger.info(f"UPDATED crop: {crop_filename}")
            except Exception as e:
                logger.error(f"Crop update failed for detection {i}: {e}")
        
        pil_image.close()
    except Exception as e:
        logger.error(f"Failed to regenerate crops: {e}")

def _process_crops(db, record_id, detection_data, file_path, filename):
    detections = detection_data.get('detections', [])
    if not detections:
        return
    
    from storage.minio_client import get_minio
    import io
    
    minio = get_minio()
    
    pil_image = None
    try:
        if file_path.startswith('images/') and minio:
            img_data = minio.download_file(file_path)
            if img_data:
                pil_image = Image.open(io.BytesIO(img_data))
        
        if not pil_image:
            pil_image = Image.open(file_path)
    except Exception as e:
        logger.error(f"Failed to open image for cropping: {e}")
        return
    
    actual_width, actual_height = pil_image.size
    image_info = detection_data.get('image_info', {})
    original_width = image_info.get('original_width', 0) or image_info.get('width', 0)
    original_height = image_info.get('original_height', 0) or image_info.get('height', 0)
    logger.info(f"Crop processing: Original={original_width}x{original_height}, Actual={actual_width}x{actual_height}")
    scale_x, scale_y = 1.0, 1.0
    if original_width > 0 and original_height > 0:
        scale_x = actual_width / original_width
        scale_y = actual_height / original_height
    
    logger.info(f"Crop scale factors: x={scale_x:.4f}, y={scale_y:.4f}")

    for i, det in enumerate(detections):
        crop_rel_path = None
        try:
            bbox = det.get('bbox', {})
            if isinstance(bbox, dict):
                x1 = float(bbox.get('x1', 0))
                y1 = float(bbox.get('y1', 0))
                x2 = float(bbox.get('x2', 0))
                y2 = float(bbox.get('y2', 0))
            elif isinstance(bbox, list) and len(bbox) == 4:
                x1, y1, x2, y2 = [float(v) for v in bbox]
            else:
                continue
            
            x1, y1 = int(x1 * scale_x), int(y1 * scale_y)
            x2, y2 = int(x2 * scale_x), int(y2 * scale_y)
            
            if x1 > 0 or y1 > 0 or x2 > 0 or y2 > 0:
                x1 = max(0, min(x1, pil_image.width - 1))
                y1 = max(0, min(y1, pil_image.height - 1))
                x2 = max(0, min(x2, pil_image.width))
                y2 = max(0, min(y2, pil_image.height))
                
                if x2 > x1 and y2 > y1:
                    crop_img = pil_image.crop((x1, y1, x2, y2))
                    
                    import numpy as np
                    crop_array = np.array(crop_img)
                    mean_pixel = np.mean(crop_array)
                    std_pixel = np.std(crop_array)
                    logger.info(f"Crop {i} stats: mean={mean_pixel:.1f}, std={std_pixel:.1f}, size={crop_img.size}")
                    has_valid_content = mean_pixel >= 5 and std_pixel >= 5
                    
                    if has_valid_content:
                        logger.info(f"Valid crop {i} - uploading to MinIO")
                        crop_filename = f"{os.path.splitext(os.path.basename(filename))[0]}_crop_{i}.jpg"
                        
                        if minio:
                            img_buffer = io.BytesIO()
                            crop_img.save(img_buffer, format='JPEG', quality=95)
                            img_buffer.seek(0)
                            minio_crop_path = minio.upload_image(img_buffer.read(), crop_filename, folder="crops", content_type="image/jpeg")
                            if minio_crop_path:
                                crop_rel_path = minio_crop_path
                                logger.info(f"Crop uploaded to MinIO: {crop_rel_path}")
                            else:
                                logger.error(f"MinIO upload failed for crop {i}")
                        
                        if not crop_rel_path:
                            crops_dir = os.getenv('CROPS_DIR', 'crops')
                            os.makedirs(crops_dir, exist_ok=True)
                            crop_full_path = os.path.join(crops_dir, crop_filename)
                            crop_img.save(crop_full_path, quality=95)
                            crop_rel_path = crop_filename
                            logger.info(f"Crop saved locally: {crop_rel_path}")
                    else:
                        logger.info(f"Skipping crop {i} - bbox area incomplete (mean:{mean_pixel:.1f}, std:{std_pixel:.1f})")
        except Exception as e:
            logger.error(f"Crop failed for detection {i}: {e}")

        scaled_det = det.copy()
        if 'bbox' in scaled_det and isinstance(scaled_det['bbox'], dict):
            scaled_det['bbox'] = {
                'x1': int(float(det['bbox'].get('x1', 0)) * scale_x),
                'y1': int(float(det['bbox'].get('y1', 0)) * scale_y),
                'x2': int(float(det['bbox'].get('x2', 0)) * scale_x),
                'y2': int(float(det['bbox'].get('y2', 0)) * scale_y)
            }
        db.save_detection_detail(record_id, scaled_det, crop_path=crop_rel_path)
    
    pil_image.close()
    logger.info(f"Saved {len(detections)} detection details.")

