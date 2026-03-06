-- ============================================================
-- Fix synced_documents source_type CHECK constraint
-- Ensures all HubSpot CRM source types are allowed
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
    'attachment',
    'cleverbrain_chat',
    'hubspot_contact',
    'hubspot_company',
    'hubspot_deal',
    'hubspot_ticket',
    'hubspot_task',
    'hubspot_note',
    'hubspot_owner',
    'hubspot_product',
    'hubspot_user',
    'hubspot_kb_article',
    'hubspot_service_ticket',
    'hubspot_currency'
  ));
