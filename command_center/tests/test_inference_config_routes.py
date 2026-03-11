import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

COMMAND_CENTER_DIR = Path(__file__).resolve().parents[1]
if str(COMMAND_CENTER_DIR) not in sys.path:
    sys.path.insert(0, str(COMMAND_CENTER_DIR))

from mqtt.inference_config import InferenceDesiredRequest
from routes import devices as device_routes


class FakeDB:
    def __init__(self, summary, existing_request=None):
        self.summary = summary
        self.existing_request = existing_request
        self.recorded = None
        self.publish_failed = None
        self.system_events = []

    def mark_timed_out_inference_requests(self, _timeout_seconds):
        return []

    def get_inference_config_summary(self, _device_id, limit=20):
        return {**self.summary, "history": self.summary.get("history", [])[:limit]}

    def get_inference_config_request(self, _device_id, _request_id):
        return self.existing_request

    def record_inference_config_desired(self, **kwargs):
        self.recorded = kwargs
        return {
            "request_id": kwargs["request_id"],
            "config_version": kwargs["config_version"],
            "request_state": "pending",
            "request_json": kwargs["request_json"],
        }

    def record_inference_config_publish_failed(self, device_id, request_id, error_message, payload=None):
        self.publish_failed = {
            "device_id": device_id,
            "request_id": request_id,
            "error_message": error_message,
            "payload": payload,
        }
        return {
            "request_id": request_id,
            "request_state": "publish_failed",
            "errors_json": [error_message],
        }

    def record_system_event(self, payload, touch_last_seen=True):
        event = {
            **payload,
            "touch_last_seen": touch_last_seen,
        }
        self.system_events.append(event)
        return event


def run_async(coro):
    return asyncio.run(coro)


def test_post_inference_config_rejects_offline_device(monkeypatch):
    fake_db = FakeDB({
        "device": {"current_status": "offline", "mqtt_ok": False},
        "current": {"settings": {"CONFIDENCE": 0.25}},
        "pending_request": None,
        "next_config_version": 2,
        "history": [],
    })
    monkeypatch.setattr(device_routes, "get_db", lambda: fake_db)

    body = InferenceDesiredRequest.model_validate({
        "request_id": "req-offline",
        "config_version": 2,
        "settings": {"CONFIDENCE": 0.35},
    })

    with pytest.raises(HTTPException) as exc:
        run_async(device_routes.post_inference_config("TOWER-001", body, current_user=SimpleNamespace(username="tester")))

    assert exc.value.status_code == 409


def test_post_inference_config_is_idempotent_for_same_request(monkeypatch):
    existing_request = {
        "request_id": "req-existing",
        "config_version": 4,
        "request_state": "finalized",
        "request_json": {
            "request_id": "req-existing",
            "config_version": 4,
            "settings": {"CONFIDENCE": 0.4},
        },
    }
    fake_db = FakeDB({
        "device": {"current_status": "online", "mqtt_ok": True},
        "current": {"settings": {"CONFIDENCE": 0.25}},
        "pending_request": None,
        "next_config_version": 5,
        "history": [],
    }, existing_request=existing_request)
    monkeypatch.setattr(device_routes, "get_db", lambda: fake_db)
    monkeypatch.setattr(device_routes, "_publish_inference_config", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("should not publish")))

    body = InferenceDesiredRequest.model_validate({
        "request_id": "req-existing",
        "config_version": 4,
        "settings": {"CONFIDENCE": 0.4},
    })

    result = run_async(device_routes.post_inference_config("TOWER-001", body, current_user=SimpleNamespace(username="tester")))

    assert result["success"] is True
    assert result["data"]["request"]["request_id"] == "req-existing"


def test_compose_device_view_uses_fresh_heartbeat_over_stale_remote_offline():
    remote_last_seen = "2026-03-11T08:09:54.340053+00:00"
    heartbeat_seen = "2026-03-11T08:25:10.605075+00:00"

    view = device_routes._compose_device_view(
        {
            "device_id": "TOWER-001",
            "current_status": "offline",
            "mqtt_ok": True,
            "last_seen_at": remote_last_seen,
        },
        {
            "device_id": "TOWER-001",
            "status": "online",
            "last_heartbeat_at": heartbeat_seen,
        },
    )

    assert view["current_status"] == "online"
    assert view["mqtt_ok"] is True
    assert view["last_seen_at"] == heartbeat_seen


