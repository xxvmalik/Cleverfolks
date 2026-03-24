# CleverFolks AI — MVP Build Plan (Final)

**Date:** 23 March 2026
**Author:** Claude (CTO) + Malik (CEO)
**Status:** Approved for execution
**Execution method:** Claude writes CC prompt files → Malik pastes into CC → CC builds → Claude reviews

---

## Vision (What We're Building)

CleverBrain is the central nervous system. It sits on top of all business data (connectors, onboarding, agent activity) and gives users real-time, contextual answers about their business. It does everything an LLM can do — summarise, draft, analyse, create documents — but grounded in the user's actual business context.

AI employees (Skyler, eventually Vera, Martin) are specialists who do the work. Each operates autonomously within their domain, has full LLM capabilities, learns from feedback, and shares context with every other agent through CleverBrain.

The system is connected from day one. User signs up, onboards, connects integrations — and every subscribed agent immediately understands the business and starts working.

Team members join workspaces with role-based access. Different users see different agents and different data based on their permissions.

---

## Architecture Principles (From Research)

1. **Layered shared context, not a single document.** Static business context in prompts (~1,500 tokens) + structured database tools for precise queries + pgvector RAG for deep history + event-sourced activity log for cross-agent visibility.

2. **Deterministic coordination, LLM reasoning only where it adds unique value.** Inngest events for all cross-agent communication. Simple routing rules for predictable patterns. Reserve Claude for user-facing conversation and genuinely ambiguous decisions.

3. **Tool-level data filtering, prompt-level as secondary guardrail only.** Once unauthorised data enters the LLM context, prompt instructions cannot reliably prevent leakage. Every tool function filters by user role and workspace before returning data.

4. **Read before write. Single agent before multi-agent.** Validate each phase works before adding complexity.

5. **Nango Proxy for HubSpot enrichment.** Pre-built syncs lack association data and engagement history. Use Nango Proxy for all deep HubSpot API calls while Nango handles OAuth and rate limits.

6. **CleverBrain reads, analyses, creates content, and delegates. It never writes to external systems.** CleverBrain pulls data from connectors and agent activity, generates documents in the chat preview panel, and delegates action tasks to agents via Inngest events. Only agents (Skyler, Vera, Martin) write to external systems (HubSpot, Gmail, Slack, calendars). This separation is a hard boundary — it keeps CleverBrain safe and predictable, and ensures all external actions go through agent approval workflows.

---

## Phase 0 — Patch, Harden, and Protect (1–2 days)

**Goal:** Make the existing product stable, monitored, and safe from runaway costs before building anything new.

### Quick fixes
- **B2: Competitors into Skyler system prompt.** Extract competitors from onboarding data (Step 2), inject into `buildSkylerSystemPrompt()`. Skyler needs this to handle competitive objections.
- **B3: Email From name.** Pass `fromName` as "User Name, Company Name" when calling `draftOutreachEmail()`. Currently sends as bare email address.
- **D7: Environment variable validation.** Startup function that checks all required vars (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `NANGO_SECRET_KEY`, etc.) and fails fast with a clear message instead of crashing at first use.

### Error handling and monitoring
- **D3: Error boundaries.** Add `error.tsx` to `(app)`, `(auth)`, `(onboarding)` route groups. Show recovery UI instead of white screen.
- **D4: Loading states.** Add `loading.tsx` with skeleton screens for main pages (dashboard, Skyler workspace, settings, chat).
- **D8: Sentry.** Install and configure basic Sentry error tracking. 15 minutes of setup that saves hours of debugging.

### Cost and security protection
- **D5 (partial): Zod validation on critical endpoints.** At minimum: `/api/cleverbrain/chat`, `/api/skyler/chat`, all webhook handlers, settings update endpoints. Prevents prompt injection via unsanitised message fields.
- **D6: Rate limiting.** Add Upstash ratelimit (or equivalent) on chat endpoints, webhook endpoints, and admin endpoints. Multi-agent systems consume ~15x more tokens than single chats — one runaway loop without rate limits can generate massive bills.

### Defensive fixes
- **B1: Slack notification response validation.** Capture `resp.data.ok` from Slack API, log actual error codes instead of always logging "Sent".
- **B7: Legacy Slack channel format.** Add fallback resolution for old `slackChannel: string` format alongside new `slackChannels[]` array format. Users who set Slack channel before the format change currently get zero notifications.

**Test gate:** All existing features still work. Sentry captures errors. Rate limiting blocks excessive requests. Slack notifications verified with both old and new format.

---

## Phase 1 — Shared Business Context Layer (2–3 days)

**Goal:** Every agent understands the business from the moment onboarding completes. This is the foundation everything else builds on.

### The business context object

Build a `workspace_business_context` service that assembles a compact (~1,500 token) business context document from:
- Onboarding data (company name, industry, ICP, products/services, competitors, team size, tone of voice)
- Knowledge profile (auto-generated from synced data — team detection, business patterns, terminology)
- Connector summaries (which integrations are connected, what data is available)
- Agent status (which agents are subscribed and active)

This document gets injected into every agent's system prompt. It's the "Layer 1" of shared context. Updated when onboarding data changes, when connectors are added/removed, or when the knowledge profile refreshes.

### Brand asset processing (B5 + B6)
- **B5: Wire brand upload to Supabase Storage.** Onboarding Step 3 file upload zone currently goes nowhere. Upload files to Supabase Storage bucket.
- **B6: Process brand documents.** Use existing `extractText()` + chunking pipeline (already supports PDF, DOCX, images) to extract text, chunk, embed, and store in `document_chunks` for RAG. Remove the stub that marks `brand_assets` as "completed" without doing anything.

### Context injection
- Modify `buildSkylerSystemPrompt()` to include the business context object.
- Modify CleverBrain's system prompt builder to include the business context object.
- Ensure the context is workspace-scoped (different workspaces get different context).

### Knowledge profile status resolution
Knowledge profiles can currently sit in `pending_review` indefinitely — there's no auto-confirmation trigger and no user review UI. The business context object largely supersedes the knowledge profile for static business facts (it pulls from workspace settings + onboarding). However, the knowledge profile's auto-detected intelligence (team members, business patterns, terminology) is still valuable and feeds into both agents' prompts.

