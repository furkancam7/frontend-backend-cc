import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr, ValidationError, field_validator

INFERENCE_ACK_STATUSES = {
    "applied",
    "rejected",
    "duplicate",
    "rolled_back",
    "rollback_failed",
}


def _parse_iso(value: Any) -> str:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class InferenceSettingsPatch(BaseModel):
    model_config = {"extra": "forbid"}

    NVIDIA_DRIVER_CAPABILITIES: Optional[StrictStr] = None
    MODEL_PATH: Optional[StrictStr] = None
    CAMERA_URL: Optional[StrictStr] = None
    PAYLOAD_DIR: Optional[StrictStr] = None
    TOWER_ID: Optional[StrictStr] = None
    MODEL_NAME: Optional[StrictStr] = None
    CONFIDENCE: Optional[StrictFloat | StrictInt] = None
    DEVICE: Optional[StrictStr] = None
    IMGSZ: Optional[StrictInt] = None
    CLASSES: Optional[list] = None
    TRACKER_CONFIG: Optional[StrictStr] = None
    TEMPORAL_WINDOW_SEC: Optional[StrictFloat | StrictInt] = None
    TEMPORAL_RATIO: Optional[StrictFloat | StrictInt] = None
    DRIFT_BASE: Optional[StrictFloat | StrictInt] = None
    DRIFT_SCALE: Optional[StrictFloat | StrictInt] = None
    MIN_EXPANSION_RATE: Optional[StrictFloat | StrictInt] = None
    STATIC_AREA_CV: Optional[StrictFloat | StrictInt] = None
    VERTICAL_GROWTH_RATIO: Optional[StrictFloat | StrictInt] = None
    ALARM_COOLDOWN_SEC: Optional[StrictFloat | StrictInt] = None
    VIDEO_ENABLED: Optional[StrictBool] = None
    VIDEO_DIR: Optional[StrictStr] = None
    VIDEO_FPS: Optional[StrictInt] = None
    VIDEO_SEGMENT_MIN: Optional[StrictInt] = None

    @field_validator(
        "CONFIDENCE",
        "TEMPORAL_RATIO",
        "STATIC_AREA_CV",
        "VERTICAL_GROWTH_RATIO",
    )
    @classmethod
    def validate_ratio(cls, value: Optional[float]):
        if value is None:
            return value
        if not 0 <= value <= 1:
            raise ValueError("must be between 0 and 1")
        return value

    @field_validator(
        "IMGSZ",
        "VIDEO_FPS",
        "VIDEO_SEGMENT_MIN",
    )
    @classmethod
    def validate_positive_int(cls, value: Optional[int]):
        if value is None:
            return value
        if value < 0:
            raise ValueError("must be >= 0")
        return value

    @field_validator(
        "TEMPORAL_WINDOW_SEC",
        "DRIFT_BASE",
        "DRIFT_SCALE",
        "MIN_EXPANSION_RATE",
        "ALARM_COOLDOWN_SEC",
    )
    @classmethod
    def validate_non_negative_float(cls, value: Optional[float]):
        if value is None:
            return value
        if value < 0:
            raise ValueError("must be >= 0")
        return value

    @field_validator("CLASSES")
    @classmethod
    def validate_classes(cls, value: Optional[list]):
        if value is None:
            return value
        if not isinstance(value, list):
            raise ValueError("must be an array")
        return value


class InferenceDesiredRequest(BaseModel):
    model_config = {"extra": "forbid"}

    request_id: StrictStr = Field(..., min_length=1, max_length=128)
    config_version: StrictInt = Field(..., ge=1)
    settings: InferenceSettingsPatch


class InferenceAppliedAck(BaseModel):
    model_config = {"extra": "forbid"}

    device_id: StrictStr = Field(..., min_length=1, max_length=128)
    component: StrictStr
    request_id: StrictStr = Field(..., min_length=1, max_length=128)
    config_version: StrictInt = Field(..., ge=1)
    status: StrictStr
    applied: StrictBool
    applied_at: StrictStr
    changed_keys: list = Field(default_factory=list)
    errors: list = Field(default_factory=list)
    container: Dict[str, Any] = Field(default_factory=dict)
    effective_settings: InferenceSettingsPatch = Field(default_factory=InferenceSettingsPatch)

    @field_validator("component")
    @classmethod
    def validate_component(cls, value: str):
        if value != "inference":
            raise ValueError("component must be 'inference'")
        return value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str):
        if value not in INFERENCE_ACK_STATUSES:
            raise ValueError(f"unsupported status: {value}")
        return value

    @field_validator("changed_keys")
    @classmethod
    def validate_changed_keys(cls, value: list):
        if not isinstance(value, list):
            raise ValueError("changed_keys must be an array")
        invalid = [key for key in value if key not in InferenceSettingsPatch.model_fields]
        if invalid:
            raise ValueError(f"unsupported changed_keys: {', '.join(invalid)}")
        return value

    @field_validator("errors")
    @classmethod
    def validate_errors(cls, value: list):
        if not isinstance(value, list):
            raise ValueError("errors must be an array")
        return value

    @field_validator("container")
    @classmethod
    def validate_container(cls, value: Dict[str, Any]):
        if not isinstance(value, dict):
            raise ValueError("container must be an object")
        return value

    @field_validator("applied_at")
    @classmethod
    def validate_applied_at(cls, value: str):
        return _parse_iso(value)


def build_inference_desired_topic(device_id: str) -> str:
    return f"devices/{device_id}/inference/config/desired"


def build_inference_applied_topic(device_id: str) -> str:
    return f"devices/{device_id}/inference/config/applied"


def normalize_inference_settings(settings: Any) -> Dict[str, Any]:
    if isinstance(settings, InferenceSettingsPatch):
        return settings.model_dump(exclude_none=True)
    model = InferenceSettingsPatch.model_validate(settings or {})
    return model.model_dump(exclude_none=True)


def merge_inference_settings(base_settings: Optional[Dict[str, Any]], patch_settings: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    merged = dict(base_settings or {})
    merged.update(patch_settings or {})
    return merged


def normalize_inference_ack(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, (bytes, bytearray)):
        try:
            payload = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON payload: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object")

    try:
        ack = InferenceAppliedAck.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc

    return {
        "device_id": ack.device_id,
        "component": ack.component,
        "request_id": ack.request_id,
        "config_version": ack.config_version,
        "status": ack.status,
        "applied": ack.applied,
        "applied_at": ack.applied_at,
        "changed_keys": ack.changed_keys,
        "errors": ack.errors,
        "container": ack.container,
        "effective_settings": ack.effective_settings.model_dump(exclude_none=True),
        "raw_json": payload,
    }
