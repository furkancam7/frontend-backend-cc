import json
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from Database.authentication.auth import get_current_active_user
from mqtt.remote_management import SUPPORTED_COMMAND_TYPES
from mqtt.utils import get_mqtt_client
from routes.utils import (
    extract_location,
    get_db,
    get_field,
    get_standard_field,
    list_response,
    logger,
)

router = APIRouter(prefix="/api", tags=["Devices"])

DEFAULT_SERVICE_RESTART_NAME = os.getenv("REMOTE_SERVICE_RESTART_DEFAULT_SERVICE", "hub.service")


class DirectionUpdate(BaseModel):
    direction: float = Field(..., ge=0, le=360, description="Direction in degrees from north (0-360)")


class DeviceConfigRequest(BaseModel):
    model_config = {"extra": "forbid"}

    config_version: Optional[str] = Field(default=None, min_length=1, max_length=64)
    heartbeat_interval_s: int = Field(..., ge=5, le=3600)
    network_snapshot_interval_s: int = Field(..., ge=5, le=86400)
    access_check_interval_s: int = Field(..., ge=5, le=3600)
    reverse_tunnel_enabled: bool = Field(...)
    tailscale_required: bool = Field(...)


class CommandRequest(BaseModel):
    model_config = {"extra": "forbid"}

    payload: Dict = Field(default_factory=dict)


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _build_legacy_devices(db) -> List[Dict]:
    devices_data = db.get_all_devices()
    all_hb = {}
    try:
        hb_rows = db.get_all_heartbeat_settings()
        for row in hb_rows:
            all_hb[row["device_id"]] = row
    except Exception:
        pass

    devices = []
    for item in devices_data:
        device = item.get("value", {})
        device_id = get_standard_field(device, "device_id")
        if not device_id:
            continue

        device_type = get_field(device, "type") or "tower"
        detections = db.get_detections_by_device(device_id, limit=1) if device_id else []
        last_detection = get_standard_field(detections[0].get("value", {}), "created_at") if detections else None
        location = extract_location(device)
        last_update = get_standard_field(device, "updated_at")

        hb_settings = all_hb.get(device_id)
        last_heartbeat_at = hb_settings.get("last_heartbeat_at") if hb_settings else None
        offline_threshold_s = (hb_settings or {}).get("offline_threshold_s", 90)

        status = "offline"
        if last_heartbeat_at:
            hb_time = _parse_dt(last_heartbeat_at)
            if hb_time:
                delta = datetime.now(timezone.utc) - hb_time
                if delta.total_seconds() <= offline_threshold_s:
                    status = "online"
        else:
            update_time = _parse_dt(last_update)
            if update_time and (datetime.now(timezone.utc) - update_time) < timedelta(minutes=5):
                status = "online"
            if last_detection:
                status = "online"

        direction = get_field(device, "direction")
        if direction is not None:
            try:
                direction = float(direction)
            except (ValueError, TypeError):
                direction = None

        device_entry = {
            "device_id": device_id,
            "type": device_type,
            "location": location,
            "last_known_location": {
                **location,
                "timestamp": last_update,
            },
            "status": status,
            "last_detection": last_detection,
            "last_heartbeat_at": last_heartbeat_at,
            "direction": direction,
            "raw": device,
            "heartbeat_settings": None,
        }

        if hb_settings:
            device_entry["heartbeat_settings"] = {
                "enabled": hb_settings.get("enabled", True),
                "heartbeat_interval_s": hb_settings.get("heartbeat_interval_s", 30),
                "offline_threshold_s": hb_settings.get("offline_threshold_s", 90),
                "jitter_s": hb_settings.get("jitter_s", 3),
                "config_version": hb_settings.get("config_version", 0),
                "last_ack_status": hb_settings.get("last_ack_status", "pending"),
                "last_config_sent_at": hb_settings.get("last_config_sent_at"),
                "last_config_ack_at": hb_settings.get("last_config_ack_at"),
                "last_ack_error_code": hb_settings.get("last_ack_error_code"),
                "last_ack_error_message": hb_settings.get("last_ack_error_message"),
            }
        devices.append(device_entry)

    return devices


