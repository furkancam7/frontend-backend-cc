import os
import json
import uuid
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, List, Any

logger = logging.getLogger(__name__)

# Check if we should use mock/in-memory database for local testing.
# Load .env first, then .env.local overrides, so required DB vars are not lost.
try:
    from pathlib import Path as _Path
    from dotenv import load_dotenv as _load_dotenv
    _env_local = _Path(__file__).resolve().parents[2] / '.env.local'
    _env_file = _Path(__file__).resolve().parents[2] / '.env'
    if _env_file.exists():
        _load_dotenv(_env_file, override=False)
    if _env_local.exists():
        _load_dotenv(_env_local, override=True)
except Exception:
    pass

USE_MOCK_DB = os.getenv('USE_MOCK_DB', 'false').lower() == 'true'

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    psycopg2 = None  # type: ignore


class MockDatabase:
    """In-memory mock database for local testing without PostgreSQL"""
    def __init__(self):
        self.kv_store = {}
        self.users = {
            'admin': {
                'id': 'admin-001',
                'username': 'admin',
                'email': 'admin@localhost',
                'password_hash': '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4aLQHkMrQP5Yq.Km',  # "admin"
                'role': 'admin',
                'is_active': True,
                'created_at': datetime.now(timezone.utc).isoformat()
            }
        }
        logger.info("Mock Database initialized for local testing")
    
    def execute(self, query, params=None, fetch=True):
        # Return empty results for most queries
        return [] if fetch else 0


