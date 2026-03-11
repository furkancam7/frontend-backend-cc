import json
import importlib.util
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

_config_spec = importlib.util.spec_from_file_location(
    "config_module",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.py"),
)
_config_module = importlib.util.module_from_spec(_config_spec)
_config_spec.loader.exec_module(_config_module)
config = _config_module.config
from Database.authentication.auth import get_current_active_user
from mqtt.inference_config import (
    InferenceDesiredRequest,
    build_inference_applied_topic,
    build_inference_desired_topic,
    merge_inference_settings,
)
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


def _latest_timestamp(*values):
    latest_dt = None
    latest_value = None
    for value in values:
        parsed = _parse_dt(value)
        if parsed and (latest_dt is None or parsed > latest_dt):
            latest_dt = parsed
            latest_value = value.isoformat() if isinstance(value, datetime) else value
    return latest_value


def _resolve_effective_status(remote: Optional[Dict], legacy: Optional[Dict]) -> str:
    remote = remote or {}
    legacy = legacy or {}

    remote_status = remote.get("current_status")
    legacy_status = legacy.get("status")

    if remote_status == "error":
        return "error"

    # Heartbeat freshness is a stronger signal for MQTT reachability than stale
    # remote-management snapshots, so let it override an aged-out remote status.
    if legacy_status == "online":
        if remote_status in {"online", "degraded"}:
            return remote_status
        return "online"

    return remote_status or legacy_status or "offline"


