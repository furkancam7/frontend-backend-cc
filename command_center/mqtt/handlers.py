import os
import sys
import json
import logging
from typing import Dict

COMMAND_CENTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if COMMAND_CENTER_DIR not in sys.path:
    sys.path.insert(0, COMMAND_CENTER_DIR)

from storage.minio_client import get_minio

try:
    from .logging_handler import logger
    from .utils import get_db, generate_unique_filename
    from .payload_extractor import PayloadExtractor, parse_location, parse_battery
    from .data_lake import save_to_data_lake, save_json_to_data_lake
    from .transfer_manager import (
        get_transfer_manager,
        set_metadata_buffer, delete_metadata_buffer, get_metadata_buffer,
        cleanup_stale_metadata_buffers, _metadata_buffers_lock, metadata_buffers
    )
    from .processors import (
        process_metadata_and_image,
        _process_crops_for_existing_record,
        _save_device_info
    )
except ImportError:
    from logging_handler import logger
    from utils import get_db, generate_unique_filename
    from payload_extractor import PayloadExtractor, parse_location, parse_battery
    from data_lake import save_to_data_lake, save_json_to_data_lake
    from transfer_manager import (
        get_transfer_manager,
        set_metadata_buffer, delete_metadata_buffer, get_metadata_buffer,
        cleanup_stale_metadata_buffers, _metadata_buffers_lock, metadata_buffers
    )
    from processors import (
        process_metadata_and_image,
        _process_crops_for_existing_record,
        _save_device_info
    )

def print_progress_bar(filename: str, current: int, total: int, transfer_id: str):
    bar_length = 30
    progress = current / total
    filled_length = int(bar_length * progress)
    bar = '=' * filled_length + '-' * (bar_length - filled_length)
    percent = progress * 100
    status = "Receiving"
    if current == total:
        status = "Completed"
    sys.stdout.write(f"\rTRANSFER [{transfer_id[:8]}] |{bar}| {percent:.1f}% [{current}/{total}] {filename} ({status})")
    sys.stdout.flush()
    if current == total:
        sys.stdout.write("\n")  

def pretty_print_metadata(payload: Dict):
    try:
        extractor = PayloadExtractor(payload)
        t_id = payload.get('transfer_id', 'N/A')
        ts = payload.get('timestamp', payload.get('transfer_timestamp', 'N/A'))

        logger.info(
            f"METADATA RECEIVED | Transfer ID: {t_id} | "
            f"Device: {extractor.device_id} | "
            f"Time: {ts} | Detections: {extractor.detection_count}"
        )

        if extractor.detection_count > 0 and logger.isEnabledFor(logging.DEBUG):
            for i, det in enumerate(extractor.detections[:5]):
                cls = det.get('class_name', 'unknown')
                conf = det.get('confidence', 0)
                logger.debug(f"  Detection {i+1}: {cls} ({conf:.1%})")

    except Exception as e:
        logger.error(f"Metadata logging error: {e}")

