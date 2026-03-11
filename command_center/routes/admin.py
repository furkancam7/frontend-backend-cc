from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from Database.authentication.auth import get_admin_user
from Database.authentication.permission_models import CreateDeviceRequest, UpdateDeviceRequest, UpdateCropRequest, UpdateRecordRequest
from routes.utils import get_db, logger

router = APIRouter(prefix="/api", tags=["Admin"])

@router.post("/devices")
async def create_device(device: CreateDeviceRequest, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        exists = db.get(f"device:{device.device_id}")
        if exists:
            raise HTTPException(status_code=400, detail="Device already exists")
        
        device_data = {
            'id': device.device_id,
            'location': {'address': device.address, 'latitude': device.latitude, 'longitude': device.longitude},
            'battery_condition': {}
        }
        db.save_device_info(device_data)
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create device error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.put("/device/{device_id}")
async def update_device(device_id: str, device: UpdateDeviceRequest, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        existing = db.get(f"device:{device_id}")
        if not existing:
            raise HTTPException(status_code=404, detail="Device not found")
        
        if device.address is not None:
            existing['address'] = device.address
        if device.latitude is not None:
            existing['latitude'] = device.latitude
        if device.longitude is not None:
            existing['longitude'] = device.longitude
        
        existing['last_update'] = datetime.now().isoformat()
        db.set(f"device:{device_id}", db.NS_DEVICE, existing)
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update device error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/device/{device_id}")
async def delete_device(device_id: str, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        detections = db.get_detections_by_device(device_id)
        for det_item in detections:
            det = det_item.get('value', {})
            detection_id = det.get('detection_id')
            if detection_id:
                crops = db.get_crops_by_detection(detection_id)
                for crop_item in crops:
                    crop = crop_item.get('value', {})
                    db.delete(f"crop:{crop.get('crop_id')}")
                db.delete(f"image:{detection_id}:original")
                db.delete(f"image:{detection_id}:fullframe")
                db.delete(f"detection:{detection_id}")
        
        db.delete(f"device:{device_id}")
        return {'success': True}
    except Exception as e:
        logger.error(f"Delete device error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.put("/crop/{crop_id}")
async def update_crop(crop_id: str, crop: UpdateCropRequest, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        existing = db.get(f"crop:{crop_id}")
        if not existing:
            raise HTTPException(status_code=404, detail="Crop not found")
        
        if crop.class_name:
            existing['class_name'] = crop.class_name
        if crop.confidence is not None:
            conf = crop.confidence
            if conf > 1:
                conf = conf / 100.0
            existing['confidence'] = conf
        
        db.set(f"crop:{crop_id}", db.NS_CROP, existing)
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update crop error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.put("/record/{record_id}")
async def update_record(record_id: str, record: UpdateRecordRequest, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        exists = db.get(f"device:{record.device_id}")
        if not exists:
            raise HTTPException(status_code=400, detail="Device ID does not exist")
        
        detection = db.get(f"detection:{record_id}")
        if not detection:
            raise HTTPException(status_code=404, detail="Record not found")
        
        detection['device_id'] = record.device_id
        db.set(f"detection:{record_id}", db.NS_DETECTION, detection)
        return {'success': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update record error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/crop/{crop_id}")
async def delete_crop(crop_id: str, current_user=Depends(get_admin_user)):
    db = get_db()
    try:
        db.delete(f"crop:{crop_id}")
        return {'success': True}
    except Exception as e:
        logger.error(f"Delete crop error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
