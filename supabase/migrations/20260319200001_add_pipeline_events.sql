-- Stage 15: Pipeline Event Log (event sourcing for audit + reconciliation)
CREATE TABLE IF NOT EXISTS pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  payload JSONB DEFAULT '{}',
  source TEXT NOT NULL,
  source_detail TEXT,
  confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_lead ON pipeline_events(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type ON pipeline_events(event_type, created_at DESC);
