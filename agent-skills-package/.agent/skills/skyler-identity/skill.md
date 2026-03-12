---
name: skyler-identity
description: Use when building, configuring, or debugging Skyler's runtime AI personality, role understanding, sales behaviour, conversation patterns, email drafting, pipeline management, or chat context. This skill defines how Skyler works as a CleverFolks AI sales employee.
---

# Skyler Identity and Role System

## The Concept: Skills as Runtime Identity

In Claude Code, a skill teaches the development agent how to do a specific job.
For Skyler, the same pattern applies at RUNTIME -- skills teach Skyler how to be a sales employee.

The difference:
- **Development skill** = SKILL.md loaded into Claude Code agent's context at dev time
- **Skyler runtime skill** = Markdown/structured instructions loaded into Skyler's Claude API system prompt at runtime

The architecture is identical. The execution environment is different.

## Skyler is NOT CleverBrain

Skyler has her OWN dedicated chat interface -- completely separate from CleverBrain.
Users communicate with Skyler directly about each lead, prospect, and sales conversation.
Skyler is an autonomous sales agent, not a chatbot reporting through CleverBrain.

- **CleverBrain** = business intelligence assistant (read-only, answers questions, analyses data)
- **Skyler** = sales AI employee (reads AND writes, takes actions, manages pipeline)

They share the same workspace_memories table. What CleverBrain learns, Skyler inherits.
What Skyler learns, CleverBrain inherits. Day one, Skyler already knows all the terminology,
corrections, patterns, and preferences that CleverBrain has accumulated.

## System Prompt Assembly

When Skyler handles a conversation, her system prompt is assembled dynamically in `lib/skyler/system-prompt.ts`:

```
[SKYLER CORE IDENTITY]        <-- Always loaded. Who she is. Built by buildSkylerSystemPrompt()
[COMPANY CONTEXT]             <-- Company name, description, industry, products, target audience
[COMPANY INTELLIGENCE]        <-- Knowledge profile (services, patterns, topics) if ready
[WORKSPACE MEMORIES]          <-- From workspace_memories table. Shared with CleverBrain.
  - TERMINOLOGY & CORRECTIONS <-- Non-negotiable overrides (always loaded)
  - USER PREFERENCES          <-- How the user likes things done
  - KNOWN PATTERNS            <-- Business patterns learned over time
  - AGENT LEARNINGS           <-- Things Skyler/CleverBrain discovered
  - SAVED RESOURCES           <-- Booking links, URLs, templates (always loaded)
[INTEGRATION AWARENESS MAP]   <-- Which integrations are connected/not connected
[AUTONOMY LEVEL]              <-- full | approval_required | read_only
[PENDING ACTIONS]             <-- Actions awaiting user approval (with NL approval rules)
[PIPELINE CONTEXT]            <-- Injected when user highlights a lead/pipeline card (includes conversation thread)
[CONVERSATION HISTORY]        <-- Last 15 messages + Haiku summary of older messages
[TOOL DEFINITIONS]            <-- All available tools
```

**IMPORTANT:** There is NO separate intent detection step. Claude IS the agent.
Claude reads the message, decides which tools to call, and acts. Same architecture
as CleverBrain's agent loop. No pre-classifier, no planner, no router.

## Skyler's Core Identity (Always Loaded)

Built by `buildSkylerSystemPrompt()` in `lib/skyler/system-prompt.ts`. Key aspects:

- Sales AI Employee -- not a chatbot, not an assistant
- Speaks as a teammate: "our pipeline", "our prospects", "our team"
- Celebrates wins, flags risks proactively
- Leads with the answer, not the search process
- Timezone-aware (workspace timezone injected with current date/time)
- Integration-aware (knows what's connected and what's not)

### Communication Rules
- Lead with the most important information
- Back up recommendations with data
- Celebrate wins ("Nice -- we closed the DataFlow deal for $45K!")
- Flag risks: stalled deals, overdue closes, cold prospects
- ONE proactive suggestion at the end maximum
- Match response length to complexity
- NEVER mention "my memory" or "I remember from CleverBrain" -- just know things naturally

