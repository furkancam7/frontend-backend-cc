import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from mqtt.inference_config import normalize_inference_ack

logger = logging.getLogger(__name__)

ACCESS_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/state/access$")
NETWORK_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/state/network$")
CONFIG_APPLIED_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/config/applied$")
INFERENCE_CONFIG_APPLIED_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/inference/config/applied$")
COMMAND_RESULT_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/cmd/result$")
SYSTEM_EVENT_TOPIC_RE = re.compile(r"^devices/(?P<device_id>[^/]+)/events/system$")

REMOTE_SUBSCRIBE_TOPICS = [
    ("devices/+/state/access", 1),
    ("devices/+/state/network", 1),
    ("devices/+/config/applied", 1),
    ("devices/+/inference/config/applied", 1),
    ("devices/+/cmd/result", 1),
    ("devices/+/events/system", 1),
]

SUPPORTED_CONFIG_FIELDS = {
    "config_version",
    "heartbeat_interval_s",
    "network_snapshot_interval_s",
    "access_check_interval_s",
    "reverse_tunnel_enabled",
    "tailscale_required",
}

SUPPORTED_COMMAND_TYPES = {"reboot", "service_restart", "network_cycle"}


def _parse_iso(value: Any) -> str:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        txt = value.strip()
        if txt.endswith("Z"):
            txt = txt[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(txt)
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _ensure_json_dict(payload: bytes) -> Dict[str, Any]:
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Payload must be a JSON object")
    return parsed


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    if isinstance(value, (int, float)):
        return value != 0
    return bool(value)


def _required(data: Dict[str, Any], fields: Tuple[str, ...]):
    missing = [f for f in fields if f not in data]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")


def _normalize_access(device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    _required(payload, ("mqtt_ok", "tailscale_ok", "reverse_tunnel_ok", "ssh_ready"))
    normalized = {
        "device_id": device_id,
        "timestamp": _parse_iso(payload.get("timestamp")),
        "mqtt_ok": _as_bool(payload.get("mqtt_ok")),
        "tailscale_ok": _as_bool(payload.get("tailscale_ok")),
        "reverse_tunnel_ok": _as_bool(payload.get("reverse_tunnel_ok")),
        "ssh_ready": _as_bool(payload.get("ssh_ready")),
        "last_successful_tailscale_check_at": _parse_iso(payload.get("last_successful_tailscale_check_at"))
        if payload.get("last_successful_tailscale_check_at")
        else None,
        "last_successful_reverse_tunnel_check_at": _parse_iso(payload.get("last_successful_reverse_tunnel_check_at"))
        if payload.get("last_successful_reverse_tunnel_check_at")
        else None,
        "hostname": payload.get("hostname"),
        "raw_json": payload,
    }
    return normalized


def _normalize_network(device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    _required(payload, ("primary_interface", "default_route_interface", "public_egress_ip", "tailscale_ip", "interfaces"))
    interfaces = payload.get("interfaces")
    if not isinstance(interfaces, list):
        raise ValueError("interfaces must be a list")
    normalized = {
        "device_id": device_id,
        "timestamp": _parse_iso(payload.get("timestamp")),
        "primary_interface": payload.get("primary_interface"),
        "default_route_interface": payload.get("default_route_interface"),
        "public_egress_ip": payload.get("public_egress_ip"),
        "local_ip": payload.get("local_ip"),
        "tailscale_ip": payload.get("tailscale_ip"),
        "interfaces": interfaces,
        "hostname": payload.get("hostname"),
        "raw_json": payload,
    }
    return normalized


def _normalize_config_applied(device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    _required(payload, ("config_version", "applied"))
    normalized = {
        "device_id": device_id,
        "config_version": str(payload.get("config_version")),
        "applied": _as_bool(payload.get("applied")),
        "applied_at": _parse_iso(payload.get("applied_at")),
        "errors": payload.get("errors") if payload.get("errors") is not None else [],
        "raw_json": payload,
    }
    return normalized


def _normalize_command_result(device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    _required(payload, ("command_id", "command_type", "status"))
    normalized = {
        "device_id": device_id,
        "command_id": str(payload.get("command_id")),
        "command_type": str(payload.get("command_type")),
        "status": str(payload.get("status")),
        "finished_at": _parse_iso(payload.get("finished_at")),
        "details": payload.get("details") if payload.get("details") is not None else {},
        "raw_json": payload,
    }
    return normalized


def _normalize_system_event(device_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {
        "device_id": device_id,
        "timestamp": _parse_iso(payload.get("timestamp")),
        "event_type": payload.get("event_type") or payload.get("type") or "system",
        "severity": payload.get("severity") or "info",
        "message": payload.get("message") or payload.get("details") or "",
        "payload": payload.get("payload") if isinstance(payload.get("payload"), dict) else payload,
        "raw_json": payload,
    }
    return normalized


def handle_remote_management_message(db, topic: str, payload_bytes: bytes) -> Optional[Dict[str, Any]]:
    payload = _ensure_json_dict(payload_bytes)

    def _emit_event(event_type: str, device_id: str, data: Dict[str, Any], before_status: Optional[str], after_device: Optional[Dict[str, Any]]):
        event = {
            "event_type": event_type,
            "device_id": device_id,
            "topic": topic,
            "data": data,
            "device": after_device,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
        after_status = (after_device or {}).get("current_status")
        if before_status != after_status and after_status:
            event["status_change"] = {"from": before_status, "to": after_status}
        return event

    if match := ACCESS_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = _normalize_access(device_id, payload)
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        after = db.record_access_state(normalized)
        return _emit_event("access_state", device_id, normalized, before, after)

    if match := NETWORK_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = _normalize_network(device_id, payload)
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        after = db.record_network_state(normalized)
        return _emit_event("network_state", device_id, normalized, before, after)

    if match := CONFIG_APPLIED_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = _normalize_config_applied(device_id, payload)
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        db.record_config_applied(normalized)
        after = db.get_remote_device(device_id)
        return _emit_event("config_applied", device_id, normalized, before, after)

    if match := INFERENCE_CONFIG_APPLIED_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = normalize_inference_ack(payload)
        payload_device_id = normalized.get("device_id")
        if payload_device_id and payload_device_id != device_id:
            db.record_system_event({
                "device_id": device_id,
                "event_type": "inference_config_ack_device_mismatch",
                "severity": "warning",
                "message": "Inference config ACK payload device_id did not match MQTT topic",
                "payload": {
                    **normalized,
                    "topic_device_id": device_id,
                    "payload_device_id": payload_device_id,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        # The MQTT topic is the routing source of truth for which device this ACK belongs to.
        normalized["device_id"] = device_id
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        updated = db.record_inference_config_applied(normalized)
        if not updated:
            db.record_system_event({
                "device_id": device_id,
                "event_type": "inference_config_orphan_ack",
                "severity": "warning",
                "message": "Inference config ACK did not match a known request",
                "payload": normalized,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            after = db.get_remote_device(device_id)
            return _emit_event("inference_config_orphan_ack", device_id, normalized, before, after)
        after = db.get_remote_device(device_id)
        return _emit_event("inference_config_applied", device_id, updated, before, after)

    if match := COMMAND_RESULT_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = _normalize_command_result(device_id, payload)
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        db.record_command_result(normalized)
        after = db.get_remote_device(device_id)
        return _emit_event("command_result", device_id, normalized, before, after)

    if match := SYSTEM_EVENT_TOPIC_RE.match(topic):
        device_id = match.group("device_id")
        normalized = _normalize_system_event(device_id, payload)
        before = (db.get_remote_device(device_id) or {}).get("current_status")
        db.record_system_event(normalized)
        after = db.get_remote_device(device_id)
        return _emit_event("system_event", device_id, normalized, before, after)

    return None
