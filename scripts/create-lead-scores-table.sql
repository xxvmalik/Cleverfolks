-- Lead Scores table -- stores flexible dimension-based lead scoring
-- Dimensions are JSONB so users can customise (rename, reweight, add, remove)
-- without any database migration. BANT is just the default template.

CREATE TABLE IF NOT EXISTS lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,           -- HubSpot contact ID (or internal ID later)
  contact_name TEXT,                  -- Full name for display
  contact_email TEXT,                 -- Email for display
  company_name TEXT,                  -- Associated company name
  company_id TEXT,                    -- HubSpot company ID

  -- Flexible dimension scores (JSONB, not hardcoded columns)
  -- Structure: { "budget": { "score": 18, "reasoning": "Mid-size company with..." }, ... }
  dimension_scores JSONB NOT NULL DEFAULT '{}',

  -- Total score (sum of all dimension scores)
  total_score INTEGER NOT NULL DEFAULT 0 CHECK (total_score >= 0 AND total_score <= 100),

  -- Classification
  classification TEXT NOT NULL DEFAULT 'unscored'
    CHECK (classification IN ('hot', 'nurture', 'disqualified', 'unscored')),

  -- Referral tracking
  is_referral BOOLEAN NOT NULL DEFAULT false,
  referrer_name TEXT,
  referrer_company TEXT,
  referral_source_chunk_id UUID,

  -- Overall reasoning
  scoring_reasoning TEXT,

  -- Metadata
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_rescored_at TIMESTAMPTZ,
  score_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'hubspot',

  -- Constraints
  UNIQUE(workspace_id, contact_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lead_scores_workspace ON lead_scores(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_classification ON lead_scores(workspace_id, classification);
CREATE INDEX IF NOT EXISTS idx_lead_scores_total ON lead_scores(workspace_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_referral ON lead_scores(workspace_id, is_referral) WHERE is_referral = true;

-- RLS
ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_scores_select ON lead_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = lead_scores.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY lead_scores_insert ON lead_scores
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = lead_scores.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY lead_scores_update ON lead_scores
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = lead_scores.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
