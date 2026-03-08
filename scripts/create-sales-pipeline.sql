-- Sales Pipeline tables for Skyler Sales Closer workflow
-- skyler_sales_pipeline: tracks outreach lifecycle per lead
-- skyler_email_events: Resend webhook events
-- skyler_performance: aggregated success metrics

-- ── skyler_sales_pipeline ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_sales_pipeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT NOT NULL,
  company_name TEXT,
  company_id TEXT,

  -- Pipeline stage
  stage TEXT NOT NULL DEFAULT 'initial_outreach'
    CHECK (stage IN (
      'initial_outreach', 'follow_up_1', 'follow_up_2', 'follow_up_3',
      'negotiation', 'demo_booked', 'payment_secured', 'closed_won', 'disqualified', 'stalled'
    )),

  -- Scoring reference
  lead_score INTEGER,
  lead_score_id UUID REFERENCES lead_scores(id),

  -- Research cache
  company_research JSONB,
  research_updated_at TIMESTAMPTZ,

  -- Email tracking
  last_email_sent_at TIMESTAMPTZ,
  last_email_resend_id TEXT,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,

  -- Conversation state
  conversation_thread JSONB DEFAULT '[]'::jsonb,
  last_reply_at TIMESTAMPTZ,
  awaiting_reply BOOLEAN DEFAULT false,

  -- Cadence tracking
  cadence_step INTEGER DEFAULT 0,
  next_followup_at TIMESTAMPTZ,

  -- Resolution
  resolution TEXT
    CHECK (resolution IS NULL OR resolution IN (
      'meeting_booked', 'demo_booked', 'payment_secured', 'disqualified', 'no_response'
    )),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,

  -- CRM sync
  hubspot_deal_id TEXT,
  crm_synced BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, contact_email)
);

CREATE INDEX IF NOT EXISTS idx_sales_pipeline_workspace ON skyler_sales_pipeline(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_stage ON skyler_sales_pipeline(workspace_id, stage);
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_contact ON skyler_sales_pipeline(workspace_id, contact_email);
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_next_followup ON skyler_sales_pipeline(next_followup_at)
  WHERE next_followup_at IS NOT NULL AND resolution IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_resend ON skyler_sales_pipeline(last_email_resend_id);

ALTER TABLE skyler_sales_pipeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY skyler_pipeline_select ON skyler_sales_pipeline
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_sales_pipeline.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY skyler_pipeline_insert ON skyler_sales_pipeline
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_sales_pipeline.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY skyler_pipeline_update ON skyler_sales_pipeline
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_sales_pipeline.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY skyler_pipeline_delete ON skyler_sales_pipeline
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_sales_pipeline.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── skyler_email_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_email_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  resend_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_pipeline ON skyler_email_events(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_email_events_resend ON skyler_email_events(resend_email_id);

ALTER TABLE skyler_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_events_select ON skyler_email_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_email_events.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY email_events_insert ON skyler_email_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_email_events.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── skyler_performance ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skyler_performance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  leads_entered INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,

  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  open_rate DECIMAL(5,2) DEFAULT 0,
  reply_rate DECIMAL(5,2) DEFAULT 0,

  meetings_booked INTEGER DEFAULT 0,
  demos_booked INTEGER DEFAULT 0,
  payments_secured INTEGER DEFAULT 0,
  deals_won INTEGER DEFAULT 0,
  deals_lost INTEGER DEFAULT 0,

  revenue_generated DECIMAL(12,2) DEFAULT 0,

  lead_to_meeting_rate DECIMAL(5,2) DEFAULT 0,
  meeting_to_close_rate DECIMAL(5,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, period_start, period_end)
);

ALTER TABLE skyler_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY performance_select ON skyler_performance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_performance.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY performance_insert ON skyler_performance
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_performance.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY performance_update ON skyler_performance
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = skyler_performance.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
