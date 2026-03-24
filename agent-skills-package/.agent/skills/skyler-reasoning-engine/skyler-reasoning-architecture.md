# Skyler AI-First Reasoning Architecture

## What This Document Is

This is the architecture reference for rebuilding Skyler from a rule-based system into an AI-first reasoning engine. Claude Code should read this BEFORE making any changes to understand the full picture. Every implementation task will reference sections of this document.

---

## The Problem We Are Solving

Skyler currently makes decisions using hardcoded rules with narrow AI classification:

1. Code detects an event (email reply, calendar event, transcript ready)
2. Code classifies the event into a fixed bucket using AI ("meeting_accept", "positive_interest", "objection", "opt_out")
3. Code runs hardcoded logic based on the bucket (if meeting_accept -> update stage, if opt_out -> disqualify)
4. Code calls AI again for narrow tasks (draft an email, analyse a transcript)

This breaks constantly. Examples:
- "Accepted: Demo booking" calendar emails get treated as real replies
- "I booked a meeting, but can we move it to 3pm?" classified as meeting_accept, returns early without drafting the rescheduling reply
- "I forwarded this to Daniel" classified as positive_interest, drafts a pitch instead of asking about Daniel
- One-word "Thanks" triggers a full pitch response when it should do nothing
- Every new edge case requires new code rules, and rules added to fix one scenario break another

## What Replaces It

A unified AI reasoning layer where:
- Every event flows through a central decision engine
- The AI receives full context and reasons about what to do
- The AI outputs a structured decision (action type, parameters, reasoning, confidence)
- Code executes the decision and enforces guardrails
- No hardcoded branching per event type

---

## The Event Pipeline (How Every Event Flows)

```
EVENT SOURCES                    PIPELINE                         OUTCOMES
--------------                   --------                         --------
Email reply    ─┐
Calendar event ─┤
Meeting end    ─┼──> Inngest ──> Tier 1 Classify ──> Assemble Context ──> AI Reasoning Layer ──> Guardrail Engine ──┬──> Auto-execute
Cadence due    ─┤    Event Bus   (GPT-4o-mini)       (pgvector RAG +       (Claude Sonnet 4)     (Tier + confidence    ├──> Await approval
User response  ─┘                                     tool-loaded data +    Structured output      + directive check)    ├──> Request info (lead card banner)
                                                       user directives)                                                  └──> Escalate (configured channel)
```

### Step by step:

1. **Event arrives** -- email reply, calendar event, meeting transcript, cadence timer, or user response to a previous request
2. **Inngest event bus** -- receives the event, provides durable execution with retries, memoisation, and exactly-once guarantees
3. **Tier 1: Classify** (GPT-4o-mini, $0.15/M tokens) -- quick classification of the event type, intent extraction, entity extraction, sentiment. Determines whether deep reasoning is needed
4. **Assemble context** -- gathers everything the reasoning layer needs: pipeline record, conversation thread, meeting transcripts (from Recall AI), sales playbook, company research, workspace memories, user directives for this lead, past corrections from decision memory
5. **AI reasoning layer** (Claude Sonnet 4, $3/M tokens) -- receives full context, reasons about the best action, outputs a structured decision via constrained decoding (JSON schema). The decision includes: action_type, parameters, reasoning, confidence_score
6. **Guardrail engine** -- checks the decision against: autonomy settings from Workflow Settings, escalation rules, confidence thresholds, user directives. Routes to one of four outcomes
7. **Execute** -- one of: auto-execute (low risk, high confidence), await approval (sends to approval queue, uses Inngest step.waitForEvent()), request info (surfaces banner on lead card, pauses workflow), escalate (sends to configured channel: email, Slack user/channel)

---

## Multi-LLM Routing Strategy

Three tiers of models, each handling different task types:

### Tier 1: GPT-4o-mini ($0.15/$0.60 per million tokens)
Handles 60-70% of all calls. ~1% of total LLM spend.
- Email intent classification
- Referral detection
- Entity extraction (names, companies, roles)
- Conversation categorisation
- Simple sentiment analysis
- Company research summarisation
- Meeting transcript action item extraction

