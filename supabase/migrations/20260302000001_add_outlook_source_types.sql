-- ============================================================
-- Add outlook_email, outlook_event, outlook_contact to
-- synced_documents source_type CHECK constraint
-- ============================================================

ALTER TABLE synced_documents
  DROP CONSTRAINT IF EXISTS synced_documents_source_type_check;

ALTER TABLE synced_documents
  ADD CONSTRAINT synced_documents_source_type_check
  CHECK (source_type IN (
    'email',
    'gmail_message',
    'gmail_contact',
    'outlook_email',
    'outlook_event',
    'outlook_contact',
    'slack_message',
    'slack_reply',
    'slack_reaction',
    'calendar_event',
    'deal',
    'document',
    'attachment'
  ));
