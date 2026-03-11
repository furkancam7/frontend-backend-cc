import os
import json
import logging
import time
from functools import wraps
from typing import Optional, Dict, List, Any, Callable
from datetime import timedelta, datetime
from pathlib import Path
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger("MinIOClient")

RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY = 1.0
RETRY_MAX_DELAY = 30.0 
RETRY_EXPONENTIAL_BASE = 2

def retry_on_failure(
    max_attempts: int = RETRY_MAX_ATTEMPTS,
    base_delay: float = RETRY_BASE_DELAY,
    max_delay: float = RETRY_MAX_DELAY,
    exponential_base: int = RETRY_EXPONENTIAL_BASE,
    retryable_exceptions: tuple = (S3Error, ConnectionError, TimeoutError, OSError)
):
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    
                    if isinstance(e, S3Error):
                        error_code = getattr(e, 'code', '')
                        if error_code and error_code.startswith('4') and error_code != '429':
                            logger.error(f"Permanent error (no retry): {e}")
                            raise
                    
                    if attempt < max_attempts - 1:
                        delay = min(
                            base_delay * (exponential_base ** attempt),
                            max_delay
                        )
                        import random
                        jitter = delay * 0.25 * (random.random() * 2 - 1)
                        delay = max(0.1, delay + jitter)
                        
                        logger.warning(
                            f"MinIO operation failed (attempt {attempt + 1}/{max_attempts}): {e}. "
                            f"Retrying in {delay:.1f}s..."
                        )
                        time.sleep(delay)
                    else:
                        logger.error(
                            f"MinIO operation failed after {max_attempts} attempts: {e}"
                        )
            
            if last_exception:
                raise last_exception
            return None
        return wrapper
    return decorator

def generate_folder_path(hub_id: str = None, device_id: str = None, timestamp: datetime = None, file_type: str = None) -> Optional[str]:
    if not device_id:
        return None
    
    if timestamp is None:
        timestamp = datetime.now()
    
    date_path = timestamp.strftime("%Y/%m/%d/%H:%M")
    
    if hub_id:
        base_path = f"{hub_id}/{device_id}/{date_path}"
    else:
        base_path = f"{device_id}/{date_path}"
    
    if file_type:
        return f"{base_path}/{file_type}"
    return base_path

