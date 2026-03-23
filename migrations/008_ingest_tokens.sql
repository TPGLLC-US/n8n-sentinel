-- migrations/008_ingest_tokens.sql
-- Add per-instance ingest tokens for unique webhook URLs

-- 1. Add ingest_token column to instances (nullable for existing rows)
ALTER TABLE instances ADD COLUMN IF NOT EXISTS ingest_token VARCHAR(32) UNIQUE;

-- 2. Backfill existing instances with random tokens (24 chars, URL-safe)
UPDATE instances SET ingest_token = LEFT(REPLACE(gen_random_uuid()::text, '-', ''), 24)
WHERE ingest_token IS NULL;

-- 3. Make it NOT NULL after backfill
ALTER TABLE instances ALTER COLUMN ingest_token SET NOT NULL;

-- 4. Add index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_instances_ingest_token ON instances(ingest_token);

-- 5. Seed account-level token in settings (if not exists)
INSERT INTO settings (key, value, is_encrypted)
VALUES ('account_ingest_token', LEFT(REPLACE(gen_random_uuid()::text, '-', ''), 16), false)
ON CONFLICT (key) DO NOTHING;