**Fix:** Auto-confirm knowledge profiles after 24 hours if no user review. Add a simple "Review Knowledge Profile" button in Settings → Business Profile (or wherever business context lives after Sprint 7). When the user clicks it, show the extracted intelligence with the ability to confirm, edit, or reject individual items. This doesn't need to be elaborate — a simple list with checkboxes is sufficient. The important thing is that profiles don't sit in limbo blocking agent context.

**Test gate:** Create a fresh workspace, complete onboarding with business details, connect at least one integration. Both CleverBrain and Skyler can accurately describe the business, its products, its ICP, and its competitors without the user having to explain anything. Knowledge profile auto-confirms after 24 hours if not manually reviewed.

---

## Phase 2 — CleverBrain Sees Everything + CRM Pipeline Import (5–7 days)

**Goal:** CleverBrain becomes the actual brain — it can answer any question about the business by pulling from connectors AND agent activity. Skyler inherits the user's existing HubSpot pipeline with full context.

### 2A: CleverBrain agent visibility tools

New CleverBrain tools (all read-only, all respect user RBAC role):

- **`query_sales_pipeline`** — Query Skyler's `skyler_sales_pipeline` table. Filter by stage, status, date range, lead name. Returns lead cards with current stage, health score, last activity, assigned owner.
- **`get_lead_details`** — Deep dive on a specific lead. Returns full lead card data, recent activity timeline, email history summary, meeting history, current tasks, Skyler's assessment.
- **`get_agent_activity`** — What has Skyler done today/this week/this month? Pulls from `skyler_actions`, `skyler_decisions`, `skyler_notifications`. Grouped by action type (emails drafted, emails sent, leads scored, meetings booked, escalations raised).
- **`pipeline_metrics`** — Aggregation queries: total deals by stage, total pipeline value, conversion rates (stage-to-stage), average deal size, average time in stage, win/loss rates, pipeline velocity. Supports time comparisons (this month vs last month, this quarter vs last quarter).

**Explicit data source mapping for each tool (CC must wire these correctly):**
- `query_sales_pipeline` → reads from `skyler_sales_pipeline` (lead cards, stages, health scores)
- `get_lead_details` → reads from `skyler_sales_pipeline` + `deal_contexts` (Tier 1 summary + Tier 2 recent activity) + `skyler_actions` (action history for this lead) + `skyler_decisions` (decision history)
- `get_agent_activity` → reads from `skyler_actions` + `skyler_decisions` + `skyler_notifications` + `agent_activities` (the new table from 2B)
- `pipeline_metrics` → reads from `skyler_sales_pipeline` (stage counts, deal values) + `deal_contexts` (time-in-stage data from Tier 1 summaries)
- CleverBrain's existing `search_knowledge_base` tool → continues reading from `document_chunks` as before, which now also includes Tier 3 deal history chunks (source_type='hubspot_deal_history'). No changes needed to the existing tool — Tier 3 data is automatically searchable via the existing RAG pipeline.

The key insight: `deal_contexts` is a NEW table that only the new Phase 2A tools read from. The existing `document_chunks` table gets new Tier 3 rows but is queried by the same existing tools. These two data paths don't conflict — they complement each other.

### 2B: Basic activity feed

- Create `agent_activities` table: `id`, `workspace_id`, `agent_type`, `activity_type`, `title`, `description`, `metadata` (JSONB), `created_at`.
- Every significant agent action writes to this table (email drafted, email sent, lead scored, meeting booked, deal stage changed, escalation raised, etc.).
- Simple activity feed component in the UI — not a full notification centre, just a chronological list of what agents have been doing. Can live in the dashboard or as a panel in the Skyler workspace.
- This builds trust: users see that agents are working even when they're not actively interacting with them.

### 2C: HubSpot pipeline import (the big one)

**What this does:** When a user connects HubSpot, Skyler pulls in all active deals with their complete history and creates a lead card for each one on the sales closer page.

**Data retrieval chain (all via Nango Proxy, orchestrated as Inngest background jobs):**

**Step 1 — Fetch active deals.**
Use HubSpot Search API via Nango Proxy. Filter by `dealstage` NOT in closed stages. Request `propertiesWithHistory=dealstage` for complete stage progression with timestamps. Also request `hs_date_entered_{stage}` and `hs_date_exited_{stage}` hidden properties for time-in-stage data. Batch: 100 deals per request. Hard limit: 10,000 results per query (segment by date for larger datasets).

**Step 2 — Batch-read all associations.**
Use HubSpot Associations v4 batch endpoint via Nango Proxy. 1,000 deal IDs per request. Fetch in parallel:
- Deal → Contact (type 3)
- Deal → Company (type 5)
- Deal → Email (type 211)
- Deal → Meeting (type 213)
- Deal → Note (type 215)
- Deal → Task (type 217)
- Deal → Call (type 209)

**Step 3 — Hydrate engagement objects.**
Using collected IDs from Step 2, batch-read each object type via Nango Proxy (100 objects per request):
- **Emails:** `hs_email_subject`, `hs_email_text` (fallback to `hs_email_html` or `hs_body_preview` if null), `hs_email_direction`, `hs_email_headers`, `hs_timestamp`, `hs_email_thread_id`
- **Meetings:** `hs_meeting_title`, `hs_meeting_body`, `hs_meeting_start_time`, `hs_meeting_end_time`
- **Calls:** `hs_call_body`, `hs_call_duration`, `hs_call_recording_url`
- **Notes:** `hs_note_body`, `hs_timestamp`
- **Tasks:** `hs_task_subject`, `hs_task_body`, `hs_task_status`, `hs_timestamp`
- **Contacts:** `firstname`, `lastname`, `email`, `jobtitle`, `phone`, `lifecyclestage`
- **Companies:** `name`, `domain`, `industry`, `city`, `country`, `numberofemployees`

**Step 4 — Assemble and store using three-tier context model.**

**Tier 1 — Deal summary (~500–800 tokens, always available in prompt):**
Pre-computed by Claude (Haiku) for each deal:
- Deal name, amount, current stage, days in current stage
- Stage history as compressed timeline: "Discovery(14d) → Qualified(7d) → Proposal(21d)"
- Primary contact: name, title, company
- Last activity date and type
- Open tasks count and nearest due date
- Key signals extracted by Claude: "Legal review in progress", "Budget approved", "Champion engaged"