class DatabaseManager:
    NS_DEVICE = "device"
    NS_DETECTION = "detection"
    NS_CROP = "crop"
    NS_IMAGE = "image"
    NS_LOG = "log"
    
    def __init__(self):
        self.connection = None
        self.mock_db = None
        # Re-read at instance creation time so any dotenv loaded after
        # module import (e.g. by config.py) is still picked up.
        self.use_mock = os.getenv('USE_MOCK_DB', 'false').lower() == 'true'

        if self.use_mock:
            self.mock_db = MockDatabase()
            self._kv_store = {}
            self._heartbeat_store = {}
            self._remote_devices = {}
            self._remote_access_history = []
            self._remote_network_history = []
            self._remote_configs = []
            self._remote_config_applies = []
            self._remote_commands = []
            self._remote_system_events = []
            logger.info("DatabaseManager running in MOCK mode (no PostgreSQL)")
            logger.warning(
                "USE_MOCK_DB=true: data is process-local and not shared between "
                "API and mqtt_receiver processes."
            )
            self._seed_mock_data()
        else:
            self.connect()
    
    def connect(self) -> bool:
        if self.use_mock:
            return True
            
        db_password = os.getenv('DB_PASSWORD')
        if not db_password:
            logger.error("DB_PASSWORD environment variable is not set!")
            return False
        
        for attempt in range(3):
            try:
                self.connection = psycopg2.connect(
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=int(os.getenv('DB_PORT', '5433')),
                    database=os.getenv('DB_NAME', 'command_center'),
                    user=os.getenv('DB_USER', 'postgres'),
                    password=db_password
                )
                self.connection.autocommit = False
                logger.info("Connected to Database")
                return True
            except psycopg2.OperationalError as e:
                logger.warning(f"Connection retry ({attempt + 1}/3): {e}")
                time.sleep(2)  
        return False

    def _execute(self, query: str, params: tuple = None, fetch: bool = True) -> Any:
        if self.use_mock:
            # Mock mode - return empty results
            return [] if fetch else 0
            
        if not self.connection and not self.connect():
            return None

        cursor = None
        try:
            cursor = self.connection.cursor(cursor_factory=RealDictCursor)
            cursor.execute(query, params)
            if fetch and cursor.description:
                result = cursor.fetchall()
            else:
                result = cursor.rowcount
            self.connection.commit()
            return result
        except psycopg2.OperationalError as e:
            logger.error(f"Database connection error: {e}")
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            self.connection = None
            return None
        except psycopg2.IntegrityError as e:
            logger.error(f"Database integrity error: {e}")
            if self.connection:
                self.connection.rollback()
            return None
        except psycopg2.Error as e:
            logger.error(f"Database error: {e}")
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            return None
        except Exception as e:
            logger.error(f"Unexpected query error: {e}")
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            return None
        finally:
            if cursor:
                try:
                    cursor.close()
                except Exception:
                    pass
        
    def set(self, key: str, namespace: str, value: Dict, ttl_seconds: int = None) -> bool:
        if not key.startswith(f"{namespace}:"):
            print(f"Warning: key '{key}' doesn't match namespace '{namespace}'")
        
        # Mock mode - use in-memory store
        if self.use_mock:
            expires_at = None
            if ttl_seconds:
                expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
            self._kv_store[key] = {
                'value': value,
                'namespace': namespace,
                'expires_at': expires_at,
                'created_at': datetime.now(timezone.utc)
            }
            return True
        
        expires_at = None
        if ttl_seconds:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
        
        query = """
            INSERT INTO kv_store (key, namespace, value, expires_at, version)
            VALUES (%s, %s, %s, %s, 1)
            ON CONFLICT (namespace, key) DO UPDATE SET
                value = EXCLUDED.value,
                version = kv_store.version + 1,
                expires_at = EXCLUDED.expires_at
        """
        result = self._execute(query, (key, namespace, Json(value), expires_at), fetch=False)
        return result is not None and result > 0
    
    def get(self, key: str) -> Optional[Dict]:
        # Mock mode
        if self.use_mock:
            item = self._kv_store.get(key)
            if item:
                if item['expires_at'] and item['expires_at'] < datetime.now(timezone.utc):
                    del self._kv_store[key]
                    return None
                return item['value']
            return None
            
        result = self._execute(
            "SELECT value FROM kv_store WHERE key = %s AND (expires_at IS NULL OR expires_at > NOW())",
            (key,)
        )
        return result[0]['value'] if result else None
    
    def delete(self, key: str) -> bool:
        # Mock mode
        if self.use_mock:
            if key in self._kv_store:
                del self._kv_store[key]
                return True
            return False
            
        result = self._execute("DELETE FROM kv_store WHERE key = %s", (key,), fetch=False)
        return result is not None and result > 0  
    
    def keys(self, pattern: str = None, namespace: str = None, limit: int = 100) -> List[str]:
        # Mock mode
        if self.use_mock:
            import fnmatch
            now = datetime.now(timezone.utc)
            keys = []
            for k, v in self._kv_store.items():
                if v['expires_at'] and v['expires_at'] < now:
                    continue
                if namespace and v['namespace'] != namespace:
                    continue
                if pattern and not fnmatch.fnmatch(k, pattern):
                    continue
                keys.append(k)
                if len(keys) >= limit:
                    break
            return keys
            
        if namespace:
            result = self._execute(
                """SELECT key FROM kv_store 
                   WHERE namespace = %s AND (expires_at IS NULL OR expires_at > NOW())
                   ORDER BY created_at DESC LIMIT %s""",
                (namespace, limit)
            )
        elif pattern:
            result = self._execute(
                """SELECT key FROM kv_store 
                   WHERE key LIKE %s AND (expires_at IS NULL OR expires_at > NOW())
                   ORDER BY created_at DESC LIMIT %s""",
                (pattern.replace('*', '%'), limit)
            )
        else:
            result = self._execute(
                """SELECT key FROM kv_store 
                   WHERE (expires_at IS NULL OR expires_at > NOW())
                   ORDER BY created_at DESC LIMIT %s""",
                (limit,)
            )
        return [row['key'] for row in result] if result else []
    
    def get_by_namespace(self, namespace: str, limit: int = 100) -> List[Dict]:
        # Mock mode – iterate in-memory store
        if self.use_mock:
            now = datetime.now(timezone.utc)
            rows = []
            for k, v in self._kv_store.items():
                if v.get('namespace') != namespace:
                    continue
                exp = v.get('expires_at')
                if exp and exp < now:
                    continue
                rows.append({'key': k, 'value': v['value']})
                if len(rows) >= limit:
                    break
            return rows

        result = self._execute(
            """SELECT key, value FROM kv_store 
               WHERE namespace = %s AND (expires_at IS NULL OR expires_at > NOW())
               ORDER BY created_at DESC LIMIT %s""",
            (namespace, limit)
        )
        return [dict(row) for row in result] if result else []
    
    def count(self, namespace: str = None) -> int:
        if namespace:
            result = self._execute(
                """SELECT COUNT(*) as cnt FROM kv_store 
                   WHERE namespace = %s AND (expires_at IS NULL OR expires_at > NOW())""",
                (namespace,)
            )
        else:
            result = self._execute(
                "SELECT COUNT(*) as cnt FROM kv_store WHERE (expires_at IS NULL OR expires_at > NOW())"
            )
        return result[0]['cnt'] if result else 0
    
    def _generate_id(self) -> str:
        return uuid.uuid4().hex[:16]
    
    def save_raw(self, namespace: str, entity_id: str, data: Dict) -> bool:
        key = f"{namespace}:{entity_id}"
        existing = self.get(key)
        value = {
            **data,
            "_meta": {
                "id": entity_id,
                "namespace": namespace,
                "created_at": existing.get('_meta', {}).get('created_at') if existing else datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
        return self.set(key, namespace, value)
    
    def save_device_info(self, device_data: Dict) -> bool:
        device_id = device_data.get('device_id') or device_data.get('id') or device_data.get('solo_id') or device_data.get('hub_id')
        if not device_id:
            return False
        return self.save_raw(self.NS_DEVICE, device_id, device_data)

    def upsert_device(self, device_id: str, device_data: Dict) -> bool:
        """Compatibility helper used by legacy routes."""
        payload = dict(device_data or {})
        payload.setdefault('id', device_id)
        payload.setdefault('device_id', device_id)
        return self.save_device_info(payload)
    
    def save_detection_record(self, detection_data: Dict) -> Optional[str]:
        detection_id = self._generate_id()
        device_id = detection_data.get('device_id') or detection_data.get('solo_id') or 'UNKNOWN'
        data = {**detection_data, "detection_id": detection_id, "device_id": device_id, "crop_ids": []}
        if self.save_raw(self.NS_DETECTION, detection_id, data):
            return detection_id
        return None
    
    def save_detection_detail(self, record_id: str, detection: Dict, crop_path: str = None) -> Optional[str]:
        idx = detection.get('id') or detection.get('index') or '0'
        crop_id = f"{record_id}:{idx}"
        data = {**detection, "crop_id": crop_id, "detection_id": record_id, "crop_image_path": crop_path}
        if self.save_raw(self.NS_CROP, crop_id, data):
            det = self.get(f"{self.NS_DETECTION}:{record_id}")
            if det:
                crop_ids = det.get('crop_ids', [])
                if crop_id not in crop_ids:
                    crop_ids.append(crop_id)
                    det['crop_ids'] = crop_ids
                    self.set(f"{self.NS_DETECTION}:{record_id}", self.NS_DETECTION, det)
            return crop_id
        return None
    
    def save_image_metadata(self, record_id: str, image_type: str, file_path: str, file_size: int, file_hash: str = None) -> bool:
        data = {"detection_id": record_id, "image_type": image_type, "file_path": file_path, "file_size_bytes": file_size}
        return self.save_raw(self.NS_IMAGE, f"{record_id}:{image_type}", data)
    
    def get_all_devices(self) -> List[Dict]:
        return self.get_by_namespace(self.NS_DEVICE)
    
    def get_device(self, device_id: str) -> Optional[Dict]:
        return self.get(f"{self.NS_DEVICE}:{device_id}")
    
    def get_recent_detections(self, limit: int = 100) -> List[Dict]:
        return self.get_by_namespace(self.NS_DETECTION, limit=limit)
    
    def get_recent_crops(self, limit: int = 100) -> List[Dict]:
        return self.get_by_namespace(self.NS_CROP, limit=limit)
    
    def get_detections_by_device(self, device_id: str, limit: int = 100) -> List[Dict]:
        """Get detections for a specific device."""
        result = self._execute(
            """SELECT key, value FROM kv_store 
               WHERE namespace = %s 
               AND value->>'device_id' = %s 
               AND (expires_at IS NULL OR expires_at > NOW())
               ORDER BY created_at DESC LIMIT %s""",
            (self.NS_DETECTION, device_id, limit)
        )
        return [{'key': r['key'], 'value': r['value']} for r in result] if result else []
    
    def get_crops_by_detection(self, detection_id: str) -> List[Dict]:
        result = self._execute(
            """SELECT key, value FROM kv_store 
               WHERE key LIKE %s AND (expires_at IS NULL OR expires_at > NOW())
               ORDER BY created_at DESC""",
            (f"crop:{detection_id}:%",)
        )
        return [{'key': r['key'], 'value': r['value']} for r in result] if result else []
    
    def get_detection_details(self, record_id: str) -> List[Dict]:
        result = self._execute(
            """SELECT key, value FROM kv_store 
               WHERE key LIKE %s AND (expires_at IS NULL OR expires_at > NOW())""",
            (f"{self.NS_CROP}:{record_id}:%",)
        )
        if not result:
            return []
        return [{'id': r['key'], 'detection_data': r['value'], 'crop_path': r['value'].get('crop_image_path')} for r in result]
    
    def get_by_metadata(self, meta_data: str) -> Optional[Dict]:
        result = self._execute(
            """SELECT key, value FROM kv_store 
               WHERE namespace = %s 
               AND value->>'meta_data' = %s 
               AND (expires_at IS NULL OR expires_at > NOW())
               LIMIT 1""",
            (self.NS_DETECTION, meta_data)
        )
        return result[0]['value'] if result else None
    
    def update_detection_record(self, record_id: str, updates: Dict) -> bool:
        existing = self.get(f"{self.NS_DETECTION}:{record_id}")
        if not existing:
            return False
        existing.update(updates)
        return self.set(f"{self.NS_DETECTION}:{record_id}", self.NS_DETECTION, existing)
    
    def update_detection_detail_crop(self, crop_key: str, crop_path: str) -> bool:
        existing = self.get(crop_key)
        if not existing:
            return False
        existing['crop_image_path'] = crop_path
        parts = crop_key.split(':')
        namespace = parts[0] if parts else self.NS_CROP
        return self.set(crop_key, namespace, existing)
    
    def get_stats(self) -> Dict:
        return {
            "total_devices": self.count(self.NS_DEVICE),
            "total_detections": self.count(self.NS_DETECTION),
            "total_crops": self.count(self.NS_CROP),
            "total_images": self.count(self.NS_IMAGE)
        }
    
    def execute_query(self, query: str, params: tuple = None, fetch_dict: bool = False) -> Any:
        if self.use_mock:
            # Mock mode does not back PostgreSQL tables like detection_events.
            return [] if fetch_dict else True

        if not self.connection and not self.connect():
            return None

        cursor = None
        try:
            cursor = self.connection.cursor(cursor_factory=RealDictCursor if fetch_dict else None)
            cursor.execute(query, params)
            if cursor.description:
                result = cursor.fetchall()
            else:
                result = True
            self.connection.commit()
            return result
        except psycopg2.Error as e:
            logger.error(f"Query error: {e}")
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            return []
        except Exception as e:
            logger.error(f"Unexpected query error: {e}")
            if self.connection:
                try:
                    self.connection.rollback()
                except Exception:
                    pass
            return []
        finally:
            if cursor:
                try:
                    cursor.close()
                except Exception:
                    pass
    
    def get_user_by_username(self, username: str) -> Optional[Dict]:
        # Mock mode - return mock admin user
        if self.use_mock:
            if username == 'admin':
                return {
                    "id": 1,
                    "username": "admin",
                    "email": "admin@localhost",
                    "hashed_password": "$2b$12$aMnnsaEepEEsfe.1DU39f.kDafXrbhxasEwqu7NK4N12ErMCCF8uq",  # "admin"
                    "role": "admin",
                    "is_active": True,
                    "last_login": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": None
                }
            return None
            
        result = self._execute(
            """SELECT id, username, email, password_hash, role, is_active, 
                      last_login, created_at, updated_at 
               FROM users WHERE username = %s""",
            (username,)
        )
        if result and len(result) > 0:
            user = dict(result[0])
            return {
                "id": user["id"],
                "username": user["username"],
                "email": user.get("email") or "",
                "hashed_password": user["password_hash"],
                "role": user["role"],
                "is_active": user["is_active"],
                "last_login": user.get("last_login"),
                "created_at": user["created_at"],
                "updated_at": user.get("updated_at")
            }
        return None
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        # Mock mode
        if self.use_mock:
            if user_id == 1:
                return self.get_user_by_username('admin')
            return None
            
        result = self._execute(
            """SELECT id, username, email, password_hash, role, is_active, 
                      last_login, created_at, updated_at 
               FROM users WHERE id = %s""",
            (user_id,)
        )
        if result and len(result) > 0:
            user = dict(result[0])
            return {
                "id": user["id"],
                "username": user["username"],
                "email": user.get("email") or "",
                "hashed_password": user["password_hash"],
                "role": user["role"],
                "is_active": user["is_active"],
                "last_login": user.get("last_login"),
                "created_at": user["created_at"],
                "updated_at": user.get("updated_at")
            }
        return None
    
    def create_user(self, username: str, password_hash: str, role: str = "viewer", email: str = "") -> Optional[Dict]:
        result = self._execute(
            """INSERT INTO users (username, email, password_hash, role, is_active)
               VALUES (%s, %s, %s, %s, TRUE)
               RETURNING id, username, email, role, is_active, created_at""",
            (username, email, password_hash, role)
        )
        if result and len(result) > 0:
            user = dict(result[0])
            return {
                "id": user["id"],
                "username": user["username"],
                "email": user.get("email") or "",
                "role": user["role"],
                "is_active": user["is_active"],
                "created_at": user["created_at"]
            }
        return None
    
    def update_user(self, username: str, updates: Dict) -> bool:
        """Update user fields. Supports: email, role, is_active, password_hash."""
        allowed_fields = {"email", "role", "is_active", "password_hash"}
        filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
        
        if not filtered_updates:
            return False
        
        if "password_hash" in filtered_updates:
            filtered_updates["password_hash"] = filtered_updates.pop("password_hash")
        
        set_clauses = ", ".join([f"{k} = %s" for k in filtered_updates.keys()])
        values = list(filtered_updates.values()) + [username]
        
        result = self._execute(
            f"UPDATE users SET {set_clauses}, updated_at = NOW() WHERE username = %s",
            tuple(values),
            fetch=False
        )
        return result is not None and result > 0
    
    def update_user_password(self, username: str, new_password_hash: str) -> bool:
        result = self._execute(
            "UPDATE users SET password_hash = %s, updated_at = NOW() WHERE username = %s",
            (new_password_hash, username),
            fetch=False
        )
        return result is not None and result > 0
    
    def update_user_last_login(self, username: str) -> bool:
        # Mock mode - just return True
        if self.use_mock:
            return True
            
        result = self._execute(
            "UPDATE users SET last_login = NOW() WHERE username = %s",
            (username,),
            fetch=False
        )
        return result is not None and result > 0
    
    def deactivate_user(self, username: str) -> bool:
        # Mock mode
        if self.use_mock:
            return True
            
        result = self._execute(
            "UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE username = %s",
            (username,),
            fetch=False
        )
        return result is not None and result > 0
    
    def activate_user(self, username: str) -> bool:
        # Mock mode
        if self.use_mock:
            return True
            
        result = self._execute(
            "UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE username = %s",
            (username,),
            fetch=False
        )
        return result is not None and result > 0
    
    def delete_user(self, username: str) -> bool:
        result = self._execute(
            "DELETE FROM users WHERE username = %s",
            (username,),
            fetch=False
        )
        return result is not None and result > 0
    
    def list_users(self, include_inactive: bool = False) -> List[Dict]:
        if include_inactive:
            result = self._execute(
                """SELECT id, username, email, role, is_active, last_login, created_at, updated_at
                   FROM users ORDER BY created_at DESC"""
            )
        else:
            result = self._execute(
                """SELECT id, username, email, role, is_active, last_login, created_at, updated_at
                   FROM users WHERE is_active = TRUE ORDER BY created_at DESC"""
            )
        
        if not result:
            return []
        
        return [
            {
                "id": user["id"],
                "username": user["username"],
                "email": user.get("email") or "",
                "role": user["role"],
                "is_active": user["is_active"],
                "last_login": user.get("last_login"),
                "created_at": user["created_at"],
                "updated_at": user.get("updated_at")
            }
            for user in result
        ]
    
    def count_users(self, include_inactive: bool = False) -> int:
        if include_inactive:
            result = self._execute("SELECT COUNT(*) as cnt FROM users")
        else:
            result = self._execute("SELECT COUNT(*) as cnt FROM users WHERE is_active = TRUE")
        return result[0]['cnt'] if result else 0
    
    def user_exists(self, username: str) -> bool:
        result = self._execute(
            "SELECT 1 FROM users WHERE username = %s",
            (username,)
        )
        return result is not None and len(result) > 0
    
    # ─── Mock seed data ────────────────────────────────────────────

    def _seed_mock_data(self):
        """Populate a realistic mock device + heartbeat row for local dev/testing."""
        now = datetime.now(timezone.utc).isoformat()

        # Seed device
        self.save_device_info({
            'device_id': 'TOWER-001',
            'id': 'TOWER-001',
            'type': 'tower',
            'device_type': 'tower',
            'location': {
                'latitude': 39.9334,
                'longitude': 32.8597,
                'address': 'Ankara, Turkey'
            },
            'fw_version': '1.3.0',
            'updated_at': now,
            'created_at': now,
        })

        # Seed heartbeat settings with realistic values
        self._heartbeat_store['TOWER-001'] = {
            'device_id': 'TOWER-001',
            'enabled': True,
            'heartbeat_interval_s': 30,
            'offline_threshold_s': 90,
            'jitter_s': 3,
            'config_version': 2,
            'last_config_sent_at': now,
            'last_config_ack_at': now,
            'last_ack_status': 'applied',
            'last_ack_error_code': None,
            'last_ack_error_message': None,
            'last_heartbeat_at': now,
            'created_at': now,
            'updated_at': now,
        }

        logger.info("Mock data seeded: TOWER-001 device + heartbeat config")
        # Verify it's readable back
        check = self.get_all_devices()
        logger.info(f"[MOCK SEED] get_all_devices() = {len(check)} device(s): {[d.get('value', {}).get('device_id') for d in check]}")

    # ─── Heartbeat Settings ───────────────────────────────────────

    def _ensure_heartbeat_table(self):
        """Create the heartbeat settings table if it doesn't exist (idempotent)."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            return
        self._execute("""
            CREATE TABLE IF NOT EXISTS device_heartbeat_settings (
                device_id             VARCHAR(128) PRIMARY KEY,
                enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
                heartbeat_interval_s  INTEGER      NOT NULL DEFAULT 30,
                offline_threshold_s   INTEGER      NOT NULL DEFAULT 90,
                jitter_s              INTEGER      NOT NULL DEFAULT 3,
                config_version        INTEGER      NOT NULL DEFAULT 0,
                last_config_sent_at   TIMESTAMPTZ,
                last_config_ack_at    TIMESTAMPTZ,
                last_ack_status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
                last_ack_error_code   VARCHAR(64),
                last_ack_error_message TEXT,
                last_heartbeat_at     TIMESTAMPTZ,
                created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

    def get_heartbeat_settings(self, device_id: str) -> Optional[Dict]:
        """Return heartbeat settings for a single device, or None."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            return self._heartbeat_store.get(device_id)

        self._ensure_heartbeat_table()
        result = self._execute(
            "SELECT * FROM device_heartbeat_settings WHERE device_id = %s",
            (device_id,)
        )
        if result and len(result) > 0:
            row = dict(result[0])
            # Convert datetimes to ISO strings for JSON serialisation
            for k in ('last_config_sent_at', 'last_config_ack_at', 'last_heartbeat_at', 'created_at', 'updated_at'):
                if row.get(k) and hasattr(row[k], 'isoformat'):
                    row[k] = row[k].isoformat()
            return row
        return None

    def get_all_heartbeat_settings(self) -> List[Dict]:
        """Return heartbeat settings for all devices."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            return list(self._heartbeat_store.values())

        self._ensure_heartbeat_table()
        result = self._execute("SELECT * FROM device_heartbeat_settings ORDER BY device_id")
        if not result:
            return []
        rows = []
        for r in result:
            row = dict(r)
            for k in ('last_config_sent_at', 'last_config_ack_at', 'last_heartbeat_at', 'created_at', 'updated_at'):
                if row.get(k) and hasattr(row[k], 'isoformat'):
                    row[k] = row[k].isoformat()
            rows.append(row)
        return rows

    def upsert_heartbeat_settings(self, device_id: str, settings: Dict) -> Optional[Dict]:
        """Insert or update heartbeat settings.  Increments config_version automatically."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            existing = self._heartbeat_store.get(device_id, {})
            new_version = existing.get('config_version', 0) + 1
            record = {
                'device_id': device_id,
                'enabled': settings.get('enabled', True),
                'heartbeat_interval_s': settings.get('heartbeat_interval_s', 30),
                'offline_threshold_s': settings.get('offline_threshold_s', 90),
                'jitter_s': settings.get('jitter_s', 3),
                'config_version': new_version,
                'last_config_sent_at': datetime.now(timezone.utc).isoformat(),
                'last_config_ack_at': existing.get('last_config_ack_at'),
                'last_ack_status': 'pending',
                'last_ack_error_code': None,
                'last_ack_error_message': None,
                'last_heartbeat_at': existing.get('last_heartbeat_at'),
                'created_at': existing.get('created_at', datetime.now(timezone.utc).isoformat()),
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }
            self._heartbeat_store[device_id] = record
            return record

        self._ensure_heartbeat_table()
        result = self._execute("""
            INSERT INTO device_heartbeat_settings
                (device_id, enabled, heartbeat_interval_s, offline_threshold_s, jitter_s,
                 config_version, last_config_sent_at, last_ack_status)
            VALUES (%s, %s, %s, %s, %s, 1, NOW(), 'pending')
            ON CONFLICT (device_id) DO UPDATE SET
                enabled              = EXCLUDED.enabled,
                heartbeat_interval_s = EXCLUDED.heartbeat_interval_s,
                offline_threshold_s  = EXCLUDED.offline_threshold_s,
                jitter_s             = EXCLUDED.jitter_s,
                config_version       = device_heartbeat_settings.config_version + 1,
                last_config_sent_at  = NOW(),
                last_ack_status      = 'pending',
                last_ack_error_code  = NULL,
                last_ack_error_message = NULL
            RETURNING *
        """, (
            device_id,
            settings.get('enabled', True),
            settings.get('heartbeat_interval_s', 30),
            settings.get('offline_threshold_s', 90),
            settings.get('jitter_s', 3),
        ))
        if result and len(result) > 0:
            row = dict(result[0])
            for k in ('last_config_sent_at', 'last_config_ack_at', 'last_heartbeat_at', 'created_at', 'updated_at'):
                if row.get(k) and hasattr(row[k], 'isoformat'):
                    row[k] = row[k].isoformat()
            return row
        return None

    def update_heartbeat_ack(self, device_id: str, config_version: int, applied: bool,
                             error_code: str = None, error_message: str = None) -> bool:
        """Update ACK status after a config ACK arrives from a device."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            rec = self._heartbeat_store.get(device_id)
            if not rec or rec.get('config_version') != config_version:
                return False
            rec['last_config_ack_at'] = datetime.now(timezone.utc).isoformat()
            rec['last_ack_status'] = 'applied' if applied else 'failed'
            rec['last_ack_error_code'] = error_code
            rec['last_ack_error_message'] = error_message
            return True

        self._ensure_heartbeat_table()
        status = 'applied' if applied else 'failed'
        result = self._execute("""
            UPDATE device_heartbeat_settings
            SET last_config_ack_at    = NOW(),
                last_ack_status       = %s,
                last_ack_error_code   = %s,
                last_ack_error_message = %s
            WHERE device_id = %s
        """, (status, error_code, error_message, device_id), fetch=False)
        return result is not None and result > 0

    def update_last_heartbeat(self, device_id: str) -> bool:
        """Touch last_heartbeat_at for a device (creates row if missing)."""
        if self.use_mock:
            if not hasattr(self, '_heartbeat_store'):
                self._heartbeat_store = {}
            rec = self._heartbeat_store.get(device_id)
            if rec:
                rec['last_heartbeat_at'] = datetime.now(timezone.utc).isoformat()
            else:
                self._heartbeat_store[device_id] = {
                    'device_id': device_id,
                    'enabled': True,
                    'heartbeat_interval_s': 30,
                    'offline_threshold_s': 90,
                    'jitter_s': 3,
                    'config_version': 0,
                    'last_config_sent_at': None,
                    'last_config_ack_at': None,
                    'last_ack_status': 'pending',
                    'last_ack_error_code': None,
                    'last_ack_error_message': None,
                    'last_heartbeat_at': datetime.now(timezone.utc).isoformat(),
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            return True

        self._ensure_heartbeat_table()
        result = self._execute("""
            INSERT INTO device_heartbeat_settings (device_id, last_heartbeat_at)
            VALUES (%s, NOW())
            ON CONFLICT (device_id) DO UPDATE SET last_heartbeat_at = NOW()
        """, (device_id,), fetch=False)
        return result is not None and result > 0

    def mark_stale_acks(self, timeout_seconds: int = 120) -> int:
        """Mark ACKs that have been pending longer than timeout as 'stale'."""
        if self.use_mock:
            return 0
        self._ensure_heartbeat_table()
        result = self._execute("""
            UPDATE device_heartbeat_settings
            SET last_ack_status = 'stale'
            WHERE last_ack_status = 'pending'
              AND last_config_sent_at IS NOT NULL
              AND last_config_sent_at < NOW() - INTERVAL '%s seconds'
        """ % int(timeout_seconds), fetch=False)
        return result if result else 0

    # Remote management helpers
    def _parse_datetime(self, value: Any, default_now: bool = True) -> Optional[datetime]:
        if value is None:
            return datetime.now(timezone.utc) if default_now else None
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        elif isinstance(value, str):
            clean = value.strip()
            if not clean:
                return datetime.now(timezone.utc) if default_now else None
            if clean.endswith('Z'):
                clean = clean[:-1] + '+00:00'
            try:
                dt = datetime.fromisoformat(clean)
            except ValueError:
                return datetime.now(timezone.utc) if default_now else None
        else:
            return datetime.now(timezone.utc) if default_now else None

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def _iso(self, value: Any) -> Optional[str]:
        dt = self._parse_datetime(value, default_now=False)
        return dt.isoformat() if dt else None

    def _normalize_row_datetimes(self, row: Dict, fields: List[str]) -> Dict:
        normalized = dict(row or {})
        for field in fields:
            if normalized.get(field) and hasattr(normalized[field], 'isoformat'):
                normalized[field] = normalized[field].isoformat()
        return normalized

    def _ensure_remote_management_tables(self):
        if self.use_mock:
            if not hasattr(self, '_remote_devices'):
                self._remote_devices = {}
            if not hasattr(self, '_remote_access_history'):
                self._remote_access_history = []
            if not hasattr(self, '_remote_network_history'):
                self._remote_network_history = []
            if not hasattr(self, '_remote_configs'):
                self._remote_configs = []
            if not hasattr(self, '_remote_config_applies'):
                self._remote_config_applies = []
            if not hasattr(self, '_remote_commands'):
                self._remote_commands = []
            if not hasattr(self, '_remote_system_events'):
                self._remote_system_events = []
            return

        self._execute("""
            CREATE TABLE IF NOT EXISTS devices (
                device_id                VARCHAR(128) PRIMARY KEY,
                hostname                 VARCHAR(255),
                last_seen_at             TIMESTAMPTZ,
                current_status           VARCHAR(20) NOT NULL DEFAULT 'offline',
                mqtt_ok                  BOOLEAN,
                tailscale_ok             BOOLEAN,
                reverse_tunnel_ok        BOOLEAN,
                ssh_ready                BOOLEAN,
                primary_interface        VARCHAR(128),
                public_egress_ip         VARCHAR(64),
                local_ip                 VARCHAR(64),
                tailscale_ip             VARCHAR(64),
                current_config_version   VARCHAR(64),
                current_access_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
                current_network_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS device_access_states (
                id                                      BIGSERIAL PRIMARY KEY,
                device_id                               VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                timestamp                               TIMESTAMPTZ NOT NULL,
                mqtt_ok                                 BOOLEAN,
                tailscale_ok                            BOOLEAN,
                reverse_tunnel_ok                       BOOLEAN,
                ssh_ready                               BOOLEAN,
                raw_json                                JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS device_network_states (
                id                          BIGSERIAL PRIMARY KEY,
                device_id                   VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                timestamp                   TIMESTAMPTZ NOT NULL,
                primary_interface           VARCHAR(128),
                default_route_interface     VARCHAR(128),
                public_egress_ip            VARCHAR(64),
                local_ip                    VARCHAR(64),
                tailscale_ip                VARCHAR(64),
                interfaces_json             JSONB NOT NULL DEFAULT '[]'::jsonb,
                raw_json                    JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS device_configs (
                id              BIGSERIAL PRIMARY KEY,
                device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                config_version  VARCHAR(64) NOT NULL,
                desired_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_by      VARCHAR(128) NOT NULL
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS device_config_applies (
                id              BIGSERIAL PRIMARY KEY,
                device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                config_version  VARCHAR(64) NOT NULL,
                applied         BOOLEAN NOT NULL DEFAULT FALSE,
                applied_at      TIMESTAMPTZ,
                error_json      JSONB,
                raw_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS device_commands (
                id              BIGSERIAL PRIMARY KEY,
                device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                command_id      VARCHAR(128) NOT NULL,
                command_type    VARCHAR(64) NOT NULL,
                payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
                status          VARCHAR(32) NOT NULL DEFAULT 'pending',
                issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at     TIMESTAMPTZ,
                result_json     JSONB,
                issued_by       VARCHAR(128) NOT NULL
            )
        """, fetch=False)

        self._execute("""
            CREATE TABLE IF NOT EXISTS system_events (
                id              BIGSERIAL PRIMARY KEY,
                device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                event_type      VARCHAR(64) NOT NULL,
                severity        VARCHAR(16) NOT NULL DEFAULT 'info',
                message         TEXT,
                event_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                payload_json    JSONB,
                raw_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """, fetch=False)

        # Backward-compatible adds for already created tables.
        self._execute("ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS local_ip VARCHAR(64)", fetch=False)
        self._execute("ALTER TABLE IF EXISTS device_network_states ADD COLUMN IF NOT EXISTS local_ip VARCHAR(64)", fetch=False)

        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_devices_last_seen ON devices(last_seen_at DESC NULLS LAST)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_access_device_ts ON device_access_states(device_id, timestamp DESC)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_network_device_ts ON device_network_states(device_id, timestamp DESC)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_configs_device_created ON device_configs(device_id, created_at DESC)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_config_apply_device_created ON device_config_applies(device_id, created_at DESC)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_commands_device_issued ON device_commands(device_id, issued_at DESC)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_commands_command_id ON device_commands(command_id)",
            fetch=False
        )
        self._execute(
            "CREATE INDEX IF NOT EXISTS idx_rm_system_events_device_event ON system_events(device_id, event_at DESC)",
            fetch=False
        )

    def _default_remote_device(self, device_id: str) -> Dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            'device_id': device_id,
            'hostname': None,
            'last_seen_at': None,
            'current_status': 'offline',
            'mqtt_ok': None,
            'tailscale_ok': None,
            'reverse_tunnel_ok': None,
            'ssh_ready': None,
            'primary_interface': None,
            'public_egress_ip': None,
            'local_ip': None,
            'tailscale_ip': None,
            'current_config_version': None,
            'current_access_json': {},
            'current_network_json': {},
            'created_at': now_iso,
            'updated_at': now_iso,
        }

    def derive_remote_status(self, device_row: Dict, offline_timeout_s: int = 180) -> str:
        if not device_row:
            return 'error'

        last_seen_at = self._parse_datetime(device_row.get('last_seen_at'), default_now=False)
        if not last_seen_at:
            return 'offline'

        age_s = (datetime.now(timezone.utc) - last_seen_at).total_seconds()
        if age_s > offline_timeout_s:
            return 'offline'

        mqtt_ok = device_row.get('mqtt_ok')
        tailscale_ok = device_row.get('tailscale_ok')
        reverse_tunnel_ok = device_row.get('reverse_tunnel_ok')
        ssh_ready = device_row.get('ssh_ready')

        access_paths = [tailscale_ok, reverse_tunnel_ok, ssh_ready]
        has_access = any(v is True for v in access_paths)
        has_broken = any(v is False for v in access_paths)

        if mqtt_ok is True:
            if has_access and not has_broken:
                return 'online'
            return 'degraded'
        if mqtt_ok is False:
            return 'error'
        return 'degraded' if has_access else 'offline'

    def _next_mock_id(self, rows: List[Dict]) -> int:
        return len(rows) + 1

    def _upsert_remote_device(self, device_id: str, updates: Dict) -> Optional[Dict]:
        if not device_id:
            return None
        self._ensure_remote_management_tables()

        existing = self.get_remote_device(device_id) or self._default_remote_device(device_id)
        merged = dict(existing)
        merged.update({k: v for k, v in (updates or {}).items() if v is not None})
        merged['device_id'] = device_id
        merged['last_seen_at'] = self._iso(merged.get('last_seen_at'))
        explicit_status = (updates or {}).get('current_status')
        if explicit_status == 'error':
            merged['current_status'] = 'error'
        else:
            merged['current_status'] = self.derive_remote_status(merged)
        merged['updated_at'] = datetime.now(timezone.utc).isoformat()

        if self.use_mock:
            if not merged.get('created_at'):
                merged['created_at'] = datetime.now(timezone.utc).isoformat()
            self._remote_devices[device_id] = merged
            return dict(merged)

        result = self._execute("""
            INSERT INTO devices (
                device_id, hostname, last_seen_at, current_status, mqtt_ok, tailscale_ok,
                reverse_tunnel_ok, ssh_ready, primary_interface, public_egress_ip, local_ip,
                tailscale_ip, current_config_version, current_access_json, current_network_json
            )
            VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb, %s::jsonb
            )
            ON CONFLICT (device_id) DO UPDATE SET
                hostname = EXCLUDED.hostname,
                last_seen_at = EXCLUDED.last_seen_at,
                current_status = EXCLUDED.current_status,
                mqtt_ok = EXCLUDED.mqtt_ok,
                tailscale_ok = EXCLUDED.tailscale_ok,
                reverse_tunnel_ok = EXCLUDED.reverse_tunnel_ok,
                ssh_ready = EXCLUDED.ssh_ready,
                primary_interface = EXCLUDED.primary_interface,
                public_egress_ip = EXCLUDED.public_egress_ip,
                local_ip = EXCLUDED.local_ip,
                tailscale_ip = EXCLUDED.tailscale_ip,
                current_config_version = EXCLUDED.current_config_version,
                current_access_json = EXCLUDED.current_access_json,
                current_network_json = EXCLUDED.current_network_json,
                updated_at = NOW()
            RETURNING *
        """, (
            device_id,
            merged.get('hostname'),
            self._parse_datetime(merged.get('last_seen_at'), default_now=False),
            merged.get('current_status'),
            merged.get('mqtt_ok'),
            merged.get('tailscale_ok'),
            merged.get('reverse_tunnel_ok'),
            merged.get('ssh_ready'),
            merged.get('primary_interface'),
            merged.get('public_egress_ip'),
            merged.get('local_ip'),
            merged.get('tailscale_ip'),
            merged.get('current_config_version'),
            json.dumps(merged.get('current_access_json') or {}),
            json.dumps(merged.get('current_network_json') or {}),
        ))
        if not result:
            return None
        return self._normalize_row_datetimes(result[0], ['last_seen_at', 'created_at', 'updated_at'])

    def get_remote_device(self, device_id: str) -> Optional[Dict]:
        if not device_id:
            return None
        self._ensure_remote_management_tables()

        if self.use_mock:
            row = self._remote_devices.get(device_id)
            if not row:
                return None
            row_copy = dict(row)
            if row_copy.get('current_status') != 'error':
                row_copy['current_status'] = self.derive_remote_status(row_copy)
            return row_copy

        result = self._execute("SELECT * FROM devices WHERE device_id = %s", (device_id,))
        if not result:
            return None
        row = self._normalize_row_datetimes(result[0], ['last_seen_at', 'created_at', 'updated_at'])
        if row.get('current_status') != 'error':
            derived = self.derive_remote_status(row)
            if row.get('current_status') != derived:
                row['current_status'] = derived
                self._execute(
                    "UPDATE devices SET current_status = %s, updated_at = NOW() WHERE device_id = %s",
                    (derived, device_id),
                    fetch=False
                )
        return row

    def list_remote_devices(self) -> List[Dict]:
        self._ensure_remote_management_tables()
        if self.use_mock:
            rows = []
            for row in self._remote_devices.values():
                item = dict(row)
                if item.get('current_status') != 'error':
                    item['current_status'] = self.derive_remote_status(item)
                rows.append(item)
            rows.sort(key=lambda r: r.get('device_id') or '')
            return rows

        result = self._execute("SELECT * FROM devices ORDER BY last_seen_at DESC NULLS LAST, device_id ASC")
        if not result:
            return []
        rows = []
        for raw in result:
            row = self._normalize_row_datetimes(raw, ['last_seen_at', 'created_at', 'updated_at'])
            if row.get('current_status') != 'error':
                row['current_status'] = self.derive_remote_status(row)
            rows.append(row)
        return rows

    def record_access_state(self, payload: Dict) -> Optional[Dict]:
        device_id = payload.get('device_id')
        if not device_id:
            return None
        self._ensure_remote_management_tables()

        timestamp = self._parse_datetime(payload.get('timestamp'))
        access_row = {
            'device_id': device_id,
            'timestamp': timestamp.isoformat(),
            'mqtt_ok': payload.get('mqtt_ok'),
            'tailscale_ok': payload.get('tailscale_ok'),
            'reverse_tunnel_ok': payload.get('reverse_tunnel_ok'),
            'ssh_ready': payload.get('ssh_ready'),
            'raw_json': payload.get('raw_json') or payload,
            'last_successful_tailscale_check_at': self._iso(payload.get('last_successful_tailscale_check_at')),
            'last_successful_reverse_tunnel_check_at': self._iso(payload.get('last_successful_reverse_tunnel_check_at')),
        }

        if self.use_mock:
            row = dict(access_row)
            row['id'] = self._next_mock_id(self._remote_access_history)
            self._remote_access_history.append(row)
        else:
            self._execute("""
                INSERT INTO device_access_states (
                    device_id, timestamp, mqtt_ok, tailscale_ok, reverse_tunnel_ok, ssh_ready, raw_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """, (
                device_id,
                timestamp,
                payload.get('mqtt_ok'),
                payload.get('tailscale_ok'),
                payload.get('reverse_tunnel_ok'),
                payload.get('ssh_ready'),
                json.dumps(access_row['raw_json']),
            ), fetch=False)

        device = self._upsert_remote_device(device_id, {
            'hostname': payload.get('hostname'),
            'last_seen_at': datetime.now(timezone.utc),
            'mqtt_ok': payload.get('mqtt_ok'),
            'tailscale_ok': payload.get('tailscale_ok'),
            'reverse_tunnel_ok': payload.get('reverse_tunnel_ok'),
            'ssh_ready': payload.get('ssh_ready'),
            'current_access_json': {
                'timestamp': access_row['timestamp'],
                'mqtt_ok': payload.get('mqtt_ok'),
                'tailscale_ok': payload.get('tailscale_ok'),
                'reverse_tunnel_ok': payload.get('reverse_tunnel_ok'),
                'ssh_ready': payload.get('ssh_ready'),
                'last_successful_tailscale_check_at': access_row['last_successful_tailscale_check_at'],
                'last_successful_reverse_tunnel_check_at': access_row['last_successful_reverse_tunnel_check_at'],
            }
        })
        return device

    def record_network_state(self, payload: Dict) -> Optional[Dict]:
        device_id = payload.get('device_id')
        if not device_id:
            return None
        self._ensure_remote_management_tables()

        timestamp = self._parse_datetime(payload.get('timestamp'))
        network_row = {
            'device_id': device_id,
            'timestamp': timestamp.isoformat(),
            'primary_interface': payload.get('primary_interface'),
            'default_route_interface': payload.get('default_route_interface'),
            'public_egress_ip': payload.get('public_egress_ip'),
            'local_ip': payload.get('local_ip'),
            'tailscale_ip': payload.get('tailscale_ip'),
            'interfaces': payload.get('interfaces') if isinstance(payload.get('interfaces'), list) else [],
            'raw_json': payload.get('raw_json') or payload,
        }

        if self.use_mock:
            row = dict(network_row)
            row['id'] = self._next_mock_id(self._remote_network_history)
            self._remote_network_history.append(row)
        else:
            self._execute("""
                INSERT INTO device_network_states (
                    device_id, timestamp, primary_interface, default_route_interface,
                    public_egress_ip, local_ip, tailscale_ip, interfaces_json, raw_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """, (
                device_id,
                timestamp,
                network_row['primary_interface'],
                network_row['default_route_interface'],
                network_row['public_egress_ip'],
                network_row['local_ip'],
                network_row['tailscale_ip'],
                json.dumps(network_row['interfaces']),
                json.dumps(network_row['raw_json']),
            ), fetch=False)

        device = self._upsert_remote_device(device_id, {
            'hostname': payload.get('hostname'),
            'last_seen_at': datetime.now(timezone.utc),
            'primary_interface': network_row['primary_interface'],
            'public_egress_ip': network_row['public_egress_ip'],
            'local_ip': network_row['local_ip'],
            'tailscale_ip': network_row['tailscale_ip'],
            'current_network_json': {
                'timestamp': network_row['timestamp'],
                'primary_interface': network_row['primary_interface'],
                'default_route_interface': network_row['default_route_interface'],
                'public_egress_ip': network_row['public_egress_ip'],
                'local_ip': network_row['local_ip'],
                'tailscale_ip': network_row['tailscale_ip'],
                'interfaces': network_row['interfaces'],
            }
        })
        return device

    def record_config_desired(self, device_id: str, config_version: str, desired_json: Dict, created_by: str) -> Optional[Dict]:
        if not device_id or not config_version:
            return None
        self._ensure_remote_management_tables()
        self._upsert_remote_device(device_id, {})

        if self.use_mock:
            row = {
                'id': self._next_mock_id(self._remote_configs),
                'device_id': device_id,
                'config_version': str(config_version),
                'desired_json': desired_json or {},
                'created_at': datetime.now(timezone.utc).isoformat(),
                'created_by': created_by or 'unknown',
            }
            self._remote_configs.append(row)
            return dict(row)

        result = self._execute("""
            INSERT INTO device_configs (
                device_id, config_version, desired_json, created_by
            ) VALUES (%s, %s, %s::jsonb, %s)
            RETURNING *
        """, (
            device_id,
            str(config_version),
            json.dumps(desired_json or {}),
            created_by or 'unknown',
        ))
        if not result:
            return None
        return self._normalize_row_datetimes(result[0], ['created_at'])

    def record_config_applied(self, payload: Dict) -> Optional[Dict]:
        device_id = payload.get('device_id')
        config_version = payload.get('config_version')
        if not device_id or config_version is None:
            return None
        self._ensure_remote_management_tables()
        self._upsert_remote_device(device_id, {})

        applied_at = self._parse_datetime(payload.get('applied_at'))
        applied = bool(payload.get('applied', False))
        errors = payload.get('errors') if payload.get('errors') is not None else []
        raw_json = payload.get('raw_json') or payload

        if self.use_mock:
            row = {
                'id': self._next_mock_id(self._remote_config_applies),
                'device_id': device_id,
                'config_version': str(config_version),
                'applied': applied,
                'applied_at': applied_at.isoformat(),
                'error_json': errors,
                'raw_json': raw_json,
                'created_at': datetime.now(timezone.utc).isoformat(),
            }
            self._remote_config_applies.append(row)
        else:
            self._execute("""
                INSERT INTO device_config_applies (
                    device_id, config_version, applied, applied_at, error_json, raw_json
                ) VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """, (
                device_id,
                str(config_version),
                applied,
                applied_at,
                json.dumps(errors),
                json.dumps(raw_json),
            ), fetch=False)

        updates = {'last_seen_at': datetime.now(timezone.utc)}
        if applied:
            updates['current_config_version'] = str(config_version)
        self._upsert_remote_device(device_id, updates)

        return {
            'device_id': device_id,
            'config_version': str(config_version),
            'applied': applied,
            'applied_at': applied_at.isoformat(),
            'errors': errors,
        }

    def record_command_issued(self, device_id: str, command_id: str, command_type: str,
                              payload_json: Dict, issued_by: str) -> Optional[Dict]:
        if not device_id or not command_id or not command_type:
            return None
        self._ensure_remote_management_tables()
        self._upsert_remote_device(device_id, {})

        issued_at = datetime.now(timezone.utc)
        row = {
            'device_id': device_id,
            'command_id': command_id,
            'command_type': command_type,
            'payload_json': payload_json or {},
            'status': 'pending',
            'issued_at': issued_at.isoformat(),
            'finished_at': None,
            'result_json': None,
            'issued_by': issued_by or 'unknown',
        }

        if self.use_mock:
            mock_row = dict(row)
            mock_row['id'] = self._next_mock_id(self._remote_commands)
            self._remote_commands.append(mock_row)
            return mock_row

        result = self._execute("""
            INSERT INTO device_commands (
                device_id, command_id, command_type, payload_json, status, issued_at, issued_by
            ) VALUES (%s, %s, %s, %s::jsonb, 'pending', %s, %s)
            RETURNING *
        """, (
            device_id,
            command_id,
            command_type,
            json.dumps(payload_json or {}),
            issued_at,
            issued_by or 'unknown',
        ))
        if not result:
            return None
        return self._normalize_row_datetimes(result[0], ['issued_at', 'finished_at'])

    def record_command_result(self, payload: Dict) -> Optional[Dict]:
        device_id = payload.get('device_id')
        command_id = payload.get('command_id')
        command_type = payload.get('command_type')
        if not device_id or not command_id:
            return None
        self._ensure_remote_management_tables()
        self._upsert_remote_device(device_id, {})

        finished_at = self._parse_datetime(payload.get('finished_at'))
        status = str(payload.get('status') or 'unknown')
        details = payload.get('details') if payload.get('details') is not None else {}

        if self.use_mock:
            updated_row = None
            for idx in range(len(self._remote_commands) - 1, -1, -1):
                cmd = self._remote_commands[idx]
                if cmd.get('device_id') == device_id and cmd.get('command_id') == command_id:
                    cmd['status'] = status
                    cmd['finished_at'] = finished_at.isoformat()
                    cmd['result_json'] = details
                    updated_row = dict(cmd)
                    break

            if not updated_row:
                updated_row = {
                    'id': self._next_mock_id(self._remote_commands),
                    'device_id': device_id,
                    'command_id': command_id,
                    'command_type': command_type or 'unknown',
                    'payload_json': {},
                    'status': status,
                    'issued_at': finished_at.isoformat(),
                    'finished_at': finished_at.isoformat(),
                    'result_json': details,
                    'issued_by': 'system',
                }
                self._remote_commands.append(updated_row)
        else:
            result = self._execute("""
                UPDATE device_commands
                SET status = %s,
                    finished_at = %s,
                    result_json = %s::jsonb
                WHERE device_id = %s AND command_id = %s
                RETURNING *
            """, (
                status,
                finished_at,
                json.dumps(details),
                device_id,
                command_id,
            ))

            if not result:
                result = self._execute("""
                    INSERT INTO device_commands (
                        device_id, command_id, command_type, payload_json, status,
                        issued_at, finished_at, result_json, issued_by
                    ) VALUES (%s, %s, %s, '{}'::jsonb, %s, %s, %s, %s::jsonb, 'system')
                    RETURNING *
                """, (
                    device_id,
                    command_id,
                    command_type or 'unknown',
                    status,
                    finished_at,
                    finished_at,
                    json.dumps(details),
                ))
            updated_row = self._normalize_row_datetimes(result[0], ['issued_at', 'finished_at']) if result else None

        self._upsert_remote_device(device_id, {'last_seen_at': datetime.now(timezone.utc)})
        return updated_row

    def record_system_event(self, payload: Dict) -> Optional[Dict]:
        device_id = payload.get('device_id')
        if not device_id:
            return None
        self._ensure_remote_management_tables()
        self._upsert_remote_device(device_id, {})

        event_at = self._parse_datetime(payload.get('timestamp') or payload.get('event_at'))
        event_type = payload.get('event_type') or payload.get('type') or 'system'
        severity = payload.get('severity') or 'info'
        message = payload.get('message') or payload.get('details') or ''
        payload_json = payload.get('payload') if isinstance(payload.get('payload'), dict) else payload

        row = {
            'device_id': device_id,
            'event_type': event_type,
            'severity': severity,
            'message': message,
            'event_at': event_at.isoformat(),
            'payload_json': payload_json,
            'raw_json': payload.get('raw_json') or payload,
        }

        if self.use_mock:
            mock_row = dict(row)
            mock_row['id'] = self._next_mock_id(self._remote_system_events)
            self._remote_system_events.append(mock_row)
            inserted = mock_row
        else:
            result = self._execute("""
                INSERT INTO system_events (
                    device_id, event_type, severity, message, event_at, payload_json, raw_json
                ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                RETURNING *
            """, (
                device_id,
                event_type,
                severity,
                message,
                event_at,
                json.dumps(payload_json),
                json.dumps(row['raw_json']),
            ))
            inserted = self._normalize_row_datetimes(result[0], ['event_at', 'created_at']) if result else None

        self._upsert_remote_device(device_id, {'last_seen_at': datetime.now(timezone.utc)})
        return inserted

    def mark_remote_device_error(self, device_id: str, message: str) -> Optional[Dict]:
        if not device_id:
            return None
        self.record_system_event({
            'device_id': device_id,
            'event_type': 'ingest_error',
            'severity': 'error',
            'message': message,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        })
        return self._upsert_remote_device(device_id, {'current_status': 'error'})

    def get_access_history(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_access_history if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('timestamp') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, timestamp, mqtt_ok, tailscale_ok, reverse_tunnel_ok, ssh_ready, raw_json, created_at
            FROM device_access_states
            WHERE device_id = %s
            ORDER BY timestamp DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [
            self._normalize_row_datetimes(row, ['timestamp', 'created_at'])
            for row in result
        ]

    def get_network_history(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_network_history if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('timestamp') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, timestamp, primary_interface, default_route_interface,
                   public_egress_ip, local_ip, tailscale_ip, interfaces_json, raw_json, created_at
            FROM device_network_states
            WHERE device_id = %s
            ORDER BY timestamp DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [
            self._normalize_row_datetimes(row, ['timestamp', 'created_at'])
            for row in result
        ]

    def get_device_configs(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_configs if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('created_at') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, config_version, desired_json, created_at, created_by
            FROM device_configs
            WHERE device_id = %s
            ORDER BY created_at DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [self._normalize_row_datetimes(row, ['created_at']) for row in result]

    def get_device_config_applies(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_config_applies if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('applied_at') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, config_version, applied, applied_at, error_json, raw_json, created_at
            FROM device_config_applies
            WHERE device_id = %s
            ORDER BY created_at DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [self._normalize_row_datetimes(row, ['applied_at', 'created_at']) for row in result]

    def get_device_commands(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_commands if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('issued_at') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, command_id, command_type, payload_json, status,
                   issued_at, finished_at, result_json, issued_by
            FROM device_commands
            WHERE device_id = %s
            ORDER BY issued_at DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [self._normalize_row_datetimes(row, ['issued_at', 'finished_at']) for row in result]

    def clear_device_commands(self, device_id: str) -> int:
        self._ensure_remote_management_tables()
        if not device_id:
            return 0

        if self.use_mock:
            before = len(self._remote_commands)
            self._remote_commands = [
                cmd for cmd in self._remote_commands
                if cmd.get('device_id') != device_id
            ]
            return max(0, before - len(self._remote_commands))

        result = self._execute(
            "DELETE FROM device_commands WHERE device_id = %s",
            (device_id,),
            fetch=False,
        )
        return int(result or 0)

    def get_system_events(self, device_id: str, limit: int = 100) -> List[Dict]:
        self._ensure_remote_management_tables()
        limit = max(1, min(int(limit), 1000))

        if self.use_mock:
            rows = [dict(r) for r in self._remote_system_events if r.get('device_id') == device_id]
            rows.sort(key=lambda r: r.get('event_at') or '', reverse=True)
            return rows[:limit]

        result = self._execute("""
            SELECT id, device_id, event_type, severity, message, event_at, payload_json, raw_json, created_at
            FROM system_events
            WHERE device_id = %s
            ORDER BY event_at DESC
            LIMIT %s
        """, (device_id, limit))
        if not result:
            return []
        return [self._normalize_row_datetimes(row, ['event_at', 'created_at']) for row in result]

    def close(self):
        if self.connection:
            try:
                self.connection.close()
                logger.info("Database connection closed")
            except Exception as e:
                logger.warning(f"Error closing database connection: {e}")
            finally:
                self.connection = None

    def __del__(self):
        self.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False
