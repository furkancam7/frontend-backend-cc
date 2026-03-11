import os
import sys
from datetime import datetime
from typing import Dict, Any, Optional

COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if COMMAND_CENTER_DIR not in sys.path:
    sys.path.insert(0, COMMAND_CENTER_DIR)

try:
    from .logging_handler import logger
    from .utils import get_db
except ImportError:
    from logging_handler import logger
    from utils import get_db

def save_to_data_lake(topic: str, key: str, value: Any):
    db = get_db()
    if not db:
        return
    try:
        full_key = f"legacy:{topic}:{key}"
        db.set(full_key, "legacy", value)
    except Exception as e:
        logger.error(f"Data lake save error: {e}")

def save_json_to_data_lake(topic: str, data: Dict):
    db = get_db()
    if not db:
        return    
    try:
        full_key = f"legacy:{topic}:full_json"
        db.set(full_key, "legacy", data)
    except Exception as e:
        logger.error(f"JSON save error: {e}")

def save_image_to_data_lake(topic: str, filename: str, img_path: str):
    db = get_db()
    if not db:
        return    
    try:
        full_key = f"legacy:{topic}:image_info"
        db.set(full_key, "legacy", {
            "filename": filename,
            "path": img_path,
            "saved_at": str(datetime.now())
        })
    except Exception as e:
        logger.error(f"Image info save error: {e}")

def save_crop_to_data_lake(topic: str, crop_path: str, bbox: list, idx: int,
                           label: Optional[str] = None, confidence: Optional[float] = None):
    db = get_db()
    if not db:
        return
    try:
        full_key = f"legacy:{topic}:crop_{idx}"
        db.set(full_key, "legacy", {
            "path": crop_path,
            "bbox": str(bbox),
            "label": label,
            "confidence": str(confidence) if confidence else None
        })
    except Exception as e:
        logger.error(f"Crop info save error: {e}")
