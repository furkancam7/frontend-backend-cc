from fastapi import APIRouter, Depends, HTTPException
from Database.authentication.auth import get_current_active_user
from routes.utils import (
    get_field, get_standard_field, get_db, logger,
    extract_location, list_response
)

router = APIRouter(prefix="/api", tags=["Crops"])


def _normalize_confidence(confidence) -> float:
    if confidence is None:
        return 0.0
    try:
        val = float(confidence)
        if val <= 1.0:
            return round(val * 100, 2)
        return round(val, 2)
    except (ValueError, TypeError):
        return 0.0

@router.get("/crops", response_model=dict)
async def get_crops(current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        crops = []
        seen_detection_ids = set()
        crops_data = db.get_recent_crops(limit=50)

        for item in crops_data:
            crop = item.get('value', {})
            detection_id = get_standard_field(crop, 'record_id')
            if detection_id:
                seen_detection_ids.add(detection_id)

            detection = db.get(f"detection:{detection_id}") if detection_id else {}
            device_id = get_standard_field(detection, 'device_id') if detection else None
            device = db.get(f"device:{device_id}") if device_id else {}
            class_name = get_standard_field(crop, 'class_name')
            confidence = get_standard_field(crop, 'confidence')
            bbox = get_standard_field(crop, 'bbox')
            location = extract_location(detection, device)

            crops.append({
                'crop_id': get_standard_field(crop, 'crop_id'),
                'class': class_name,
                'accuracy': _normalize_confidence(confidence),
                'device_id': device_id,
                'solo_id': device_id,
                'captured_time': get_standard_field(crop, 'created_at'),
                'record_id': detection_id,
                'location': location,
                'bbox': bbox or {},
                'crop_image_path': get_field(crop, 'crop_image_path', 'image_path', 'path'),
                'hub_id': get_standard_field(detection, 'hub_id') if detection else None,
                'raw': {
                    **crop,
                    'is_partial': detection.get('is_partial', False) if detection else False,
                    'meta_data': detection.get('meta_data') if detection else None,
                    'updated_at': detection.get('updated_at') if detection else None,
                    'image_status': detection.get('image_status', 'ready') if detection else 'ready'
                }
            })

        detections_data = db.get_recent_detections(limit=50)
        for item in detections_data:
            detection = item.get('value', {})
            detection_id = get_standard_field(detection, 'record_id')
            if detection_id in seen_detection_ids:
                continue

            device_id = get_standard_field(detection, 'device_id')
            device = db.get(f"device:{device_id}") if device_id else {}
            det_info = detection.get('detection', {}) if isinstance(detection.get('detection'), dict) else {}
            class_name = get_standard_field(det_info, 'class_name') or get_standard_field(detection, 'class_name')
            confidence = get_standard_field(det_info, 'confidence') or get_standard_field(detection, 'confidence')
            location = extract_location(detection, device)
            is_partial = detection.get('is_partial', False)
            meta_data = detection.get('meta_data')
            source_image = get_field(detection, 'source_image_path', 'source', 'image_path')
            image_status = detection.get('image_status', 'ready')

            crops.append({
                'crop_id': detection_id,
                'class': class_name or ('partial_image' if is_partial else 'unknown'),
                'accuracy': _normalize_confidence(confidence),
                'device_id': device_id,
                'solo_id': device_id,
                'captured_time': get_standard_field(detection, 'created_at'),
                'record_id': detection_id,
                'location': location,
                'bbox': {},
                'crop_image_path': source_image,
                'hub_id': get_standard_field(detection, 'hub_id'),
                'image_status': image_status,
                'raw': {
                    **detection,
                    'is_partial': is_partial,
                    'meta_data': meta_data,
                    'updated_at': detection.get('updated_at'),
                    'image_status': image_status
                }
            })

        crops.sort(key=lambda x: x.get('captured_time') or '', reverse=True)
        return list_response(crops, 'crops')
    except Exception as e:
        logger.error(f"Get crops error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/crop/{crop_id}", response_model=dict)
async def get_crop_detail(crop_id: str, current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        crop = db.get(f"crop:{crop_id}")
        if not crop:
            raise HTTPException(status_code=404, detail="Crop not found")

        detection_id = crop.get('detection_id')
        detection = db.get(f"detection:{detection_id}") if detection_id else {}
        device_id = get_standard_field(detection, 'device_id') if detection else None
        device = db.get(f"device:{device_id}") if device_id else {}

        location = extract_location(detection, device)

        crop_data = {
            'crop_id': crop.get('crop_id'),
            'class': crop.get('class_name'),
            'accuracy': _normalize_confidence(crop.get('confidence')),
            'bbox': crop.get('bbox', {}),
            'device_id': device_id,
            'solo_id': device_id,
            'captured_time': crop.get('created_at'),
            'record_id': detection_id,
            'image_dimensions': detection.get('image_info', {}) if detection else {},
            'location': location,
            'hub_id': get_standard_field(detection, 'hub_id') if detection else None
        }

        return {
            'success': True,
            'data': crop_data,
            'crop': crop_data  
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get crop detail error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
