import json
from fastapi import APIRouter, Depends, HTTPException, Response
from Database.authentication.auth import get_current_active_user
from storage.minio_client import get_minio
from routes.utils import logger

router = APIRouter(prefix="/api/minio", tags=["MinIO"])

try:
    _minio = get_minio()
    MINIO_AVAILABLE = _minio is not None
except Exception:
    MINIO_AVAILABLE = False

def _check_minio():
    if not MINIO_AVAILABLE:
        raise HTTPException(status_code=503, detail="MinIO not available")
    minio = get_minio()
    if not minio:
        raise HTTPException(status_code=503, detail="MinIO not connected")
    return minio

@router.get("/images")
async def list_minio_images(current_user=Depends(get_current_active_user)):
    minio = _check_minio()
    files = minio.list_files(prefix="images/")
    result = [{
        "name": f["name"].replace("images/", ""),
        "path": f["name"],
        "size": f["size"],
        "last_modified": f["last_modified"],
        "url": minio.get_presigned_url(f["name"], expiry_hours=24)
    } for f in files]
    return {"success": True, "images": result, "count": len(result)}

@router.get("/crops")
async def list_minio_crops(current_user=Depends(get_current_active_user)):
    minio = _check_minio()
    files = minio.list_files(prefix="crops/")
    result = [{
        "name": f["name"].replace("crops/", ""),
        "path": f["name"],
        "size": f["size"],
        "last_modified": f["last_modified"],
        "url": minio.get_presigned_url(f["name"], expiry_hours=24)
    } for f in files]
    return {"success": True, "crops": result, "count": len(result)}

@router.get("/jsons")
async def list_minio_jsons(current_user=Depends(get_current_active_user)):
    minio = _check_minio()
    files = minio.list_files(prefix="jsons/")
    result = [{
        "name": f["name"].replace("jsons/", ""),
        "path": f["name"],
        "size": f["size"],
        "last_modified": f["last_modified"],
        "url": minio.get_presigned_url(f["name"], expiry_hours=24)
    } for f in files]
    return {"success": True, "jsons": result, "count": len(result)}

@router.get("/image/{filename:path}")
async def get_minio_image(filename: str):
    minio = _check_minio()
    object_name = f"images/{filename}" if not filename.startswith("images/") else filename
    data = minio.download_file(object_name)
    if data:
        content_type = "image/webp" if filename.endswith(".webp") else "image/jpeg"
        return Response(data, media_type=content_type)
    raise HTTPException(status_code=404, detail="Image not found")

@router.get("/crop/{filename:path}")
async def get_minio_crop(filename: str):
    minio = _check_minio()
    object_name = f"crops/{filename}" if not filename.startswith("crops/") else filename
    data = minio.download_file(object_name)
    if data:
        return Response(data, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Crop not found")

@router.get("/detections")
async def list_minio_detections(current_user=Depends(get_current_active_user)):
    minio = _check_minio()
    json_files = minio.list_files(prefix="jsons/")
    
    detections = []
    for jf in json_files:
        json_name = jf["name"].replace("jsons/", "")
        transfer_id = json_name.replace("_detection.json", "")
        
        json_data = minio.download_file(jf["name"])
        if not json_data:
            continue
        
        try:
            detection = json.loads(json_data.decode('utf-8'))
        except json.JSONDecodeError:
            continue
        
        images = minio.list_files(prefix="images/")
        crops = minio.list_files(prefix="crops/")
        
        detections.append({
            "transfer_id": transfer_id,
            "timestamp": detection.get("timestamp"),
            "detection_count": detection.get("detection_count", 0),
            "device_id": detection.get("device_id"),
            "json_url": minio.get_presigned_url(jf["name"], 24),
            "raw": detection,
            "image_urls": [minio.get_presigned_url(img["name"], 24) for img in images if transfer_id in img["name"]],
            "crop_urls": [minio.get_presigned_url(c["name"], 24) for c in crops if transfer_id in c["name"]]
        })
    
    detections.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return {"success": True, "detections": detections, "count": len(detections)}
