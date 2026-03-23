
-- Cleanup Script for Duplicate Workflows
-- This script identifies duplicate workflows (same instance_id and remote_id),
-- merges their execution history to the latest version, and deletes the duplicates.
-- It then ensures the unique constraint exists to prevent future duplicates.

DO $$
DECLARE
    r RECORD;
    winner_id UUID;
BEGIN
    -- Loop through all duplicate groups
    FOR r IN SELECT instance_id, remote_id FROM workflows GROUP BY instance_id, remote_id HAVING COUNT(*) > 1 LOOP
        
        -- 1. Identify valid "winner" (most recently updated, or created)
        SELECT id INTO winner_id FROM workflows w1
        WHERE w1.instance_id = r.instance_id AND w1.remote_id = r.remote_id
        ORDER BY remote_updated_at DESC NULLS LAST, created_at DESC, id DESC
        LIMIT 1;
        
        RAISE NOTICE 'Processing duplicates for % (Winner ID: %)', r.remote_id, winner_id;

        -- 2. Move non-conflicting executions from losers to winner
        -- We effectively "merge" the history.
        UPDATE executions e
        SET workflow_id = winner_id
        FROM workflows w
        WHERE e.workflow_id = w.id
        AND w.instance_id = r.instance_id AND w.remote_id = r.remote_id
        AND w.id != winner_id
        AND NOT EXISTS (
            -- Check if the winner already has this execution (avoid conflict)
            SELECT 1 FROM executions e2 
            WHERE e2.workflow_id = winner_id 
            AND e2.remote_execution_id = e.remote_execution_id
        );
        
        -- 3. Move non-conflicting workflow_resources
        UPDATE workflow_resources res
        SET workflow_id = winner_id
        FROM workflows w
        WHERE res.workflow_id = w.id
        AND w.instance_id = r.instance_id AND w.remote_id = r.remote_id
        AND w.id != winner_id
        AND NOT EXISTS (
            SELECT 1 FROM workflow_resources res2
            WHERE res2.workflow_id = winner_id
            AND res2.resource_type = res.resource_type
            AND res2.resource_identifier = res.resource_identifier
        );

        -- 4. Delete "loser" workflows
        -- This will cascade delete any remaining conflicting executions/resources
        DELETE FROM workflows w
        WHERE w.instance_id = r.instance_id AND w.remote_id = r.remote_id
        AND w.id != winner_id;
        
    END LOOP;
    
    RAISE NOTICE 'Duplicate cleanup completed.';
    
END $$;

-- 5. Add the unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'workflows_instance_id_remote_id_key'
    ) THEN
        ALTER TABLE workflows 
        ADD CONSTRAINT workflows_instance_id_remote_id_key UNIQUE (instance_id, remote_id);
        RAISE NOTICE 'Added unique constraint workflows_instance_id_remote_id_key';
    ELSE
        RAISE NOTICE 'Unique constraint already exists';
    END IF;
END $$;
