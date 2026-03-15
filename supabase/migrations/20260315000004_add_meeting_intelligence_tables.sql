-- Stage 8.5: Meeting Intelligence Tables
-- Dedicated tables for transcripts, chunks, bots, and calendar connections.
-- Replaces the flat fields on skyler_sales_pipeline with proper relational structure.

-- ── Meeting Transcripts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  raw_transcript JSONB,
  summary TEXT,
  intelligence JSONB,
  participants JSONB,
  meeting_date TIMESTAMPTZ,
  duration_seconds INTEGER,
  meeting_url TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'extracting', 'summarising', 'strategising', 'complete', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meeting_transcripts_lead ON meeting_transcripts(lead_id);
CREATE INDEX idx_meeting_transcripts_workspace ON meeting_transcripts(workspace_id);
CREATE INDEX idx_meeting_transcripts_bot ON meeting_transcripts(bot_id);

ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can view transcripts"
  ON meeting_transcripts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = meeting_transcripts.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── Meeting Chunks (for semantic search via pgvector) ───────────────────────

CREATE TABLE IF NOT EXISTS meeting_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transcript_id UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES skyler_sales_pipeline(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  speaker_name TEXT,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  start_time FLOAT,
  end_time FLOAT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meeting_chunks_transcript ON meeting_chunks(transcript_id);
CREATE INDEX idx_meeting_chunks_lead ON meeting_chunks(lead_id);

-- HNSW index for fast similarity search on embeddings
CREATE INDEX idx_meeting_chunks_embedding ON meeting_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE meeting_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can view chunks"
  ON meeting_chunks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = meeting_chunks.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── Recall Bots ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recall_bots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recall_bot_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES skyler_sales_pipeline(id) ON DELETE SET NULL,
  calendar_event_id TEXT,
  meeting_url TEXT,
  scheduled_join_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'joining', 'in_call', 'done', 'failed', 'cancelled')),
  bot_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_recall_bots_recall_id ON recall_bots(recall_bot_id);
CREATE INDEX idx_recall_bots_workspace ON recall_bots(workspace_id);
CREATE INDEX idx_recall_bots_lead ON recall_bots(lead_id);
CREATE INDEX idx_recall_bots_active ON recall_bots(status) WHERE status IN ('scheduled', 'joining', 'in_call');

ALTER TABLE recall_bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage bots"
  ON recall_bots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = recall_bots.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- ── Recall Calendars ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recall_calendars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recall_calendar_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  platform_email TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  auto_join_external BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_recall_calendars_recall_id ON recall_calendars(recall_calendar_id);
CREATE INDEX idx_recall_calendars_workspace ON recall_calendars(workspace_id);

ALTER TABLE recall_calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage calendars"
  ON recall_calendars FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.workspace_id = recall_calendars.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
