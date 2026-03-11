"""
Settings API for configurable map locations and other application settings.
"""
import os
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from Database.authentication.auth import get_current_active_user
from routes.utils import logger

router = APIRouter(prefix="/api", tags=["Settings"])

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'settings.json')

DEFAULT_LOCATIONS = {
    "home": {
        "name": "Headquarters",
        "latitude": 44.55221753,
        "longitude": 20.49456016,
        "zoom": 16
    },
    "responsibleArea": {
        "name": "UAE",
        "latitude": 24.3004247,
        "longitude": 54.5831548,
        "zoom": 7.3
    }
}


class LocationModel(BaseModel):
    name: str = Field(..., description="Location name")
    latitude: float = Field(..., ge=-90, le=90, description="Latitude")
    longitude: float = Field(..., ge=-180, le=180, description="Longitude")
    zoom: float = Field(default=15, ge=1, le=22, description="Map zoom level")


class LocationsUpdate(BaseModel):
    home: Optional[LocationModel] = None
    responsibleArea: Optional[LocationModel] = None


def load_settings():
    """Load settings from file or return defaults."""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
                return {**{"locations": DEFAULT_LOCATIONS}, **settings}
    except Exception as e:
        logger.error(f"Error loading settings: {e}")
    return {"locations": DEFAULT_LOCATIONS}


def save_settings(settings: dict):
    """Save settings to file."""
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving settings: {e}")
        return False


@router.get("/settings/locations")
async def get_locations(current_user=Depends(get_current_active_user)):
    """Get configured map locations (home and responsible area)."""
    try:
        settings = load_settings()
        locations = settings.get("locations", DEFAULT_LOCATIONS)
        return {
            "success": True,
            "data": locations
        }
    except Exception as e:
        logger.error(f"Get locations error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/settings/locations")
async def update_locations(
    locations: LocationsUpdate,
    current_user=Depends(get_current_active_user)
):
    """Update map locations (requires authentication)."""
    try:
        settings = load_settings()
        current_locations = settings.get("locations", DEFAULT_LOCATIONS.copy())
        
        if locations.home:
            current_locations["home"] = locations.home.model_dump()
        if locations.responsibleArea:
            current_locations["responsibleArea"] = locations.responsibleArea.model_dump()
        
        settings["locations"] = current_locations
        
        if save_settings(settings):
            return {
                "success": True,
                "message": "Locations updated successfully",
                "data": current_locations
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to save settings")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update locations error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/settings")
async def get_all_settings(current_user=Depends(get_current_active_user)):
    """Get all application settings."""
    try:
        settings = load_settings()
        return {
            "success": True,
            "data": settings
        }
    except Exception as e:
        logger.error(f"Get settings error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
