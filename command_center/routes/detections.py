"""
routes/detections.py

REST endpoints for detection events.
  GET /api/devices/{device_id}/detections     — list events (paged)
  GET /api/detections/latest                  — latest events across all devices
  GET /api/detections/{event_id}              — single event detail
  GET /api/detections/{event_id}/media        — media artefacts for event
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from Database.databasemanager.db_manager import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["detections"])


def _get_db() -> DatabaseManager:
    return DatabaseManager()


# ── list by device ──────────────────────────────────────

@router.get("/api/devices/{device_id}/detections")
def list_device_detections(
    device_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    has_detection: Optional[bool] = Query(None),
    camera_id: Optional[str] = Query(None),
    db: DatabaseManager = Depends(_get_db),
):
    """List detection events for a single device, newest first."""
    where = "WHERE device_id = %s"
    params = [device_id]

    if has_detection is not None:
        where += " AND has_detection = %s"
        params.append(has_detection)
    if camera_id:
        where += " AND camera_id = %s"
        params.append(camera_id)

    rows = db.execute_query(
        f"""
        SELECT id, event_id, device_id, camera_id, detected_at,
               model, has_detection, max_confidence, classes, boxes,
               speed_preprocess, speed_inference, speed_postprocess,
               created_at
        FROM detection_events
        {where}
        ORDER BY detected_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple([*params, limit, offset]),
        fetch_dict=True,
    )

    count_rows = db.execute_query(
        f"SELECT COUNT(*) as total FROM detection_events {where}",
        tuple(params),
        fetch_dict=True,
    )
    total = count_rows[0]["total"] if count_rows else 0

    return {
        "success": True,
        "data": _format_rows(rows),
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ── latest across all devices ───────────────────────────

@router.get("/api/detections/latest")
def latest_detections(
    limit: int = Query(20, ge=1, le=100),
    has_detection: Optional[bool] = Query(None),
    db: DatabaseManager = Depends(_get_db),
):
    """Latest detection events across all devices."""
    where = ""
    params: list = []

    if has_detection is not None:
        where = "WHERE has_detection = %s"
        params.append(has_detection)

    rows = db.execute_query(
        f"""
        SELECT id, event_id, device_id, camera_id, detected_at,
               model, has_detection, max_confidence, classes, boxes,
               speed_preprocess, speed_inference, speed_postprocess,
               created_at
        FROM detection_events
        {where}
        ORDER BY detected_at DESC
        LIMIT %s
        """,
        tuple([*params, limit]),
        fetch_dict=True,
    )

    return {"success": True, "data": _format_rows(rows)}


# ── single event detail ────────────────────────────────

@router.get("/api/detections/{event_id}")
def get_detection(
    event_id: str,
    db: DatabaseManager = Depends(_get_db),
):
    rows = db.execute_query(
        """
        SELECT id, event_id, device_id, camera_id, detected_at,
               model, has_detection, max_confidence, classes, boxes,
               inference_json,
               speed_preprocess, speed_inference, speed_postprocess,
               created_at
        FROM detection_events
        WHERE event_id = %s
        """,
        (event_id,),
        fetch_dict=True,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found")

    row = rows[0]
    data = _format_row(row)
    data["inference_json"] = row.get("inference_json")
    return {"success": True, "data": data}


# ── media for event ─────────────────────────────────────

@router.get("/api/detections/{event_id}/media")
def get_event_media(
    event_id: str,
    db: DatabaseManager = Depends(_get_db),
):
    rows = db.execute_query(
        """
        SELECT id, event_id, device_id, filename, content_type,
               size_bytes, sha256, is_placeholder, duration_s,
               chunk_count, chunks_received, fully_received,
               storage_path, created_at
        FROM detection_media
        WHERE event_id = %s
        ORDER BY created_at
        """,
        (event_id,),
        fetch_dict=True,
    )
    return {"success": True, "data": _format_rows(rows) if rows else []}


# ── helpers ─────────────────────────────────────────────

def _format_rows(rows):
    if not rows:
        return []
    return [_format_row(r) for r in rows]


def _format_row(row):
    if not row:
        return None
    r = dict(row)
    # Ensure timestamps are ISO strings
    for key in ("detected_at", "created_at"):
        if r.get(key) and hasattr(r[key], "isoformat"):
            r[key] = r[key].isoformat()
    return r
