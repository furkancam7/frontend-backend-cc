from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime
import re

class BaseModelConfig(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,  
        str_strip_whitespace=True,  
        validate_assignment=True,  
        extra="ignore" 
    )

class UserLogin(BaseModelConfig):
    username: str = Field(..., min_length=3, max_length=50, description="Username")
    password: str = Field(..., min_length=4, description="Password")  # Reduced for testing
    @field_validator('username')
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9_]+$', v):
            raise ValueError('Username must be alphanumeric (letters, numbers, underscore only)')
        return v.lower()  

class Token(BaseModelConfig):
    access_token: str
    refresh_token: Optional[str] = None  
    token_type: str = "bearer"
    user: Dict[str, str]
    expires_in: Optional[int] = None  

class TokenRefresh(BaseModelConfig):
    refresh_token: str = Field(..., min_length=10, description="Refresh token")

class TokenData(BaseModelConfig):
    username: Optional[str] = None
    role: Optional[str] = None
    exp: Optional[datetime] = None

class UserCreate(BaseModelConfig):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    role: str = Field(default="viewer", pattern="^(admin|editor|viewer)$")
    
    @field_validator('username')
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9_]+$', v):
            raise ValueError('Username must be alphanumeric')
        return v.lower()
    
    @field_validator('email')
    @classmethod
    def email_format(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', v):
            raise ValueError('Invalid email format')
        return v.lower()
    
    @field_validator('password')
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters')
        return v

class UserUpdate(BaseModelConfig):
    email: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = Field(None, pattern="^(admin|editor|viewer)$")
    is_active: Optional[bool] = None
    
    @field_validator('email')
    @classmethod
    def email_format(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', v):
            raise ValueError('Invalid email format')
        return v.lower()

class UserPasswordChange(BaseModelConfig):
    current_password: str = Field(..., min_length=6)
    new_password: str = Field(..., min_length=6, max_length=100)
    @field_validator('new_password')
    @classmethod
    def passwords_different(cls, v: str, info) -> str:
        return v

class UserResponse(BaseModelConfig):
    username: str
    email: Optional[str] = None
    role: str
    is_active: bool = True
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

class UserListResponse(BaseModelConfig):
    users: List[UserResponse]
    total: int

class Location(BaseModelConfig):
    latitude: Optional[float] = Field(None, ge=-90, le=90, description="Latitude (-90 to +90)")
    longitude: Optional[float] = Field(None, ge=-180, le=180, description="Longitude (-180 to +180)")
    address: Optional[str] = Field(None, max_length=500)
    
    @field_validator('latitude', 'longitude')
    @classmethod
    def validate_coordinates(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v != v):  
            raise ValueError('Coordinate cannot be NaN')
        return v

class BBox(BaseModelConfig):
    x1: float = Field(..., ge=0, description="Left x coordinate")
    y1: float = Field(..., ge=0, description="Top y coordinate")
    x2: float = Field(..., ge=0, description="Right x coordinate")
    y2: float = Field(..., ge=0, description="Bottom y coordinate")
    
    @field_validator('x2')
    @classmethod
    def x2_greater_than_x1(cls, v: float, info) -> float:
        x1 = info.data.get('x1')
        if x1 is not None and v < x1:
            raise ValueError('x2 must be greater than or equal to x1')
        return v
    
    @field_validator('y2')
    @classmethod
    def y2_greater_than_y1(cls, v: float, info) -> float:
        y1 = info.data.get('y1')
        if y1 is not None and v < y1:
            raise ValueError('y2 must be greater than or equal to y1')
        return v

class Crop(BaseModelConfig):
    crop_id: int = Field(..., ge=0)
    class_name: str = Field(..., alias="class", min_length=1, max_length=100)
    accuracy: float = Field(..., ge=0, le=1, description="Detection accuracy (0-1)")
    solo_id: Optional[str] = Field(None, max_length=50)
    captured_time: Optional[datetime] = None
    record_id: int = Field(..., ge=0)
    location: Optional[Location] = None
    bbox: Optional[BBox] = None
    crop_image_path: Optional[str] = Field(None, max_length=1000)

class CropDetail(Crop):
    image_dimensions: Optional[Dict[str, int]] = None

class DeviceBattery(BaseModelConfig):
    capacity: Optional[int] = Field(None, ge=0, le=100000, description="Battery capacity in mAh")
    percentage: Optional[float] = Field(None, ge=0, le=100, description="Battery percentage (0-100)")
    remaining_days: Optional[float] = Field(None, ge=0, description="Estimated remaining days")
    status: str = Field(..., pattern="^(charging|discharging|full|unknown|critical|low)$")

class DeviceLastLocation(Location):
    timestamp: Optional[datetime] = None

class Device(BaseModelConfig):
    device_id: str = Field(..., min_length=1, max_length=100)
    location: Optional[Location] = None
    battery: Optional[DeviceBattery] = None
    last_known_location: Optional[DeviceLastLocation] = None
    status: str = Field(..., pattern="^(online|offline|idle|active|error|maintenance)$")
    last_detection: Optional[datetime] = None

class FullFrame(BaseModelConfig):
    record_id: int = Field(..., ge=0)
    file_path: str = Field(..., min_length=1, max_length=1000)
    file_size: int = Field(..., ge=0, description="File size in bytes")
    file_hash: str = Field(..., min_length=32, max_length=128, description="File hash (MD5/SHA)")
    dimensions: Dict[str, int]
    timestamp: Optional[datetime] = None
    device_id: str = Field(..., min_length=1, max_length=100)
    detections: List[Crop] = Field(default_factory=list)
    detection_count: int = Field(..., ge=0)

class MapMarker(BaseModelConfig):
    device_id: str = Field(..., min_length=1, max_length=100)
    location: Location
    detection_count: int = Field(..., ge=0)
    last_detection: Optional[datetime] = None

class Stats(BaseModelConfig):
    total_records: int = Field(..., ge=0)
    total_detections: int = Field(..., ge=0)
    total_devices: int = Field(..., ge=0)
    active_devices_24h: int = Field(..., ge=0)

class CreateDeviceRequest(BaseModelConfig):
    device_id: str = Field(..., min_length=1, max_length=100)
    address: Optional[str] = Field("", max_length=500)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)

class UpdateDeviceRequest(BaseModelConfig):
    address: Optional[str] = Field(None, max_length=500)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)

class UpdateCropRequest(BaseModelConfig):
    class_name: Optional[str] = Field(None, alias="class", min_length=1, max_length=100)
    confidence: Optional[float] = Field(None, ge=0, le=1)

class UpdateRecordRequest(BaseModelConfig):
    device_id: str = Field(..., min_length=1, max_length=100)

