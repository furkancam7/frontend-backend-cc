-- ============================================================
-- Detection Events & Media tables
-- Mount as 03_detections.sql in docker-compose postgres init
-- ============================================================

-- Main events table
CREATE TABLE IF NOT EXISTS detection_events (
    id              BIGSERIAL PRIMARY KEY,
    event_id        VARCHAR(64) NOT NULL UNIQUE,
    device_id       VARCHAR(64) NOT NULL,
    camera_id       VARCHAR(16) NOT NULL,          -- 'eo' | 'ir'
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- inference summary
    model           VARCHAR(64),
    has_detection   BOOLEAN NOT NULL DEFAULT FALSE,
    max_confidence  REAL DEFAULT 0.0,
    classes         JSONB DEFAULT '[]',             -- [0,1] class ids
    boxes           JSONB DEFAULT '[]',             -- full boxes array
    inference_json  JSONB,                          -- entire inference payload

    -- speed metrics (ms)
    speed_preprocess  REAL,
    speed_inference   REAL,
    speed_postprocess REAL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_det_events_device
    ON detection_events (device_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_det_events_detection
    ON detection_events (has_detection, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_det_events_event_id
    ON detection_events (event_id);

-- Media artefacts linked to an event (snapshot, clip, …)
CREATE TABLE IF NOT EXISTS detection_media (
    id              BIGSERIAL PRIMARY KEY,
    event_id        VARCHAR(64) NOT NULL REFERENCES detection_events(event_id)
                        ON DELETE CASCADE,
    device_id       VARCHAR(64) NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    content_type    VARCHAR(64) NOT NULL,           -- 'image/jpeg', 'video/mp4'
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    sha256          VARCHAR(64),
    is_placeholder  BOOLEAN NOT NULL DEFAULT FALSE,
    duration_s      REAL,                            -- video only

    -- chunk tracking (for reassembly)
    chunk_count     INTEGER DEFAULT 0,
    chunks_received INTEGER DEFAULT 0,
    fully_received  BOOLEAN NOT NULL DEFAULT FALSE,

    -- storage path (after reassembly / direct save)
    storage_path    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_det_media_event
    ON detection_media (event_id);

CREATE INDEX IF NOT EXISTS idx_det_media_device
    ON detection_media (device_id, created_at DESC);
