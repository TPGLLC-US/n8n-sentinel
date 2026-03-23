-- Migration 005: Add AI diagnosis storage to executions
-- Stores structured diagnosis JSON: { diagnosis, cause, resolution, category, severity, fixable }

ALTER TABLE executions ADD COLUMN IF NOT EXISTS ai_diagnosis JSONB DEFAULT NULL;

-- Index for quickly finding errors that have/haven't been diagnosed
CREATE INDEX IF NOT EXISTS idx_executions_ai_diagnosis ON executions ((ai_diagnosis IS NOT NULL)) WHERE status = 'error';