class InferenceSummaryMergeDB:
    def get_inference_config_summary(self, _device_id, limit=20):
        return {
            "device": {
                "device_id": "TOWER-001",
                "current_status": "offline",
                "mqtt_ok": True,
                "last_seen_at": "2026-03-11T08:09:54.340053+00:00",
            },
            "current": {"settings": {}},
            "pending_request": None,
            "history": [],
            "next_config_version": 1,
        }

    def get_all_devices(self):
        return [{"value": {"device_id": "TOWER-001", "type": "tower"}}]

    def get_all_heartbeat_settings(self):
        return [{
            "device_id": "TOWER-001",
            "last_heartbeat_at": "2026-03-11T08:25:10.605075+00:00",
            "offline_threshold_s": 90,
        }]

    def get_detections_by_device(self, _device_id, limit=1):
        return []

    def list_remote_devices(self):
        return [{
            "device_id": "TOWER-001",
            "current_status": "offline",
            "mqtt_ok": True,
            "last_seen_at": "2026-03-11T08:09:54.340053+00:00",
        }]

    def get_system_events(self, _device_id, limit=25):
        return [{
            "event_type": "inference_config_publish_confirmed",
            "event_at": "2026-03-11T08:25:12.000000+00:00",
            "payload_json": {
                "device_id": "TOWER-001",
                "request_id": "req-1",
                "topic": "devices/TOWER-001/inference/config/desired",
                "mid": 14,
            },
        }][:limit]


def test_build_inference_config_response_uses_effective_device_status():
    summary = device_routes._build_inference_config_response(InferenceSummaryMergeDB(), "TOWER-001", limit=20)

    assert summary["device"]["current_status"] == "online"
    assert summary["device"]["mqtt_ok"] is True
    assert summary["device"]["last_seen_at"] == "2026-03-11T08:25:10.605075+00:00"
    assert summary["transport"]["desired_topic"] == "devices/TOWER-001/inference/config/desired"
    assert summary["transport"]["applied_topic"] == "devices/TOWER-001/inference/config/applied"
    assert summary["transport"]["last_publish_event"]["event_type"] == "inference_config_publish_confirmed"


class FakePublishInfo:
    def __init__(self, *, rc=0, mid=1, published=True):
        self.rc = rc
        self.mid = mid
        self._published = published
        self.wait_calls = []

    def wait_for_publish(self, timeout=None):
        self.wait_calls.append(timeout)

    def is_published(self):
        return self._published


class FakeMQTTClient:
    def __init__(self, info, *, connected=True, client_id=b"test-client"):
        self.info = info
        self._connected = connected
        self._client_id = client_id
        self.calls = []

    def is_connected(self):
        return self._connected

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.calls.append({
            "topic": topic,
            "payload": payload,
            "qos": qos,
            "retain": retain,
        })
        return self.info


def test_mqtt_publish_returns_confirmed_metadata(monkeypatch):
    info = FakePublishInfo(rc=0, mid=7, published=True)
    client = FakeMQTTClient(info)
    monkeypatch.setattr(device_routes, "get_mqtt_client", lambda: client)

    result = device_routes._mqtt_publish(
        "devices/TOWER-001/inference/config/desired",
        {"request_id": "req-1"},
        require_confirm=True,
        confirm_timeout_s=2,
    )

    assert result["topic"] == "devices/TOWER-001/inference/config/desired"
    assert result["mid"] == 7
    assert result["published"] is True
    assert info.wait_calls == [2]


def test_mqtt_publish_raises_when_broker_confirm_times_out(monkeypatch):
    info = FakePublishInfo(rc=0, mid=9, published=False)
    client = FakeMQTTClient(info)
    monkeypatch.setattr(device_routes, "get_mqtt_client", lambda: client)

    with pytest.raises(HTTPException) as exc:
        device_routes._mqtt_publish(
            "devices/TOWER-001/inference/config/desired",
            {"request_id": "req-1"},
            require_confirm=True,
            confirm_timeout_s=2,
        )

    assert exc.value.status_code == 502
    assert "Broker publish confirmation timed out" in exc.value.detail
    assert getattr(exc.value, "publish_metadata")["mid"] == 9


