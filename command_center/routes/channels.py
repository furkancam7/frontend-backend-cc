from fastapi import APIRouter
from config.channels import COMMUNICATION_CHANNELS, get_channel_config

router = APIRouter(prefix="/api", tags=["Channels"])

@router.get("/channels")
async def list_channels():
    channels = []
    for channel_id, config in COMMUNICATION_CHANNELS.items():
        channels.append({
            "id": channel_id,
            "name": config["name"],
            "type": config["type"],
            "bitrate_bps": config["bitrate_bps"],
            "bitrate_human": _format_bitrate(config["bitrate_bps"]),
            "chunk_size": config["expected_chunk_size"],
            "timeout_seconds": config["timeout_seconds"],
            "preview_interval": config["preview_interval"],
            "persist_chunks": config["store_chunks_to_minio"],
            "description": config["description"]
        })
    
    channels.sort(key=lambda x: x["bitrate_bps"])
    
    return {
        "success": True,
        "channels": channels,
        "count": len(channels)
    }


@router.get("/channels/{channel_id}")
async def get_channel(channel_id: str):
    try:
        config = get_channel_config(channel_id)
        return {
            "success": True,
            "channel": {
                "id": channel_id,
                "name": config["name"],
                "type": config["type"],
                "bitrate_bps": config["bitrate_bps"],
                "bitrate_human": _format_bitrate(config["bitrate_bps"]),
                "chunk_size": config["expected_chunk_size"],
                "timeout_seconds": config["timeout_seconds"],
                "preview_interval": config["preview_interval"],
                "persist_chunks": config["store_chunks_to_minio"],
                "description": config["description"]
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/channels/by-type/{channel_type}")
async def get_channels_by_type(channel_type: str):
    channels = []
    for channel_id, config in COMMUNICATION_CHANNELS.items():
        if config["type"] == channel_type:
            channels.append({
                "id": channel_id,
                "name": config["name"],
                "bitrate_bps": config["bitrate_bps"],
                "bitrate_human": _format_bitrate(config["bitrate_bps"]),
                "description": config["description"]
            })
    
    return {
        "success": True,
        "type": channel_type,
        "channels": channels,
        "count": len(channels)
    }

def _format_bitrate(bps: int) -> str:
    if bps >= 1_000_000:
        return f"{bps / 1_000_000:.1f} Mbps"
    elif bps >= 1_000:
        return f"{bps / 1_000:.1f} kbps"
    else:
        return f"{bps} bps"
