-- Add Inngest background-job tracking columns to integrations table
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'syncing', 'completed', 'error')),
  ADD COLUMN IF NOT EXISTS sync_error  text,
  ADD COLUMN IF NOT EXISTS synced_count integer NOT NULL DEFAULT 0;