def test_post_inference_config_marks_publish_failed_on_broker_confirm_failure(monkeypatch):
    fake_db = FakeDB({
        "device": {"current_status": "online", "mqtt_ok": True},
        "current": {"settings": {"CONFIDENCE": 0.25}},
        "pending_request": None,
        "next_config_version": 2,
        "history": [],
    })
    monkeypatch.setattr(device_routes, "get_db", lambda: fake_db)

    def fail_publish(*_args, **_kwargs):
        exc = HTTPException(status_code=502, detail="Broker publish confirmation timed out for devices/TOWER-001/inference/config/desired")
        exc.publish_metadata = {"mid": 42, "topic": "devices/TOWER-001/inference/config/desired"}
        raise exc

    monkeypatch.setattr(device_routes, "_publish_inference_config", fail_publish)

    body = InferenceDesiredRequest.model_validate({
        "request_id": "req-fail",
        "config_version": 2,
        "settings": {"CONFIDENCE": 0.35},
    })

    with pytest.raises(HTTPException) as exc:
        run_async(device_routes.post_inference_config("TOWER-001", body, current_user=SimpleNamespace(username="tester")))

    assert exc.value.status_code == 502
    assert fake_db.publish_failed["request_id"] == "req-fail"
    assert fake_db.publish_failed["payload"]["topic"] == "devices/TOWER-001/inference/config/desired"
    assert fake_db.publish_failed["payload"]["mid"] == 42


def test_post_inference_config_uses_canonical_device_id_in_request_and_publish(monkeypatch):
    fake_db = FakeDB({
        "device": {"current_status": "online", "mqtt_ok": True},
        "current": {"settings": {"CONFIDENCE": 0.25}},
        "pending_request": None,
        "next_config_version": 2,
        "history": [],
    })
    monkeypatch.setattr(device_routes, "get_db", lambda: fake_db)

    published = {}

    def capture_publish(device_id, payload):
        published["device_id"] = device_id
        published["payload"] = payload
        return {
            "topic": "devices/TOWER-001/inference/config/desired",
            "mid": 11,
            "published": True,
            "broker_host": "mosquitto",
            "broker_port": 1883,
            "qos": 1,
            "retain": False,
            "client_connected": True,
            "publish_confirm_timeout_s": 2,
        }

    monkeypatch.setattr(device_routes, "_publish_inference_config", capture_publish)
    monkeypatch.setattr(device_routes, "_notify_remote_ws", lambda *_args, **_kwargs: None)

    body = InferenceDesiredRequest.model_validate({
        "request_id": "req-success",
        "config_version": 2,
        "settings": {"CONFIDENCE": 0.35},
    })

    result = run_async(device_routes.post_inference_config("TOWER-001", body, current_user=SimpleNamespace(username="tester")))

    assert result["success"] is True
    assert published["device_id"] == "TOWER-001"
    assert "device_id" not in published["payload"]
    assert "device_id" not in fake_db.recorded["request_json"]
    assert fake_db.system_events[-1]["payload"]["device_id"] == "TOWER-001"
    assert fake_db.system_events[-1]["payload"]["request_id"] == "req-success"


def test_build_inference_config_response_includes_pending_age_and_ack_event():
    now = datetime.now(timezone.utc)

    class TransportDB(InferenceSummaryMergeDB):
        def get_inference_config_summary(self, _device_id, limit=20):
            return {
                "device": {
                    "device_id": "TOWER-001",
                    "current_status": "offline",
                    "mqtt_ok": True,
                    "last_seen_at": "2026-03-11T08:09:54.340053+00:00",
                },
                "current": {"settings": {}},
                "pending_request": {
                    "request_id": "req-pending",
                    "created_at": (now - timedelta(seconds=75)).isoformat(),
                },
                "history": [{
                    "request_id": "req-ack",
                    "config_version": 1,
                    "ack_status": "applied",
                    "applied": True,
                    "ack_received_at": now.isoformat(),
                    "applied_at": now.isoformat(),
                    "late_ack": False,
                    "errors_json": [],
                }],
                "next_config_version": 2,
            }

    summary = device_routes._build_inference_config_response(TransportDB(), "TOWER-001", limit=20)

    assert summary["transport"]["pending_age_s"] >= 75
    assert summary["transport"]["last_ack_event"]["topic"] == "devices/TOWER-001/inference/config/applied"
    assert summary["transport"]["publish_confirm_timeout_s"] == device_routes.config.MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC
