-- Flag to opt individual pipeline records into the new reasoning engine.
-- When true, the reasoning cadence scheduler picks up this lead instead of the old rule-based cadence.
-- Default false = existing system handles it. Flip to true to test the reasoning engine on specific leads.

ALTER TABLE skyler_sales_pipeline
  ADD COLUMN IF NOT EXISTS use_reasoning_engine BOOLEAN DEFAULT false;