def handle_chunks(msg) -> None:
    transfer_manager = get_transfer_manager()

    try:
        header_len = int.from_bytes(msg.payload[:4], byteorder='big')
        header_json = msg.payload[4:4+header_len]
        header = json.loads(header_json.decode())
        chunk_binary = msg.payload[4+header_len:]
        transfer_id = header.get('transfer_id', 'unknown')
        filename = header['filename']
        chunk_idx = header['chunk_index']
        chunk_total = header['chunk_total']
        device_id = header.get('device_id')
        print_progress_bar(filename, chunk_idx + 1, chunk_total, transfer_id)
        metadata = get_metadata_buffer(transfer_id)

        if device_id and metadata:
            metadata['_device_id'] = device_id
        
        full_data = transfer_manager.register_chunk(
            transfer_id=transfer_id,
            chunk_index=chunk_idx,
            chunk_total=chunk_total,
            chunk_data=chunk_binary,
            filename=filename,
            metadata=metadata
        )
        
        if transfer_id in transfer_manager.transfers:
            transfer = transfer_manager.transfers[transfer_id]
            received_count = len(transfer['received'])
            progress_pct = (received_count / chunk_total) * 100
            if progress_pct >= 90 and received_count % 50 == 0:
                missing = transfer_manager.get_missing_chunks(transfer_id)
                if missing and len(missing) <= 20:
                    logger.warning(f"Transfer {transfer_id[:8]} - Missing chunks: {missing[:20]}")
        
        if full_data is not None:
            logger.info(f"TRANSFER COMPLETED: {filename} ({len(full_data)} bytes)")
            unique_filename = generate_unique_filename(transfer_id, filename)
            minio = get_minio()
            minio_image_path = None
            upload_device_id = device_id
            cached_metadata = get_metadata_buffer(transfer_id)
            if cached_metadata:
                upload_device_id = cached_metadata.get('device_id') or upload_device_id

            if minio:
                minio_image_path = minio.upload_image(
                    full_data,
                    unique_filename,
                    "images",
                    device_id=upload_device_id
                )
                if minio_image_path:
                    logger.info(f"MinIO upload success: {minio_image_path}")

            if minio_image_path:
                metadata_payload = get_metadata_buffer(transfer_id)
                if not metadata_payload:
                    metadata_payload = get_metadata_buffer(filename)

                pending_record_id = metadata_payload.get('_pending_record_id') if metadata_payload else None

                if metadata_payload:
                    json_filename = f"{transfer_id}_detection.json"
                    metadata_payload['final_image_path'] = f"minio://{minio_image_path}"
                    metadata_payload['transfer_status'] = 'completed'
                    minio.upload_json(
                        metadata_payload,
                        json_filename,
                        "jsons",
                        device_id=upload_device_id
                    )
                    logger.info(f"JSON updated with final image path: {json_filename}")

                    if pending_record_id:
                        db = get_db()
                        if db:
                            try:
                                existing = db.get(f"detection:{pending_record_id}")
                                if existing:
                                    existing['source'] = f"minio://{minio_image_path}"
                                    existing['source_image_path'] = f"minio://{minio_image_path}"
                                    existing['image_status'] = 'ready'
                                    db.set(f"detection:{pending_record_id}", "detection", existing)
                                    logger.info(f"Updated pending detection {pending_record_id} -> ready")

                                    preview_filename = f"previews/preview_{transfer_id}.webp"
                                    if minio.delete_file(preview_filename):
                                        logger.info(f"Deleted preview: {preview_filename}")

                                    _process_crops_for_existing_record(
                                        pending_record_id,
                                        metadata_payload,
                                        f"minio://{minio_image_path}",
                                        unique_filename,
                                        f"transfer:{transfer_id}"
                                    )

                                    try:
                                        from app import notify_detection_update
                                        notify_detection_update({
                                            "record_id": pending_record_id,
                                            "is_update": True,
                                            "image_status": "ready"
                                        })
                                        logger.info(f"WebSocket notification sent for ready image: {pending_record_id}")
                                    except Exception as ws_err:
                                        logger.warning(f"Failed to send WebSocket notification: {ws_err}")
                            except Exception as e:
                                logger.warning(f"Failed to update pending record: {e}")
                    else:
                        process_metadata_and_image(
                            f"transfer:{transfer_id}",
                            metadata_payload,
                            f"minio://{minio_image_path}",
                            unique_filename
                        )

                    delete_metadata_buffer(transfer_id)
                    delete_metadata_buffer(filename)
            else:
                logger.error(f"Failed to upload image to MinIO: {unique_filename}")
                
    except json.JSONDecodeError as e:
        logger.error(f"Chunk header JSON parse error: {e}")
    except KeyError as e:
        logger.error(f"Chunk header missing field: {e}")
    except Exception as e:
        logger.exception(f"Chunk processing error: {e}")

def _write_detection_event(db, event_id: str, extractor, payload: dict) -> None:
    """Insert a hub-transfer detection into detection_events so FireDetectionPanel sees it."""
    detection_data = payload.get('detection') or {}
    raw_dets = detection_data.get('detections', [])
    boxes = [
        {
            'class_id': d.get('class_id', 0),
            'class_name': d.get('class_name', ''),
            'confidence': d.get('confidence', 0),
            'x1': d.get('bbox', {}).get('x1', 0),
            'y1': d.get('bbox', {}).get('y1', 0),
            'x2': d.get('bbox', {}).get('x2', 0),
            'y2': d.get('bbox', {}).get('y2', 0),
        }
        for d in raw_dets
    ]
    classes = [d.get('class_id', 0) for d in raw_dets]
    model_info = detection_data.get('model', {})
    model_name = model_info.get('name') if isinstance(model_info, dict) else (model_info or None)
    has_det = bool(boxes)
    max_conf = max((b['confidence'] for b in boxes), default=0.0)

    db.execute_query(
        """INSERT INTO detection_events
               (event_id, device_id, camera_id, detected_at,
                model, has_detection, max_confidence, classes, boxes, inference_json,
                speed_preprocess, speed_inference, speed_postprocess)
           VALUES (%s, %s, %s, NOW(),
                   %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb,
                   %s, %s, %s)
           ON CONFLICT (event_id) DO NOTHING""",
        (
            event_id, extractor.device_id, 'hub',
            model_name, has_det, max_conf,
            json.dumps(classes), json.dumps(boxes),
            json.dumps(detection_data),
            None, detection_data.get('detection_time_ms'), None,
        ),
    )
    logger.info(f"Detection event saved: {event_id} (device={extractor.device_id}, boxes={len(boxes)})")

    try:
        from app import notify_detection_update
        notify_detection_update({
            'type': 'detection',
            'device_id': extractor.device_id,
            'camera_id': 'hub',
            'event_id': event_id,
            'has_detection': has_det,
            'max_confidence': round(max_conf, 4),
            'boxes_count': len(boxes),
        })
    except Exception:
        pass