Store in `deal_contexts` table (JSONB column for the summary).

**Tier 2 — Recent activity detail (~2,000–3,000 tokens, loaded on demand):**
- Last 5–10 interactions: email threads summarised to 2–3 sentences each (grouped by `hs_email_thread_id`)
- Last meeting notes summarised
- Open tasks with due dates and assignees
- Recent calls with duration and key points

Store in `deal_contexts` table (separate JSONB column).

**Tier 3 — Full history (stored in pgvector, retrieved via RAG):**
- All email bodies chunked individually and embedded
- All meeting transcripts/notes chunked and embedded
- All call notes chunked and embedded
- Complete stage history with timestamps

Store in `document_chunks` with `source_type='hubspot_deal_history'` and `source_id=deal_id`.

**Creating Skyler lead cards:**
For each imported deal, create a row in `skyler_sales_pipeline`:
- Map HubSpot deal stages to Skyler stages (configurable mapping, sensible defaults)
- Link associated contacts (primary = deal owner's main contact)
- Set health score based on: days in current stage, recent activity recency, open task count, email response patterns
- Set initial Skyler assessment from the Tier 1 summary
- Mark as `source: 'hubspot_import'` to distinguish from manually created leads

**Rate limit management:**
HubSpot allows 100 requests/10 seconds (Free/Starter). For 200 active deals, expect ~70–120 API calls total. Use Inngest's built-in throttling and concurrency controls. Implement exponential backoff on 429 responses. For larger CRM instances (1,000+ deals), process in batches of 50 deals with configurable delay.

**Refresh strategy:**
- Inngest cron job runs nightly to refresh deal summaries (detect new engagements, stage changes)
- On-demand refresh when user clicks "sync" on a specific lead card
- Webhook-triggered refresh when HubSpot deal properties change (future — Phase 7 or beyond)

**Test gate:** Connect HubSpot with active deals. Skyler's sales closer page shows a lead card for every active deal. Each card shows correct stage, contact, company, and deal value. Click into a lead — Skyler knows the full context: recent emails, meetings, where things stand. Ask CleverBrain "how's the pipeline?" — it answers accurately with real numbers.

---

## Phase 3 — Cross-Agent Delegation (1–2 days)

**Goal:** CleverBrain can delegate tasks to AI employees. Users don't have to switch between agents to get things done — they tell CleverBrain what they need and it routes the work to the right agent.

### CleverBrain's role boundary (critical principle)

CleverBrain does NOT write to external systems (HubSpot, Gmail, Slack, etc.). It reads from them, analyses the data, creates documents in the chat preview panel, and delegates action to agents. The agents are the "hands" — they execute on external systems. CleverBrain is the "brain" — it thinks, advises, creates content, and coordinates.

If a user says "create a follow-up task for the Acme deal" → CleverBrain delegates to Skyler (or eventually Vera), who creates the task in HubSpot.
If a user says "draft an email to John about the proposal" → CleverBrain delegates to Skyler, who drafts the email for approval.
If a user says "what's our pipeline worth?" → CleverBrain answers directly (read-only, no delegation needed).
If a user says "generate a pipeline report" → CleverBrain creates the document itself in the preview panel (no delegation needed — document creation is an LLM capability, not a connector action).

### Cross-agent delegation via Inngest events

**`delegate_to_agent` tool for CleverBrain:**

The LLM decides when a user's request requires agent action vs when CleverBrain can handle it directly. The tool definition makes this clear:

```typescript
// Tool: delegate_to_agent
// Description: Use this tool when the user's request requires taking action
// on an external system (sending emails, creating CRM records, updating deals,
// booking meetings, etc.). You cannot perform these actions directly — delegate
// to the appropriate AI employee. Do NOT use this for questions you can answer,
// documents you can create, or analysis you can perform yourself.
{
  name: 'delegate_to_agent',
  parameters: {
    target_agent: 'skyler' | 'vera' | 'martin', // which agent should handle this
    task_type: string,     // 'draft_email', 'create_task', 'update_deal', 'book_meeting', etc.
    instructions: string,  // natural language description of what needs to be done
    context: {             // relevant context for the agent
      lead_id?: string,
      contact_name?: string,
      deal_name?: string,
      additional_context?: string
    },
    urgency: 'normal' | 'high' // high = process immediately, normal = next cycle
  }
}
```

**Event flow:**

1. User asks CleverBrain: "Tell Skyler to draft a follow-up email to John about the proposal timeline"
2. CleverBrain calls `delegate_to_agent` with target_agent='skyler', task_type='draft_email', instructions='Draft a follow-up email to John about the proposal timeline', context={ contact_name: 'John', deal_name: 'Acme proposal' }
3. Backend publishes Inngest event:
   ```
   Event: cleverbrain/task.delegated
   Payload: {
     workspace_id, delegating_agent: 'cleverbrain',
     target_agent: 'skyler', task_type: 'draft_email',
     task_id: '<generated UUID>',
     instructions: '...',
     context: { lead_id, contact_name, deal_name },
     urgency: 'normal',
     delegated_by: '<user_id>',
     created_at: '<timestamp>'
   }
   ```
4. Skyler's Inngest function subscribes to `cleverbrain/task.delegated` where `target_agent='skyler'`. It processes the task — in this case, drafting an email using the lead's context from `deal_contexts` and `skyler_sales_pipeline`. The draft goes through the normal approval workflow.
5. On completion, Skyler publishes:
   ```
   Event: agent/skyler.task.completed
   Payload: { workspace_id, task_id, result: { action_id, status: 'draft_ready' } }
   ```
6. CleverBrain responds to the user: "I've asked Skyler to draft that follow-up email to John. She'll have it ready for your approval shortly."
7. A notification is created (Phase 6) so the user knows when the draft is ready.

**Delegation tracking table:**
```sql
CREATE TABLE agent_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL UNIQUE, -- unique task reference
  delegating_agent TEXT NOT NULL, -- 'cleverbrain'
  target_agent TEXT NOT NULL, -- 'skyler', 'vera', 'martin'
  task_type TEXT NOT NULL,
  instructions TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  urgency TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed')),
  delegated_by UUID REFERENCES profiles(id), -- the user who initiated
  result JSONB, -- filled on completion
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

**What Skyler can receive as delegated tasks (initially):**
- `draft_email` — Draft an outreach or follow-up email for a lead
- `create_task` — Create a HubSpot task associated with a deal/contact
- `create_note` — Add a note to a HubSpot deal/contact
- `update_deal` — Update deal properties (stage, amount, close date)
- `research_prospect` — Research a company/contact and update the deal context
- `book_meeting` — Check availability and send a meeting link

Future agents (Vera, Martin) will accept their own task types when they're built.

### Event naming convention (for all future agent communication)
Pattern: `agent/{name}.{action}.{status}`
Examples:
- `agent/skyler.deal.analyzed`
- `agent/skyler.email.drafted`
- `agent/skyler.email.sent`
- `cleverbrain/task.delegated`
- `cleverbrain/insight.generated`

All events carry typed Zod payloads with `workspace_id`, `agent_id`, relevant entity IDs, and result data.

**Test gate:** Ask CleverBrain "tell Skyler to draft an email to John about the proposal" → delegation event fires → Skyler picks it up → draft appears in Skyler's approval queue → notification created. Ask CleverBrain "what's the pipeline worth?" → answers directly, no delegation. Ask CleverBrain "create a pipeline report" → generates document in preview panel, no delegation. Verify CleverBrain never tries to write to HubSpot/Gmail/Slack directly.

---

## Phase 4 — Team Invitations + Workspace RBAC + Data Access Policies (4–5 days)

**Goal:** Multiple users can join a workspace with proper role-based access, and admins can control who sees what data. This must be in place before agents get expanded capabilities.

### Team invitation flow (fixes B4)
- Owner/admin invites user by email from Settings → Team page
- Resend sends invitation email (sender: `noreply@cleverfolks.app` or similar)
- Invitation stored in `workspace_invitations` table: `id`, `workspace_id`, `email`, `role`, `invited_by`, `token`, `status` (pending/accepted/expired), `created_at`, `expires_at`
- Invitee clicks link → signs up or logs in → accepts invitation → added to workspace with assigned role
- Invitation expires after 7 days, resend available

### Team management UI (Settings → Team)
- View all members with role badges
- Change member roles (owner/admin only, cannot demote yourself)
- Remove members (owner/admin only, cannot remove the owner)
- View pending invitations, resend or revoke
- Invite new members (owner/admin only)

### Access control database schema

**⚠️ CC NOTE: `workspace_agents` vs `agent_configurations` relationship.**
The `agent_configurations` table already exists with a `(workspace_id, agent_type)` unique constraint. It stores agent config (personality, autonomy level, rules, knowledge sources). The new `workspace_agents` table handles subscription state (enabled/disabled, billing-related). These are separate concerns but tightly linked:
- `workspace_agents.agent_type` must use the same values as `agent_configurations.agent_type`
- When a workspace subscribes to an agent (row created in `workspace_agents`), also create the corresponding `agent_configurations` row with default config if it doesn't exist
- When checking agent access, query `workspace_agents` for subscription status, query `agent_configurations` for agent behaviour
- Do NOT merge these tables — subscription (billing concern) and configuration (behaviour concern) change independently

```sql
-- workspace_members already exists, ensure it has:
-- workspace_id, user_id, role ('owner','admin','manager','member')

-- Which agents a workspace subscribes to
CREATE TABLE workspace_agents (
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL, -- 'skyler', 'vera', 'martin'
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, agent_type)
);

