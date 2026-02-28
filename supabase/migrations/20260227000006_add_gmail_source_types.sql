-- ============================================================
-- Add gmail_message and gmail_contact to synced_documents
-- source_type CHECK constraint
-- ============================================================
--
-- The original sync-tables.sql only listed:
--   email, slack_message, calendar_event, deal, document, attachment
--
-- This migration drops that constraint and replaces it with the
-- full set of source types currently in use, so Gmail records
-- can be inserted without a check-constraint violation (23514).
-- ============================================================

ALTER TABLE synced_documents
  DROP CONSTRAINT IF EXISTS synced_documents_source_type_check;

ALTER TABLE synced_documents
  ADD CONSTRAINT synced_documents_source_type_check
  CHECK (source_type IN (
    'email',
    'gmail_message',
    'gmail_contact',
    'slack_message',
    'slack_reply',
    'slack_reaction',
    'calendar_event',
    'deal',
    'document',
    'attachment'
  ));
