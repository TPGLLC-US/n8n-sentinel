-- Migration 004: Error reporting foundation
-- Adds error_node to executions, settings table, ai_fix_attempts table, n8n_api_key to instances

-- 1. Add error_node column to executions (which node failed)
ALTER TABLE executions ADD COLUMN IF NOT EXISTS error_node VARCHAR(255);

-- 2. Global settings table (key-value, supports encrypted values)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AI fix attempts tracking table
CREATE TABLE IF NOT EXISTS ai_fix_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID REFERENCES executions(id) ON DELETE SET NULL,
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    workflow_remote_id VARCHAR(255),
    workflow_name VARCHAR(500),
    error_message TEXT,
    error_node VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, in_progress, success, failed, rejected
    ai_diagnosis TEXT,
    ai_fix_description TEXT,
    fix_applied BOOLEAN DEFAULT false,
    triggered_by VARCHAR(20) NOT NULL DEFAULT 'manual', -- manual, auto
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_fix_attempts_instance ON ai_fix_attempts(instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_fix_attempts_execution ON ai_fix_attempts(execution_id);
CREATE INDEX IF NOT EXISTS idx_ai_fix_attempts_status ON ai_fix_attempts(status) WHERE status IN ('pending', 'in_progress');

-- 4. Add encrypted n8n API key column to instances (needed for AI to read/fix workflows)
ALTER TABLE instances ADD COLUMN IF NOT EXISTS n8n_api_key_encrypted TEXT;