def handle_metadata(msg) -> None:
    cleanup_stale_metadata_buffers()

    try:
        payload = json.loads(msg.payload.decode())
        transfer_id = payload.get('transfer_id')
        image_filename = None
        pretty_print_metadata(payload)

        if 'image_metadata' in payload:
            img_meta = payload['image_metadata']
            if isinstance(img_meta, dict):
                if 'detected' in img_meta and isinstance(img_meta.get('detected'), dict):
                    image_filename = img_meta['detected'].get('filename')
                elif 'original' in img_meta and isinstance(img_meta.get('original'), dict):
                    image_filename = img_meta['original'].get('filename')
        elif 'filename' in payload:
            image_filename = payload['filename']

        if transfer_id:
            set_metadata_buffer(transfer_id, payload)
            logger.info(f"Metadata buffered for sync: {transfer_id}")

            minio = get_minio()
            if minio:
                json_filename = f"{transfer_id}_detection.json"
                device_id = payload.get('device_id') or payload.get('solo_id') or payload.get('hub_id')
                minio_json_path = minio.upload_json(
                    payload,
                    json_filename,
                    "jsons",
                    device_id=device_id
                )
                if minio_json_path:
                    logger.info(f"JSON saved to MinIO: {minio_json_path}")

        if image_filename:
            set_metadata_buffer(image_filename, payload)

        db = get_db()
        if db and transfer_id:
            try:
                extractor = PayloadExtractor(payload)

                logger.debug(f"Payload extracted - device_id: {extractor.device_id}, location: {extractor.location}, battery: {extractor.battery}, detections: {len(extractor.detections)}")

                # Validate device_id
                if not extractor.is_valid:
                    logger.warning(f"Metadata rejected: missing device_id for transfer {transfer_id}")
                else:
                    _save_device_info(db, extractor.get_device_info_dict(), extractor.device_id)

                    record_data = {
                        'image_info': extractor.image_info,
                        'model': extractor.model_info,
                        'timestamp': payload.get('timestamp') or payload.get('transfer_timestamp'),
                        'detection_time_ms': extractor.detection_time_ms,
                        'detection_count': extractor.detection_count,
                        'source': f"pending://{transfer_id}",
                        'device_id': extractor.device_id,
                        'device_type': 'tower',
                        'transfer_id': transfer_id,
                        'image_status': 'pending',
                        'location': extractor.location
                    }

                    record_id = db.save_detection_record(record_data)
                    if record_id:
                        for idx, det in enumerate(extractor.detections):
                            bbox = det.get('bbox', {})
                            det_detail = {
                                'id': idx,
                                'class_id': det.get('class_id', 0),
                                'class_name': det.get('class_name'),
                                'confidence': det.get('confidence'),
                                'bbox': {
                                    'x1': bbox.get('x1', 0),
                                    'y1': bbox.get('y1', 0),
                                    'x2': bbox.get('x2', 0),
                                    'y2': bbox.get('y2', 0),
                                    'width': bbox.get('x2', 0) - bbox.get('x1', 0),
                                    'height': bbox.get('y2', 0) - bbox.get('y1', 0)
                                },
                                'crop_status': 'pending'
                            }
                            db.save_detection_detail(record_id, det_detail, None)

                        with _metadata_buffers_lock:
                            if transfer_id in metadata_buffers:
                                metadata_buffers[transfer_id]['_pending_record_id'] = record_id
                        logger.info(f"Pending detection saved: {record_id} with {len(extractor.detections)} objects")

                    # Populate detection_events so FireDetectionPanel shows this data
                    try:
                        _write_detection_event(db, transfer_id, extractor, payload)
                    except Exception as e:
                        logger.warning(f"Detection event insert failed: {e}")

            except Exception as e:
                logger.warning(f"Pending detection save failed: {e}")

        if not transfer_id and not image_filename:
            save_json_to_data_lake(msg.topic, payload)

    except json.JSONDecodeError as e:
        logger.error(f"Metadata JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Metadata processing error: {e}")

