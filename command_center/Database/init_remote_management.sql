-- ============================================================
-- Remote Management Plane tables
-- Mount as 04_remote_management.sql in docker-compose postgres init
-- ============================================================

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
);

CREATE TABLE IF NOT EXISTS device_access_states (
    id                        BIGSERIAL PRIMARY KEY,
    device_id                 VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    timestamp                 TIMESTAMPTZ NOT NULL,
    mqtt_ok                   BOOLEAN,
    tailscale_ok              BOOLEAN,
    reverse_tunnel_ok         BOOLEAN,
    ssh_ready                 BOOLEAN,
    raw_json                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_network_states (
    id                        BIGSERIAL PRIMARY KEY,
    device_id                 VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    timestamp                 TIMESTAMPTZ NOT NULL,
    primary_interface         VARCHAR(128),
    default_route_interface   VARCHAR(128),
    public_egress_ip          VARCHAR(64),
    local_ip                  VARCHAR(64),
    tailscale_ip              VARCHAR(64),
    interfaces_json           JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_json                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_configs (
    id              BIGSERIAL PRIMARY KEY,
    device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    config_version  VARCHAR(64) NOT NULL,
    desired_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS device_config_applies (
    id              BIGSERIAL PRIMARY KEY,
    device_id       VARCHAR(128) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    config_version  VARCHAR(64) NOT NULL,
    applied         BOOLEAN NOT NULL DEFAULT FALSE,
    applied_at      TIMESTAMPTZ,
    error_json      JSONB,
    raw_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_rm_devices_last_seen ON devices(last_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_rm_access_device_ts ON device_access_states(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rm_network_device_ts ON device_network_states(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rm_configs_device_created ON device_configs(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rm_config_apply_device_created ON device_config_applies(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rm_commands_device_issued ON device_commands(device_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_rm_commands_command_id ON device_commands(command_id);
CREATE INDEX IF NOT EXISTS idx_rm_system_events_device_event ON system_events(device_id, event_at DESC);

-- Backward-compatible adds for existing deployments
ALTER TABLE IF EXISTS devices
    ADD COLUMN IF NOT EXISTS local_ip VARCHAR(64);

ALTER TABLE IF EXISTS device_network_states
    ADD COLUMN IF NOT EXISTS local_ip VARCHAR(64);

COMMIT;