class MinIOStorage:
    def __init__(
        self,
        endpoint: str = None,
        access_key: str = None,
        secret_key: str = None,
        bucket: str = None,
        secure: bool = False
    ):
        raw_endpoint = endpoint or os.getenv("MINIO_ENDPOINT", "")
        if raw_endpoint.startswith("https://"):
            raw_endpoint = raw_endpoint.replace("https://", "")
            self.secure = True
        elif raw_endpoint.startswith("http://"):
            raw_endpoint = raw_endpoint.replace("http://", "")
            if not secure:
                self.secure = os.getenv("MINIO_SECURE", "false").lower() == "true"
        else:
            self.secure = secure or os.getenv("MINIO_SECURE", "false").lower() == "true"
        self.endpoint = raw_endpoint.rstrip("/")
        self.access_key = access_key or os.getenv("MINIO_ACCESS_KEY")
        self.secret_key = secret_key or os.getenv("MINIO_SECRET_KEY")
        self.bucket = bucket or os.getenv("MINIO_BUCKET", "detections")
        self.client: Optional[Minio] = None
        self._connected = False

    
    def connect(self) -> bool:
        if not all([self.endpoint, self.access_key, self.secret_key]):
            logger.error("MinIO credentials not configured. Check MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY environment variables.")
            return False

        try:
            self.client = Minio(
                self.endpoint,
                access_key=self.access_key,
                secret_key=self.secret_key,
                secure=self.secure
            )
            
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
                logger.info(f"Bucket created: {self.bucket}")
            
            self._connected = True
            logger.info(f"MinIO connected: {self.endpoint}/{self.bucket}")
            return True
            
        except S3Error as e:
            logger.error(f"MinIO S3 error: {e}")
            return False
        except Exception as e:
            logger.error(f"MinIO connection error: {e}")
            return False
    
    @property
    def is_connected(self) -> bool:
        return self._connected and self.client is not None
    
    def upload_image(
        self,
        data: bytes,
        filename: str,
        folder: str = "images",
        content_type: str = "image/webp",
        device_id: str = None,
        hub_id: str = None
    ) -> Optional[str]:
        if not self.is_connected:
            if not self.connect():
                return None
        
        if device_id:
            base_path = generate_folder_path(hub_id=hub_id, device_id=device_id, file_type=folder)
            if base_path:
                object_name = f"{base_path}/{filename}"
            else:
                object_name = f"{folder}/{filename}"
        else:
            object_name = f"{folder}/{filename}"
        return self._upload_with_retry(data, object_name, content_type)
    
    @retry_on_failure(max_attempts=3, base_delay=1.0)
    def _upload_with_retry(
        self,
        data: bytes,
        object_name: str,
        content_type: str
    ) -> Optional[str]:
        from io import BytesIO
        
        if not self.is_connected:
            if not self.connect():
                raise ConnectionError("Failed to connect to MinIO")
        
        data_stream = BytesIO(data)
        
        self.client.put_object(
            self.bucket,
            object_name,
            data_stream,
            length=len(data),
            content_type=content_type
        )
        
        logger.info(f"Uploaded: {object_name} ({len(data)} bytes)")
        return object_name
    
    def upload_json(
        self,
        data: Dict[str, Any],
        filename: str,
        folder: str = "jsons",
        device_id: str = None,
        hub_id: str = None
    ) -> Optional[str]:
        if not self.is_connected:
            if not self.connect():
                return None
        
        json_bytes = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        
        if device_id:
            base_path = generate_folder_path(hub_id=hub_id, device_id=device_id, file_type="jsons")
            if base_path:
                object_name = f"{base_path}/{filename}"
            else:
                object_name = f"{folder}/{filename}"
        else:
            object_name = f"{folder}/{filename}"
        
        return self._upload_with_retry(json_bytes, object_name, "application/json")
    
    def get_presigned_url(
        self,
        object_name: str,
        expiry_hours: int = 24
    ) -> Optional[str]:
        if not self.is_connected:
            if not self.connect():
                return None
        
        try:
            url = self.client.presigned_get_object(
                self.bucket,
                object_name,
                expires=timedelta(hours=expiry_hours)
            )
            return url
            
        except S3Error as e:
            logger.error(f"Presigned URL error: {e}")
            return None
    
    def list_files(
        self,
        prefix: str = "",
        recursive: bool = True
    ) -> List[Dict[str, Any]]:
        if not self.is_connected:
            if not self.connect():
                return []
        
        try:
            objects = self.client.list_objects(
                self.bucket,
                prefix=prefix,
                recursive=recursive
            )
            
            files = []
            for obj in objects:
                files.append({
                    "name": obj.object_name,
                    "size": obj.size,
                    "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
                    "etag": obj.etag
                })
            
            return files
            
        except S3Error as e:
            logger.error(f"List error: {e}")
            return []
    
    def download_file(self, object_name: str) -> Optional[bytes]:
        if not self.is_connected:
            if not self.connect():
                return None
        
        try:
            response = self.client.get_object(self.bucket, object_name)
            data = response.read()
            response.close()
            response.release_conn()
            return data
            
        except S3Error as e:
            logger.error(f"Download error: {e}")
            return None
    
    def delete_file(self, object_name: str) -> bool:
        """Deletes a file from MinIO."""
        if not self.is_connected:
            if not self.connect():
                return False
        
        try:
            self.client.remove_object(self.bucket, object_name)
            logger.info(f"Deleted: {object_name}")
            return True
            
        except S3Error as e:
            logger.error(f"Delete error: {e}")
            return False

_minio_instance: Optional[MinIOStorage] = None

def get_minio() -> Optional[MinIOStorage]:
    global _minio_instance
    if _minio_instance is None or not _minio_instance.is_connected:
        _minio_instance = MinIOStorage()
        if not _minio_instance.connect():
            logger.warning("MinIO connection failed, will retry on next request")
            _minio_instance = None
            return None
    return _minio_instance

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    minio = get_minio()
    