-- Per-user agent access (opt-out model)
CREATE TABLE user_agent_access (
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  access_level TEXT CHECK (access_level IN ('interact','configure')) DEFAULT 'interact',
  UNIQUE(workspace_id, user_id, agent_type)
);
```

### Access control logic
- **Opt-out model:** When workspace subscribes to an agent, all members automatically get `interact` access. Junction table records exceptions (revocations) or elevations.
- **Owner/admin bypass:** Always have `configure` access to all subscribed agents via application logic (no junction table rows needed).
- **CleverBrain exception:** Every user gets CleverBrain access. It's the base layer.
- **Two permission levels:**
  - `interact` — Chat with agent, see outputs, trigger actions within data scope. Default for manager/member.
  - `configure` — Edit agent personality, autonomy level, rules, knowledge sources. Owner/admin only by default.

### Supabase RLS helper function
```sql
CREATE OR REPLACE FUNCTION public.has_agent_access(ws_id UUID, ag_type TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS(
      SELECT 1 FROM workspace_members wm
      JOIN workspace_agents wa ON wa.workspace_id = wm.workspace_id
      WHERE wm.workspace_id = ws_id AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
      AND wa.agent_type = ag_type AND wa.enabled = true
    )
    OR EXISTS(
      SELECT 1 FROM user_agent_access uaa
      WHERE uaa.workspace_id = ws_id AND uaa.user_id = auth.uid()
      AND uaa.agent_type = ag_type
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
```

### UI changes
- Sidebar only shows agents the user has access to
- Agent configuration pages only accessible with `configure` permission
- Integration settings (Nango connections) restricted to admin/owner — hard security boundary

### Data scoping for CleverBrain tools
- Owner/admin: Full visibility across all pipeline data, all agent activity, all metrics
- Manager: Sees pipeline data for leads they own or are assigned to, plus aggregate metrics
- Member: Sees only their own interactions and assigned items

Every CleverBrain tool function accepts `user_id` and `workspace_id`, filters at the database query level.

### Data access policy UI (E2)

The `data_access_policies` table already exists in Supabase. Build the admin UI and enforcement layer.

**Settings → Data Access page (owner/admin only):**
- Matrix view: rows = roles (owner, admin, manager, member), columns = data sources (HubSpot, Gmail, Outlook, Slack, Google Drive, Skyler Pipeline, Agent Activity)
- Each cell is a toggle: on/off. Owner row is always all-on and non-editable.
- Default state: all roles have access to everything (matches current behaviour). Admins restrict by toggling off.
- Save writes to `data_access_policies` table with: `workspace_id`, `role`, `source_type`, `allowed` (boolean).

**Database schema (extend existing table if needed):**

**⚠️ CC NOTE: The `data_access_policies` table already exists in Supabase.** Before running any migration, inspect the current schema with `\d data_access_policies` in the Supabase SQL editor. The existing columns may differ from what's specified below. If the existing table has different columns, write an ALTER TABLE migration to add the missing columns rather than dropping and recreating. If the existing table matches or is close enough, just add any missing columns/constraints.

```sql
-- Target schema (migrate existing table to match this):
CREATE TABLE IF NOT EXISTS data_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','member')), -- owner always has full access
  source_type TEXT NOT NULL, -- 'hubspot', 'gmail', 'outlook', 'slack', 'google_drive', 'skyler_pipeline', 'agent_activity'
  allowed BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(workspace_id, role, source_type)
);
```

**Enforcement (critical — must be at tool/query level, not prompt level):**
- Create a helper function `getUserDataAccess(workspaceId, userId)` that returns the list of allowed source types for the user's role.
- Every CleverBrain tool and every agent data query checks this before returning results. If a manager's role has Slack toggled off, CleverBrain's RAG search excludes `source_type='slack_message'` and `source_type='slack_reply'` from results.
- Skyler pipeline visibility: if a member's role has `skyler_pipeline` toggled off, CleverBrain's `query_sales_pipeline` and `pipeline_metrics` tools return an access denied message for that user.
- The system prompt includes a line describing which data sources the user can access, as a secondary guardrail: "This user has access to: HubSpot, Gmail, Agent Activity. They do NOT have access to: Slack, Outlook, Google Drive, Skyler Pipeline."

**Important:** This is role-based, not per-user. Keeps it simple. If a workspace has 5 members, they all share the same data access policy for the "member" role. Per-user overrides are a future enhancement if customers need it.

**Test gate:** Owner invites a team member by email. Member accepts, logs in, sees only the agents they have access to. Member asks CleverBrain about pipeline — gets scoped results. Owner sees full data. Admin can configure agents, member cannot. Admin toggles Slack off for member role → member asks CleverBrain about Slack messages → gets told they don't have access to that data source.

---

## Phase 5 — Full Agent Capabilities + Document Preview System (3–4 days)

**Goal:** Agents get full LLM capabilities within their domains. When any agent generates substantial content (documents, reports, analyses, exports), it renders in a live preview panel — exactly like Claude's artifact panel — instead of dumping it inline in chat.

### The Document Preview Panel (E8 — reimagined)

This is how all agents handle document/content generation. It's a core UX pattern, not an afterthought.

**How it works — the agent-side:**
CleverBrain and Skyler already return streamed responses via SSE. Add a new response block type alongside the existing text stream. When the LLM generates substantial content, the response includes a structured artifact block:

```typescript
// Agent response can contain interleaved text and artifact blocks
type AgentResponse = {
  blocks: Array<
    | { type: 'text'; content: string }           // renders inline in chat
    | { type: 'artifact'; artifact: ArtifactBlock } // renders in preview panel
  >
}

type ArtifactBlock = {
  id: string;                    // unique ID for this artifact
  title: string;                 // display title in panel header
  content_type: 'markdown' | 'html' | 'csv' | 'code' | 'react'; // determines renderer
  content: string;               // the actual content
  language?: string;             // for code blocks: 'python', 'javascript', etc.
  downloadable: boolean;         // show download button
  download_formats?: Array<'pdf' | 'docx' | 'csv' | 'md' | 'txt'>; // available export formats
}
```

**How the LLM decides — tool-based, not hardcoded:**
Give CleverBrain and Skyler a `create_document` tool. The LLM naturally decides when to use it — just like how Claude decides when to create an artifact vs reply inline. The tool definition:

```typescript
// Tool: create_document
// Description: Use this tool when you need to create a substantial document,
// report, analysis, export, proposal, or any content longer than a few paragraphs.
// This renders the content in a preview panel where the user can view, copy, and download it.
// Do NOT use this for short answers, conversational replies, or brief summaries.
{
  name: 'create_document',
  parameters: {
    title: string,          // "Q1 Pipeline Report", "Proposal for Acme Corp", "Lead Export"
    content_type: 'markdown' | 'html' | 'csv' | 'code',
    content: string,        // the full document content
    download_formats: string[], // which formats to offer for download
  }
}
```

When the LLM calls `create_document`, the backend:
1. Generates a unique artifact ID
2. Stores the artifact in a `chat_artifacts` table (for persistence and re-rendering)
3. Streams the artifact block to the frontend as part of the SSE response
4. The frontend detects the artifact block and renders it in the preview panel

**The frontend preview panel:**

The panel slides in from the right side of the chat interface (same pattern as Claude's artifact panel). Components:

- **Panel header:** Title of the document + close button + action buttons
- **Action buttons:** Copy to clipboard, Download (dropdown with format options), Expand/collapse
- **Content renderer:** Switches based on `content_type`:
  - `markdown` → Rendered Markdown with proper headings, tables, lists, code blocks. Use `react-markdown` with `remark-gfm` for GitHub-flavoured Markdown (tables, strikethrough, task lists).
  - `html` → Sandboxed iframe render (for rich documents, formatted reports)
  - `csv` → Table view with sortable columns + raw CSV download. Use a simple `<table>` render with alternating row colours. For large datasets (100+ rows), add pagination or virtual scrolling.
  - `code` → Syntax-highlighted code block with language detection. Use `highlight.js` or `prism` for highlighting. Include a "Copy code" button.
  - `react` → Future capability. Not needed for MVP but the type system supports it.

- **Download conversion:**
  - Markdown → PDF: Use `md-to-pdf` or generate via `pdfkit` on the backend. API route: `POST /api/documents/convert` with `{ artifactId, format: 'pdf' }`.
  - Markdown → DOCX: Use `docx` npm package on the backend (same as the skill file describes). Parse the Markdown headings/paragraphs/lists and generate a proper Word document.
  - CSV → Direct download (no conversion needed, already in format)
  - Code → Direct download as `.py`, `.js`, `.ts`, etc.

- **Panel behaviour:**
  - Opens automatically when an artifact block is streamed
  - Can be closed and reopened (artifact persists in the chat message)
  - Multiple artifacts in one conversation — each message can reference its artifact, clicking reopens it in the panel
  - Panel is responsive: on mobile/narrow screens, it overlays instead of side-by-side

**Database table for artifact persistence:**
```sql
CREATE TABLE chat_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL, -- which message in the conversation created this
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL, -- 'cleverbrain' or 'skyler'
  title TEXT NOT NULL,
  content_type TEXT NOT NULL, -- 'markdown', 'html', 'csv', 'code'
  content TEXT NOT NULL,
  download_formats TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}', -- extra info: language for code, source query for exports
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**What CleverBrain uses the preview panel for:**
- Pipeline reports: "Generate a pipeline report for this quarter" → Markdown document with deal breakdown, stage analysis, conversion metrics, rendered in preview panel with PDF/DOCX download
- Data exports: "Export all leads as a CSV" → CSV rendered as sortable table in preview panel with direct CSV download
- Business analyses: "Analyse our sales performance this month compared to last month" → Markdown report with comparisons, insights, recommendations
- Meeting summaries: "Summarise yesterday's meetings" → Markdown document
- Draft documents: "Draft a company update for the team" → Markdown with download options
- Any response where CleverBrain determines the content is substantial enough to warrant a document rather than inline text