## Sales Closer Pipeline System

The Sales Closer is Skyler's core outreach engine. It manages the full lifecycle from qualified lead to closed deal.

### Architecture

- **Inngest durable functions** (`lib/inngest/functions/sales-closer.ts`) handle async workflows
- **Approval mode** -- all emails are drafted for user approval before sending
- **Pipeline table:** `skyler_sales_pipeline` stores lead state, conversation thread, research, and email stats

### Pipeline Stages

```
initial_outreach → follow_up_1 → follow_up_2 → follow_up_3 → replied → demo_booked → closed_won / closed_lost
```

### Sales Closer Workflow (Inngest: `skyler/lead.qualified.hot`)

Triggered when a lead scores hot (70+). Steps:

1. **Create/find pipeline record** in `skyler_sales_pipeline`
2. **Load workspace memories** (filtered to remove other leads' deal data via `filterDealMemories`)
3. **Load sender identity** -- workspace owner name + company name from settings
4. **Load knowledge profile** -- authoritative source for what the business does
5. **Build sales playbook** (`lib/skyler/sales-playbook.ts`) -- structured services, pricing, objection handlers
6. **Research the company** (`lib/skyler/company-research.ts`) -- web browse, search, service alignment scoring
7. **Learn sales voice** (`lib/skyler/voice-learner.ts`) -- learns writing style from past emails
8. **Detect lead context** -- HubSpot deal data, form submissions, notes
9. **Draft initial email** via the email drafting engine
10. **Store draft for approval** as a pending action

### Reply Handler (Inngest: `skyler/pipeline.reply.received`)

Triggered when a prospect replies to an outreach email. Steps:

1. **Classify reply intent** using Claude with last 4 thread messages as context:
   - `positive_interest` -- asking questions, showing curiosity
   - `objection` -- pushing back but still engaged
   - `meeting_accept` -- agreed to a call/meeting/demo
   - `opt_out` -- wants to be removed
2. **Load full context** (playbook, voice, research, knowledge profile, sender identity)
3. **Draft intent-aware reply** via the email drafting engine
4. **Store reply draft for approval**
5. **Sync to HubSpot** (reply logged, resolution synced)

### Cadence Engine (Inngest: `skyler/cadence.step.due`)

Automated follow-ups when prospects don't reply:

- **Day 3:** `different_value_prop` -- new angle, fresh hook, different subject line
- **Day 7:** `social_proof_or_case_study` -- specific result or proof point
- **Day 14:** `breakup_final_attempt` -- close the loop gracefully, leave door open

Each step goes through the full email drafting engine with all guardrails.

## Email Drafting Engine

`lib/skyler/email-drafter.ts` -- dedicated Claude Sonnet-powered email writer. ALL emails (initial outreach, follow-ups, replies, corrections) route through this engine.

### Key Rules (data-backed)

- **Word count:** Cold outreach 50-100 words (sweet spot 60-80). Replies under 100 words.
- **Reading level:** 5th grade. Short sentences. Simple words. No jargon.
- **Subject lines:** All lowercase, 1-4 words, no punctuation, no emojis.
- **CTAs:** Interest-based only ("Worth a look?", "Is this relevant?"). NEVER calendar CTAs for cold emails.
- **No emojis** -- anywhere in the email. Instant delete trigger.
- **No cliches:** "I hope this email finds you well", "just checking in", "bumping this", "circling back" are banned.
- **No sentences starting with "I"** -- start with "you" or their company name.

### Sender Identity

Emails are signed as the **workspace owner** (e.g. "Adebayo / TheKclaut"), NEVER as "Skyler". Skyler drafts the email but it sends FROM the user's identity. The sender name and company are loaded from workspace memberships and settings.

### Three Lead Scenarios

The drafter detects which scenario applies and adjusts the approach:

1. **Form/inbound lead** -- they came to us. Reference what they submitted, be direct.
2. **Company-researched lead** -- we know the company. Lead with trigger events or specific observations.
   - Sub-scenario: **Universal benefits** -- no clear service fit, pitch universal value of our services.
3. **Individual lead** -- minimal company data. Lead with questions, be curiosity-driven.

### Reply Mode

When drafting replies to prospect messages, the drafter:
- Reads the FULL conversation thread (last 4 messages in full, older ones truncated to 200 chars)
- Uses intent classification to determine approach:
  - `positive_interest` → answer their question with specifics, advance to next step
  - `objection` → PQVIR framework (Pause, Question, Validate, Isolate, Reframe)
  - `meeting_accept` → 3 sub-cases: already booked (just confirm), agreed but no time (propose slots), picked a time (confirm + send link)
  - `opt_out` → gracious removal, no guilt
- Will NOT repeat offers, re-introduce, or re-pitch after booking
- Matches the conversation stage (if they're ready to buy, help them buy)

### Sales Playbook (`lib/skyler/sales-playbook.ts`)

Structured extraction from knowledge profile + workspace memories:
- Company name, positioning, target audience
- Services with descriptions and pricing (the ONLY things Skyler can offer -- no hallucinated pricing)
- Objection handlers (objection → response mappings)
- Case studies / social proof

### Sales Voice Learner (`lib/skyler/voice-learner.ts`)

Learns the user's writing style from past sent emails:
- Greeting style, closing style, tone
- CTA preferences
- Vocabulary notes
- Patterns to avoid

### Company Research (`lib/skyler/company-research.ts`)

Multi-source research with caching:
- Web browsing (company website) + web search (news, funding)
- Service alignment scoring against the sales playbook
- Trigger event detection (5x conversion boost per Forrester)
- Pain point identification
- Cached on `skyler_sales_pipeline.company_research` to avoid redundant research

### Draft Correction Flow

When the user gives feedback on an email in chat and wants a re-draft:
- The `draft_correction_email` tool accepts `pipeline_id` + `user_feedback`
- The handler fetches ALL context (pipeline record, sender identity, playbook, voice, knowledge profile, memories, thread, cached research)
- Routes through the full `draftEmail()` engine with the user's feedback as an override
- Stores the result as a pending action for approval
- This ensures correction drafts get the same guardrails as automated drafts (sender identity, word limits, no emojis, thread awareness, grounded pricing)

## Outlook Email Integration

### Sending Emails

Two-step draft-then-send pattern via Microsoft Graph API:

1. `POST /v1.0/me/messages` -- creates a draft (returns the real Outlook message ID)
2. `POST /v1.0/me/messages/{draftId}/send` -- sends the draft

This captures the real Outlook message ID for deterministic threading.

### Email Threading

Threading priority for replies:
1. **Stored `outlook_message_id`** from the conversation thread (most reliable)
2. **Search inbox** for received messages from the prospect (fallback)
3. **Search sent items** for our sent messages (second fallback)
4. **New email** if all else fails

Each thread entry in `skyler_sales_pipeline.conversation_thread` stores:
- `role`, `content`, `subject`, `timestamp`
- `outlook_message_id` -- the real Outlook ID for threading

OData filter escaping: special characters (`\`, `"`, `%`, `&`, `+`, `#`) are stripped from search queries to prevent Graph API 400 errors.

### Email Sender (`lib/email/email-sender.ts`)

Core functions:
- `sendViaOutlook()` -- draft→send for new emails, returns `outlookMessageId`
- `replyViaOutlook()` -- reply to existing thread, returns `outlookMessageId`
- `getThreadingInfo()` -- extracts stored `outlook_message_id` from thread entries
- `executeEmailSend()` -- orchestrates the full send with threading logic
- `draftOutreachEmail()` -- stores email as pending action for approval
- `executeApprovedAction()` -- sends approved email and updates pipeline

## Chat Context System

### Pipeline Context Injection (`app/api/skyler/chat/route.ts`)

When the user highlights a lead or pipeline card in the chat UI (WhatsApp-style tag):

**Case 1: Lead/Pipeline card highlight** (no specific email)
- Fetches pipeline record including `conversation_thread`
- Injects into system prompt: lead name, company, stage, email stats, AND the full conversation thread
- Skyler can see exactly what was said (e.g. "I have booked for Friday 2pm GMT")

**Case 2: Email-level highlight** (specific email from thread)
- Injects the highlighted email content plus pipeline stats
- If email is pending: offers to redraft
- If email was sent: stores feedback as memory AND offers correction draft

**Pipeline context persistence across follow-up messages:**
- When a pipeline context is present, it's embedded in the saved user message as a marker: `[Pipeline context: Name at Company (pipeline_id: xxx, email: subject)]`
- On follow-up messages (no new highlight), the chat route scans history for this marker
- If found, re-fetches the pipeline record (including conversation thread) and re-injects it
- This ensures Skyler remembers which lead you're discussing even across multiple messages

### WhatsApp-Style Highlights (Frontend)

`components/skyler/skyler-client.tsx` implements:
- `PinnedLeadContext` type: source (lead/pipeline), sourceId, contactEmail, stage, classification, potential, optional email
- `MessageHighlight` type: kind (lead/pipeline/email), contactName, companyName, preview/subject/stage/classification/potential
- `HighlightQuote` component renders the highlight inline with the message
- Each message gets its own independent highlight (no sticky tag across messages)
- "Tag" button on lead cards and pipeline cards pins the lead into the chatbox

## Approval Workflow

All CRM writes and email sends go through approval when autonomy is `approval_required`.

### How It Works

1. Skyler calls a write tool (e.g. `create_deal`, `draft_correction_email`)
2. The action is stored in `skyler_actions` table with status `pending`
3. Skyler tells the user: "I've drafted this for your approval"
4. Pending actions are listed in the system prompt on the next message

### Natural Language Approval

When pending actions exist, the system prompt includes NL approval rules:
- Approval language ("yes", "go ahead", "send it", "looks good") → `execute_pending_action`
- Rejection language ("no", "cancel", "reject") → `reject_pending_action`
- Most recent action is assumed if user doesn't specify which one
- CRITICAL: Skyler must NOT call the original write tool again (that creates a duplicate)

## Tools (Complete List)

### CRM Read Tools (shared with CleverBrain)
- `search_knowledge_base` -- semantic + keyword hybrid search across all synced data
- `fetch_recent_messages` -- chronological fetch for time-range queries
- `search_by_person` -- find messages from/about a specific person

### CRM Write Tools (HubSpot via Nango, respects autonomy level)
- `create_contact` / `update_contact`
- `create_company` / `update_company`
- `create_deal` / `update_deal`
- `create_task`
- `create_note`

### Sales Closer Tools
- `get_sales_pipeline` -- view active pipeline records with stage, email stats, conversation state
- `get_performance_metrics` -- success metrics (emails sent, open rate, reply rate, meetings booked, conversion rate)
- `move_to_sales_closer` -- add a qualified lead to the Sales Closer pipeline for active outreach
- `pickup_conversation` -- take over an existing email thread with a contact (reads history first)
- `draft_correction_email` -- re-draft an email through the full engine using user feedback (pipeline_id + user_feedback)

### Lead Scoring Tools
- `score_lead` -- BANT-based scoring for a specific contact (Budget, Authority, Need, Timeline → 0-100)
- `get_lead_scores` -- retrieve all scored leads with classification (hot 70+ / nurture 40-69 / disqualified <40)

### Action Tools
- `execute_pending_action` -- approve and execute a pending action
- `reject_pending_action` -- reject/cancel a pending action

### Web Research Tools (shared with CleverBrain)
- `search_web` -- Tavily web search
- `browse_website` -- Tavily Extract + direct HTTP fetch fallback
- `map_website` -- Tavily site map

## Memory System

### Memory Types
Shared with CleverBrain via `workspace_memories` table:
- `correction` -- user corrections (ALWAYS loaded, non-negotiable overrides)
- `terminology` -- business terminology (ALWAYS loaded)
- `resource` -- booking links, URLs, templates, reusable assets (ALWAYS loaded as foundational)
- `preference` -- how the user likes things done
- `pattern` -- business patterns learned over time
- `learning` -- things discovered by the agent

### Foundational Memories
`correction`, `terminology`, and `resource` types are always loaded regardless of similarity search. They represent non-negotiable knowledge that applies to every interaction.

### Memory Extraction
After every conversation turn, memories are extracted using `lib/cleverbrain/memory-extractor.ts`:
- Runs in `after()` callback (non-blocking)
- Checks against existing memories to avoid duplicates
- Resources (URLs, booking links) extracted with HIGH confidence always
- Memories go to the shared `workspace_memories` table

### Filter Deal Memories
`lib/skyler/filter-deal-memories.ts` prevents lead-specific data (deal amounts, specific conversations) from leaking into other leads' email drafts. Applied when loading memories for the email drafter.

## Skyler Settings (User-Configurable)

Settings live in workspace settings and are injected into Skyler's system prompt:

### Autonomy Level (`skyler_autonomy_level`)
- **full** -- execute actions immediately without asking
- **approval_required** (default) -- draft everything for user review
- **read_only** -- analyse and recommend only, no actions

### Lead Scoring (100-point BANT system)
- Budget signals (0-25), Authority signals (0-25), Need signals (0-25), Timeline signals (0-25)
- Classifications: hot (70+), nurture (40-69), disqualified (<40)
- Referral leads get bonus points

### Connected Integrations
Skyler dynamically adapts to connected tools. The integration awareness map shows:
- HubSpot (CRM), Gmail, Outlook (email), Slack (messaging), Google Calendar, Google Drive, CleverBrain Chat History
- If a needed integration is not connected, Skyler recommends connecting it and explains what it would unlock

## Key Files

```
lib/skyler/system-prompt.ts          -- System prompt builder (buildSkylerSystemPrompt)
lib/skyler/tools.ts                  -- Tool definitions (SKYLER_TOOLS, SKYLER_WRITE_TOOL_NAMES, etc.)
lib/skyler/tool-handlers.ts          -- Tool execution (executeSkylerToolCall, handleDraftCorrectionEmail)
lib/skyler/email-drafter.ts          -- Email drafting engine (draftEmail, buildDraftPrompt, CADENCE_ANGLES)
lib/skyler/company-research.ts       -- Company research (researchCompany)
lib/skyler/voice-learner.ts          -- Sales voice learning (learnSalesVoice, getSalesVoice)
lib/skyler/sales-playbook.ts         -- Sales playbook builder (buildSalesPlaybook)
lib/skyler/lead-scoring.ts           -- Lead scoring (scoreLead)
lib/skyler/conversation-pickup.ts    -- Thread pickup (pickupExistingConversation)
lib/skyler/filter-deal-memories.ts   -- Memory filtering for drafts (filterDealMemories)
lib/email/email-sender.ts            -- Email sending, threading, approval (sendViaOutlook, executeEmailSend, draftOutreachEmail)
lib/inngest/functions/sales-closer.ts -- Inngest workflows (salesCloserWorkflow, pipelineReplyHandler)
lib/inngest/functions/sales-cadence.ts -- Cadence automation (cadenceStepDue)
app/api/skyler/chat/route.ts         -- Chat API endpoint (context injection, agent loop, memory extraction)
components/skyler/skyler-client.tsx   -- Frontend UI (highlights, tags, pipeline cards, chat)
```

## The Key Insight

Claude Code skills teach agents how to BUILD software.
Skyler runtime skills teach Skyler how to BE a sales employee.

Same format. Same progressive disclosure. Same on-demand loading.
Different execution context.

Memory is the bridge -- CleverBrain and Skyler share one brain.
What one learns, the other inherits. The organisation's knowledge compounds over time.
