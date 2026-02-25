-- =============================================================================
-- Cleverfolks – Initial Database Schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================================


-- =============================================================================
-- SECTION 1: Shared helper functions
-- =============================================================================

-- Automatically bumps updated_at to now() on any UPDATE.
-- Attached as a BEFORE UPDATE trigger on tables that have the column.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Returns TRUE if the currently authenticated user is a member of the given workspace.
-- Used inside RLS policies (SECURITY DEFINER so the policy can read memberships freely).
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND user_id      = auth.uid()
  );
$$;

-- Returns the current user's role string in the given workspace, or NULL if not a member.
CREATE OR REPLACE FUNCTION public.get_workspace_role(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role
  FROM public.workspace_memberships
  WHERE workspace_id = p_workspace_id
    AND user_id      = auth.uid()
  LIMIT 1;
$$;


-- =============================================================================
-- SECTION 2: profiles
-- Extends auth.users with display info. One row per Supabase auth user.
-- =============================================================================

CREATE TABLE public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email       text        NOT NULL,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Automatically creates a profile row whenever a user signs up via Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER                    -- runs as postgres, can write to profiles
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;     -- idempotent in case of replays
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- SECTION 3: workspaces
-- A workspace represents one company/team. Users belong to workspaces.
-- =============================================================================

CREATE TABLE public.workspaces (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  slug                 text        NOT NULL UNIQUE,     -- URL-safe identifier, e.g. "acme-corp"
  settings             jsonb       NOT NULL DEFAULT '{}',
  onboarding_completed boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- =============================================================================
-- SECTION 4: workspace_memberships
-- Join table linking users to workspaces with a role. One role per user per workspace.
-- =============================================================================

CREATE TABLE public.workspace_memberships (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id)  ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, workspace_id)   -- one role per user per workspace
);


-- =============================================================================
-- SECTION 5: integrations
-- Tracks third-party tool connections (Gmail, Slack, HubSpot, etc.) per workspace.
-- =============================================================================

CREATE TABLE public.integrations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider            text        NOT NULL,                          -- e.g. 'gmail', 'slack'
  nango_connection_id text,                                          -- Nango OAuth connection ID
  status              text        NOT NULL DEFAULT 'disconnected'
                                  CHECK (status IN ('connected', 'disconnected', 'syncing', 'error')),
  sync_config         jsonb       NOT NULL DEFAULT '{}',             -- channels, labels, filters, etc.
  last_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 6: data_access_policies
-- Fine-grained access control: which roles or users can access which integrations.
-- A NULL role means it is a per-user override; a NULL user_id means it is role-level.
-- =============================================================================

CREATE TABLE public.data_access_policies (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES public.workspaces(id)   ON DELETE CASCADE,
  integration_id uuid                 REFERENCES public.integrations(id) ON DELETE CASCADE,
  role           text,                -- NULL → this is a per-user policy
  user_id        uuid                 REFERENCES public.profiles(id),     -- NULL → role-level policy
  access_level   text        NOT NULL DEFAULT 'full'
                             CHECK (access_level IN ('full', 'read_only', 'none')),
  created_at     timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- SECTION 7: onboarding_state
-- Tracks progress through the multi-step onboarding wizard, one row per workspace.
-- =============================================================================

CREATE TABLE public.onboarding_state (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  current_step integer     NOT NULL DEFAULT 1,
  org_data     jsonb       NOT NULL DEFAULT '{}',    -- answers from org setup steps
  skyler_data  jsonb       NOT NULL DEFAULT '{}',    -- answers from SKYLER setup steps
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER onboarding_state_updated_at
  BEFORE UPDATE ON public.onboarding_state
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- =============================================================================
-- SECTION 8: Indexes
-- Cover the most common foreign-key lookups and filter patterns.
-- =============================================================================

CREATE INDEX idx_workspace_memberships_user_id      ON public.workspace_memberships (user_id);
CREATE INDEX idx_workspace_memberships_workspace_id ON public.workspace_memberships (workspace_id);

CREATE INDEX idx_integrations_workspace_id ON public.integrations (workspace_id);
CREATE INDEX idx_integrations_provider     ON public.integrations (provider);

CREATE INDEX idx_data_access_policies_workspace_id   ON public.data_access_policies (workspace_id);
CREATE INDEX idx_data_access_policies_integration_id ON public.data_access_policies (integration_id);
CREATE INDEX idx_data_access_policies_user_id        ON public.data_access_policies (user_id);

CREATE INDEX idx_onboarding_state_workspace_id ON public.onboarding_state (workspace_id);


-- =============================================================================
-- SECTION 9: Row Level Security
-- Enable RLS on every table, then add explicit policies.
-- "Deny all by default" – only the policies below grant access.
-- =============================================================================

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_access_policies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_state      ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- profiles policies
-- -----------------------------------------------------------------------------

-- Users can always read their own profile.
CREATE POLICY "profiles: read own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Users can read profiles of people who share at least one workspace with them.
CREATE POLICY "profiles: read workspacemates"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm1
      JOIN public.workspace_memberships wm2 ON wm2.workspace_id = wm1.workspace_id
      WHERE wm1.user_id = auth.uid()
        AND wm2.user_id = profiles.id
    )
  );

