import sys
from pathlib import Path

from pydantic import ValidationError

COMMAND_CENTER_DIR = Path(__file__).resolve().parents[1]
if str(COMMAND_CENTER_DIR) not in sys.path:
    sys.path.insert(0, str(COMMAND_CENTER_DIR))

from mqtt.inference_config import (
    InferenceDesiredRequest,
    build_inference_applied_topic,
    build_inference_desired_topic,
    normalize_inference_ack,
)


def test_inference_desired_rejects_unknown_key():
    payload = {
        "request_id": "req-1",
        "config_version": 1,
        "settings": {
            "CONFIDENCE": 0.5,
            "UNKNOWN_FIELD": True,
        },
    }

    try:
        InferenceDesiredRequest.model_validate(payload)
        assert False, "ValidationError expected"
    except ValidationError as exc:
        assert "UNKNOWN_FIELD" in str(exc)


def test_inference_desired_rejects_string_boolean():
    payload = {
        "request_id": "req-1",
        "config_version": 1,
        "settings": {
            "VIDEO_ENABLED": "true",
        },
    }

    try:
        InferenceDesiredRequest.model_validate(payload)
        assert False, "ValidationError expected"
    except ValidationError as exc:
        assert "VIDEO_ENABLED" in str(exc)


def test_normalize_inference_ack_accepts_valid_payload():
    payload = {
        "device_id": "TOWER-001",
        "component": "inference",
        "request_id": "req-2",
        "config_version": 12,
        "status": "applied",
        "applied": True,
        "applied_at": "2026-03-11T12:00:00+00:00",
        "changed_keys": ["CONFIDENCE", "VIDEO_ENABLED"],
        "errors": [],
        "container": {"name": "stopfires-inference", "state": "healthy"},
        "effective_settings": {
            "CONFIDENCE": 0.35,
            "VIDEO_ENABLED": True,
            "CLASSES": [],
        },
    }

    normalized = normalize_inference_ack(payload)

    assert normalized["status"] == "applied"
    assert normalized["effective_settings"]["VIDEO_ENABLED"] is True
    assert normalized["effective_settings"]["CLASSES"] == []


def test_inference_topics_are_exact():
    assert build_inference_desired_topic("TOWER-001") == "devices/TOWER-001/inference/config/desired"
    assert build_inference_applied_topic("TOWER-001") == "devices/TOWER-001/inference/config/applied"
