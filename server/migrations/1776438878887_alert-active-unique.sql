-- Resolve any existing duplicate active alerts before creating the index.
-- Keeps the oldest unresolved alert per (alert_type, instance_id), resolves the rest.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY alert_type, instance_id
               ORDER BY triggered_at
           ) AS rn
    FROM alerts
    WHERE acknowledged_at IS NULL
)
UPDATE alerts
   SET acknowledged_at = NOW(),
       acknowledged_by = NULL
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index: at most one active alert per (alert_type, instance_id).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_alert_per_type_instance
    ON alerts (alert_type, instance_id)
    WHERE acknowledged_at IS NULL;
