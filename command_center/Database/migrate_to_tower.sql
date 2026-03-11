-- ============================================================
-- Migration: Normalize devices to single "tower" type
-- Removes HUB/SOLO distinction, unifies to device_id + type=tower
-- ============================================================

BEGIN;

-- 1. Update all device records: set type to 'tower', normalize device_id
UPDATE kv_store
SET value = jsonb_set(
    jsonb_set(
        value,
        '{device_type}',
        '"tower"'
    ),
    '{type}',
    '"tower"'
)
WHERE namespace = 'device';

-- 2. For detection records that have hub_id but no device_id, copy hub_id -> device_id
UPDATE kv_store
SET value = jsonb_set(value, '{device_id}', value->'hub_id')
WHERE namespace = 'detection'
  AND (value->>'device_id' IS NULL OR value->>'device_id' = '')
  AND value->>'hub_id' IS NOT NULL
  AND value->>'hub_id' != '';

-- 3. For detection records that have solo_id but no device_id, copy solo_id -> device_id
UPDATE kv_store
SET value = jsonb_set(value, '{device_id}', value->'solo_id')
WHERE namespace = 'detection'
  AND (value->>'device_id' IS NULL OR value->>'device_id' = '')
  AND value->>'solo_id' IS NOT NULL
  AND value->>'solo_id' != '';

-- 4. Remove hub_id, solo_id, hub_info from detection records
UPDATE kv_store
SET value = value - 'hub_id' - 'solo_id' - 'hub_info'
WHERE namespace = 'detection'
  AND (value ? 'hub_id' OR value ? 'solo_id' OR value ? 'hub_info');

-- 5. Remove hub-specific fields from device records
UPDATE kv_store
SET value = value - 'hub_id' - 'hubid' - 'hubId' - 'solo_id' - 'soloId'
    - 'battery_capacity' - 'hub_battery_capacity' - 'hub_battery_condition'
    - 'last_known_location' - 'hub_location'
WHERE namespace = 'device'
  AND (value ? 'hub_id' OR value ? 'hubid' OR value ? 'solo_id');

-- 6. Remove any drone-prefixed devices
DELETE FROM kv_store
WHERE namespace = 'device'
  AND (
    value->>'device_id' ILIKE 'DRONE%'
    OR value->>'id' ILIKE 'DRONE%'
    OR key ILIKE 'device:DRONE%'
  );

-- 7. Drop notification/detection classes that are not fire or smoke
-- (These remain in DB but will be ignored by the pipeline)

-- 8. Create index on device_type for fast filtering
CREATE INDEX IF NOT EXISTS idx_kv_device_type ON kv_device ((value->>'type'));
CREATE INDEX IF NOT EXISTS idx_kv_device_device_type ON kv_device ((value->>'device_type'));

COMMIT;