**What Skyler uses the preview panel for:**
- Proposals: "Create a proposal for the Acme deal" → Markdown/HTML proposal with deal context, pricing, value proposition. Download as PDF.
- One-pagers: "Create a one-pager about our product for this prospect" → Markdown with key selling points tailored to the prospect's industry and needs
- Meeting summaries: "Summarise my last meeting with John" → Markdown document with key points, action items, next steps
- Research reports: "Research Acme Corp and give me a full briefing" → Markdown document with company overview, key contacts, recent news, competitive positioning
- Email sequences: "Draft a 4-email nurture sequence for cold leads" → Markdown document with all 4 emails laid out

**Critical: The LLM decides, not hardcoded rules.** The `create_document` tool description tells the LLM when to use it. The LLM naturally understands that "what's our pipeline value?" is a short answer (inline) while "generate a Q1 pipeline report" is a document (preview panel). Do not build if/else logic to determine this — let the reasoning layer decide, just like Claude does with artifacts.

### Skyler expanded capabilities
- **Document generation via preview panel:** Proposals, one-pagers, meeting summaries, research reports, email sequences. All rendered in the preview panel with download options.
- **Web browsing:** Research prospects, check company websites, find news. Uses existing Tavily integration + direct HTTP fetch fallback for pages Tavily strips (pricing pages, tables).
- **File reading:** User uploads a document (brief, RFP, competitor analysis) → Skyler reads it via existing `extractText()` pipeline and incorporates into deal context.
- **Link analysis:** User shares a URL in chat → Skyler fetches, summarises, extracts relevant information for the deal context.

