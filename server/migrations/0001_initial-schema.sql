-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Instances table
CREATE TABLE IF NOT EXISTS instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    environment VARCHAR(50), -- production, staging, development
    n8n_version VARCHAR(20),
    database_type VARCHAR(20), -- sqlite, postgres, mysql
    execution_mode VARCHAR(20), -- main, queue
    timezone VARCHAR(50),
    base_url VARCHAR(500), -- e.g. https://n8n.example.com
    hmac_secret VARCHAR(64) NOT NULL, -- base64 encoded 32-byte secret
    hmac_secret_previous VARCHAR(64), -- for rotation grace period
    hmac_secret_rotated_at TIMESTAMPTZ,
    ingest_token VARCHAR(32) NOT NULL UNIQUE, -- URL-safe token for per-instance ingest paths
    is_active BOOLEAN DEFAULT true,
    last_heartbeat TIMESTAMPTZ,
    reporter_version VARCHAR(20),
    baseline_workflow_count INTEGER,
    baseline_execution_count INTEGER,
    n8n_api_key_encrypted TEXT, -- encrypted n8n API key for AI fix service
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instances_active ON instances(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_instances_ingest_token ON instances(ingest_token);

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    remote_id VARCHAR(255) NOT NULL, -- n8n's internal workflow ID
    name VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    node_count INTEGER,
    remote_created_at TIMESTAMPTZ,
    remote_updated_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(instance_id, remote_id)
);

CREATE INDEX IF NOT EXISTS idx_workflows_instance ON workflows(instance_id);
CREATE INDEX IF NOT EXISTS idx_workflows_active ON workflows(instance_id, is_active) WHERE is_active = true;

-- Workflow resources (static analysis results)
CREATE TABLE IF NOT EXISTS workflow_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL, -- ai_model, google_doc, ms_doc, api_domain, webhook, database
    resource_identifier VARCHAR(500) NOT NULL,
    provider VARCHAR(100), -- openai, anthropic, google, microsoft, etc.
    node_name VARCHAR(255),
    credential_name VARCHAR(255), -- display name of the n8n credential used
    credential_id VARCHAR(255),   -- n8n internal credential ID (for verification)
    credential_exposed BOOLEAN DEFAULT false, -- true if hardcoded auth detected in node params
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_id, resource_type, resource_identifier)
);

CREATE INDEX IF NOT EXISTS idx_workflow_resources_type ON workflow_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_workflow_resources_workflow ON workflow_resources(workflow_id);

-- Executions table (high volume, retention-managed)
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    remote_execution_id VARCHAR(255),
    status VARCHAR(50) NOT NULL, -- success, error, running, waiting, cancelled
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    error_message TEXT,
    error_node VARCHAR(255), -- which node failed (from Error Trigger)
    ai_diagnosis JSONB DEFAULT NULL, -- structured AI diagnosis: { diagnosis, cause, resolution, category, severity, fixable }
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_id, remote_execution_id)
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow_started ON executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status) WHERE status = 'error';
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);
CREATE INDEX IF NOT EXISTS idx_executions_ai_diagnosis ON executions ((ai_diagnosis IS NOT NULL)) WHERE status = 'error';

-- Token usage per execution
CREATE TABLE IF NOT EXISTS token_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    model VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    tokens_input INTEGER,
    tokens_output INTEGER,
    accuracy VARCHAR(20) NOT NULL DEFAULT 'exact', -- exact, estimated, unavailable
    source VARCHAR(20) NOT NULL DEFAULT 'workflow', -- workflow (from n8n executions) or sentinel (diagnosis/fix)
    call_type VARCHAR(20), -- diagnosis, fix (only for source=sentinel)
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_execution ON token_usage(execution_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model, provider);
CREATE INDEX IF NOT EXISTS idx_token_usage_recorded ON token_usage(recorded_at);

-- Nonce cache for replay protection
CREATE TABLE IF NOT EXISTS nonce_cache (
    nonce VARCHAR(64) PRIMARY KEY,
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nonce_expires ON nonce_cache(expires_at);

-- Users table (Sentinel dashboard auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- bcrypt
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Refresh tokens for JWT token rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
    alert_type VARCHAR(50) NOT NULL, -- heartbeat_missed, error_rate_high, instance_offline
    severity VARCHAR(20) NOT NULL, -- info, warning, critical
    message TEXT NOT NULL,
    metadata JSONB, -- additional context
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_unacknowledged ON alerts(triggered_at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_instance ON alerts(instance_id, triggered_at DESC);

-- Daily aggregations (for long-term reporting)
CREATE TABLE IF NOT EXISTS daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_executions INTEGER DEFAULT 0,
    successful_executions INTEGER DEFAULT 0,
    failed_executions INTEGER DEFAULT 0,
    total_tokens_input BIGINT DEFAULT 0,
    total_tokens_output BIGINT DEFAULT 0,
    unique_workflows_run INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(instance_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date DESC);

-- Global settings (key-value, supports encrypted values)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI fix attempts tracking
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

-- Diagnosis feedback (thumbs up/down + comment for quality evaluation)
CREATE TABLE IF NOT EXISTS diagnosis_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    rating VARCHAR(10) NOT NULL CHECK (rating IN ('up', 'down')),
    comment TEXT,
    diagnosis_mode VARCHAR(20), -- 'simple' or 'complex'
    diagnosis_snapshot JSONB, -- copy of ai_diagnosis at time of rating
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_feedback_execution ON diagnosis_feedback(execution_id);
CREATE INDEX IF NOT EXISTS idx_diagnosis_feedback_rating ON diagnosis_feedback(rating, created_at DESC);

-- Report history
CREATE TABLE IF NOT EXISTS report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
    recipients TEXT[] NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    error_message TEXT,
    resend_id TEXT,
    report_data JSONB,
    date_from TIMESTAMPTZ NOT NULL,
    date_to TIMESTAMPTZ NOT NULL,
    triggered_by TEXT NOT NULL DEFAULT 'scheduler' CHECK (triggered_by IN ('scheduler', 'manual', 'test')),
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_history_period ON report_history(period, sent_at DESC);

-- Function to clean expired nonces
CREATE OR REPLACE FUNCTION clean_expired_nonces()
RETURNS void AS $$
BEGIN
    DELETE FROM nonce_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS instances_updated_at ON instances;
CREATE TRIGGER instances_updated_at
    BEFORE UPDATE ON instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
