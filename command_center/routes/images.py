import io
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from PIL import Image
from storage.minio_client import get_minio
from routes.utils import get_field, get_db, logger

router = APIRouter(prefix="/api", tags=["Images"])

def _check_minio():
    minio = get_minio()
    if not minio:
        raise HTTPException(status_code=503, detail="MinIO not available")
    return minio

def _get_object_name(file_path: str, prefix: str = "images") -> str:
    if file_path.startswith("minio://"):
        return file_path.replace("minio://", "")
    elif file_path.startswith(f"{prefix}/"):
        return file_path
    else:
        return f"{prefix}/{file_path}"

@router.get("/fullframe/{record_id}", response_model=dict)
async def get_fullframe(record_id: str):
    db = get_db()
    try:
        detection = db.get(f"detection:{record_id}")
        if not detection:
            raise HTTPException(status_code=404, detail="Full frame not found")
        
        image = db.get(f"image:{record_id}:original") or db.get(f"image:{record_id}:fullframe")
        crops_data = db.get_crops_by_detection(record_id)
        
        detections = []
        for item in crops_data:
            crop = item.get('value', {})
            detections.append({
                'crop_id': get_field(crop, 'crop_id', 'cropId', 'id'),
                'class': get_field(crop, 'class_name', 'class', 'className', 'label', 'type'),
                'accuracy': round(float(get_field(crop, 'confidence', 'accuracy', 'score', 'prob') or 0) * 100, 2),
                'bbox': get_field(crop, 'bbox', 'bounding_box', 'boundingBox', 'box', 'coordinates') or {}
            })
        
        source_path = get_field(detection, 'source_image_path', 'sourcePath', 'image_path', 'imagePath', 'path')
        file_path = get_field(image, 'file_path', 'filePath', 'path') if image else source_path 
        location = get_field(detection, 'location', 'solo_location')
        latitude = None
        longitude = None
        address = None
        if isinstance(location, dict):
            latitude = location.get('latitude') or location.get('lat')
            longitude = location.get('longitude') or location.get('lng') or location.get('lon')
            address = location.get('address')
        
        hub_info = get_field(detection, 'hub_info')
        hub_id = None
        if isinstance(hub_info, dict):
            hub_id = hub_info.get('hubid') or hub_info.get('hub_id')
        
        return {
            'success': True,
            'fullframe': {
                'record_id': record_id,
                'file_path': file_path,
                'file_size': get_field(image, 'file_size_bytes', 'fileSize', 'size') if image else None,
                'file_hash': get_field(image, 'file_hash', 'hash', 'checksum') if image else None,
                'dimensions': get_field(detection, 'image_info', 'imageInfo', 'dimensions', 'size') or {},
                'timestamp': get_field(detection, 'created_at', 'createdAt', 'timestamp', '_meta.created_at'),
                'device_id': get_field(detection, 'device_id', 'deviceId', 'id', 'solo_id'),
                'hub_id': hub_id,
                'location': {
                    'latitude': float(latitude) if latitude else None,
                    'longitude': float(longitude) if longitude else None,
                    'address': address
                },
                'detections': detections,
                'detection_count': len(detections),
                'raw': detection
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get fullframe error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/image/fullframe/{record_id}")
async def serve_fullframe_image(record_id: str):
    minio = _check_minio()
    db = get_db()
    try:
        image = db.get(f"image:{record_id}:original") or db.get(f"image:{record_id}:fullframe")
        logger.debug(f"Fullframe lookup: record_id={record_id}, image_found={image is not None}")

        if not image:
            detection = db.get(f"detection:{record_id}")
            logger.debug(f"Fullframe fallback to detection: found={detection is not None}")
            if not detection:
                logger.warning(f"Fullframe: detection kaydı bulunamadı: {record_id}")
                raise HTTPException(status_code=404, detail=f"Detection kaydı bulunamadı: {record_id}")
            file_path = detection.get('source_image_path') or detection.get('source')
        else:
            file_path = image.get('file_path')

        logger.debug(f"Fullframe file_path resolved: {file_path}")

        if not file_path:
            logger.warning(f"Fullframe: DB kaydında image path yok: {record_id}")
            raise HTTPException(status_code=404, detail=f"DB kaydında image path bulunamadı: {record_id}")

        object_name = _get_object_name(file_path, "images")
        logger.debug(f"Fullframe MinIO object_name: {object_name}")
        data = minio.download_file(object_name)
        if not data:
            logger.warning(f"Fullframe: MinIO'da dosya yok: {object_name}")
            raise HTTPException(status_code=404, detail=f"MinIO'da dosya bulunamadı: {object_name}")

        content_type = "image/webp" if object_name.endswith(".webp") else "image/jpeg"
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
        return Response(data, media_type=content_type, headers=headers)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Serve fullframe error [{record_id}]: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Fullframe hatası [{record_id}]: {type(e).__name__}: {e}")

@router.get("/image/crop/{crop_id}")
async def serve_crop_image(crop_id: str):
    minio = _check_minio()
    db = get_db()
    headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}

    try:

        crop = db.get(f"crop:{crop_id}")
        if not crop:
            detection = db.get(f"detection:{crop_id}")
            if detection:
                file_path = detection.get('source_image_path') or detection.get('source')
                if file_path:
                    object_name = _get_object_name(file_path, "images")
                    data = minio.download_file(object_name)
                    if data:
                        content_type = "image/webp" if object_name.endswith(".webp") else "image/jpeg"
                        return Response(data, media_type=content_type, headers=headers)
                    logger.warning(f"Crop fallback: MinIO'da dosya yok: {object_name}")
                else:
                    logger.warning(f"Crop fallback: detection kaydında image path yok: {crop_id}")
            else:
                logger.warning(f"Crop: crop ve detection kaydı bulunamadı: {crop_id}")
            raise HTTPException(status_code=404, detail=f"Crop bulunamadı: {crop_id}")

        crop_path = crop.get('crop_image_path')
        if crop_path:
            object_name = _get_object_name(crop_path, "crops")
            data = minio.download_file(object_name)
            if data:
                return Response(data, media_type="image/jpeg", headers=headers)
            logger.warning(f"Crop: MinIO'da crop dosyası yok: {object_name}")

        bbox = crop.get('bbox', {})
        x1, y1 = float(bbox.get('x1', 0)), float(bbox.get('y1', 0))
        x2, y2 = float(bbox.get('x2', 0)), float(bbox.get('y2', 0))

        detection_id = crop.get('detection_id')
        detection = db.get(f"detection:{detection_id}") if detection_id else None
        if not detection:
            logger.warning(f"Crop: bbox fallback için detection bulunamadı: detection_id={detection_id}, crop_id={crop_id}")
            raise HTTPException(status_code=404, detail=f"Detection bulunamadı: {detection_id}")

        full_frame_path = detection.get('source_image_path') or detection.get('source')
        if not full_frame_path:
            image = db.get(f"image:{detection_id}:original") or db.get(f"image:{detection_id}:fullframe")
            if image:
                full_frame_path = image.get('file_path')

        if not full_frame_path:
            logger.warning(f"Crop: fullframe path bulunamadı: detection_id={detection_id}, crop_id={crop_id}")
            raise HTTPException(status_code=404, detail=f"Image path bulunamadı: {detection_id}")

        object_name = _get_object_name(full_frame_path, "images")
        data = minio.download_file(object_name)
        if not data:
            logger.warning(f"Crop: MinIO'da fullframe yok: {object_name}")
            raise HTTPException(status_code=404, detail=f"MinIO'da fullframe bulunamadı: {object_name}")

        with Image.open(io.BytesIO(data)) as img:
            x1, y1 = max(0, int(x1)), max(0, int(y1))
            x2, y2 = min(img.width, int(x2)), min(img.height, int(y2))
            if x1 > x2: x1, x2 = x2, x1
            if y1 > y2: y1, y2 = y2, y1
            if x2 - x1 < 1: x2 = x1 + 1
            if y2 - y1 < 1: y2 = y1 + 1
            x2, y2 = min(img.width, x2), min(img.height, y2)

            cropped = img.crop((x1, y1, x2, y2))
            img_io = io.BytesIO()
            cropped.save(img_io, 'JPEG', quality=85)
            img_io.seek(0)

        return StreamingResponse(img_io, media_type="image/jpeg")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Serve crop error [{crop_id}]: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Crop hatası [{crop_id}]: {type(e).__name__}: {e}")