def _compose_device_view(remote: Optional[Dict], legacy: Optional[Dict]) -> Dict:
    legacy = legacy or {}
    remote = remote or {}
    access_state = remote.get("current_access_json") or {}
    network_state = remote.get("current_network_json") or {}

    status = (
        remote.get("current_status")
        or legacy.get("status")
        or "offline"
    )

    return {
        "device_id": remote.get("device_id") or legacy.get("device_id"),
        "type": legacy.get("type") or "tower",
        "location": legacy.get("location") or {"latitude": None, "longitude": None, "address": None},
        "last_known_location": legacy.get("last_known_location"),
        "status": status,
        "current_status": status,
        "last_seen_at": remote.get("last_seen_at"),
        "last_detection": legacy.get("last_detection"),
        "last_heartbeat_at": legacy.get("last_heartbeat_at"),
        "direction": legacy.get("direction"),
        "mqtt_ok": remote.get("mqtt_ok"),
        "tailscale_ok": remote.get("tailscale_ok"),
        "reverse_tunnel_ok": remote.get("reverse_tunnel_ok"),
        "ssh_ready": remote.get("ssh_ready"),
        "primary_interface": remote.get("primary_interface") or network_state.get("primary_interface"),
        "public_egress_ip": remote.get("public_egress_ip") or network_state.get("public_egress_ip"),
        "local_ip": remote.get("local_ip") or network_state.get("local_ip"),
        "tailscale_ip": remote.get("tailscale_ip") or network_state.get("tailscale_ip"),
        "current_config_version": remote.get("current_config_version"),
        "access_state": access_state,
        "network_state": network_state,
        "heartbeat_settings": legacy.get("heartbeat_settings"),
        "raw": legacy.get("raw") or {},
        "remote": remote or None,
    }


def _build_devices_for_response(db) -> List[Dict]:
    legacy_rows = _build_legacy_devices(db)
    legacy_map = {row["device_id"]: row for row in legacy_rows if row.get("device_id")}
    remote_rows = db.list_remote_devices()
    remote_map = {row["device_id"]: row for row in remote_rows if row.get("device_id")}

    merged = []
    seen = set()
    for device_id, remote_row in remote_map.items():
        merged.append(_compose_device_view(remote_row, legacy_map.get(device_id)))
        seen.add(device_id)

    for device_id, legacy_row in legacy_map.items():
        if device_id not in seen:
            merged.append(_compose_device_view(None, legacy_row))

    merged.sort(key=lambda d: (d.get("device_id") or ""))
    return merged


def _mqtt_publish(topic: str, payload: Dict):
    client = get_mqtt_client()
    if not client:
        raise HTTPException(status_code=503, detail="MQTT client is not available")

    message = json.dumps(payload)
    info = client.publish(topic, payload=message, qos=1)
    if getattr(info, "rc", 0) != 0:
        raise HTTPException(status_code=502, detail=f"Failed to publish MQTT message to {topic}")


def _notify_remote_ws(event: Dict):
    try:
        from app import notify_remote_management_update
        notify_remote_management_update(event)
    except Exception as e:
        logger.warning(f"Remote websocket notify failed: {e}")


def _issue_command(db, device_id: str, command_type: str, payload: Dict, issued_by: str):
    if command_type not in SUPPORTED_COMMAND_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported command type: {command_type}")

    command_id = uuid4().hex
    issued_at = datetime.now(timezone.utc).isoformat()
    payload_data = dict(payload or {})

    if command_type == "service_restart":
        requested_name = payload_data.get("service_name") or payload_data.get("service")
        if isinstance(requested_name, str):
            requested_name = requested_name.strip()
        service_name = requested_name or DEFAULT_SERVICE_RESTART_NAME
        payload_data["service_name"] = service_name

    command_payload = {
        "device_id": device_id,
        "command_id": command_id,
        "command_type": command_type,
        "issued_at": issued_at,
        "issued_by": issued_by,
        "payload": payload_data,
    }
    if command_type == "service_restart":
        # Keep a top-level copy for devices that parse flat command payloads.
        command_payload["service_name"] = payload_data["service_name"]

    stored = db.record_command_issued(
        device_id=device_id,
        command_id=command_id,
        command_type=command_type,
        payload_json=command_payload,
        issued_by=issued_by,
    )

    topic_map = {
        "reboot": f"devices/{device_id}/cmd/reboot",
        "service_restart": f"devices/{device_id}/cmd/service_restart",
        "network_cycle": f"devices/{device_id}/cmd/network_cycle",
    }
    topic = topic_map[command_type]
    _mqtt_publish(topic, command_payload)

    _notify_remote_ws({
        "event_type": "command_issued",
        "device_id": device_id,
        "topic": topic,
        "data": command_payload,
        "command": stored,
        "received_at": datetime.now(timezone.utc).isoformat(),
    })

    return {
        "topic": topic,
        "command": stored,
        "payload": command_payload,
    }


