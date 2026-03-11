import os
import logging
import asyncio
import json
import uuid
from typing import List, Set
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import paho.mqtt.client as mqtt
import importlib.util
import sys
_config_spec = importlib.util.spec_from_file_location("config_module", os.path.join(os.path.dirname(__file__), "config.py"))
_config_module = importlib.util.module_from_spec(_config_spec)
_config_spec.loader.exec_module(_config_module)
config = _config_module.config
from routes.utils import get_db
from routes import crops, devices, images, admin, ingestion, minio_routes, transfers, channels, auth, settings
from routes import heartbeat as heartbeat_routes
from routes import detections as detection_routes
from mqtt.remote_management import REMOTE_SUBSCRIBE_TOPICS, handle_remote_management_message
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
_event_loop: asyncio.AbstractEventLoop = None

class ConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: str):
        async with self._lock:
            connections = list(self._connections)

        disconnected = []
        for connection in connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"WebSocket send error: {e}")
                disconnected.append(connection)
        if disconnected:
            async with self._lock:
                for conn in disconnected:
                    self._connections.discard(conn)

    @property
    def active_connections(self) -> List[WebSocket]:
        return list(self._connections)

manager = ConnectionManager()
detection_manager = ConnectionManager()  
heartbeat_manager = ConnectionManager()
remote_management_manager = ConnectionManager()
transfer_manager = ConnectionManager()
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, f"FastAPI_Bridge_{uuid.uuid4().hex[:8]}")

def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("FastAPI MQTT Bridge Connected")
        client.publish("commandcenter/status", '{"status": "online"}', qos=1, retain=True)
        logger.info("Published online status to commandcenter/status")
        for topic, qos in REMOTE_SUBSCRIBE_TOPICS:
            client.subscribe(topic, qos=qos)
            logger.info(f"Subscribed remote-management topic: {topic}")
    else:
        logger.error(f"FastAPI MQTT Connection Failed: {rc}")

def on_mqtt_message(client, userdata, msg):
    global _event_loop
    try:
        db = get_db()
        event = handle_remote_management_message(db, msg.topic, msg.payload)
        if event:
            notify_remote_management_update(event)
            return
    except ValueError as e:
        logger.warning(f"Remote management payload rejected ({msg.topic}): {e}")
        parts = msg.topic.split("/")
        if len(parts) >= 2 and parts[0] == "devices":
            device_id = parts[1]
            try:
                db = get_db()
                device = db.mark_remote_device_error(device_id, str(e))
                notify_remote_management_update({
                    "event_type": "ingest_error",
                    "device_id": device_id,
                    "topic": msg.topic,
                    "error": str(e),
                    "device": device,
                })
            except Exception as inner:
                logger.warning(f"Failed to mark device ingest error: {inner}")
    except Exception as e:
        logger.error(f"Remote management handler error ({msg.topic}): {e}")

    try:
        payload = msg.payload.decode(errors="replace")
        if _event_loop is not None and _event_loop.is_running():
            asyncio.run_coroutine_threadsafe(manager.broadcast(payload), _event_loop)
        else:
            logger.warning("Event loop not available for MQTT message broadcast")
    except Exception as e:
        logger.error(f"MQTT Message Error: {e}")

mqtt_client.on_connect = on_mqtt_connect
mqtt_client.on_message = on_mqtt_message

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    logger.info("Event loop initialized for MQTT bridge")

    mqtt_started = False
    if config.MQTT_ENABLED:
        try:
            if config.MQTT_USERNAME and config.MQTT_PASSWORD:
                mqtt_client.username_pw_set(config.MQTT_USERNAME, config.MQTT_PASSWORD)
                logger.info(f"MQTT auth configured for user: {config.MQTT_USERNAME}")
            mqtt_client.connect(config.MQTT_BROKER, config.MQTT_PORT, config.MQTT_KEEPALIVE)
            mqtt_client.loop_start()
            mqtt_started = True
            logger.info("MQTT Bridge started")
            # Make this client available to route handlers (e.g. heartbeat config publish)
            from mqtt.utils import set_mqtt_client
            set_mqtt_client(mqtt_client)
        except Exception as e:
            logger.warning(f"Could not start MQTT Bridge (continuing without MQTT): {e}")
    else:
        logger.info("MQTT disabled via MQTT_ENABLED=false")

    yield

    logger.info("Shutting down application...")
    if mqtt_started:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()

    _shutdown_db = get_db()
    if _shutdown_db:
        _shutdown_db.close()
        logger.info("Database connection closed")

app = FastAPI(
    title="Command Center API",
    description="Tactical Monitoring Dashboard API",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)

