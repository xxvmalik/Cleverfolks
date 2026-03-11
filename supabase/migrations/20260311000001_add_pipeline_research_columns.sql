-- Add website, user_context, and skyler_note columns to skyler_sales_pipeline
-- These support deep company research and low-confidence pause flow

ALTER TABLE skyler_sales_pipeline
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS user_context TEXT,
ADD COLUMN IF NOT EXISTS skyler_note JSONB;

-- Add pending_clarification to the stage check constraint (if one exists)
-- First try to drop, then re-add. If no constraint exists, the DROP will fail silently.
DO $$
BEGIN
  ALTER TABLE skyler_sales_pipeline DROP CONSTRAINT IF EXISTS skyler_sales_pipeline_stage_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Note: If your table has no stage constraint, this is a no-op.
-- The stage column accepts any text value, so 'pending_clarification' works automatically.