def _resolve_effective_mqtt_ok(remote: Optional[Dict], legacy: Optional[Dict], status: str):
    remote = remote or {}
    legacy = legacy or {}

    mqtt_ok = remote.get("mqtt_ok")
    if mqtt_ok is not None:
        return mqtt_ok

    if status in {"online", "degraded"} and legacy.get("last_heartbeat_at"):
        return True

    return None


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

    status = _resolve_effective_status(remote, legacy)
    mqtt_ok = _resolve_effective_mqtt_ok(remote, legacy, status)
    last_seen_at = _latest_timestamp(
        remote.get("last_seen_at"),
        legacy.get("last_heartbeat_at"),
    )

    return {
        "device_id": remote.get("device_id") or legacy.get("device_id"),
        "type": legacy.get("type") or "tower",
        "location": legacy.get("location") or {"latitude": None, "longitude": None, "address": None},
        "last_known_location": legacy.get("last_known_location"),
        "status": status,
        "current_status": status,
        "last_seen_at": last_seen_at,
        "last_detection": legacy.get("last_detection"),
        "last_heartbeat_at": legacy.get("last_heartbeat_at"),
        "direction": legacy.get("direction"),
        "mqtt_ok": mqtt_ok,
        "tailscale_ok": remote.get("tailscale_ok"),
        "reverse_tunnel_ok": remote.get("reverse_tunnel_ok"),
        "ssh_ready": remote.get("ssh_ready"),
        "primary_interface": remote.get("primary_interface") or network_state.get("primary_interface"),
        "public_egress_ip": remote.get("public_egress_ip") or network_state.get("public_egress_ip"),
        "local_ip": remote.get("local_ip") or network_state.get("local_ip"),
        "tailscale_ip": remote.get("tailscale_ip") or network_state.get("tailscale_ip"),
        "current_config_version": remote.get("current_config_version"),
        "current_inference_config_version": remote.get("current_inference_config_version"),
        "current_inference_request_id": remote.get("current_inference_request_id"),
        "current_inference_status": remote.get("current_inference_status"),
        "last_inference_applied_at": remote.get("last_inference_applied_at"),
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


def _mqtt_client_id(client) -> str:
    client_id = getattr(client, "_client_id", "")
    if isinstance(client_id, (bytes, bytearray)):
        return client_id.decode("utf-8", errors="replace")
    return str(client_id or "")


def _mqtt_publish(
    topic: str,
    payload: Dict,
    *,
    qos: int = 1,
    retain: bool = False,
    require_confirm: bool = False,
    confirm_timeout_s: Optional[int] = None,
) -> Dict:
    client = get_mqtt_client()
    if not client:
        raise HTTPException(status_code=503, detail="MQTT client is not available")

    client_connected = bool(getattr(client, "is_connected", lambda: False)())
    publish_meta = {
        "topic": topic,
        "broker_host": config.MQTT_BROKER,
        "broker_port": config.MQTT_PORT,
        "qos": qos,
        "retain": retain,
        "client_id": _mqtt_client_id(client),
        "client_connected": client_connected,
        "publish_confirm_timeout_s": confirm_timeout_s,
    }
    if not client_connected:
        exc = HTTPException(status_code=503, detail="MQTT client is not connected")
        exc.publish_metadata = publish_meta
        raise exc

    message = json.dumps(payload)
    info = client.publish(topic, payload=message, qos=qos, retain=retain)
    publish_meta["rc"] = getattr(info, "rc", None)
    publish_meta["mid"] = getattr(info, "mid", None)
    publish_meta["published"] = bool(getattr(info, "is_published", lambda: False)())
    if getattr(info, "rc", 0) != 0:
        exc = HTTPException(status_code=502, detail=f"Failed to publish MQTT message to {topic}")
        exc.publish_metadata = publish_meta
        raise exc

    if require_confirm:
        timeout = confirm_timeout_s if confirm_timeout_s is not None else config.MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC
        waiter = getattr(info, "wait_for_publish", None)
        if callable(waiter):
            waiter(timeout)
        publish_meta["published"] = bool(getattr(info, "is_published", lambda: False)())
        if not publish_meta["published"]:
            exc = HTTPException(status_code=502, detail=f"Broker publish confirmation timed out for {topic}")
            exc.publish_metadata = publish_meta
            raise exc

    return publish_meta


def _notify_remote_ws(event: Dict):
    try:
        from app import notify_remote_management_update
        notify_remote_management_update(event)
    except Exception as e:
        logger.warning(f"Remote websocket notify failed: {e}")


def _sweep_inference_timeouts(db):
    rows = db.mark_timed_out_inference_requests(config.INFERENCE_CONFIG_ACK_TIMEOUT_SEC)
    for row in rows:
        _notify_remote_ws({
            "event_type": "inference_config_timeout",
            "device_id": row.get("device_id"),
            "data": row,
            "received_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def _find_latest_system_event(db, device_id: str, event_types: List[str], limit: int = 25) -> Optional[Dict]:
    try:
        rows = db.get_system_events(device_id, limit=limit)
    except Exception:
        return None

    allowed = set(event_types)
    return next((row for row in rows if row.get("event_type") in allowed), None)


def _build_inference_ack_event(summary: Dict, device_id: str) -> Optional[Dict]:
    for row in summary.get("history") or []:
        if row.get("ack_received_at"):
            return {
                "request_id": row.get("request_id"),
                "config_version": row.get("config_version"),
                "ack_status": row.get("ack_status"),
                "applied": row.get("applied"),
                "ack_received_at": row.get("ack_received_at"),
                "applied_at": row.get("applied_at"),
                "late_ack": row.get("late_ack"),
                "errors": row.get("errors_json") or [],
                "topic": build_inference_applied_topic(device_id),
            }
    return None


def _build_inference_transport(db, device_id: str, summary: Dict) -> Dict:
    pending_request = summary.get("pending_request") or {}
    pending_created_at = _parse_dt(pending_request.get("created_at"))
    pending_age_s = None
    if pending_created_at:
        pending_age_s = max(0, int((datetime.now(timezone.utc) - pending_created_at).total_seconds()))

    return {
        "desired_topic": build_inference_desired_topic(device_id),
        "applied_topic": build_inference_applied_topic(device_id),
        "broker_host": config.MQTT_BROKER,
        "broker_port": config.MQTT_PORT,
        "qos": 1,
        "retain": False,
        "publish_confirm_timeout_s": config.MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC,
        "pending_age_s": pending_age_s,
        "last_publish_event": _find_latest_system_event(
            db,
            device_id,
            ["inference_config_publish_confirmed", "inference_config_publish_failed"],
        ),
        "last_ack_event": _build_inference_ack_event(summary, device_id),
    }


def _build_inference_config_response(db, device_id: str, limit: int = 20) -> Dict:
    summary = db.get_inference_config_summary(device_id, limit=limit)
    try:
        device_view = next(
            (item for item in _build_devices_for_response(db) if item.get("device_id") == device_id),
            None,
        )
    except Exception:
        device_view = None

    if device_view:
        summary["device"] = {
            **(summary.get("device") or {}),
            "device_id": device_id,
            "current_status": device_view.get("current_status") or device_view.get("status") or "offline",
            "mqtt_ok": device_view.get("mqtt_ok"),
            "last_seen_at": device_view.get("last_seen_at") or (summary.get("device") or {}).get("last_seen_at"),
            "last_heartbeat_at": device_view.get("last_heartbeat_at"),
        }
    summary["ack_timeout_s"] = config.INFERENCE_CONFIG_ACK_TIMEOUT_SEC
    summary["transport"] = _build_inference_transport(db, device_id, summary)
    return summary


def _publish_inference_config(device_id: str, payload: Dict) -> Dict:
    topic = build_inference_desired_topic(device_id)
    return _mqtt_publish(
        topic,
        payload,
        qos=1,
        retain=False,
        require_confirm=True,
        confirm_timeout_s=config.MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC,
    )


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


@router.get("/devices/{device_id}/inference-config", response_model=dict)
async def get_inference_config(
    device_id: str,
    limit: int = Query(20, ge=1, le=200),
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        _sweep_inference_timeouts(db)
        summary = _build_inference_config_response(db, device_id, limit=limit)
        return {"success": True, "data": summary}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get inference config error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/devices/{device_id}/inference-config", response_model=dict)
async def post_inference_config(
    device_id: str,
    body: InferenceDesiredRequest,
    current_user=Depends(get_current_active_user),
):
    db = get_db()
    try:
        _sweep_inference_timeouts(db)
        summary = _build_inference_config_response(db, device_id, limit=20)
        device_state = summary.get("device") or {}

        if device_state.get("current_status") in {"offline", "error"} or device_state.get("mqtt_ok") is False:
            raise HTTPException(status_code=409, detail="Device is offline or MQTT unavailable")

        base_settings = ((summary.get("current") or {}).get("settings") or {})
        patch_settings = body.settings.model_dump(exclude_none=True)
        changed_settings = {
            key: value
            for key, value in patch_settings.items()
            if base_settings.get(key) != value
        }
        if not changed_settings:
            raise HTTPException(status_code=422, detail="No settings changes to publish")

        request_payload = {
            "request_id": body.request_id,
            "config_version": body.config_version,
            "settings": changed_settings,
        }
        publish_context = {
            "device_id": device_id,
            "request_id": body.request_id,
            "config_version": body.config_version,
            "desired_topic": build_inference_desired_topic(device_id),
            "applied_topic": build_inference_applied_topic(device_id),
            "broker_host": config.MQTT_BROKER,
            "broker_port": config.MQTT_PORT,
            "qos": 1,
            "retain": False,
            "publish_confirm_timeout_s": config.MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC,
            "changed_keys": sorted(changed_settings.keys()),
        }
        merged_settings = merge_inference_settings(base_settings, changed_settings)

        existing_request = db.get_inference_config_request(device_id, body.request_id)
        if existing_request:
            same_payload = (
                int(existing_request.get("config_version") or 0) == int(body.config_version)
                and (existing_request.get("request_json") or {}).get("settings") == changed_settings
            )
            if not same_payload:
                raise HTTPException(status_code=409, detail="request_id already exists with different payload")

            if existing_request.get("request_state") == "publish_failed":
                stored = db.retry_inference_config_request(device_id, body.request_id) or existing_request
            else:
                return {
                    "success": True,
                    "message": "Inference config request already exists",
                    "data": {
                        "device_id": device_id,
                        "topic": build_inference_desired_topic(device_id),
                        "request": existing_request,
                    },
                }
        else:
            pending_request = summary.get("pending_request")
            if pending_request:
                raise HTTPException(status_code=409, detail="Another inference config request is still pending")

            latest_version = max(int(summary.get("next_config_version") or 1) - 1, 0)
            if body.config_version <= latest_version:
                raise HTTPException(status_code=409, detail="config_version must be greater than the latest request version")

            stored = db.record_inference_config_desired(
                device_id=device_id,
                request_id=body.request_id,
                config_version=body.config_version,
                settings_patch_json=changed_settings,
                base_settings_json=base_settings,
                merged_settings_json=merged_settings,
                request_json=request_payload,
                created_by=current_user.username,
            )
            if not stored:
                raise HTTPException(status_code=409, detail="Failed to store inference config request")

        try:
            publish_meta = _publish_inference_config(device_id, request_payload)
            db.record_system_event({
                "device_id": device_id,
                "event_type": "inference_config_publish_confirmed",
                "severity": "info",
                "message": f"Inference config publish confirmed for {body.request_id}",
                "payload": {
                    **publish_context,
                    **publish_meta,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }, touch_last_seen=False)
        except HTTPException as exc:
            db.record_inference_config_publish_failed(
                device_id,
                body.request_id,
                exc.detail,
                payload={
                    **publish_context,
                    **(getattr(exc, "publish_metadata", {}) or {}),
                    "error": exc.detail,
                },
            )
            raise
        except Exception as exc:
            db.record_inference_config_publish_failed(
                device_id,
                body.request_id,
                str(exc),
                payload={
                    **publish_context,
                    "error": str(exc),
                },
            )
            raise HTTPException(status_code=502, detail="Failed to publish MQTT message")

        _notify_remote_ws({
            "event_type": "inference_config_desired",
            "device_id": device_id,
            "topic": publish_meta["topic"],
            "data": request_payload,
            "request": db.get_inference_config_request(device_id, body.request_id) or stored,
            "received_at": datetime.now(timezone.utc).isoformat(),
        })

        return {
            "success": True,
            "message": "Inference config published",
            "data": {
                "device_id": device_id,
                "topic": publish_meta["topic"],
                "request": db.get_inference_config_request(device_id, body.request_id) or stored,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post inference config error: {e}")
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
