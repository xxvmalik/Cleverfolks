-- =============================================================================
-- fix-rls.sql
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Idempotent: drops each policy first so re-running is safe.
-- Covers every RLS policy needed for the workspace creation flow.
-- =============================================================================


-- =============================================================================
-- 1. workspaces INSERT
--    Allows any logged-in user to create a workspace.
--    This is the policy that was missing / not applied.
-- =============================================================================

DROP POLICY IF EXISTS "workspaces: authenticated users can create"
  ON public.workspaces;

CREATE POLICY "workspaces: authenticated users can create"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- =============================================================================
-- 2. workspaces SELECT
--    Members can read their own workspace(s).
--    Needed immediately after creation when the app layout fetches workspaces.
-- =============================================================================

DROP POLICY IF EXISTS "workspaces: members can read"
  ON public.workspaces;

CREATE POLICY "workspaces: members can read"
  ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id));


-- =============================================================================
-- 3. workspace_memberships INSERT — bootstrap (first owner)
--    Allows the creator to add themselves as 'owner' on a brand-new workspace
--    that has zero members yet. Solves the chicken-and-egg problem.
-- =============================================================================

DROP POLICY IF EXISTS "workspace_memberships: allow first owner"
  ON public.workspace_memberships;

CREATE POLICY "workspace_memberships: allow first owner"
  ON public.workspace_memberships FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_memberships existing
      WHERE existing.workspace_id = workspace_memberships.workspace_id
    )
  );


-- =============================================================================
-- 4. workspace_memberships SELECT
--    Members can read membership rows for workspaces they belong to.
--    Needed by getUserWorkspaces() right after the workspace is created.
-- =============================================================================

DROP POLICY IF EXISTS "workspace_memberships: members can read"
  ON public.workspace_memberships;

CREATE POLICY "workspace_memberships: members can read"
  ON public.workspace_memberships FOR SELECT
  USING (public.is_workspace_member(workspace_id));


-- =============================================================================
-- 5. workspace_memberships INSERT — owners / admins adding more members
--    Separate policy for inviting teammates after the workspace exists.
-- =============================================================================

DROP POLICY IF EXISTS "workspace_memberships: owners and admins can insert"
  ON public.workspace_memberships;

CREATE POLICY "workspace_memberships: owners and admins can insert"
  ON public.workspace_memberships FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));


-- =============================================================================
-- Verify: list all policies on the two tables so you can confirm they applied.
-- =============================================================================

SELECT
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN ('workspaces', 'workspace_memberships')
ORDER BY tablename, policyname;
