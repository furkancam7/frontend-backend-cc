import logging
from datetime import datetime, timedelta
from storage.minio_client import get_minio

class MinIOLogHandler(logging.Handler):
    
    def __init__(self, log_name: str = "mqtt_receiver", buffer_size: int = 100):
        super().__init__()
        self.log_name = log_name
        self.buffer = []
        self.buffer_size = buffer_size
        self.last_flush = datetime.now()
        self.flush_interval = timedelta(seconds=60)  
    
    def emit(self, record):
        try:
            log_entry = self.format(record)
            self.buffer.append(log_entry)
            should_flush = (
                len(self.buffer) >= self.buffer_size or 
                datetime.now() - self.last_flush > self.flush_interval
            )
            
            if should_flush:
                self.flush()
        except Exception:
            self.handleError(record)
    
    def flush(self):
        if not self.buffer:
            return
        
        try:
            minio = get_minio()
            if minio:
                log_content = "\n".join(self.buffer)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                log_filename = f"{self.log_name}_{timestamp}.log"
                
                minio.upload_image(
                    data=log_content.encode('utf-8'), 
                    filename=log_filename,
                    folder="logs",
                    content_type="text/plain"
                )
                self.buffer = []
                self.last_flush = datetime.now()
        except Exception:
            pass

def setup_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    
    if logger.handlers:
        return logger
    
    logger.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    minio_handler = MinIOLogHandler(log_name=name)
    minio_handler.setFormatter(formatter)
    minio_handler.setLevel(logging.DEBUG)
    logger.addHandler(minio_handler)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logger("MQTTReceiver")
