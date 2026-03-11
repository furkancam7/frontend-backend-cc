import logging
from typing import Optional, Any, Dict

logger = logging.getLogger(__name__)

FIELD_ALIASES = {
    'device_id': ['device_id', 'deviceId', 'id', 'solo_id', 'soloId', 'hub_id', 'hubid', '_meta.id'],
    'record_id': ['record_id', 'recordId', 'detection_id', 'detectionId', '_meta.id', 'id'],
    'crop_id': ['crop_id', 'cropId', '_meta.id'],
    'transfer_id': ['transfer_id', 'transferId'],
    'latitude': ['latitude', 'lat', 'location.latitude', 'location.lat'],
    'longitude': ['longitude', 'lng', 'lon', 'location.longitude', 'location.lng'],
    'address': ['address', 'location.address', 'location'],
    'class_name': ['class_name', 'className', 'class', 'label'],
    'confidence': ['confidence', 'accuracy', 'score', 'conf'],
    'bbox': ['bbox', 'bounding_box', 'boundingBox', 'box', 'coordinates'],
    'created_at': ['created_at', 'createdAt', 'timestamp', '_meta.created_at'],
    'updated_at': ['updated_at', 'updatedAt', '_meta.updated_at', 'last_update', 'lastUpdate'],
    'detection_count': ['detection_count', 'count', 'total', 'num_detections', 'detectionCount'],
}

def get_field(data: dict, *keys, default=None):
    if not data:
        return default
    for key in keys:
        if '.' in key:
            parts = key.split('.')
            val = data
            for p in parts:
                if isinstance(val, dict) and p in val:
                    val = val[p]
                else:
                    val = None
                    break
            if val is not None:
                return val
        elif key in data and data[key] is not None:
            return data[key]
    return default

def get_standard_field(data: dict, standard_name: str, default=None):
    if not data:
        return default

    aliases = FIELD_ALIASES.get(standard_name, [standard_name])

    return get_field(data, *aliases, default=default)

def extract_location(data: dict, fallback_device: dict = None) -> Dict[str, Any]:
    location = data.get('location') if data else None

    if isinstance(location, dict) and location.get('latitude') is not None:
        lat_val = location.get('latitude')
        lng_val = location.get('longitude')
        return {
            'latitude': float(lat_val) if lat_val is not None else None,
            'longitude': float(lng_val) if lng_val is not None else None,
            'address': location.get('address')
        }

    lat = get_standard_field(data, 'latitude')
    lng = get_standard_field(data, 'longitude')

    if lat is not None and lng is not None:
        return {
            'latitude': float(lat),
            'longitude': float(lng),
            'address': get_standard_field(data, 'address')
        }

    if fallback_device:
        lat = get_standard_field(fallback_device, 'latitude')
        lng = get_standard_field(fallback_device, 'longitude')
        return {
            'latitude': float(lat) if lat is not None else None,
            'longitude': float(lng) if lng is not None else None,
            'address': get_standard_field(fallback_device, 'address')
        }

    return {'latitude': None, 'longitude': None, 'address': None}

_db: Optional[Any] = None

def get_db():
    global _db
    if _db is None:
        from Database.databasemanager.db_manager import DatabaseManager
        _db = DatabaseManager()
        logger.info("DatabaseManager singleton created")
    return _db

def success_response(data: Any = None, message: str = None, count: int = None) -> dict:
    response = {'success': True}

    if data is not None:
        response['data'] = data

    if message:
        response['message'] = message

    if count is not None:
        response['meta'] = {'count': count}

    return response

def list_response(items: list, key_name: str = None) -> dict:
    response = {
        'success': True,
        'data': items,
        'meta': {'count': len(items)}
    }

    if key_name:
        response[key_name] = items
        response['count'] = len(items)

    return response

def error_response(message: str, code: str = 'INTERNAL_ERROR', details: Any = None) -> dict:
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
