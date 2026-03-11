"""
Heartbeat configuration API routes.

GET  /api/devices/{device_id}/heartbeat-config   — current settings + status
PUT  /api/devices/{device_id}/heartbeat-config   — update & publish config
GET  /api/heartbeat/settings                      — all devices' settings
"""

import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, validator
from typing import Optional

from Database.authentication.auth import get_current_active_user
from routes.utils import get_db, success_response, list_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Heartbeat"])


# ─── Request / response models ──────────────────────────────

class HeartbeatConfigUpdate(BaseModel):
    enabled: bool = Field(True, description="Enable or disable heartbeats")
    heartbeat_interval_s: int = Field(30, ge=5, le=3600, description="Seconds between heartbeats (5-3600)")
    offline_threshold_s: int = Field(90, ge=10, le=7200, description="Seconds before device considered offline")
    jitter_s: int = Field(3, ge=0, le=60, description="Random jitter in seconds")

    @validator("offline_threshold_s")
    def threshold_must_exceed_interval(cls, v, values):
        interval = values.get("heartbeat_interval_s", 30)
        if v < 2 * interval:
            raise ValueError(
                f"offline_threshold_s ({v}) must be >= 2 * heartbeat_interval_s ({interval})"
            )
        return v


# ─── Helpers ─────────────────────────────────────────────────

def _get_mqtt_client():
    """Return the mqtt_receiver's MQTT client (for publishing config)."""
    try:
        from mqtt.utils import get_mqtt_client
        return get_mqtt_client()
    except Exception:
        return None


def _compute_online_status(settings: dict) -> str:
    """Derive online/offline from last_heartbeat_at vs offline_threshold_s."""
    last_hb = settings.get("last_heartbeat_at")
    threshold = settings.get("offline_threshold_s", 90)

    if not last_hb:
        return "unknown"

    try:
        if isinstance(last_hb, str):
            last_hb_dt = datetime.fromisoformat(last_hb.replace("Z", "+00:00"))
        else:
            last_hb_dt = last_hb

        # Ensure timezone-aware comparison
        now = datetime.now(timezone.utc)
        if last_hb_dt.tzinfo is None:
            last_hb_dt = last_hb_dt.replace(tzinfo=timezone.utc)

        elapsed = (now - last_hb_dt).total_seconds()
        return "online" if elapsed <= threshold else "offline"
    except Exception:
        return "unknown"


# ─── Endpoints ───────────────────────────────────────────────

@router.get("/devices/{device_id}/heartbeat-config")
async def get_heartbeat_config(device_id: str, current_user=Depends(get_current_active_user)):
    """Return current heartbeat settings, ACK status, and online state for a device."""
    db = get_db()
    settings = db.get_heartbeat_settings(device_id)

    if not settings:
        # Return defaults – device exists but has no heartbeat row yet
        settings = {
            "device_id": device_id,
            "enabled": True,
            "heartbeat_interval_s": 30,
            "offline_threshold_s": 90,
            "jitter_s": 3,
            "config_version": 0,
            "last_config_sent_at": None,
            "last_config_ack_at": None,
            "last_ack_status": "pending",
            "last_ack_error_code": None,
            "last_ack_error_message": None,
            "last_heartbeat_at": None,
        }

    settings["online_status"] = _compute_online_status(settings)
    return {"success": True, "data": settings}


@router.put("/devices/{device_id}/heartbeat-config")
async def update_heartbeat_config(
    device_id: str,
    body: HeartbeatConfigUpdate,
    current_user=Depends(get_current_active_user),
):
    """Persist heartbeat settings, increment config_version, publish retained MQTT config."""
    db = get_db()

    # Persist and get the updated row (with new config_version)
    updated = db.upsert_heartbeat_settings(device_id, body.dict())
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to save heartbeat settings")

    config_version = updated["config_version"]

    # Build MQTT payload
    config_payload = {
        "device_id": device_id,
        "config_version": config_version,
        "ts": datetime.now(timezone.utc).isoformat(),
        "heartbeat_interval_s": body.heartbeat_interval_s,
        "offline_threshold_s": body.offline_threshold_s,
        "jitter_s": body.jitter_s,
        "enabled": body.enabled,
    }

    # Publish as retained so a rebooted device always gets the latest config
    mqtt_client = _get_mqtt_client()
    if mqtt_client:
        topic = f"cc/devices/{device_id}/heartbeat_config/set"
        try:
            mqtt_client.publish(
                topic,
                json.dumps(config_payload),
                qos=1,
                retain=True,
            )
            logger.info(f"Published heartbeat config to {topic} (v{config_version})")
        except Exception as e:
            logger.error(f"Failed to publish heartbeat config: {e}")
    else:
        logger.warning("MQTT client not available – config saved in DB only")

    updated["online_status"] = _compute_online_status(updated)
    return {"success": True, "data": updated, "message": f"Config v{config_version} published"}


@router.get("/heartbeat/settings")
async def get_all_heartbeat_settings(current_user=Depends(get_current_active_user)):
    """Return heartbeat settings for every device that has one."""
    db = get_db()
    rows = db.get_all_heartbeat_settings()
    for r in rows:
        r["online_status"] = _compute_online_status(r)
    return list_response(rows, "settings")