### Tier 2: Claude Haiku 4.5 ($1.00/$5.00 per million tokens)
Handles 15-20% of calls. ~10% of total LLM spend.
- Email thread summarisation
- Knowledge profile generation
- Memory extraction from conversations
- Meeting transcript summarisation
- Voice learner analysis
- Conversation summary generation

### Tier 3: Claude Sonnet 4 ($3.00/$15.00 per million tokens)
Handles 10-20% of calls. ~85% of total LLM spend.
- The central AI reasoning/decision layer
- Strategic email composition
- Deal dynamics analysis and next-best-action
- Complex objection handling
- Meeting follow-up strategy
- Sales playbook reasoning

### Implementation approach:
Use the Vercel AI SDK's `customProvider` to create a `skyler` provider with semantic model aliases:
```typescript
const skyler = customProvider({
  languageModels: {
    'fast': openai('gpt-4o-mini'),
    'medium': anthropic('claude-haiku-4-5-20251001'),
    'complex': anthropic('claude-sonnet-4-20250514'),
  },
});
```

A central `task-router.ts` maps every operation to a tier. Model reassignment becomes a one-line change.

---

## Workflow Settings Integration (CRITICAL -- MUST BE WIRED FIRST)

The Workflow Settings page contains user-configured business intelligence that Skyler needs to make good decisions. These settings split into two categories:

### Category 1: Business intelligence (makes Skyler smarter -- wire immediately)
These feed directly into Skyler's system prompt and reasoning context:

- **Primary goal** -- what Skyler aims for in every conversation (book demos, schedule calls, get replies, close deals, gather info)
- **Sales journey** -- the stages from first contact to close. Skyler follows this flow
- **Pricing structure** -- free text describing pricing tiers, discounts, trial terms. This IS Skyler's commercial knowledge
- **Average sales cycle** -- calibrates patience and urgency
- **Average deal size** -- calibrates effort level per lead
- **Communication style** -- formality level, communication approach (consultative, direct, storytelling, etc.)
- **Phrases to always use** -- brand language and value props injected into emails
- **Phrases to never use** -- banned phrases checked in output validation BEFORE any email is sent
- **Book demos using** -- how to propose meetings (Calendly link, suggest times, ask availability, direct invite)
- **Max follow-up attempts** -- hard guardrail on cadence length

### Category 2: Autonomy controls (add safety rails -- default to Draft & Approve)
These configure the guardrail engine:

- **Global autonomy level** -- "Full Autonomy" vs "Draft & Approve" master switch
- **Per-action toggles** -- send follow-up emails, handle objections, book meetings (each independently toggleable)
- **Require approval for first outreach** -- always ON by default, overrides all other autonomy settings for first-touch emails
- **CRM Update & Rep Notification** -- Slack channel/member, email address, task creation. These ARE the escalation channels
- **Escalation rules** -- hard overrides regardless of autonomy level:
  - Deal value exceeds threshold (e.g. $5,000)
  - Contact marked as VIP/key account
  - Negative sentiment detected in prospect reply
  - First contact with a new lead
  - Any action involving C-suite contacts
  - (TO ADD) Pricing negotiation detected
  - (TO ADD) Request info behaviour toggle (ask first vs draft best attempt)
  - (TO ADD) Recall AI meeting settings (auto-join toggle, calendar source, bot display name)

### How settings flow into the system prompt:
```
[SKYLER CORE IDENTITY]           <-- Always loaded. Who she is.
[WORKFLOW SETTINGS: BUSINESS]    <-- Sales process, pricing, style, phrases. NEW.
[WORKSPACE MEMORIES]             <-- From workspace_memories table.
[USER DIRECTIVES FOR THIS LEAD]  <-- Per-lead instructions from user. NEW.
[ACTIVE SKILL]                   <-- Loaded based on current task.
[CONVERSATION HISTORY]           <-- Last N messages.
[TOOL DEFINITIONS]               <-- HubSpot, search, etc.
```

