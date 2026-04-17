CREATE TABLE IF NOT EXISTS alert_email_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    instance_id UUID,
    triggered_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('failed', 'sent')),
    error_message TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_email_attempts_status ON alert_email_attempts (status, attempted_at DESC);
