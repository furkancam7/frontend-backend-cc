import json
import sys
from pathlib import Path

COMMAND_CENTER_DIR = Path(__file__).resolve().parents[1]
if str(COMMAND_CENTER_DIR) not in sys.path:
    sys.path.insert(0, str(COMMAND_CENTER_DIR))

from mqtt.remote_management import handle_remote_management_message


class FakeDB:
    def __init__(self, updated_result=None):
        self.updated_result = updated_result or {
            "device_id": "TOWER-001",
            "request_id": "req-1",
            "request_state": "finalized",
            "ack_status": "applied",
        }
        self.applied_payloads = []
        self.system_events = []

    def get_remote_device(self, device_id):
        return {
            "device_id": device_id,
            "current_status": "online",
        }

    def record_inference_config_applied(self, payload):
        self.applied_payloads.append(payload)
        return self.updated_result

    def record_system_event(self, payload):
        self.system_events.append(payload)
        return payload


def test_inference_ack_uses_topic_device_id_for_db_match():
    db = FakeDB()
    payload = {
        "device_id": "WRONG-DEVICE",
        "component": "inference",
        "request_id": "req-1",
        "config_version": 4,
        "status": "applied",
        "applied": True,
        "applied_at": "2026-03-11T11:07:27.752751+00:00",
        "changed_keys": ["TEMPORAL_RATIO"],
        "errors": [],
        "container": {"name": "stopfires-inference", "state": "healthy"},
        "effective_settings": {"TEMPORAL_RATIO": 0.8},
    }

    event = handle_remote_management_message(
        db,
        "devices/TOWER-001/inference/config/applied",
        json.dumps(payload).encode("utf-8"),
    )

    assert db.applied_payloads[0]["device_id"] == "TOWER-001"
    assert db.applied_payloads[0]["raw_json"]["device_id"] == "WRONG-DEVICE"
    assert db.system_events[0]["event_type"] == "inference_config_ack_device_mismatch"
    assert db.system_events[0]["payload"]["topic_device_id"] == "TOWER-001"
    assert db.system_events[0]["payload"]["payload_device_id"] == "WRONG-DEVICE"
    assert event["event_type"] == "inference_config_applied"
