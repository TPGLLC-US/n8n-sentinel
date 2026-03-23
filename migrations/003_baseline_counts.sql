-- Add baseline workflow/execution counts for onboarding
ALTER TABLE instances ADD COLUMN IF NOT EXISTS baseline_workflow_count INTEGER;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS baseline_execution_count INTEGER;
