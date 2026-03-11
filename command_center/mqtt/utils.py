import os
import sys
import json
import threading
from datetime import datetime
from typing import Optional

COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if COMMAND_CENTER_DIR not in sys.path:
    sys.path.insert(0, COMMAND_CENTER_DIR)

try:
    from .logging_handler import logger
except ImportError:
    from logging_handler import logger

def get_db():
    try:
        from routes.utils import get_db as _get_db
        return _get_db()
    except ImportError:
        logger.warning("routes.utils.get_db not available")
        return None

def atomic_write(path: str, data: bytes) -> bool:
    tmp_path = f"{path}.tmp"
    try:
        with open(tmp_path, 'wb') as f:
            f.write(data)
        os.replace(tmp_path, path)
        return True
    except (IOError, OSError) as e:
        logger.error(f"Atomic write failed: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return False

def generate_unique_filename(transfer_id: str, filename: str) -> str:
    import uuid
    _, ext = os.path.splitext(filename)
    return f"{uuid.uuid4()}{ext}"

_mqtt_client = None
_mqtt_client_lock = threading.Lock()

def set_mqtt_client(client):
    global _mqtt_client
    with _mqtt_client_lock:
        _mqtt_client = client

def get_mqtt_client():
    with _mqtt_client_lock:
        return _mqtt_client

def send_chunk_ack(hub_id: str, device_id: str, transfer_id: str, last_ok_chunk: int):
    client = get_mqtt_client()
    if not client:
        logger.debug("MQTT client not available for ACK")
        return

    ack_topic = f"hub/{hub_id}/device/{device_id}/transfer/{transfer_id}/ack"
    ack_payload = {
        "last_ok_chunk": last_ok_chunk,
        "is_nack": False,
        "timestamp": datetime.now().isoformat()
    }

    try:
        client.publish(ack_topic, json.dumps(ack_payload), qos=1)
        logger.debug(f"ACK sent: {transfer_id} chunk {last_ok_chunk}")
    except Exception as e:
        logger.warning(f"Failed to send ACK: {e}")

def send_chunk_nack(hub_id: str, device_id: str, transfer_id: str, missing_chunks: list):
    client = get_mqtt_client()
    if not client:
        logger.debug("MQTT client not available for NACK")
        return

    if not missing_chunks:
        return

    ack_topic = f"hub/{hub_id}/device/{device_id}/transfer/{transfer_id}/ack"
    nack_payload = {
        "is_nack": True,
        "missing_chunks": missing_chunks[:50],
        "total_missing": len(missing_chunks),
        "timestamp": datetime.now().isoformat()
    }

    try:
        client.publish(ack_topic, json.dumps(nack_payload), qos=1)
        logger.info(f"NACK sent: {transfer_id} missing {len(missing_chunks)} chunks: {missing_chunks[:10]}...")
    except Exception as e:
        logger.warning(f"Failed to send NACK: {e}")