---

## Structured Decision Output

The AI reasoning layer outputs decisions via Claude's constrained decoding (structured outputs with JSON schema). The schema:

```typescript
const AgentDecisionSchema = z.object({
  action_type: z.enum([
    'draft_email',        // Compose an email for the lead
    'update_stage',       // Move lead to a different pipeline stage
    'schedule_followup',  // Set a follow-up cadence timer
    'create_note',        // Add a note to the lead card
    'request_info',       // Ask user for information via lead card banner
    'escalate',           // Send to configured escalation channel
    'do_nothing',         // Explicitly decide no action needed
    'close_won',          // Mark deal as won, move to won section
    'close_lost',         // Mark deal as lost
  ]),
  parameters: z.record(z.string()),  // Action-specific params
  reasoning: z.string(),              // Why this decision (for audit + UI)
  confidence_score: z.number().min(0).max(1),
  urgency: z.enum(['immediate', 'same_day', 'next_day', 'standard']),
});
```

Implementation uses the Anthropic SDK with Zod:
```typescript
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2048,
  messages: [{ role: 'user', content: contextPrompt }],
  output_config: {
    format: { type: 'json_schema', schema: zodOutputFormat(AgentDecisionSchema) }
  }
});
```

Always check `stop_reason` before parsing. Handle `"refusal"` and `"max_tokens"` cases.

---

## The Guardrail Engine

After the reasoning layer outputs a decision, the guardrail engine determines what happens:

### Check sequence:
1. **Escalation rules first** (hard overrides) -- if deal value > threshold, VIP contact, C-suite, negative sentiment, first contact, or pricing negotiation detected, ALWAYS escalate regardless of autonomy setting
2. **Global autonomy check** -- if "Draft & Approve" mode, ALL actions go to approval queue
3. **Per-action autonomy** -- if "Full Autonomy" mode, check per-action toggles (can Skyler send follow-ups? handle objections? book meetings?)
4. **Confidence threshold** -- if confidence < 0.5, always escalate. If confidence < 0.7 on medium-risk action, upgrade to approval required
5. **User directive check** -- if there's an active directive for this lead, verify the decision aligns with it
6. **Output validation** -- scan drafted emails for "phrases to never use", check for binding language, PII

### Four outcomes:
- **Auto-execute** -- low risk, high confidence, autonomy enabled for this action type
- **Await approval** -- action queued with Approve/Reject buttons (existing UI). Uses Inngest `step.waitForEvent()` to pause until user responds
- **Request info** -- Skyler needs information she doesn't have. Surfaces a visible alert/banner on the lead card. Workflow pauses until user responds via chat
- **Escalate** -- routes to configured channel (Slack channel/member, email, or task) from Workflow Settings. User can respond with a directive

---

## User Directives System (NEW)

When a user gives Skyler an instruction on a specific lead (after an escalation, or proactively via chat), it becomes a **user directive**:

- Stored on the pipeline record for that lead
- Injected into the context assembly step for every future reasoning call on that lead
- Visible on the lead card via a hover icon showing all directives for that lead with timestamps
- Examples: "push for paid trial, no free trial", "hold firm on pricing", "focus on ROI not features", "Diane is the real decision maker, always address her concerns"

Directives give Skyler strategic guidance without requiring the user to make every decision. They're authorisation proof that a human directed Skyler's behaviour.

---

## The Request Loop (NEW)

When the reasoning layer decides it needs information it doesn't have (case study, technical documentation, pricing guidance, competitive intel):

1. Reasoning layer outputs `action_type: 'request_info'` with parameters describing what's needed and why
2. A visible alert/banner appears on the lead card
3. Workflow pauses (Inngest `step.waitForEvent()`)
4. User sees the request, responds via Skyler chat (existing feature: user can reference leads in chat)
5. User's response re-enters the pipeline as a new "user_response" event
6. Context assembly includes the new information
7. Reasoning layer runs again with the complete picture