-- Users can only update their own profile.
CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());


-- -----------------------------------------------------------------------------
-- workspaces policies
-- -----------------------------------------------------------------------------

-- Any authenticated user can create a workspace (they'll add themselves as owner next).
CREATE POLICY "workspaces: authenticated users can create"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only members can read a workspace.
CREATE POLICY "workspaces: members can read"
  ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id));

-- Only owners and admins can update workspace settings.
CREATE POLICY "workspaces: owners and admins can update"
  ON public.workspaces FOR UPDATE
  USING (public.get_workspace_role(id) IN ('owner', 'admin'));


-- -----------------------------------------------------------------------------
-- workspace_memberships policies
-- -----------------------------------------------------------------------------

-- Any member can see who else is in their workspace.
CREATE POLICY "workspace_memberships: members can read"
  ON public.workspace_memberships FOR SELECT
  USING (public.is_workspace_member(workspace_id));

-- Bootstrap: a user can add themselves as 'owner' only if the workspace has no members yet.
-- This covers the moment right after workspace creation.
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

-- After bootstrap, only owners and admins can add new members.
CREATE POLICY "workspace_memberships: owners and admins can insert"
  ON public.workspace_memberships FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- Owners and admins can change roles.
CREATE POLICY "workspace_memberships: owners and admins can update"
  ON public.workspace_memberships FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- Only owners can remove members (prevents admins from removing the owner).
CREATE POLICY "workspace_memberships: owners can delete"
  ON public.workspace_memberships FOR DELETE
  USING (public.get_workspace_role(workspace_id) = 'owner');


-- -----------------------------------------------------------------------------
-- integrations policies
-- -----------------------------------------------------------------------------

CREATE POLICY "integrations: members can read"
  ON public.integrations FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "integrations: owners and admins can insert"
  ON public.integrations FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "integrations: owners and admins can update"
  ON public.integrations FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "integrations: owners and admins can delete"
  ON public.integrations FOR DELETE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));


-- -----------------------------------------------------------------------------
-- data_access_policies policies
-- -----------------------------------------------------------------------------

CREATE POLICY "data_access_policies: members can read"
  ON public.data_access_policies FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "data_access_policies: owners and admins can insert"
  ON public.data_access_policies FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "data_access_policies: owners and admins can update"
  ON public.data_access_policies FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "data_access_policies: owners and admins can delete"
  ON public.data_access_policies FOR DELETE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));


-- -----------------------------------------------------------------------------
-- onboarding_state policies
-- -----------------------------------------------------------------------------

CREATE POLICY "onboarding_state: members can read"
  ON public.onboarding_state FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "onboarding_state: owners and admins can insert"
  ON public.onboarding_state FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "onboarding_state: owners and admins can update"
  ON public.onboarding_state FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));
