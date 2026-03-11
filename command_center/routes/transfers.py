from fastapi import APIRouter
from typing import Dict, List
import os

router = APIRouter(prefix="/api", tags=["Transfers"])

def get_transfer_state_db():
    try:
        from Database.transfer_state_db import get_transfer_state_db as get_db
        return get_db()
    except ImportError:
        return None

def get_transfer_manager():
    try:
        from mqtt.mqtt_receiver import get_transfer_manager as get_tm
        return get_tm()
    except ImportError:
        return None

def get_metadata_buffers():
    try:
        from mqtt.mqtt_receiver import metadata_buffers
        return metadata_buffers
    except ImportError:
        return {}

@router.get("/transfers/active")
async def get_active_transfers():
    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available", "transfers": [], "count": 0}
    try:
        db.cleanup_stale(timeout_minutes=5)
    except (RuntimeError, OSError) as e:
        import logging
        logging.getLogger(__name__).debug(f"Stale cleanup skipped: {e}")

    transfers = db.get_all_active() or []  
    active_transfers = []
    for t in transfers:
        chunks_received = t.get('chunks_received', 0)
        chunks_total = t.get('chunk_total', 1)
        
        if chunks_total > 0:
            percent = min(99.9, round((chunks_received / chunks_total) * 100, 1))
        else:
            percent = 0
        
        active_transfers.append({
            "transfer_id": t.get('transfer_id'),
            "filename": t.get('filename', 'unknown'),
            "chunks_received": chunks_received,
            "chunks_total": chunks_total,
            "percent": percent,
            "status": t.get('status') or ("receiving" if chunks_received < chunks_total else "completed"),
            "started_at": t.get('started_at'),
            "record_id": t.get('record_id'),
            "hub_id": t.get('hub_id'),
            "solo_id": t.get('solo_id'),
            "partial_path": t.get('partial_path'),
            "partial_percent": t.get('partial_percent'),
            "image_status": "partial" if t.get('status') == 'partial' else "receiving",
            "updated_at": t.get('last_activity'),
        })
    
    return {
        "success": True,
        "transfers": active_transfers,
        "count": len(active_transfers)
    }

@router.delete("/transfers/active")
async def clear_active_transfers():
    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}
    
    count = db.clear_all()
    return {"success": True, "cleared_count": count}

@router.get("/transfers/status/{record_id}")
async def get_transfer_status_by_record(record_id: str):
    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}
    
    transfer = db.get_transfer_by_record_id(record_id)
    
    if transfer:
        chunks_received = transfer.get('chunks_received', 0)
        chunks_total = transfer.get('chunk_total', 1)
        percent = min(99.9, round((chunks_received / chunks_total) * 100, 1)) if chunks_total > 0 else 0
        
        return {
            "success": True,
            "status": transfer.get('status') or "receiving",
            "transfer": {
                "transfer_id": transfer.get('transfer_id'),
                "filename": transfer.get('filename', 'unknown'),
                "chunks_received": chunks_received,
                "chunks_total": chunks_total,
                "percent": percent,
                "partial_path": transfer.get('partial_path'),
                "partial_percent": transfer.get('partial_percent'),
            }
        }
    
    return {"success": True, "status": "completed", "transfer": None}

@router.get("/transfers/stats")
async def get_transfer_stats():
    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}
    
    stats = db.get_stats()
    return {
        "success": True,
        **stats
    }

@router.get("/transfers/partial")
async def get_partial_transfers():
    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}
    
    partial = db.get_partial_transfers()
    
    partial_transfers = []
    for t in partial:
        partial_transfers.append({
            "transfer_id": t.get('transfer_id'),
            "filename": t.get('filename', 'unknown'),
            "chunks_received": t.get('chunks_received', 0),
            "chunks_total": t.get('chunk_total', 0),
            "partial_percent": t.get('partial_percent', 0),
            "partial_path": t.get('partial_path'),
            "started_at": t.get('started_at'),
            "last_activity": t.get('last_activity'),
            "hub_id": t.get('hub_id'),
            "solo_id": t.get('solo_id')
        })
    
    return {
        "success": True,
        "partial_transfers": partial_transfers,
        "count": len(partial_transfers)
    }

@router.get("/transfers/stale")
async def get_stale_transfers(timeout_minutes: int = 30):
    if timeout_minutes < 1:
        timeout_minutes = 1
    elif timeout_minutes > 1440:  
        timeout_minutes = 1440

    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}

    stale = db.get_stale_transfers(timeout_minutes) or []
    return {
        "success": True,
        "stale_transfers": stale,
        "count": len(stale)
    }

@router.delete("/transfers/cleanup")
async def cleanup_stale_transfers(timeout_minutes: int = 30):
    if timeout_minutes < 1:
        timeout_minutes = 1
    elif timeout_minutes > 1440:  
        timeout_minutes = 1440

    db = get_transfer_state_db()
    if not db:
        return {"success": False, "error": "Database not available"}

    count = db.cleanup_stale(timeout_minutes) or 0
    return {
        "success": True,
        "removed_count": count,
        "message": f"Removed {count} stale transfers"
    }

def get_corruption_tracker():
    try:
        from mqtt.mqtt_receiver import corruption_tracker
        return corruption_tracker
    except ImportError:
        return None

@router.get("/alerts/corruption")
async def get_corruption_alerts():
    tracker = get_corruption_tracker()
    if not tracker:
        return {
            "success": False,
            "error": "Corruption tracker not available",
            "stats": {},
            "recent_events": []
        }
    
    stats = tracker.get_stats()
    return {
        "success": True,
        "summary": {
            "total_events": stats.get("total_events", 0),
        },
        "by_source": stats.get("by_source", {}),
        "recent_events": stats.get("recent_events", [])[-50:],  
        "message": "Use this data to identify problematic HUBs or devices"
    }

@router.get("/alerts/corruption/hub/{hub_id}")
async def get_corruption_by_hub(hub_id: str):
    tracker = get_corruption_tracker()
    if not tracker:
        return {"success": False, "error": "Tracker not available"}
    
    stats = tracker.get_stats()
    hub_stats = {k: v for k, v in stats.get("by_source", {}).items() if k.startswith(f"{hub_id}:")}
    hub_events = [
        e for e in stats.get("recent_events", [])
        if e.get("hub_id") == hub_id
    ]
    
    total_count = sum(v.get("count", 0) for v in hub_stats.values())
    return {
        "success": True,
        "hub_id": hub_id,
        "stats": hub_stats,
        "recent_events": hub_events[-20:],
        "total_corruptions": total_count
    }

@router.post("/alerts/corruption/reset")
async def reset_corruption_stats():
    tracker = get_corruption_tracker()
    if not tracker:
        return {"success": False, "error": "Tracker not available"}
    
    old_total = len(tracker.corruption_log)
    tracker.corruption_log = []
    tracker.stats = {}
    tracker._alert_cooldown = {}
    
    return {
        "success": True,
        "message": f"Reset corruption stats. Previous total: {old_total}"
    }
