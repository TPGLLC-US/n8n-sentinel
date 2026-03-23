-- Add source column to token_usage to distinguish workflow AI tokens from Sentinel AI tokens
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'workflow';

-- Add call_type for sentinel calls (diagnosis vs fix)
ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS call_type VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_token_usage_source ON token_usage(source);
