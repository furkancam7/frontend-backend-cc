
from typing import Any, Dict, List, Optional, TypeVar, Generic
from pydantic import BaseModel, Field

class ErrorDetail(BaseModel):
    code: str = Field(..., description="Error code (e.g., NOT_FOUND, VALIDATION_ERROR)")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")

class MetaInfo(BaseModel):
    count: int = Field(..., description="Number of items in current response")
    page: Optional[int] = Field(None, description="Current page number")
    total_pages: Optional[int] = Field(None, description="Total number of pages")
    total_count: Optional[int] = Field(None, description="Total number of items across all pages")

class BaseResponse(BaseModel):
    success: bool = Field(..., description="Whether the request was successful")
    message: Optional[str] = Field(None, description="Optional message about the operation")

class SuccessResponse(BaseResponse):
    success: bool = True
    data: Optional[Dict[str, Any]] = Field(None, description="Optional data payload")

class ErrorResponse(BaseResponse):
    success: bool = False
    error: ErrorDetail

class ListResponse(BaseResponse):
    success: bool = True
    data: List[Any] = Field(default_factory=list, description="List of items")
    meta: MetaInfo

class SingleResponse(BaseResponse):
    success: bool = True
    data: Dict[str, Any] = Field(..., description="Single item data")

STANDARD_FIELD_NAMES = {
    'device_id': ['device_id', 'deviceId', 'id', 'solo_id', 'soloId', 'hub_id', 'hubId'],
    'record_id': ['record_id', 'recordId', 'detection_id', 'detectionId', '_meta.id'],
    'crop_id': ['crop_id', 'cropId'],
    'transfer_id': ['transfer_id', 'transferId'],
    'latitude': ['latitude', 'lat', 'location.latitude', 'location.lat'],
    'longitude': ['longitude', 'lng', 'lon', 'location.longitude', 'location.lng'],
    'address': ['address', 'location.address'],
    'class_name': ['class_name', 'className', 'class', 'label'],
    'confidence': ['confidence', 'accuracy', 'score', 'conf'],
    'bbox': ['bbox', 'bounding_box', 'boundingBox', 'box', 'coordinates'],
    'created_at': ['created_at', 'createdAt', 'timestamp', '_meta.created_at'],
    'updated_at': ['updated_at', 'updatedAt', '_meta.updated_at'],
}

def normalize_field(data: dict, standard_name: str, default=None):
    if not data or standard_name not in STANDARD_FIELD_NAMES:
        return default

    aliases = STANDARD_FIELD_NAMES[standard_name]

    for alias in aliases:
        if '.' in alias:
            parts = alias.split('.')
            val = data
            for part in parts:
                if isinstance(val, dict) and part in val:
                    val = val[part]
                else:
                    val = None
                    break
            if val is not None:
                return val
        elif alias in data and data[alias] is not None:
            return data[alias]

    return default

class LocationModel(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None

class DeviceModel(BaseModel):
    device_id: str
    type: str = 'tower'
    location: Optional[LocationModel] = None
    status: Optional[str] = None  
    last_detection: Optional[str] = None
    direction: Optional[float] = Field(None, ge=0, le=360, description="Device facing direction in degrees from north (0-360)")

class CropModel(BaseModel):
    crop_id: str
    record_id: Optional[str] = None
    class_name: str = Field(alias='class')
    confidence: Optional[float] = None
    device_id: Optional[str] = None
    location: Optional[LocationModel] = None
    bbox: Optional[Dict[str, Any]] = None
    captured_time: Optional[str] = None
    image_path: Optional[str] = None

    class Config:
        populate_by_name = True

class TransferModel(BaseModel):
    transfer_id: str
    record_id: Optional[str] = None
    device_id: Optional[str] = None
    filename: Optional[str] = None
    chunks_received: int = 0
    chunks_total: int = 0
    percent: float = 0.0
    status: str = 'receiving'

def success_response(data: Any = None, message: str = None, meta: dict = None) -> dict:
    response = {'success': True}

    if data is not None:
        response['data'] = data

    if message:
        response['message'] = message

    if meta:
        response['meta'] = meta

    return response

def list_response(items: list, total_count: int = None, page: int = None, total_pages: int = None) -> dict:
    meta = {'count': len(items)}

    if total_count is not None:
        meta['total_count'] = total_count
    if page is not None:
        meta['page'] = page
    if total_pages is not None:
        meta['total_pages'] = total_pages

    return {
        'success': True,
        'data': items,
        'meta': meta
    }

def error_response(code: str, message: str, details: Any = None, status_code: int = 500) -> dict:
    error = {
        'code': code,
        'message': message
    }

    if details is not None:
        error['details'] = details

    return {
        'success': False,
        'error': error
    }

class ErrorCodes:
    NOT_FOUND = 'NOT_FOUND'
    VALIDATION_ERROR = 'VALIDATION_ERROR'
    UNAUTHORIZED = 'UNAUTHORIZED'
    FORBIDDEN = 'FORBIDDEN'
    INTERNAL_ERROR = 'INTERNAL_ERROR'
    DATABASE_ERROR = 'DATABASE_ERROR'
    TIMEOUT = 'TIMEOUT'
    CONFLICT = 'CONFLICT'
