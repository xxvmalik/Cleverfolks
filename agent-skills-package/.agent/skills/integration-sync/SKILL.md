---
name: integration-sync
description: Use when building, debugging, or modifying data sync pipelines for any integration (Slack, Gmail, Outlook, HubSpot, Google Calendar, Apollo, Instagram). Covers normalizers, Nango connections, document chunks, and embedding.
---

# Integration Sync Pipeline

## Architecture
- Nango handles OAuth and raw data sync
- Normalizers transform raw Nango records into document_chunks format
- Each normalizer prepends context to chunk_text (From/To for email, event times for calendar)
- Voyage AI embeds chunk_text into vectors stored in Supabase pgvector

## Adding a New Integration
1. Configure integration in Nango dashboard
2. Add integration ID to allowed_integrations whitelist in app/api/nango-session/route.ts
3. Create normalizer in the sync pipeline
4. Add entry to PROVIDER_CONFIG in integrations-manifest.ts
5. Add source_type to CHECK constraint on synced_documents table
6. Test sync end-to-end before moving on

## Key Files
- integrations-manifest.ts (PROVIDER_CONFIG routing)
- app/api/nango-session/route.ts (allowed_integrations whitelist)
- Normalizer files for each integration
- hybrid_search_documents SQL function (p_source_types filter)

## Current Integrations
- Slack: Full (bot token scopes)
- Gmail: Full
- Outlook: Email + Calendar
- HubSpot: Connected, sync pipeline has listRecords 400 error to fix

## Common Gotchas
- Nango allowed_integrations must match EXACT integration IDs in Nango dashboard
- Adding non-existent IDs causes 400 error on session creation
- Nango incremental sync will not resend failed records, need full resync
- CHECK constraint on synced_documents must include all source_types
- Claude only reads chunk_text -- any metadata Claude needs must be prepended at sync time