This replaces the need for a content library, a docs repository, or a pricing database. Skyler asks for what she needs rather than fabricating it.

---

## Meeting Intelligence (Recall AI)

Recall AI provides meeting bot infrastructure. Skyler joins sales calls, records, and transcribes them.

### Flow:
1. Skyler detects scheduled meeting via calendar sync (Outlook now, Google Calendar + Calendly before MVP)
2. Schedules Recall AI bot to join at least 10 minutes before start
3. Bot joins meeting, provides real-time transcription with speaker diarisation
4. Transcript available within 10 seconds of meeting end
5. Inngest function processes transcript through three-tier pipeline:
   - GPT-4o-mini extracts: action items, objections, buying signals, competitor mentions, commitments (~$0.005)
   - Claude Haiku summarises meeting, updates knowledge profile (~$0.02)
   - Claude Sonnet crafts follow-up strategy and composes follow-up email (~$0.045)

### Transcript storage (Supabase):
- Layer 1: Raw transcript JSON (source of truth)
- Layer 2: Chunked segments with pgvector embeddings for semantic search (500-800 tokens, speaker-turn boundaries)
- Layer 3: Extracted structured intelligence (action items, decisions, sentiment) in relational tables

---

## Decision Memory (Learning from Corrections)

Skyler learns from user corrections without model fine-tuning:

### Three-layer feedback loop:
1. **Correction capture** -- when user overrides a decision, store: input snapshot, agent decision, user correction, reason. Embed with pgvector
2. **Few-shot retrieval** -- before each new decision, search past corrections for similar scenarios. Inject top 3-5 as examples in the prompt
3. **Preference distillation** -- when 3+ similar corrections accumulate, Inngest background job summarises the pattern into a natural language rule stored in `learned_preferences` table

### Memory hierarchy:
- Tier 0: Working memory (in the prompt, per-request)
- Tier 1: Session state (Supabase tables)
- Tier 2: Semantic memory (pgvector corrections + preferences, months-years TTL)
- Tier 3: Structured memory (relational tables for policies/rules)

---

## Context Engineering

The reasoning layer needs full context but not unlimited tokens. Target 20-50K tokens per call.

### Hierarchical context loading:
- **Level 0 (always loaded, ~2K tokens):** Deal summary, account brief, current task, workflow settings
- **Level 1 (loaded on demand via tools, ~5-10K each):** Full conversation threads, complete meeting transcripts, detailed company research
- **Level 2 (retrieved via RAG from pgvector):** Sales playbook sections, competitive intelligence, workspace memories

### Summarisation:
- Use Haiku or GPT-4o-mini to compress old conversation turns and meeting transcripts
- Keep last 5-10 turns verbatim, replace older turns with pre-computed summaries
- Pre-compute summaries asynchronously via Inngest when conversations exceed 15 turns

---

## Knowledge Gap Detection & Permanent Memory

Skyler must never fabricate specific business information she doesn't have. Research (AbstentionBench 2025) confirms LLMs cannot reliably self-detect knowledge gaps through instructions alone. The solution is five architectural layers:

### Layer 1: request_information as a first-class tool
The tool description encodes the decision framework: "It is ALWAYS better to ask than to guess." Claude follows tool descriptions more reliably than behavioral instructions.

### Layer 2: Information tier classification
System prompt classifies what Skyler can freely compose (greetings, email structure) vs what she must NEVER fabricate (payment details, bank info, legal terms, specific pricing). Missing any REQUIRED field triggers request_info.

### Layer 3: Pre-generation knowledge check (deterministic code)
Before drafting, a code-level function checks task-specific schemas against available data. If critical fields are missing, the reasoning step is skipped entirely and request_info fires. This saves API cost AND prevents fabrication. Task schemas are extensible: adding a new document type just requires a new schema entry.

### Layer 4: Permanent memory (agent_memories table)
When a user provides missing information, it's stored permanently in Supabase with workspace/lead scoping. Loaded into every future reasoning call. Skyler never asks the same question twice. Old facts are superseded (not deleted) when information changes, preserving audit history.