### Chat file upload UI (required for both agents)

**⚠️ CC NOTE: Neither Skyler's nor CleverBrain's chat currently has a file upload component.** The `extractText()` function is solid (supports PDF, DOCX, Excel, PPTX, images via Claude Vision, audio via Whisper), but there's no UI to trigger it from chat.

**Build a file attachment button for both chat inputs:**
- Paperclip/attachment icon next to the message input field (both Skyler chat and CleverBrain chat)
- Click opens file picker. Accepted types: `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`, `.wav`, `.m4a`
- Selected file uploads to Supabase Storage (temp bucket or conversation-scoped path)
- Upload progress indicator in the chat input area
- Once uploaded, file appears as a chip/pill above the message input showing filename + file size + remove button
- When the user sends the message, the file reference is included in the API request
- Backend passes the file through `extractText()`, includes the extracted content in the LLM context alongside the user's message
- File size limit: 25MB (matches common chat upload limits)
- Multiple files: support up to 5 files per message

**Storage path:** `uploads/{workspace_id}/chat/{conversation_id}/{filename}` in Supabase Storage. Clean up old uploads via a weekly Inngest cron (delete files older than 30 days).

### CleverBrain expanded capabilities
- **Document generation via preview panel:** Reports, summaries, analysis documents, business insights. All rendered in the preview panel.
- **Data export via preview panel:** CSV exports of pipeline data, deal lists, activity logs, conversation history. Rendered as sortable tables with direct download.
- **Enhanced web search:** Already has Tavily. Add the same direct fetch fallback Skyler gets for pages where Tavily strips useful data.

### Tool architecture
These aren't new architectures — they're new tools added to the existing tool-calling framework. Each tool is a function with typed inputs (Zod schema), executes against existing infrastructure, returns structured output for the LLM to use. The `create_document` tool is the key addition that enables the preview panel pattern.

**Test gate:** Ask CleverBrain "generate a pipeline report for this quarter" — report renders in the preview panel on the right side of chat. User can read it, copy it, download as PDF or DOCX. Ask Skyler "create a proposal for the Acme deal" — proposal renders in preview panel with deal-specific content. Ask CleverBrain "export all leads as CSV" — table renders in preview panel with download button. Short questions ("what's the pipeline value?") still answer inline in chat, not in the panel.

---

## Phase 6 — Notification System (2–3 days)

**Goal:** Users know when agents need attention without having to manually check each agent.

### Notification infrastructure

**⚠️ CC NOTE: Migration from `skyler_notifications` → `notifications` (CRITICAL).**
The `skyler_notifications` table already exists and is actively used by 16+ Inngest functions via `dispatchNotification()`. Do NOT create a separate `notifications` table alongside it — that creates two notification sources and doubles the query complexity.

**Migration strategy (do this FIRST before any other Phase 6 work):**
1. Rename the existing table: `ALTER TABLE skyler_notifications RENAME TO notifications;`
2. Add the missing columns the generic table needs:
   - `agent_type TEXT NOT NULL DEFAULT 'skyler'` — backfill all existing rows with 'skyler'
   - `user_id UUID REFERENCES profiles(id)` — NULL means all workspace users (existing rows are NULL = broadcast)
   - `notification_type TEXT` — map existing notification types to the new enum ('approval_needed', 'escalation', 'task_complete', 'alert', 'info'). Backfill based on existing type/category columns.
3. Update the `dispatchNotification()` helper function to write to the renamed table with the new columns. This is a single function update — all 16+ Inngest callers go through this dispatcher, so you only change one place.
4. Update any direct queries against `skyler_notifications` to use `notifications` instead. Search the codebase: `grep -r "skyler_notifications" src/`
5. Update RLS policies to reference the new table name.
6. Verify all existing notification flows still work before proceeding.

