import os
import secrets
from pathlib import Path

# Load .env first, then .env.local overrides (if present).
# This prevents losing required vars from .env when .env.local is partial.
try:
    from dotenv import load_dotenv
    env_local = Path(__file__).parent / '.env.local'
    env_file = Path(__file__).parent / '.env'

    if env_file.exists():
        load_dotenv(env_file, override=False)
        print(f"[Config] Loaded: {env_file}")

    if env_local.exists():
        load_dotenv(env_local, override=True)
        print(f"[Config] Loaded overrides: {env_local}")
except ImportError:
    pass

class Config:    
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    _jwt_secret = os.getenv("JWT_SECRET_KEY")
    if not _jwt_secret:
        if os.getenv("ENVIRONMENT", "").lower() == "production":
            raise ValueError(
                "FATAL: JWT_SECRET_KEY environment variable is not set in production! "
                "Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'"
            )
        import warnings
        warnings.warn(
            "JWT_SECRET_KEY not set — using random key. Sessions will reset on restart.",
            UserWarning,
        )
    JWT_SECRET_KEY = _jwt_secret or secrets.token_hex(32)
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "30"))
    JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_EXPIRE_DAYS", "7"))
    # MQTT Settings
    MQTT_ENABLED = os.getenv("MQTT_ENABLED", "true").lower() == "true"
    MQTT_BROKER = os.getenv("MQTT_BROKER", "127.0.0.1")
    MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
    MQTT_KEEPALIVE = int(os.getenv("MQTT_KEEPALIVE", 60))
    MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
    MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
    MQTT_TLS_ENABLED = os.getenv("MQTT_TLS_ENABLED", "false").lower() == "true"
    MQTT_TLS_CA_CERT = os.getenv("MQTT_TLS_CA_CERT", "")  
    MQTT_TLS_INSECURE = os.getenv("MQTT_TLS_INSECURE", "false").lower() == "true"
    INFERENCE_CONFIG_ACK_TIMEOUT_SEC = int(os.getenv("INFERENCE_CONFIG_ACK_TIMEOUT_SEC", "120"))
    MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC = int(os.getenv("MQTT_PUBLISH_CONFIRM_TIMEOUT_SEC", "2"))
    
    # MinIO Settings
    MINIO_ENABLED = os.getenv("MINIO_ENABLED", "true").lower() == "true"

    _DEFAULT_CORS_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]
    _cors_env = os.getenv("CORS_ORIGINS", "")
    if _cors_env and _cors_env != "*":
        _parsed_origins = [origin.strip() for origin in _cors_env.split(",") if origin.strip()]
        if ENVIRONMENT.lower() == "production":
            CORS_ORIGINS = [o for o in _parsed_origins if "localhost" not in o and "127.0.0.1" not in o]
            if not CORS_ORIGINS:
                import warnings
                warnings.warn("CORS_ORIGINS contains only localhost addresses which are blocked in production!")
                CORS_ORIGINS = []
        else:
            CORS_ORIGINS = _parsed_origins
    else:
        if ENVIRONMENT.lower() == "production":
            import warnings
            warnings.warn("CORS_ORIGINS not set in production! CORS will be disabled.")
            CORS_ORIGINS = []
        else:
            CORS_ORIGINS = _DEFAULT_CORS_ORIGINS
    
    @classmethod
    def is_production(cls) -> bool:
        return cls.ENVIRONMENT.lower() == "production"
    
    @classmethod
    def has_mqtt_auth(cls) -> bool:
        return bool(cls.MQTT_USERNAME and cls.MQTT_PASSWORD)

config = Config()
