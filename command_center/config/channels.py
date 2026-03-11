import logging

logger = logging.getLogger(__name__)

COMMUNICATION_CHANNELS = {
    "gsm": {
        "name": "GSM/LTE Cellular",
        "type": "cellular",
        "bitrate_bps": 1_000_000,
        "expected_chunk_size": 65536,
        "timeout_seconds": 30,
        "preview_interval": 1,
        "store_chunks_to_minio": False,  
        "description": "Standard cellular connection"
    },
    
    "starlink": {
        "name": "Starlink",
        "type": "satellite_leo",
        "bitrate_bps": 100_000_000,
        "expected_chunk_size": 65536,
        "timeout_seconds": 30,
        "preview_interval": 1,
        "store_chunks_to_minio": False,
        "description": "SpaceX Starlink"
    },
    
    "thuraya": {
        "name": "Thuraya IP+",
        "type": "satellite_geo",
        "bitrate_bps": 444_000,
        "expected_chunk_size": 8192,
        "timeout_seconds": 120,
        "preview_interval": 5,
        "store_chunks_to_minio": True,  
        "description": "Thuraya GEO satellite"
    },
    
    "certus": {
        "name": "Iridium Certus 100",
        "type": "satellite_leo",
        "bitrate_bps": 352_000,
        "expected_chunk_size": 8192,
        "timeout_seconds": 120,
        "preview_interval": 5,
        "store_chunks_to_minio": True,
        "description": "Iridium Certus broadband"
    },
    
    "certus_700": {
        "name": "Iridium Certus 700",
        "type": "satellite_leo",
        "bitrate_bps": 704_000,
        "expected_chunk_size": 16384,
        "timeout_seconds": 90,
        "preview_interval": 3,
        "store_chunks_to_minio": True,
        "description": "Iridium Certus 700"
    },
    
    "iridium_sbd": {
        "name": "Iridium SBD",
        "type": "satellite_sbd",
        "bitrate_bps": 2_400,
        "expected_chunk_size": 340,
        "timeout_seconds": 600,  
        "preview_interval": 10,
        "store_chunks_to_minio": True,  
        "description": "Iridium Short Burst Data"
    },
    
    "globalstar_simplex": {
        "name": "Globalstar Simplex",
        "type": "satellite_simplex",
        "bitrate_bps": 9_600,
        "expected_chunk_size": 512,
        "timeout_seconds": 300,
        "preview_interval": 8,
        "store_chunks_to_minio": True,
        "description": "Globalstar one-way"
    }
}

DEFAULT_CHANNEL = "thuraya"

def get_channel_config(channel_id: str) -> dict:
    """Get configuration for a specific channel."""
    channel_id = channel_id.lower() if channel_id else DEFAULT_CHANNEL
    if channel_id not in COMMUNICATION_CHANNELS:
        logger.warning(f"Unknown channel '{channel_id}', using default '{DEFAULT_CHANNEL}'")
        channel_id = DEFAULT_CHANNEL
    return COMMUNICATION_CHANNELS[channel_id]

def get_preview_interval(channel_id: str) -> int:
    """Get preview update interval based on channel."""
    return get_channel_config(channel_id)["preview_interval"]

def get_timeout(channel_id: str) -> int:
    """Get timeout in seconds for a channel."""
    return get_channel_config(channel_id)["timeout_seconds"]

def should_persist_chunks(channel_id: str) -> bool:
    """Whether chunks should be stored to MinIO (for slow channels)."""
    return get_channel_config(channel_id)["store_chunks_to_minio"]

def calculate_expected_time(channel_id: str, total_bytes: int) -> float:
    """Calculate expected transfer time in seconds."""
    config = get_channel_config(channel_id)
    return (total_bytes * 8) / config["bitrate_bps"]

def auto_detect_channel_from_chunk_size(chunk_size: int) -> str:
    """Try to detect channel from chunk size (fallback method)."""
    for channel_id, config in COMMUNICATION_CHANNELS.items():
        if config["expected_chunk_size"] == chunk_size:
            return channel_id
    return DEFAULT_CHANNEL

def get_all_channels() -> dict:
    """Get all available channels."""
    return COMMUNICATION_CHANNELS