### Layer 5: Post-generation placeholder scan
After any draft is generated, code scans for fabrication markers ([brackets], placeholders, generic stand-ins). If found, the draft is converted to request_info instead of entering the approval queue.

---

## Skyler's Scope Boundary

Skyler is a sales agent. Her scope ends at "Closed Won":
- She moves the lead card to the "Won" section under Pipeline on the Sales Closer page
- Everything after that (onboarding, customer success, expansion, billing) is handled by the user or future AI employees
- She does NOT handle post-sale workflows, upselling, or billing integration
- She does NOT handle expansion signals or annual conversion follow-ups

---

## Implementation Phases

### Phase 1: Wire Workflow Settings into System Prompt
- Load all Workflow Settings into Skyler's system prompt dynamically
- Business intelligence (sales process, pricing, style, phrases) feeds the prompt
- Autonomy controls feed the guardrail engine
- Escalation rules become hard checks
- Test with existing "Draft & Approve" mode

### Phase 2: Central AI Reasoning Layer
- Replace rule-based event handling with the structured decision schema
- Single reasoning function that handles ALL event types
- Constrained decoding for reliable structured output
- Guardrail engine checks every decision before execution
- Deploy with "Draft & Approve" as default (user reviews every decision via existing approval queue)

### Phase 3: Multi-LLM Routing
- Implement Vercel AI SDK customProvider with three tiers
- Migrate classification tasks to GPT-4o-mini
- Keep reasoning on Claude Sonnet
- Add Inngest step.ai.wrap() for observability
- Implement prompt caching on Sonnet system prompts

### Phase 4: Request Loop + User Directives
- Add request_info action type to decision schema
- Build lead card banner UI for requests
- Implement user directive capture and storage
- Add directive hover icon to lead card
- Wire directives into context assembly

### Phase 5: Knowledge Gap Detection & Permanent Memory
- Update request_information tool description for reliable deferral
- Add information tier classification to system prompt
- Build task schemas with pre-generation knowledge checks (deterministic, no AI)
- Create agent_memories table for permanent fact storage
- Wire memory loading into context assembler
- Add post-generation placeholder scanning to guardrail engine
- Fact extraction from user responses stored permanently

---

## Cost Model

Per workspace (100 events/day):
- Claude Sonnet 4 (complex): ~$11.39/month (73% of LLM spend)
- Recall AI + meeting LLM: ~$3.80/month (24%)
- GPT-4o-mini (fast): ~$0.24/month (2%)
- Embeddings: ~$0.01/month (<1%)
- Total: ~$15-22/workspace/month

Target: 70-90% gross margins at $50-200/month subscription price.

---

## Key Technical Patterns

- **Inngest for all background work** -- durable execution, retries, step.waitForEvent() for human-in-the-loop, step.sleep() for delayed actions, step.ai.wrap() for LLM observability
- **Structured outputs with constrained decoding** -- Claude's JSON schema mode guarantees valid decision objects. Always check stop_reason
- **Vercel AI SDK customProvider** -- unified interface across OpenAI and Anthropic. Same Zod schemas work across providers
- **Supabase pgvector** -- HNSW indexes for sub-10ms similarity search. Used for context retrieval AND decision memory
- **Prompt caching** -- Anthropic cache_control on system prompt + playbook content. 90% discount on cached tokens. 5-minute TTL refreshes on hit
- **Next.js after() API** -- for async work that doesn't block the response (memory extraction, summary generation). Never use fire-and-forget async on Vercel

## Key Technical Gotchas (from past experience)
- Claude returns uppercase types -- always `.toLowerCase()` before validation
- Vercel kills fire-and-forget async -- use Next.js `after()` API
- Tavily strips table/price data from HTML -- fallback to direct HTTP fetch
- Nango incremental sync won't resend previously failed records -- need full reprocess
- Nango uses flat field names different from HubSpot API names
- Pre-computing values in JavaScript before sending to Claude is essential for accuracy
- `workspace_memories` active records use `superseded_by IS NULL`