**Target schema after migration:**
```sql
-- This is the RENAMED + EXTENDED skyler_notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- NULL = all workspace users
  agent_type TEXT NOT NULL DEFAULT 'skyler', -- 'skyler', 'cleverbrain', 'vera', 'martin'
  notification_type TEXT NOT NULL, -- 'approval_needed', 'escalation', 'task_complete', 'alert', 'info'
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}', -- link to relevant entity (lead_id, action_id, etc.)
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Notification sources (wired into existing agent actions)
- Skyler drafts an email → notification: "Skyler drafted an email to [contact] about [deal]. Review and approve."
- Skyler escalates a lead → notification: "Skyler escalated [lead]: [reason]"
- Skyler books a meeting → notification: "Meeting booked with [contact] on [date]"
- Skyler detects a hot lead signal → notification: "Hot lead alert: [lead] opened email 3 times in 1 hour"
- CleverBrain delegation completed → notification: "Task completed: [description]"
- Pipeline milestone → notification: "Deal [name] moved to [stage]"

### Frontend components
- **Bell icon dropdown:** Unread count badge, notification list with mark-as-read, click to navigate to relevant entity.
- **Sidebar badges:** Unread count on each agent's sidebar item (e.g., Skyler shows "3" for 3 pending approvals).
- **Polling:** Every 30 seconds, `GET /api/notifications?unread=true&limit=20`. SSE/WebSocket is an optimisation for later.
- **Mark all as read:** Bulk update.

### Upgrade the Phase 2 activity feed
The basic activity feed from Phase 2 now becomes the "Activity" tab — a comprehensive log of everything agents have done. The notification system handles the "needs your attention" items. They're complementary, not duplicative.

**Test gate:** Skyler drafts an email → bell icon shows badge → user clicks notification → navigates to the lead's approval screen. User marks as read → badge clears.

---

## Phase 7 — Production Hardening + Real-Time Webhooks (3–4 days)

**Goal:** Everything that makes the product robust for real daily use, plus real-time data from the two most impactful integrations.

### Real-time webhooks — HubSpot + Slack (F4)

Replace hourly polling with real-time updates for HubSpot and Slack. Gmail and Outlook stay on polling for MVP (Gmail push requires Google Cloud Pub/Sub setup and 7-day subscription renewal; Outlook webhooks are simpler but lower priority since email reply detection already runs every 5 minutes).

**HubSpot webhooks:**

HubSpot sends webhook events when CRM objects change. Set up via the HubSpot developer app (CleverFolks AI app on developers.hubspot.com).

- **Webhook endpoint:** `POST /api/webhooks/hubspot`
- **Events to subscribe to:**
  - `deal.propertyChange` — deal stage changes, amount updates, close date changes. Triggers: refresh the deal's Tier 1 summary in `deal_contexts`, update the corresponding Skyler lead card in `skyler_sales_pipeline`, write to `agent_activities`.
  - `deal.creation` — new deal created in HubSpot. Triggers: run the pipeline import flow for this single deal (same Step 1-4 chain from Phase 2, but for one deal). Create a new Skyler lead card if auto-import is enabled.
  - `deal.deletion` — deal removed from HubSpot. Triggers: mark the corresponding Skyler lead card as `source_deleted`, notify user.
  - `contact.propertyChange` — contact info updated. Triggers: refresh contact data in any associated deal contexts.
  - `contact.creation` — new contact. Triggers: process and embed for RAG.
  - `company.propertyChange` — company info updated. Triggers: refresh company data in associated deal contexts.

- **Webhook security:** HubSpot signs webhook payloads with the app's client secret. Validate the `X-HubSpot-Signature-v3` header on every request. Reject unsigned or invalid requests with 401.

- **Implementation details:**
  ```typescript
  // /api/webhooks/hubspot/route.ts
  // 1. Validate signature using HubSpot client secret
  // 2. Parse the batch of events (HubSpot sends arrays of events)
  // 3. For each event, fire an Inngest event:
  //    inngest.send({ name: 'hubspot/webhook.received', data: { event } })
  // 4. Return 200 immediately (process async via Inngest)
  
  // Inngest function: hubspot/webhook.received
  // - Determine event type (deal.propertyChange, contact.creation, etc.)
  // - Route to appropriate handler
  // - Update deal_contexts, skyler_sales_pipeline, document_chunks as needed
  // - Write to agent_activities for visibility
  ```

- **Deduplication:** HubSpot may send duplicate events. Use the `eventId` field to deduplicate. Store processed event IDs in a `webhook_events_processed` table with a TTL of 24 hours.

- **Batch handling:** HubSpot sends events in batches (up to 100 per request). Process each event individually within the Inngest function. Use `step.run()` for each to get per-event retries.

- **Registration:** Register webhook subscriptions via HubSpot's Webhooks API. This can be done once manually through the developer portal, or programmatically via:
  ```
  POST https://api.hubapi.com/webhooks/v3/{appId}/subscriptions
  {
    "eventType": "deal.propertyChange",
    "propertyName": "dealstage",
    "active": true
  }
  ```
  The target URL is set at the app level: `PUT https://api.hubapi.com/webhooks/v3/{appId}/settings` with `{ "targetUrl": "https://cleverfolks.app/api/webhooks/hubspot", "throttling": { "maxConcurrentRequests": 10, "period": "SECONDLY" } }`

**Slack Events API:**

Slack sends real-time events when messages are posted, channels are updated, etc. You already have the bot token with required scopes.

- **Webhook endpoint:** `POST /api/webhooks/slack`
- **Events to subscribe to (via Slack Event Subscriptions in the app dashboard):**
  - `message` — new message in any channel the bot is in. Triggers: process and embed for RAG immediately instead of waiting for hourly Nango sync.
  - `message_changed` — message edited. Triggers: update the corresponding document chunk.
  - `reaction_added` / `reaction_removed` — useful for sentiment and engagement signals.
  - `channel_created` / `channel_rename` — keep channel metadata current.
  - `member_joined_channel` — track team structure changes.

- **Slack verification:**
  - URL verification challenge: Slack sends a `challenge` parameter on first setup. Endpoint must respond with the challenge value.
  - Request signing: Validate `X-Slack-Signature` header using the signing secret on every subsequent request. Reject invalid requests.

