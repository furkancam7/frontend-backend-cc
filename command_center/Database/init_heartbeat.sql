-- Heartbeat settings table
-- Stores per-device heartbeat configuration, ACK status, and runtime state

CREATE TABLE IF NOT EXISTS device_heartbeat_settings (
    device_id        VARCHAR(128) PRIMARY KEY,
    enabled          BOOLEAN      NOT NULL DEFAULT TRUE,
    heartbeat_interval_s  INTEGER NOT NULL DEFAULT 30,
    offline_threshold_s   INTEGER NOT NULL DEFAULT 90,
    jitter_s              INTEGER NOT NULL DEFAULT 3,
    config_version        INTEGER NOT NULL DEFAULT 0,

    -- Config delivery tracking
    last_config_sent_at   TIMESTAMPTZ,
    last_config_ack_at    TIMESTAMPTZ,
    last_ack_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (last_ack_status IN ('pending', 'applied', 'failed', 'stale')),
    last_ack_error_code   VARCHAR(64),
    last_ack_error_message TEXT,

    -- Heartbeat runtime state
    last_heartbeat_at     TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_heartbeat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_heartbeat_updated_at ON device_heartbeat_settings;
CREATE TRIGGER trg_heartbeat_updated_at
BEFORE UPDATE ON device_heartbeat_settings
FOR EACH ROW EXECUTE FUNCTION set_heartbeat_updated_at();

-- Index for quick online/offline queries
CREATE INDEX IF NOT EXISTS idx_heartbeat_last_heartbeat
    ON device_heartbeat_settings (last_heartbeat_at DESC NULLS LAST);

COMMIT;
