-- =============================================================================
-- onboarding-function.sql
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Creates two SECURITY DEFINER functions for the onboarding flow.
-- Both verify workspace membership before acting.
-- =============================================================================


-- =============================================================================
-- 1. upsert_onboarding_state
--    Merges step data into org_data or skyler_data (JSON merge with ||).
--    Only advances current_step forward, never backward.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_onboarding_state(
  p_workspace_id  uuid,
  p_org_data      jsonb    DEFAULT NULL,
  p_skyler_data   jsonb    DEFAULT NULL,
  p_current_step  integer  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be a member of the workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  INSERT INTO public.onboarding_state (workspace_id, org_data, skyler_data, current_step)
  VALUES (
    p_workspace_id,
    COALESCE(p_org_data,     '{}'),
    COALESCE(p_skyler_data,  '{}'),
    COALESCE(p_current_step, 1)
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    org_data = CASE
      WHEN p_org_data IS NOT NULL
        THEN onboarding_state.org_data || p_org_data
      ELSE onboarding_state.org_data
    END,
    skyler_data = CASE
      WHEN p_skyler_data IS NOT NULL
        THEN onboarding_state.skyler_data || p_skyler_data
      ELSE onboarding_state.skyler_data
    END,
    -- Only move the step pointer forward
    current_step = CASE
      WHEN p_current_step IS NOT NULL
        AND p_current_step > onboarding_state.current_step
        THEN p_current_step
      ELSE onboarding_state.current_step
    END,
    updated_at = now();
END;
$$;


-- =============================================================================
-- 2. complete_onboarding
--    Marks onboarding as done. Caller must be owner or admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be owner or admin
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to complete onboarding';
  END IF;

  UPDATE public.onboarding_state
  SET
    completed_at = now(),
    current_step = 14,
    updated_at   = now()
  WHERE workspace_id = p_workspace_id;

  UPDATE public.workspaces
  SET
    onboarding_completed = true,
    updated_at           = now()
  WHERE id = p_workspace_id;
END;
$$;


-- =============================================================================
-- Verify: confirm both functions exist
-- =============================================================================

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('upsert_onboarding_state', 'complete_onboarding');
