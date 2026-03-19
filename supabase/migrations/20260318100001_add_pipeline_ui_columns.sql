-- Add UI columns for the Skyler redesign
ALTER TABLE skyler_sales_pipeline
  ADD COLUMN IF NOT EXISTS deal_value DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT NULL;
