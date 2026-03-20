-- Stage 15.1 Part A: Add pipeline_id column to skyler_actions
-- Fixes "Could not find the 'pipeline_id' column of 'skyler_actions' in the schema cache" error
-- that blocks ALL AI-driven non-email actions.

ALTER TABLE skyler_actions
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_skyler_actions_pipeline
  ON skyler_actions(pipeline_id) WHERE pipeline_id IS NOT NULL;

-- Backfill existing rows from tool_input JSONB
UPDATE skyler_actions
SET pipeline_id = (tool_input->>'pipelineId')::uuid
WHERE pipeline_id IS NULL
  AND tool_input->>'pipelineId' IS NOT NULL;
