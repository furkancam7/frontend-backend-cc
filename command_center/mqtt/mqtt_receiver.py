import os
import sys
import ssl
import json
import paho.mqtt.client as mqtt
COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, COMMAND_CENTER_DIR)
import importlib.util
config_path = os.path.join(COMMAND_CENTER_DIR, 'config.py')
spec = importlib.util.spec_from_file_location("main_config", config_path)
main_config_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_config_module)
config = main_config_module.config

if __name__ == "__main__" or __package__ is None:
    from logging_handler import logger
    from utils import get_db, set_mqtt_client
    from handlers import (
        handle_chunks,
        handle_metadata,
        handle_status,
        handle_device_info,
        handle_fallback,
        handle_heartbeat,
        handle_heartbeat_config_ack,
        handle_detection,
        handle_media_manifest,
    )
    from corruption_tracker import get_corruption_tracker, ImageCorruptionTracker
    from transfer_manager import get_transfer_manager, get_metadata_buffers, TransferManager
    from payload_extractor import PayloadExtractor, parse_location, parse_battery
    from processors import process_metadata_and_image
    from data_lake import save_json_to_data_lake, save_to_data_lake
else:
    from .logging_handler import logger
    from .utils import get_db, set_mqtt_client
    from .handlers import (
        handle_chunks,
        handle_metadata,
        handle_status,
        handle_device_info,
        handle_fallback,
        handle_heartbeat,
        handle_heartbeat_config_ack,
        handle_detection,
        handle_media_manifest,
    )
    from .corruption_tracker import get_corruption_tracker, ImageCorruptionTracker
    from .transfer_manager import get_transfer_manager, get_metadata_buffers, TransferManager
    from .payload_extractor import PayloadExtractor, parse_location, parse_battery
    from .processors import process_metadata_and_image
    from .data_lake import save_json_to_data_lake, save_to_data_lake

SUBSCRIBE_TOPICS = [
    ("hub/+/device/+/transfer/+/chunks", 1),
    ("hub/+/device/+/transfer/+/metadata", 1),
    ("hub/+/status", 1),
    ("cc/devices/+/heartbeat", 1),
    ("cc/devices/+/heartbeat_config/ack", 1),
    ("cc/devices/+/detections", 1),
    ("cc/devices/+/media/manifest", 1),
    ("cc/devices/+/media/chunk", 1),
]

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("Connected to MQTT broker, subscribing to topics...")
        for topic, qos in SUBSCRIBE_TOPICS:
            client.subscribe(topic, qos)
            logger.info(f"Subscribed: {topic}")
    else:
        logger.error(f"MQTT connection error, rc={rc}")

def on_message(client, userdata, msg):
    logger.debug(f"MQTT IN: Topic: {msg.topic}, Payload len: {len(msg.payload)}")
    
    if msg.topic.startswith("cc/devices/") and msg.topic.endswith("/heartbeat"):
        handle_heartbeat(msg)
    elif msg.topic.startswith("cc/devices/") and msg.topic.endswith("/heartbeat_config/ack"):
        handle_heartbeat_config_ack(msg)
    elif msg.topic.startswith("cc/devices/") and msg.topic.endswith("/detections"):
        handle_detection(msg)
    elif msg.topic.startswith("cc/devices/") and msg.topic.endswith("/media/manifest"):
        handle_media_manifest(msg)
    elif msg.topic.startswith("cc/devices/") and msg.topic.endswith("/media/chunk"):
        handle_chunks(msg)
    elif "/chunks" in msg.topic:
        handle_chunks(msg)
    elif "/metadata" in msg.topic:
        handle_metadata(msg)
    elif "/status" in msg.topic:
        handle_status(msg)
    elif "/device" in msg.topic or "/hub" in msg.topic:
        handle_device_info(msg)
    else:
        handle_fallback(msg)

def main():
    CC_STATUS_TOPIC = "commandcenter/status"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, "CC_DataLake_v3")
    client.will_set(
        CC_STATUS_TOPIC,
        payload=json.dumps({"status": "offline"}),
        qos=1,
        retain=True
    )
    
    def on_connect_with_status(client, userdata, flags, rc):
        on_connect(client, userdata, flags, rc)
        if rc == 0:
            client.publish(
                CC_STATUS_TOPIC,
                payload=json.dumps({"status": "online"}),
                qos=1,
                retain=True
            )
            logger.info(f"Published CC status: online to {CC_STATUS_TOPIC}")
    
    client.on_connect = on_connect_with_status
    client.on_message = on_message
    set_mqtt_client(client)

    db = get_db()
    if db and getattr(db, "use_mock", False):
        logger.warning(
            "mqtt_receiver is running with USE_MOCK_DB=true. "
            "Data will not persist across processes."
        )
    
    if config.MQTT_TLS_ENABLED:
        logger.info("TLS enabled, configuring SSL context...")
        try:
            ssl_context = ssl.create_default_context()
            
            if config.MQTT_TLS_CA_CERT and os.path.exists(config.MQTT_TLS_CA_CERT):
                ssl_context.load_verify_locations(config.MQTT_TLS_CA_CERT)
                logger.info(f"Loaded CA certificate: {config.MQTT_TLS_CA_CERT}")
            
            if config.MQTT_TLS_INSECURE:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                logger.warning("TLS insecure mode - certificate verification disabled")
            
            client.tls_set_context(ssl_context)
            logger.info("TLS configured successfully")
        except Exception as e:
            logger.error(f"TLS configuration failed: {e}")
            raise
    
    if config.has_mqtt_auth():
        client.username_pw_set(config.MQTT_USERNAME, config.MQTT_PASSWORD)
        logger.info(f"MQTT auth configured for user: {config.MQTT_USERNAME}")
    
    try:
        mode = "production" if config.is_production() else "development"
        tls_status = "TLS" if config.MQTT_TLS_ENABLED else "plain"
        auth_status = "authenticated" if config.has_mqtt_auth() else "anonymous"
        
        logger.info(f"Connecting to MQTT broker ({mode} mode, {tls_status}, {auth_status})...")
        client.connect(config.MQTT_BROKER, config.MQTT_PORT, config.MQTT_KEEPALIVE)
        logger.info(f"MQTT Receiver started on {config.MQTT_BROKER}:{config.MQTT_PORT}")
        client.loop_forever()
    except OSError as e:
        logger.error(f"MQTT connection error: {e}")
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        
        client.publish(
            CC_STATUS_TOPIC,
            payload=json.dumps({"status": "offline"}),
            qos=1,
            retain=True
        )
        
        if db:
            db.close()

        client.disconnect()


if __name__ == "__main__":
    main()
