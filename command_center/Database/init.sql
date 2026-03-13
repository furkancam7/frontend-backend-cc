CREATE TABLE IF NOT EXISTS kv_store (
    id BIGSERIAL,
    key VARCHAR(512) NOT NULL,
    namespace VARCHAR(50) NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    version INTEGER DEFAULT 1,
    PRIMARY KEY (namespace, key) 
) PARTITION BY LIST (namespace);


CREATE TABLE IF NOT EXISTS kv_detection PARTITION OF kv_store FOR VALUES IN ('detection');
CREATE TABLE IF NOT EXISTS kv_crop PARTITION OF kv_store FOR VALUES IN ('crop');
CREATE TABLE IF NOT EXISTS kv_device PARTITION OF kv_store FOR VALUES IN ('device');
CREATE TABLE IF NOT EXISTS kv_image PARTITION OF kv_store FOR VALUES IN ('image');
CREATE TABLE IF NOT EXISTS kv_log PARTITION OF kv_store FOR VALUES IN ('log');
CREATE TABLE IF NOT EXISTS kv_default PARTITION OF kv_store DEFAULT;
CREATE INDEX IF NOT EXISTS idx_kv_value_gin ON kv_store USING GIN (value);
CREATE INDEX IF NOT EXISTS idx_kv_det_device ON kv_detection ((value->>'device_id'));
CREATE INDEX IF NOT EXISTS idx_kv_det_timestamp ON kv_detection ((value->>'timestamp') DESC);
CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL;
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kv_updated_at ON kv_store;
CREATE TRIGGER trg_kv_updated_at
BEFORE UPDATE ON kv_store
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE OR REPLACE FUNCTION kv_upsert(
    p_key VARCHAR(512),
    p_namespace VARCHAR(50),
    p_value JSONB
) RETURNS VOID AS $$
BEGIN
    INSERT INTO kv_store (key, namespace, value, version)
    VALUES (p_key, p_namespace, p_value, 1)
    ON CONFLICT (namespace, key) DO UPDATE SET
        value = p_value,
        version = kv_store.version + 1,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION kv_search(
    p_namespace VARCHAR(50),
    p_field TEXT,
    p_value TEXT
)
RETURNS TABLE(key VARCHAR(512), value JSONB) AS $$
    SELECT key, value 
    FROM kv_store 
    WHERE namespace = p_namespace 
      
      AND value @> jsonb_build_object(p_field, p_value)
      AND (expires_at IS NULL OR expires_at > NOW());
$$ LANGUAGE SQL;


CREATE OR REPLACE FUNCTION kv_get(p_key VARCHAR(512))
RETURNS JSONB AS $$
    SELECT value 
    FROM kv_store 
    WHERE key = p_key
      AND (expires_at IS NULL OR expires_at > NOW());
$$ LANGUAGE SQL;


CREATE OR REPLACE FUNCTION kv_delete(p_key VARCHAR(512))
RETURNS BOOLEAN AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM kv_store WHERE key = p_key;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count > 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kv_get_by_namespace(
    p_namespace VARCHAR(50),
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(key VARCHAR(512), value JSONB, created_at TIMESTAMPTZ) AS $$
    SELECT key, value, created_at 
    FROM kv_store 
    WHERE namespace = p_namespace 
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION kv_cleanup_expired()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active) WHERE is_active = TRUE;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO users (username, email, password_hash, role, is_active)
VALUES (
    'admin',
    'admin@commandcenter.local',
    '$2b$12$4/uGiNu4Bs3xmJBJFIhcE.xhX4Pb7UKarhqn.7.BY.LRHk3BTMqMy',
    'admin',
    TRUE
) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO users (username, email, password_hash, role, is_active)
VALUES (
    'user',
    'user@commandcenter.local',
    '$2b$12$tFHMjI.QdOYq1uylrcLFC.duBjB2aJNUGfjW0yOMKYzphY30Hcul.',
    'viewer',
    TRUE
) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

COMMIT;
