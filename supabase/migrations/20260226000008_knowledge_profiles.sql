-- ============================================================
-- Sprint 4.5: knowledge_profiles table + helper functions
-- ============================================================
--
-- One row per workspace.  A background Inngest job (build-knowledge-
-- profile) analyses all synced document_chunks and writes structured
-- JSON here:  team_members, channels, business_patterns, terminology,
-- key_topics.  CleverBrain reads this on every chat request and injects
-- it as a COMPANY INTELLIGENCE section in the system prompt.

CREATE TABLE IF NOT EXISTS public.knowledge_profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL
                              REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile       jsonb       NOT NULL DEFAULT '{}',
  last_built_at timestamptz,
  status        text        NOT NULL DEFAULT 'idle'
                              CHECK (status IN ('idle', 'building', 'ready', 'error')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE public.knowledge_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_profiles: workspace members can select"
  ON public.knowledge_profiles FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE TRIGGER knowledge_profiles_updated_at
  BEFORE UPDATE ON public.knowledge_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_knowledge_profiles_workspace
  ON public.knowledge_profiles (workspace_id);

-- ── upsert_knowledge_profile ──────────────────────────────────────────────────
-- Called by the Inngest background job (service-role key bypasses RLS).
-- Inserts the first row, or updates profile + status + last_built_at.

CREATE OR REPLACE FUNCTION public.upsert_knowledge_profile(
  p_workspace_id uuid,
  p_profile      jsonb,
  p_status       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO knowledge_profiles (workspace_id, profile, status, last_built_at)
  VALUES (
    p_workspace_id,
    p_profile,
    p_status,
    CASE WHEN p_status = 'ready' THEN now() ELSE NULL END
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    profile       = EXCLUDED.profile,
    status        = EXCLUDED.status,
    last_built_at = CASE
                      WHEN EXCLUDED.status = 'ready' THEN now()
                      ELSE knowledge_profiles.last_built_at
                    END,
    updated_at    = now();
END;
$$;

-- ── get_knowledge_profile ─────────────────────────────────────────────────────
-- Returns the profile jsonb (NULL if no row exists yet).

CREATE OR REPLACE FUNCTION public.get_knowledge_profile(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
BEGIN
  SELECT kp.profile INTO v_profile
  FROM knowledge_profiles kp
  WHERE kp.workspace_id = p_workspace_id;
  RETURN v_profile;
END;
$$;