def handle_status(msg) -> None:
    try:
        payload = json.loads(msg.payload.decode())
        status = payload.get('status')
        device_id = payload.get('device_id') or payload.get('hub_id')        
        logger.info(f"Status update: {device_id} -> {status}")
        save_json_to_data_lake(msg.topic, payload)
        
    except json.JSONDecodeError as e:
        logger.error(f"Status JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Status processing error: {e}")

def handle_device_info(msg) -> None:
    try:
        payload = json.loads(msg.payload.decode())        
        db = get_db()
        if db:
            device_id = payload.get('device_id') or payload.get('id', 'UNKNOWN')
            location = parse_location(payload.get('location'))
            
            device_data = {
                'id': device_id,
                'device_id': device_id,
                'type': 'tower',
                'device_type': 'tower',
                'location': location
            }
            
            db.save_device_info(device_data)
            logger.info(f"Device info saved: {device_id} (type=tower)")
        save_json_to_data_lake(msg.topic, payload)
        
    except json.JSONDecodeError as e:
        logger.error(f"Device info JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Device info processing error: {e}")

def handle_fallback(msg) -> None:
    try:
        if isinstance(msg.payload, bytes):
            if b'\x00' in msg.payload:
                return  
            payload_str = msg.payload.decode(errors="replace")
        else:
            payload_str = str(msg.payload)
        try:
            json_payload = json.loads(payload_str)
            save_json_to_data_lake(msg.topic, json_payload)
            logger.debug(f"General JSON message saved: {msg.topic}")
        except json.JSONDecodeError:
            save_to_data_lake(msg.topic, "raw", payload_str[:10000])
            
    except Exception as e:
        logger.warning(f"Fallback handler error: {e}")


# ─── Heartbeat handlers ────────────────────────────────────────

def handle_heartbeat(msg) -> None:
    """Handle cc/devices/{device_id}/heartbeat messages.
    
    Uses SERVER receive time (not device ts) for online/offline calculation
    to avoid device-time-drift problems.
    """
    try:
        payload = json.loads(msg.payload.decode())
        # Extract device_id from topic  cc/devices/{device_id}/heartbeat
        parts = msg.topic.split('/')
        device_id = parts[2] if len(parts) >= 4 else payload.get('device_id')
        
        if not device_id:
            logger.warning("Heartbeat received without device_id")
            return
        
        db = get_db()
        if db:
            db.update_last_heartbeat(device_id)
            logger.info(f"Heartbeat received from {device_id}")
        
        # Notify dashboard via WebSocket
        try:
            from app import notify_heartbeat_update
            notify_heartbeat_update({
                "device_id": device_id,
                "type": "heartbeat",
                "payload": payload
            })
        except Exception:
            pass
        
    except json.JSONDecodeError as e:
        logger.error(f"Heartbeat JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Heartbeat processing error: {e}")


def handle_heartbeat_config_ack(msg) -> None:
    """Handle cc/devices/{device_id}/heartbeat_config/ack messages.
    
    Updates DB with ACK status (applied / failed).
    """
    try:
        payload = json.loads(msg.payload.decode())
        # Extract device_id from topic  cc/devices/{device_id}/heartbeat_config/ack
        parts = msg.topic.split('/')
        device_id = parts[2] if len(parts) >= 5 else payload.get('device_id')
        config_version = payload.get('config_version')
        applied = payload.get('applied', False)
        
        if not device_id or config_version is None:
            logger.warning(f"Heartbeat config ACK missing fields: device_id={device_id}, config_version={config_version}")
            return
        
        error_code = None
        error_message = None
        error_obj = payload.get('error')
        if error_obj and isinstance(error_obj, dict):
            error_code = error_obj.get('code')
            error_message = error_obj.get('message')
        
        db = get_db()
        if db:
            ok = db.update_heartbeat_ack(
                device_id=device_id,
                config_version=config_version,
                applied=applied,
                error_code=error_code,
                error_message=error_message
            )
            status_str = 'applied' if applied else 'failed'
            if ok:
                logger.info(f"Heartbeat config ACK: {device_id} v{config_version} -> {status_str}")
            else:
                logger.warning(f"Heartbeat config ACK ignored (version mismatch?): {device_id} v{config_version}")
        
        # Notify dashboard
        try:
            from app import notify_heartbeat_update
            notify_heartbeat_update({
                "device_id": device_id,
                "type": "heartbeat_config_ack",
                "config_version": config_version,
                "applied": applied,
                "error": error_obj
            })
        except Exception:
            pass
        
    except json.JSONDecodeError as e:
        logger.error(f"Heartbeat config ACK JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Heartbeat config ACK processing error: {e}")