- **Implementation details:**
  ```typescript
  // /api/webhooks/slack/route.ts
  // 1. Handle URL verification challenge (one-time setup)
  // 2. Validate X-Slack-Signature using signing secret
  // 3. Parse the event
  // 4. Fire Inngest event: inngest.send({ name: 'slack/event.received', data: { event } })
  // 5. Return 200 immediately (Slack requires response within 3 seconds)
  
  // Inngest function: slack/event.received
  // - Extract message text, channel, user, timestamp
  // - Run through existing text processing pipeline (chunk + embed)
  // - Store in document_chunks with source_type='slack_message'
  // - Write to agent_activities for visibility
  ```

- **Deduplication:** Use Slack's `event_id` field. Store in same `webhook_events_processed` table.

- **Rate considerations:** Slack may send a high volume of events in active workspaces. Use Inngest's concurrency controls to prevent overwhelming the embedding pipeline. Batch embeddings where possible (collect messages for 5 seconds, embed as batch).

**Shared webhook infrastructure:**
```sql
CREATE TABLE webhook_events_processed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL, -- 'hubspot', 'slack'
  event_id TEXT NOT NULL, -- the external event ID for deduplication
  event_type TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source, event_id)
);

-- Auto-cleanup: delete processed events older than 24 hours
-- Run via Inngest cron or Supabase pg_cron
```

**Fallback:** Keep the existing Nango hourly sync running as a safety net. If webhooks miss events (network issues, downtime), the hourly sync catches up. The processing pipeline is idempotent — reprocessing the same data is safe.

### Data completeness
- **D1: Google Drive file content extraction.** Currently Nango syncs file metadata but not content. Options: configure Nango to include `exportedContent`, or download files via Nango Proxy and use existing `extractText()`. Either way, "What does our brand guide say about tone?" must work.

### Sync visibility (E5)
- Show sync status per integration in Settings → Connectors
- Display last sync time, record counts, error messages
- Manual re-sync trigger button (endpoint already exists as API, just needs UI)
- Sync error alerting (write to `agent_activities` table when sync fails)

### Skyler autonomous CRM updates (E6)
- Reasoning pipeline gets access to CRM write tools: enrich contacts (add missing fields from research), create new deals when pipeline actions warrant it, update company records with discovered information.
- All autonomous CRM writes go through the approval workflow if autonomy level requires it.

### Remaining defensive hardening
- Extend Zod validation to all remaining API endpoints not covered in Phase 0
- Review and tighten rate limits based on real usage patterns observed in testing
- Add request logging for debugging (structured JSON logs, not console.log)

**Test gate:** Google Drive document content is searchable via CleverBrain. Sync errors are visible in UI. Skyler autonomously enriches a contact record after researching their company. Change a deal stage in HubSpot → Skyler's lead card updates within seconds (not hours). Post a message in Slack → it's searchable in CleverBrain within seconds. Webhook signature validation rejects forged requests.

---

## Phase 8 — Workspace Management (1–2 days)

**Goal:** Clean workspace administration.

### Workspace admin (E3)
- Edit workspace name
- Delete workspace (owner only, confirmation dialog, cascading delete of all data)
- Transfer ownership (owner only, target must be existing admin)

### Multi-workspace improvements
- Clean workspace switcher showing workspace name, role, and member count
- Clear indication of which workspace you're currently in (persistent in header)
- Workspace-scoped everything verified end-to-end (no data leakage between workspaces)

### Notification preferences (E4 — basic)
- Per-channel toggle: Slack notifications on/off, email notifications on/off, in-app always on
- Per-type toggle: approvals, escalations, alerts, info updates
- Digest option: immediate vs daily summary (email only)

**Test gate:** User can rename workspace, transfer ownership, delete workspace. Notification preferences respected. Switching workspaces shows correct data with no cross-contamination.

---

## What's Explicitly Deferred (Not in MVP)

These items are acknowledged but deliberately excluded from the MVP build:

- **E7: Entity resolution across integrations** — same person in HubSpot, Gmail, Slack remains separate records for now. Future unification by email address.
- **F1: Agent marketplace backend** — UI shows "coming soon" for Vera and Martin, no provisioning logic
- **F2: Billing/subscription system** — no plan tiers, no usage limits, no quota tracking
- **F3: Stripe invoice integration** — no code exists, deferred
- **F4 (partial): Gmail/Outlook push notifications** — HubSpot and Slack webhooks are in Phase 7. Gmail push (requires Google Cloud Pub/Sub) and Outlook webhooks deferred. Email reply detection already polls every 5 minutes which is sufficient.
- **F5: Advanced security** — no 2FA, no session management UI, no login history
- **F6: Audit logging** — agent_activities table provides basic visibility, full audit trail later

---

## Total Estimated Timeline

| Phase | Days | Cumulative |
|-------|------|------------|
| Phase 0: Patch, Harden, Protect | 1–2 | 1–2 |
| Phase 1: Shared Business Context | 2–3 | 3–5 |
| Phase 2: CleverBrain Visibility + CRM Import | 5–7 | 8–12 |
| Phase 3: Cross-Agent Delegation | 1–2 | 9–14 |
| Phase 4: Team + RBAC + Data Access Policies | 4–5 | 13–19 |
| Phase 5: Full Agent Capabilities + Document Preview | 3–4 | 16–23 |
| Phase 6: Notification System | 2–3 | 18–26 |
| Phase 7: Production Hardening + Real-Time Webhooks | 3–4 | 21–30 |
| Phase 8: Workspace Management | 1–2 | 22–32 |

**Total: 22–32 days of CC work**, testing each phase before moving to the next.

---

## Execution Rules

1. **One phase at a time.** Do not start the next phase until the current phase passes its test gate.
2. **Claude writes CC prompt files.** Malik pastes into CC. CC builds and reports back. Claude reviews and iterates.
3. **Test one thing at a time.** Within each phase, build incrementally. Don't batch 5 features and test them all at once.
4. **Never hardcode flows.** Give agents tools and let the reasoning layer decide. Inngest pipelines for automated actions only.
5. **Entity resolution before every LLM call.** The Stage 12 lesson applies everywhere — conversational momentum causes the LLM to act on the wrong entity without explicit context.
6. **All git commits via CC must use `git config user.name "xxvmalik"`** — Vercel rejects other authors.
7. **UK English throughout.** No em dashes. No AI-sounding phrasing. £ symbols not written out.