db = get_db()

@app.get("/api/health", tags=["System"])
async def health_check():
    return {"status": "healthy", "service": "Command Center API (FastAPI)"}

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket Error: {e}")
        await manager.disconnect(websocket)

@app.websocket("/ws/detections")
async def detection_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time detection updates."""
    await detection_manager.connect(websocket)
    logger.info(f"Detection WebSocket client connected. Total: {len(detection_manager.active_connections)}")
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        await detection_manager.disconnect(websocket)
        logger.info(f"Detection WebSocket client disconnected. Total: {len(detection_manager.active_connections)}")
    except Exception as e:
        logger.error(f"Detection WebSocket Error: {e}")
        await detection_manager.disconnect(websocket)

@app.websocket("/ws/heartbeat")
async def heartbeat_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time heartbeat / config-ack updates."""
    await heartbeat_manager.connect(websocket)
    logger.info(f"Heartbeat WebSocket client connected. Total: {len(heartbeat_manager.active_connections)}")
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        await heartbeat_manager.disconnect(websocket)
        logger.info(f"Heartbeat WebSocket client disconnected. Total: {len(heartbeat_manager.active_connections)}")
    except Exception as e:
        logger.error(f"Heartbeat WebSocket Error: {e}")
        await heartbeat_manager.disconnect(websocket)

@app.websocket("/ws/management")
async def management_websocket(websocket: WebSocket):
    """WebSocket endpoint for remote management updates."""
    await remote_management_manager.connect(websocket)
    logger.info(f"Management WebSocket client connected. Total: {len(remote_management_manager.active_connections)}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await remote_management_manager.disconnect(websocket)
        logger.info(f"Management WebSocket client disconnected. Total: {len(remote_management_manager.active_connections)}")
    except Exception as e:
        logger.error(f"Management WebSocket Error: {e}")
        await remote_management_manager.disconnect(websocket)

@app.websocket("/ws/transfers")
async def transfer_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time transfer progress updates."""
    await transfer_manager.connect(websocket)
    logger.info(f"Transfer WebSocket client connected. Total: {len(transfer_manager.active_connections)}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await transfer_manager.disconnect(websocket)
        logger.info(f"Transfer WebSocket client disconnected. Total: {len(transfer_manager.active_connections)}")
    except Exception as e:
        logger.error(f"Transfer WebSocket Error: {e}")
        await transfer_manager.disconnect(websocket)

async def broadcast_detection_update(detection_data: dict):
    """Broadcast detection update to all connected WebSocket clients."""
    import json
    message = json.dumps({
        "type": "detection_update",
        "data": detection_data
    })
    await detection_manager.broadcast(message)

def notify_detection_update(detection_data: dict):
    """Thread-safe function to notify detection updates from sync code."""
    global _event_loop
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            broadcast_detection_update(detection_data),
            _event_loop
        )

async def broadcast_heartbeat_update(data: dict):
    """Broadcast heartbeat / config-ack event to WebSocket clients."""
    import json
    message = json.dumps({
        "type": "heartbeat_update",
        "data": data
    })
    await heartbeat_manager.broadcast(message)

def notify_heartbeat_update(data: dict):
    """Thread-safe: push heartbeat events from MQTT handler thread."""
    global _event_loop
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            broadcast_heartbeat_update(data),
            _event_loop
        )

async def broadcast_remote_management_update(data: dict):
    """Broadcast remote management event to WebSocket clients."""
    message = json.dumps({
        "type": "remote_management_update",
        "data": data
    })
    await remote_management_manager.broadcast(message)

def notify_remote_management_update(data: dict):
    """Thread-safe: push remote management events from MQTT/API code."""
    global _event_loop
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            broadcast_remote_management_update(data),
            _event_loop
        )

async def broadcast_transfer_update(data: dict):
    """Broadcast transfer progress update to WebSocket clients."""
    message = json.dumps({
        "type": "transfer_update",
        "data": data
    })
    await transfer_manager.broadcast(message)

def notify_transfer_update(data: dict):
    """Thread-safe: push transfer progress events from MQTT/API code."""
    global _event_loop
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            broadcast_transfer_update(data),
            _event_loop
        )

app.include_router(auth.router)
app.include_router(crops.router)
app.include_router(devices.router)
app.include_router(images.router)
app.include_router(admin.router)
app.include_router(ingestion.router)
app.include_router(minio_routes.router)
app.include_router(transfers.router)
app.include_router(channels.router)
app.include_router(settings.router)
app.include_router(heartbeat_routes.router)
app.include_router(detection_routes.router)

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
