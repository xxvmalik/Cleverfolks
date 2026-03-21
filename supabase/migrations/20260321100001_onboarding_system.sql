-- =============================================================================
-- Onboarding System: agent_configurations, brand_assets, skyler_onboarding flag, RPCs
-- =============================================================================

-- 1. agent_configurations — one row per agent per workspace
CREATE TABLE IF NOT EXISTS public.agent_configurations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_type            TEXT NOT NULL,       -- 'skyler', 'vera', 'martin'
  config                JSONB NOT NULL DEFAULT '{}',
  onboarding_completed_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, agent_type)
);

CREATE INDEX IF NOT EXISTS idx_agent_config_lookup
  ON public.agent_configurations(workspace_id, agent_type);

CREATE TRIGGER agent_configurations_updated_at
  BEFORE UPDATE ON public.agent_configurations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS
ALTER TABLE public.agent_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_configurations: members can read"
  ON public.agent_configurations FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "agent_configurations: owners and admins can insert"
  ON public.agent_configurations FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "agent_configurations: owners and admins can update"
  ON public.agent_configurations FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));


-- 2. brand_assets — files stored in Supabase Storage
CREATE TABLE IF NOT EXISTS public.brand_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  asset_type        TEXT NOT NULL,       -- 'logo_primary', 'logo_dark', 'brand_doc'
  file_name         TEXT NOT NULL,
  storage_path      TEXT NOT NULL,       -- Supabase Storage path
  mime_type         TEXT,
  file_size_bytes   BIGINT,
  processing_status TEXT DEFAULT 'pending',  -- pending/processing/completed/failed
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_assets_workspace
  ON public.brand_assets(workspace_id);

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_assets: members can read"
  ON public.brand_assets FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "brand_assets: owners and admins can insert"
  ON public.brand_assets FOR INSERT
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "brand_assets: owners and admins can update"
  ON public.brand_assets FOR UPDATE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "brand_assets: owners and admins can delete"
  ON public.brand_assets FOR DELETE
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));


-- 3. Add skyler_onboarding_completed to workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS skyler_onboarding_completed BOOLEAN DEFAULT false;


-- 4. RPC: upsert_onboarding_state
-- Merges step data into the existing onboarding_state row (or creates one).
CREATE OR REPLACE FUNCTION public.upsert_onboarding_state(
  p_workspace_id UUID,
  p_org_data     JSONB,
  p_skyler_data  JSONB,
  p_current_step INT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing_org    JSONB;
  existing_skyler JSONB;
BEGIN
  -- Get existing data
  SELECT org_data, skyler_data INTO existing_org, existing_skyler
  FROM public.onboarding_state
  WHERE workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    INSERT INTO public.onboarding_state (workspace_id, current_step, org_data, skyler_data)
    VALUES (
      p_workspace_id,
      p_current_step,
      COALESCE(p_org_data, '{}'::jsonb),
      COALESCE(p_skyler_data, '{}'::jsonb)
    );
  ELSE
    UPDATE public.onboarding_state
    SET
      current_step = p_current_step,
      org_data     = CASE WHEN p_org_data IS NOT NULL
                       THEN existing_org || p_org_data
                       ELSE existing_org END,
      skyler_data  = CASE WHEN p_skyler_data IS NOT NULL
                       THEN existing_skyler || p_skyler_data
                       ELSE existing_skyler END
    WHERE workspace_id = p_workspace_id;
  END IF;
END;
$$;


-- 5. RPC: complete_onboarding (general phase)
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_workspace_id UUID
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.workspaces
  SET onboarding_completed = true
  WHERE id = p_workspace_id;

  UPDATE public.onboarding_state
  SET completed_at = now()
  WHERE workspace_id = p_workspace_id
    AND completed_at IS NULL;
END;
$$;


-- 6. RPC: complete_skyler_onboarding
CREATE OR REPLACE FUNCTION public.complete_skyler_onboarding(
  p_workspace_id UUID
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.workspaces
  SET skyler_onboarding_completed = true
  WHERE id = p_workspace_id;
END;
$$;


-- 7. Supabase Storage bucket for brand assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "brand-assets: workspace members can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'brand-assets');

CREATE POLICY "brand-assets: workspace members can read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

CREATE POLICY "brand-assets: workspace members can delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'brand-assets');