@router.get("/devices", response_model=dict)
async def get_devices(current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        devices = _build_devices_for_response(db)
        return list_response(devices, "devices")
    except Exception as e:
        logger.error(f"Get devices error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/devices/{device_id}/access-history", response_model=dict)
async def get_access_history(
    device_id: str,
    limit: int = Query(100, ge=1, le=1000),
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        rows = db.get_access_history(device_id, limit=limit)
        return {
            "success": True,
            "data": rows,
            "meta": {"count": len(rows), "device_id": device_id},
        }
    except Exception as e:
        logger.error(f"Get access history error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/devices/{device_id}/network-history", response_model=dict)
async def get_network_history(
    device_id: str,
    limit: int = Query(100, ge=1, le=1000),
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        rows = db.get_network_history(device_id, limit=limit)
        return {
            "success": True,
            "data": rows,
            "meta": {"count": len(rows), "device_id": device_id},
        }
    except Exception as e:
        logger.error(f"Get network history error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/devices/{device_id}/configs", response_model=dict)
async def get_device_configs(
    device_id: str,
    limit: int = Query(100, ge=1, le=1000),
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        desired = db.get_device_configs(device_id, limit=limit)
        applies = db.get_device_config_applies(device_id, limit=limit)
        return {
            "success": True,
            "data": {
                "desired": desired,
                "applies": applies,
            },
            "meta": {
                "desired_count": len(desired),
                "apply_count": len(applies),
                "device_id": device_id,
            },
        }
    except Exception as e:
        logger.error(f"Get device configs error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/devices/{device_id}/commands", response_model=dict)
async def get_device_commands(
    device_id: str,
    limit: int = Query(100, ge=1, le=1000),
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        rows = db.get_device_commands(device_id, limit=limit)
        return {
            "success": True,
            "data": rows,
            "meta": {"count": len(rows), "device_id": device_id},
        }
    except Exception as e:
        logger.error(f"Get device commands error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/devices/{device_id}/commands", response_model=dict)
async def clear_device_commands(
    device_id: str,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        deleted_count = db.clear_device_commands(device_id)
        _notify_remote_ws({
            "event_type": "commands_cleared",
            "device_id": device_id,
            "data": {
                "device_id": device_id,
                "deleted_count": deleted_count,
                "cleared_by": current_user.username,
            },
            "received_at": datetime.now(timezone.utc).isoformat(),
        })
        return {
            "success": True,
            "message": "Command history cleared",
            "data": {
                "device_id": device_id,
                "deleted_count": deleted_count,
            },
        }
    except Exception as e:
        logger.error(f"Clear device commands error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/devices/{device_id}", response_model=dict)
async def get_device_detail(device_id: str, current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        devices = _build_devices_for_response(db)
        device = next((d for d in devices if d.get("device_id") == device_id), None)
        if not device:
            raise HTTPException(status_code=404, detail=f"Device {device_id} not found")

        device["system_events"] = db.get_system_events(device_id, limit=50)
        return {"success": True, "data": device}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get device detail error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/devices/{device_id}/config", response_model=dict)
async def post_device_config(
    device_id: str,
    body: DeviceConfigRequest,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        config_payload = body.model_dump()
        config_version = config_payload.get("config_version") or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        config_payload["config_version"] = config_version
        config_payload["device_id"] = device_id
        config_payload["issued_at"] = datetime.now(timezone.utc).isoformat()
        config_payload["issued_by"] = current_user.username

        stored = db.record_config_desired(
            device_id=device_id,
            config_version=config_version,
            desired_json=config_payload,
            created_by=current_user.username,
        )

        topic = f"devices/{device_id}/config/desired"
        _mqtt_publish(topic, config_payload)

        _notify_remote_ws({
            "event_type": "config_desired",
            "device_id": device_id,
            "topic": topic,
            "data": config_payload,
            "config": stored,
            "received_at": datetime.now(timezone.utc).isoformat(),
        })

        return {
            "success": True,
            "message": "Config published",
            "data": {
                "device_id": device_id,
                "topic": topic,
                "config_version": config_version,
                "config": stored,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post device config error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/devices/{device_id}/commands/reboot", response_model=dict)
async def post_command_reboot(
    device_id: str,
    body: CommandRequest,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        data = _issue_command(db, device_id, "reboot", body.payload, current_user.username)
        return {"success": True, "message": "Reboot command published", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post reboot command error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/devices/{device_id}/commands/service-restart", response_model=dict)
async def post_command_service_restart(
    device_id: str,
    body: CommandRequest,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        data = _issue_command(db, device_id, "service_restart", body.payload, current_user.username)
        return {"success": True, "message": "Service restart command published", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post service restart command error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/devices/{device_id}/commands/network-cycle", response_model=dict)
async def post_command_network_cycle(
    device_id: str,
    body: CommandRequest,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        data = _issue_command(db, device_id, "network_cycle", body.payload, current_user.username)
        return {"success": True, "message": "Network cycle command published", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post network cycle command error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/map/markers", response_model=dict)
async def get_map_markers(current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        devices_data = db.get_all_devices()
        markers = []

        for item in devices_data:
            device = item.get("value", {})
            device_id = get_standard_field(device, "device_id")
            location = extract_location(device)

            if location["latitude"] is None or location["longitude"] is None:
                continue

            detections = db.get_detections_by_device(device_id) if device_id else []
            detection_count = 0
            last_detection = None

            for det_item in detections:
                det = det_item.get("value", {})
                count = get_standard_field(det, "detection_count")
                detection_count += int(count) if count else 0
                det_time = get_standard_field(det, "created_at")
                if det_time and (not last_detection or det_time > last_detection):
                    last_detection = det_time

            markers.append({
                "device_id": device_id,
                "location": location,
                "detection_count": detection_count,
                "last_detection": last_detection,
            })

        return list_response(markers, "markers")
    except Exception as e:
        logger.error(f"Get map markers error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/stats", response_model=dict)
async def get_statistics(current_user=Depends(get_current_active_user)):
    db = get_db()
    try:
        stats = db.get_stats()
        active_devices_24h = 0
        devices_data = db.get_all_devices()
        now = datetime.now(timezone.utc)

        for item in devices_data:
            device = item.get("value", {})
            last_update = get_standard_field(device, "updated_at")
            update_time = _parse_dt(last_update)
            if update_time and (now - update_time) < timedelta(hours=24):
                active_devices_24h += 1

        stats_data = {
            "total_records": stats.get("total_detections", 0),
            "total_detections": stats.get("total_crops", 0),
            "total_devices": stats.get("total_devices", 0),
            "active_devices_24h": active_devices_24h,
        }

        return {
            "success": True,
            "data": stats_data,
            "stats": stats_data,
        }
    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/device/{device_id}/direction")
async def update_device_direction(
    device_id: str,
    direction_data: DirectionUpdate,
    current_user=Depends(get_current_active_user),
):
    """Update a device's facing direction (in degrees from north, 0-360)."""
    db = get_db()
    try:
        devices_data = db.get_all_devices()
        device_found = None

        for item in devices_data:
            device = item.get("value", {})
            if get_standard_field(device, "device_id") == device_id:
                device_found = device
                break

        if not device_found:
            raise HTTPException(status_code=404, detail=f"Device {device_id} not found")

        device_found["direction"] = direction_data.direction
        device_found["updated_at"] = datetime.now(timezone.utc).isoformat()
        db.upsert_device(device_id, device_found)
        logger.info(f"Updated direction for device {device_id} to {direction_data.direction} deg")

        return {
            "success": True,
            "message": f"Direction updated to {direction_data.direction} deg",
            "data": {
                "device_id": device_id,
                "direction": direction_data.direction,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update device direction error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