# ═══════════════════════════════════════════════════════════
#  Detection events (EO/IR pipeline)
# ═══════════════════════════════════════════════════════════

def handle_detection(msg) -> None:
    """
    Topic: cc/devices/{device_id}/detections
    Payload: inference JSON from the hub detection pipeline.
    """
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        device_id = payload.get("device_id")
        camera_id = payload.get("camera_id", "unknown")

        if not device_id:
            logger.warning("Detection missing device_id — dropped")
            return

        db = get_db()
        if not db:
            logger.error("Detection handler: DB not available")
            return

        # Generate event_id if not present (inference-only, no media)
        event_id = payload.get("event_id")
        if not event_id:
            import uuid, time as _t
            event_id = f"{_t.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

        boxes = payload.get("boxes", [])
        has_detection = len(boxes) > 0
        max_conf = max((b.get("confidence", 0) for b in boxes), default=0.0)
        classes = payload.get("classes", [])
        speed = payload.get("speed", {})

        db.execute_query(
            """
            INSERT INTO detection_events
                (event_id, device_id, camera_id, detected_at,
                 model, has_detection, max_confidence, classes, boxes,
                 inference_json,
                 speed_preprocess, speed_inference, speed_postprocess)
            VALUES (%s, %s, %s, NOW(),
                    %s, %s, %s, %s::jsonb, %s::jsonb,
                    %s::jsonb,
                    %s, %s, %s)
            ON CONFLICT (event_id) DO NOTHING
            """,
            (
                event_id, device_id, camera_id,
                payload.get("model"),
                has_detection, max_conf,
                json.dumps(classes), json.dumps(boxes),
                json.dumps(payload),
                speed.get("preprocess"), speed.get("inference"), speed.get("postprocess"),
            ),
        )

        if has_detection:
            logger.info(
                f"Detection event: {device_id}/{camera_id}  "
                f"event={event_id}  conf={max_conf:.3f}  boxes={len(boxes)}"
            )
        else:
            logger.debug(f"Detection (no event): {device_id}/{camera_id}")

        # Notify dashboard via WebSocket
        try:
            from app import notify_detection_update
            notify_detection_update({
                "type": "detection",
                "device_id": device_id,
                "camera_id": camera_id,
                "event_id": event_id,
                "has_detection": has_detection,
                "max_confidence": round(max_conf, 4),
                "boxes_count": len(boxes),
            })
        except Exception:
            pass

    except json.JSONDecodeError as e:
        logger.error(f"Detection JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Detection processing error: {e}")


def handle_media_manifest(msg) -> None:
    """
    Topic: cc/devices/{device_id}/media/manifest
    Payload: manifest JSON listing snapshot + clip for an event.
    """
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        event_id = payload.get("event_id")
        device_id = payload.get("device_id")

        if not event_id or not device_id:
            logger.warning("Media manifest missing event_id or device_id — dropped")
            return

        db = get_db()
        if not db:
            logger.error("Media manifest handler: DB not available")
            return

        # Insert rows for each artefact described in the manifest
        for key in ("snapshot", "clip"):
            item = payload.get(key)
            if not item:
                continue

            db.execute_query(
                """
                INSERT INTO detection_media
                    (event_id, device_id, filename, content_type,
                     size_bytes, sha256, is_placeholder, duration_s,
                     chunk_count, chunks_received, fully_received)
                VALUES (%s, %s, %s, %s,
                        %s, %s, %s, %s,
                        0, 0, FALSE)
                ON CONFLICT DO NOTHING
                """,
                (
                    event_id, device_id,
                    item.get("filename", ""),
                    item.get("content_type", "application/octet-stream"),
                    item.get("size_bytes", 0),
                    item.get("sha256"),
                    item.get("placeholder", False),
                    item.get("duration_s"),
                ),
            )

        logger.info(f"Media manifest stored: event={event_id} device={device_id}")

    except json.JSONDecodeError as e:
        logger.error(f"Media manifest JSON parse error: {e}")
    except Exception as e:
        logger.exception(f"Media manifest processing error: {e}")
