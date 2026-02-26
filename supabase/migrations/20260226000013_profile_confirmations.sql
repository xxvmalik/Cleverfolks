-- ============================================================
-- Sprint 4.5 Profile Overhaul: Profile confirmations table,
-- status constraint update, and confirm_profile RPC.
-- ============================================================

-- ── 1. Update status CHECK constraint ─────────────────────────────────────────
-- Add 'pending_review' as a valid status so the profile builder can flag
-- profiles that contain low/medium-confidence role detections.

ALTER TABLE public.knowledge_profiles
  DROP CONSTRAINT IF EXISTS knowledge_profiles_status_check;

ALTER TABLE public.knowledge_profiles
  ADD CONSTRAINT knowledge_profiles_status_check
    CHECK (status IN ('idle', 'building', 'ready', 'error', 'pending_review'));

-- ── 2. Update upsert_knowledge_profile ────────────────────────────────────────
-- Also set last_built_at when status transitions to 'pending_review'.

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
    CASE WHEN p_status IN ('ready', 'pending_review') THEN now() ELSE NULL END
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    profile       = EXCLUDED.profile,
    status        = EXCLUDED.status,
    last_built_at = CASE
                      WHEN EXCLUDED.status IN ('ready', 'pending_review') THEN now()
                      ELSE knowledge_profiles.last_built_at
                    END,
    updated_at    = now();
END;
$$;

-- ── 3. Create profile_confirmations table ─────────────────────────────────────
-- One row per workspace. Tracks whether team-member roles detected by the
-- profile builder have been reviewed and optionally corrected by a human.

CREATE TABLE IF NOT EXISTS public.profile_confirmations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL
                              REFERENCES public.workspaces(id) ON DELETE CASCADE,
  confirmed_by  uuid        REFERENCES auth.users(id),
  confirmed_at  timestamptz,
  corrections   jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE public.profile_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_confirmations: workspace members can select"
  ON public.profile_confirmations FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE TRIGGER profile_confirmations_updated_at
  BEFORE UPDATE ON public.profile_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── 4. confirm_profile RPC ────────────────────────────────────────────────────
-- Saves user-supplied role corrections, applies them to the profile JSON,
-- marks each corrected member's confidence as 'confirmed', and promotes
-- the knowledge_profiles row from 'pending_review' → 'ready'.

CREATE OR REPLACE FUNCTION public.confirm_profile(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_corrections  jsonb   -- { "member_name": "corrected_role", ... }
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile  jsonb;
  v_members  jsonb;
  v_key      text;
  v_role     text;
  v_idx      int;
BEGIN
  -- Upsert the confirmation record
  INSERT INTO profile_confirmations (workspace_id, confirmed_by, confirmed_at, corrections)
  VALUES (p_workspace_id, p_user_id, now(), p_corrections)
  ON CONFLICT (workspace_id) DO UPDATE SET
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_at = EXCLUDED.confirmed_at,
    corrections  = EXCLUDED.corrections,
    updated_at   = now();

  -- Fetch current profile
  SELECT profile INTO v_profile
  FROM   knowledge_profiles
  WHERE  workspace_id = p_workspace_id;

  IF v_profile IS NULL THEN RETURN; END IF;

  v_members := v_profile->'team_members';
  IF v_members IS NULL OR jsonb_typeof(v_members) != 'array' THEN RETURN; END IF;

  -- Apply each correction: find matching member by name, update role + confidence
  FOR v_key, v_role IN SELECT key, value::text FROM jsonb_each_text(p_corrections)
  LOOP
    FOR v_idx IN 0 .. jsonb_array_length(v_members) - 1
    LOOP
      IF v_members->v_idx->>'name' ILIKE v_key
        OR v_members->v_idx->>'name' ILIKE '%' || v_key || '%'
      THEN
        v_members := jsonb_set(
          v_members,
          ARRAY[v_idx::text, 'detected_role'],
          to_jsonb(v_role)
        );
        v_members := jsonb_set(
          v_members,
          ARRAY[v_idx::text, 'confidence'],
          '"confirmed"'::jsonb
        );
      END IF;
    END LOOP;
  END LOOP;

  v_profile := jsonb_set(v_profile, '{team_members}', v_members);

  -- Promote to ready and persist corrected profile
  UPDATE knowledge_profiles
  SET    profile    = v_profile,
         status     = 'ready',
         updated_at = now()
  WHERE  workspace_id = p_workspace_id;
END;
$$;
