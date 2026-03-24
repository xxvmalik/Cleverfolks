# Skyler AI Reasoning Engine -- Implementation Stages

## How to Use This File

These are sequential implementation stages. Do them in order. Each stage has:
- **Goal**: What this stage achieves
- **Prompt**: What to paste to CC
- **Done when**: How you know it's complete before moving on

Do NOT skip stages. Each one builds on the previous. ask questions on each       
  stage if you need clarity before we build!!!!

---

## STAGE 0: Setup
**Goal:** Get the architecture doc and skill file into the project so CC has full context.

### Prompt for CC:

```
I'm about to start a major Skyler rebuild. Before we write any code, I need you to set up two reference documents.

1. Create the folder /mnt/skills/user/skyler-reasoning-engine/ and place the SKILL.md file I'm about to share inside it. This is the implementation guide for the entire rebuild.

2. Place the architecture document (skyler-reasoning-architecture.md) somewhere in the project where you can reference it. This is the full picture of what we're building.

Read both documents fully before responding. Then tell me:
- What you understand the overall architecture to be (in your own words, briefly)
- What the four implementation phases are
- Any questions you have before we start Phase 1

Do not write any code yet. Just confirm you understand the plan.
```

Then share both files with CC.

**Done when:** CC confirms it understands the architecture and the four phases. It should be able to explain the event pipeline, the three LLM tiers, the four guardrail outcomes, and the role of Workflow Settings in its own words.

---

## STAGE 1: Wire Workflow Settings into Skyler's System Prompt
**Goal:** Every decision Skyler makes is informed by the user's sales process, pricing, communication style, and rules.

### Prompt for CC:

```
Let's start Phase 1: Wire Workflow Settings into Skyler's system prompt.

Read the skyler-reasoning-engine skill (SKILL.md) Phase 1 section for full details. Here's the summary:

WHAT TO DO:
1. Find where Skyler's system prompt is currently assembled (the pattern from skyler-identity where CORE IDENTITY, WORKSPACE MEMORIES, ACTIVE SKILL, etc. are concatenated)
2. Load the user's Workflow Settings from the database for the current workspace
3. Add a new WORKFLOW SETTINGS section to the system prompt BETWEEN the core identity and workspace memories
4. Format the settings into clear, structured instructions Skyler can reason about

The system prompt assembly order should be:
[SKYLER CORE IDENTITY] -- who she is
[WORKFLOW SETTINGS: BUSINESS] -- sales process, pricing, style, phrases
[WORKFLOW SETTINGS: AUTONOMY] -- autonomy level, escalation rules (informational, not enforcement)
[WORKSPACE MEMORIES] -- what she knows about this business
[USER DIRECTIVES FOR THIS LEAD] -- skip for now, Phase 4
[ACTIVE SKILL] -- loaded based on current task
[CONVERSATION HISTORY] -- last N messages
[TOOL DEFINITIONS] -- HubSpot, search, etc.

CRITICAL RULES:
- Load settings ONCE at the start of each reasoning call, not per-step
- If settings are not configured yet (new workspace), use sensible defaults and note it in the prompt
- The "phrases to never use" list should be included in the prompt AND checked in code before any email is sent (we'll add the code check in Phase 2)
- Autonomy toggles and escalation rules go in the prompt as informational context so Skyler knows her boundaries, but actual enforcement happens in the guardrail engine (Phase 2)
- Keep the static parts (identity + settings) together at the top for future prompt caching

Before writing code, show me:
1. Which files you'll be modifying
2. The exact format of the WORKFLOW SETTINGS prompt section
3. How you'll load the settings from the database

Then implement it.
```

**Done when:**
- Skyler's system prompt includes the Workflow Settings when you test in chat
- A workspace with settings configured gets them in the prompt
- A workspace WITHOUT settings configured gets sensible defaults
- You can see the settings reflected in Skyler's responses (e.g., she uses the right formality level, references the pricing structure, avoids banned phrases)

---

## STAGE 2: Structured Decision Schema
**Goal:** Define the structured output format that the AI reasoning layer will use for every decision.

### Prompt for CC:

```
Phase 2, Part A: Define the structured decision schema.

Before we build the full reasoning layer, we need the decision schema that it will output. This is the contract between the AI and the execution layer.

Read the skyler-reasoning-engine skill Phase 2 section for the full schema. Here's what to do:

1. Create a new file: lib/skyler/reasoning/decision-schema.ts (or wherever makes sense in our project structure)
2. Define the SkylerDecisionSchema using Zod with these fields:
   - action_type: enum of all possible actions (draft_email, update_stage, schedule_followup, create_note, request_info, escalate, do_nothing, close_won, close_lost)
   - parameters: object with optional fields for each action type (email_content, email_subject, new_stage, followup_delay_hours, note_text, request_description, escalation_reason, etc.)
   - reasoning: string explaining why this decision was made (shown to users for transparency)
   - confidence_score: number 0-1
   - urgency: enum (immediate, same_day, next_day, standard)

3. Also create the TypeScript type from the schema so we can use it throughout the codebase

This is just the schema definition, not the reasoning function yet. We're laying the foundation.

Show me the schema before saving it. Make sure the parameters object covers all the action types properly.
```

**Done when:**
- The Zod schema is defined and exports both the schema and the TypeScript type
- The schema covers all 9 action types with appropriate parameters for each
- The file compiles without errors

---

## STAGE 3: Guardrail Engine
**Goal:** Build the check system that sits between the AI's decision and execution.

### Prompt for CC:

```
Phase 2, Part B: Build the guardrail engine.

This is the function that checks every AI decision against the user's Workflow Settings before it gets executed. Read the skyler-reasoning-engine skill Phase 2 section for the full check sequence.

Create lib/skyler/reasoning/guardrail-engine.ts (or appropriate location) with a function that:

INPUT: Takes the AI's structured decision, the workspace's Workflow Settings, and the lead data
OUTPUT: Returns one of four outcomes: 'auto_execute' | 'await_approval' | 'request_info' | 'escalate'

CHECK SEQUENCE (this order matters):
1. Escalation rules first (hard overrides) -- deal value > threshold, VIP contact, C-suite, negative sentiment, first contact, pricing negotiation. If ANY match, return 'escalate'
2. If action is request_info, always allow it (it's asking the user, not acting autonomously)
3. Global autonomy check -- if "Draft & Approve" mode, return 'await_approval'
4. Per-action autonomy -- check individual toggles (can send follow-ups, can handle objections, can book meetings)
5. First outreach override -- if require_approval_first_outreach is ON and this is the first email to this lead, return 'await_approval'
6. Confidence threshold -- below 0.5 = escalate, below 0.7 = await_approval
7. Output validation -- check drafted emails for "phrases to never use". If any found, return 'await_approval'
8. If everything passes, return 'auto_execute'

IMPORTANT:
- This function does NOT call any AI. It's pure logic checking settings against the decision.
- Load the "phrases to never use" from Workflow Settings and do a case-insensitive check against email content
- Make the function easily testable (pure function, no side effects, no database calls inside it)
- Add TypeScript types for the inputs

Show me the function before saving. Then write unit tests for the key scenarios:
- Escalation rule triggers on high deal value
- Draft & Approve blocks everything
- Full Autonomy with all toggles ON allows auto_execute
- First outreach always requires approval when toggle is on
- Low confidence forces escalation
- Banned phrase in email forces approval
```

**Done when:**
- The guardrail function is implemented with all 8 checks in order
- Unit tests pass for all key scenarios
- The function is a pure function with no side effects

---

## STAGE 4: Central Reasoning Function
**Goal:** Build the single function that replaces all rule-based event handling.

### Prompt for CC:

```
Phase 2, Part C: Build the central reasoning function.

This is the brain. One function that handles ANY event type and outputs a structured decision. Read the skyler-reasoning-engine skill Phase 2 section for details.

Create lib/skyler/reasoning/skyler-reasoning.ts with a function that:

1. RECEIVES: An event (with type and data), the workspace ID, and the lead ID
2. ASSEMBLES CONTEXT:
   - Load Workflow Settings (from Stage 1 work)
   - Load pipeline record for this lead
   - Load conversation history (last 10 messages)
   - Load workspace memories relevant to this context
   - Load any meeting data if available
   - Format everything into a reasoning prompt
3. CALLS CLAUDE SONNET with:
   - The assembled system prompt (identity + settings + memories + skill)
   - The context as the user message
   - The SkylerDecisionSchema as structured output (constrained decoding)
4. VALIDATES the response:
   - Check stop_reason (handle refusals and token truncation)
   - Parse the decision against the Zod schema
   - If invalid, retry once with a higher max_tokens
5. RETURNS the validated SkylerDecision object

IMPORTANT:
- Use Claude's structured output with the Zod schema from Stage 2
- The reasoning prompt should clearly present: what just happened (the event), the full context (lead history, conversation, settings), and ask Skyler to decide the best action
- Include the list of available actions and what each one means
- This function does NOT execute the decision. It only decides.
- Handle errors gracefully -- if Claude fails after retries, return an escalation decision by default (safe fallback)

Also create lib/skyler/reasoning/context-assembler.ts that handles gathering all the context. Keep it separate from the reasoning function so we can test context assembly independently.

Show me your plan for:
1. The context assembly -- what data gets loaded and how it's formatted
2. The reasoning prompt template -- what Claude actually receives
3. The error handling approach

Then implement it.
```

**Done when:**
- The reasoning function can take any event type and return a valid structured decision
- Context assembly loads settings, pipeline data, conversation history, and memories
- Error handling falls back to escalation if Claude fails
- You can manually test by passing a mock event and getting a decision back

---

## STAGE 5: Decision Executor
**Goal:** Build the execution layer that takes a guardrail-approved decision and does it.

### Prompt for CC:

```
Phase 2, Part D: Build the decision executor.

This takes a guardrail-approved decision and executes it. The guardrail engine has already determined WHAT should happen (auto_execute, await_approval, request_info, or escalate). Now we need to actually do it.

Create lib/skyler/actions/execute-decision.ts with a router function and individual handlers:

FOR AUTO_EXECUTE and AWAIT_APPROVAL (after approval received):
- draft_email: Create the email draft, store it, surface in the approval queue (existing Approve/Reject UI). When approved, send via the existing email sending mechanism
- update_stage: Update the pipeline record's stage in the database
- schedule_followup: Create an Inngest scheduled event for the follow-up (use step.sleep or step.sendEvent with a delay)
- create_note: Add a note to the lead's pipeline record
- close_won: Update pipeline stage to 'won', move lead card to won section
- close_lost: Update pipeline stage to 'lost'
- do_nothing: Log the decision and reasoning, no action taken

FOR REQUEST_INFO:
- Create a record in a new skyler_requests table (or appropriate existing table) with: lead_id, workspace_id, request_description, status='pending', created_at
- This will be picked up by the lead card UI to show the banner (we'll build the UI in Phase 4)

FOR ESCALATE:
- Read the CRM Update & Rep Notification settings from Workflow Settings
- Send to configured channels: Slack (channel or member), Email (detailed brief), Task creation
- Include: lead name, what happened, what Skyler wanted to do, why she's escalating, her suggested action
- Use existing notification mechanisms where possible

IMPORTANT:
- Every execution should be wrapped in try/catch with logging
- Store the decision + outcome in a skyler_decisions log table for audit: decision_id, lead_id, workspace_id, event_type, decision (JSON), guardrail_outcome, execution_result, created_at
- The await_approval flow should use the EXISTING approval mechanism (the Approve/Reject buttons on lead cards). Don't build a new approval system.
- For escalation, reuse existing Slack/email notification code where possible

Show me which existing notification and email mechanisms you'll reuse. Then implement.
```

**Done when:**
- Each action type has a handler that executes correctly
- Decisions are logged to a decisions table for audit
- Escalation sends to configured Slack/email/task channels
- The existing Approve/Reject UI works with AI-generated decisions

---

## STAGE 6: Inngest Orchestration
**Goal:** Wire everything together with Inngest as the durable event-driven backbone.

### Prompt for CC:

```
Phase 2, Part E: Wire everything together with Inngest.

Now we connect the pieces. Create Inngest functions that:

1. MAIN EVENT HANDLER: An Inngest function triggered by Skyler events (email reply received, calendar event detected, cadence timer due, user response to request). This function:
   - step.run('classify'): Call GPT-4o-mini to classify the event (for now, just use whatever model we currently use -- we'll optimise in Phase 3)
   - step.run('reason'): Call the central reasoning function from Stage 4
   - step.run('check-guardrails'): Run the guardrail engine from Stage 3
   - Based on guardrail outcome:
     - auto_execute: step.run('execute') calls the decision executor from Stage 5
     - await_approval: step.run('queue-approval') stores the pending decision, then step.waitForEvent('skyler/approval-received', { timeout: '7d' }) pauses until user approves/rejects
     - request_info: step.run('create-request') stores the request, then step.waitForEvent('skyler/user-response', { timeout: '7d' }) pauses until user responds
     - escalate: step.run('escalate') sends to configured channels

2. APPROVAL HANDLER: When user clicks Approve on a pending decision, emit the Inngest event that resumes the waiting function. When user clicks Reject, emit a rejection event. The main function handles both.

3. CADENCE SCHEDULER: An Inngest function that fires on schedule_followup decisions. Uses step.sleep() to wait the specified delay, then emits a new cadence_due event that re-enters the main handler.

IMPORTANT:
- Each step.run() is independently retriable -- if the Claude API fails, only that step retries
- Use step.ai.wrap() if available for LLM calls to get observability
- The existing Skyler event handling should continue to work during development. Build the new pipeline alongside the old one. We'll switch over once tested.
- Use existing Inngest function patterns from the codebase

Show me:
1. The Inngest function structure
2. How the waitForEvent pattern connects to the existing Approve/Reject UI
3. Which existing event handlers this will eventually replace (but don't replace them yet)

Then implement.
```

**Done when:**
- The Inngest function runs end-to-end: event in, classify, reason, guardrail check, execute
- The approval flow works: decision queues, user approves, execution resumes
- The cadence scheduler works: follow-up scheduled, fires after delay, new event processed
- All steps are independently retriable
- The existing system still works alongside the new pipeline

---

## STAGE 7: Multi-LLM Routing (Phase 3)
**Goal:** Route cheap tasks to GPT-4o-mini, keep reasoning on Sonnet.

### Prompt for CC:

```
Phase 3: Multi-LLM routing.

Read the skyler-reasoning-engine skill Phase 3 section. We need to optimise costs by routing tasks to the right model.

1. Create lib/skyler/routing/model-router.ts using the Vercel AI SDK customProvider pattern:
   - 'fast' tier: GPT-4o-mini (we already use this, just formalise the routing)
   - 'medium' tier: Claude Haiku 4.5
   - 'complex' tier: Claude Sonnet 4

2. Create lib/skyler/routing/task-router.ts that maps task names to tiers:
   - Tier 1 (fast): classify_intent, detect_referral, extract_entities, classify_sentiment, extract_meeting_actions, summarise_company_research
   - Tier 2 (medium): summarise_thread, generate_knowledge_profile, extract_memories, summarise_meeting, generate_conversation_summary
   - Tier 3 (complex): reason_about_event, compose_email, analyse_deal, handle_objection, plan_meeting_followup

3. Update the Inngest orchestration to use the routed models:
   - The classify step uses 'fast'
   - The reasoning step uses 'complex'
   - Any summarisation steps use 'medium'

4. Add attempt-based fallback: on first 2 retries use primary model, on subsequent retries fall back to a cheaper tier

5. Implement prompt caching on the Sonnet calls:
   - Add cache_control: { type: "ephemeral" } after the static portion of the system prompt (identity + workflow settings)
   - This saves ~90% on cached input tokens

IMPORTANT:
- We're already using GPT-4o-mini for several tasks. This stage formalises the routing, it doesn't add a new provider.
- Don't break existing functionality. The same tasks should produce the same quality results, just routed more efficiently.
- Log token usage per tier so we can track cost savings

Show me the routing setup, then implement.
```

**Done when:**
- All LLM calls route through the model router
- Classification tasks use GPT-4o-mini
- Reasoning uses Sonnet
- Prompt caching is active on Sonnet calls
- Token usage is logged per tier
- No regression in response quality

---

## STAGE 8: Request Loop + User Directives (Phase 4)
**Goal:** Skyler can ask users for information and users can give per-lead instructions.

### Prompt for CC:

```
Phase 4: Request loop and user directives.

Two features to build:

FEATURE 1: REQUEST LOOP
When Skyler's reasoning layer outputs action_type: 'request_info':
1. A record is created in a skyler_requests table: lead_id, workspace_id, request_description, status ('pending'/'fulfilled'), created_at, fulfilled_at
2. The lead card shows a visible alert/banner when there's a pending request
3. The Inngest function pauses via step.waitForEvent('skyler/user-response')
4. When the user responds in chat referencing that lead, the response:
   - Marks the request as fulfilled
   - Stores the response content on the pipeline record
   - Emits the Inngest event that resumes the paused function
   - The reasoning layer re-runs with the new information in context

FEATURE 2: USER DIRECTIVES
When a user gives Skyler an instruction about a specific lead:
1. Detect it as a directive vs a general question (use GPT-4o-mini classification: "Is this a general question or a specific instruction about how to handle this lead?")
2. Store in a skyler_directives table: lead_id, workspace_id, directive_text, created_at, is_active
3. Load active directives for the current lead during context assembly (update the context assembler from Stage 4)
4. Format in the system prompt as: "User instructions for this lead: [text] (given on [date])"
5. On the lead card, add a small icon that shows a popover/tooltip on hover with all directives for that lead and their timestamps

IMPORTANT:
- The lead card banner for requests should be visually distinct from the approval buttons
- Directives are per-lead, NOT global
- A directive like "push for paid trial" only applies to that one lead
- Directives persist until the lead is closed or the user deactivates them
- When displaying directives on hover, show them in reverse chronological order (newest first)

Show me:
1. The database schema for both tables
2. The lead card UI changes needed
3. How directives get loaded into the context assembler

Then implement.
```

**Done when:**
- Skyler can request info and a banner appears on the lead card
- User response resumes the paused workflow
- User can give directives that persist on the lead and influence future decisions
- Directives appear on hover on the lead card
- The full pipeline works end-to-end with requests and directives

# STAGE 8.5: Recall AI Meeting Intelligence

**Goal:** Skyler joins sales meetings via a bot, gets speaker-attributed transcripts, processes them through the three-tier LLM pipeline, and feeds meeting context into the reasoning layer so follow-up decisions reference what was actually discussed on the call.

---

## Why This Matters

Without meeting intelligence, Skyler is deaf to what happens on calls. She can handle the full email lifecycle (outreach, follow-ups, objection handling, escalation) but when a user has a 20-minute demo call where the prospect says "I need to talk to my business partner about finances", Skyler has no idea. Her follow-up email would be generic instead of referencing the specific pain points discussed, the stakeholders identified, and the commitments made.

With meeting intelligence, Skyler knows: who was on the call, what they said, what objections came up, what next steps were agreed, who the real decision-maker is, and what the emotional tone was. Her follow-up email references the conversation. Her pipeline updates reflect reality.

---

## Recall AI Overview (from research)

Recall AI is a YC-backed meeting bot API. It's developer infrastructure, not an end-user product.

**What it does:**
- Sends a bot to join Zoom, Google Meet, Microsoft Teams, Webex, GoTo Meeting, and Slack Huddles
- Records audio/video with separate streams per participant
- Transcribes with speaker diarisation (who said what)
- Delivers transcripts via webhook in real-time or post-call
- Calendar V2 API syncs with Google Calendar and Outlook to auto-detect meetings
- Transcript available within seconds of meeting end

**Pricing (as of early 2026, pay-as-you-go):**
- Bot recording: $0.50/hour (prorated to the second, so a 30-min meeting = $0.25)
- Built-in transcription: $0.15/hour
- Calendar API: free (included in all plans)
- No platform fee
- 7 days free storage per recording, then $0.05/hour/30 days

**Cost per 30-minute meeting: approximately $0.33 from Recall alone**

**Why Recall over alternatives:**
- Gong ($1,400-1,600/user/year) and Fireflies ($10-29/user/month) are end-user products, not programmable infrastructure. They lack the API control an autonomous agent needs.
- Otter.ai's API cannot send bots to arbitrary meeting URLs
- AssemblyAI provides transcription only, not meeting joining
- MeetingBaaS ($0.69/hr including transcription) is a viable alternative but has a smaller track record
- Recall AI is the only platform giving full programmatic control over bot scheduling, real-time transcript webhooks, and meeting metadata. Used by HubSpot, Calendly, and Brighthire in production.

---

## Prompt for CC:

```
Stage 8.5: Recall AI Meeting Intelligence.

This stage adds meeting awareness to Skyler. Read the architecture doc's "Meeting Intelligence (Recall AI)" section for context. Here's what to build:

PART A: RECALL AI API INTEGRATION

1. Create lib/skyler/meetings/recall-client.ts -- a wrapper around the Recall AI REST API:

   Core methods needed:
   - createBot(meetingUrl, botName, joinAt, webhookUrl): Creates a bot that joins a meeting
     POST https://{REGION}.recall.ai/api/v1/bot/
     Body: {
       meeting_url: string,
       bot_name: "Skyler - {workspace_name}",
       join_at: ISO datetime (schedule at least 10 mins before meeting start),
       recording_config: {
         transcript: {
           provider: {
             recallai_streaming: { mode: "prioritize_accuracy" }
           }
         }
       },
       metadata: { workspace_id, lead_id }
     }
   
   - getBot(botId): Get bot status and recording details
     GET https://{REGION}.recall.ai/api/v1/bot/{bot_id}/
   
   - getBotTranscript(botId): Get the full transcript after meeting ends
     GET https://{REGION}.recall.ai/api/v1/bot/{bot_id}/transcript/
   
   - deleteBot(botId): Cancel a scheduled bot
     DELETE https://{REGION}.recall.ai/api/v1/bot/{bot_id}/
   
   - listBots(filters): List bots with optional filters
     GET https://{REGION}.recall.ai/api/v1/bot/

   Auth: Token-based header: Authorization: Token {RECALL_API_KEY}
   Region: Store RECALL_API_REGION in env (e.g. us-west-2, eu-central-1)
   
   Error handling:
   - 507 errors mean bot capacity is full. Retry with backoff.
   - If bot fails to join, log the error and create a skyler_request asking the user for meeting notes manually
   - Store RECALL_API_KEY in environment variables, never in code

2. Create a webhook endpoint: app/api/webhooks/recall/route.ts
   
   Recall sends webhooks for bot status changes. Handle these events:
   - bot.status_change: Track when bot is joining, in_call, done, fatal_error
   - recording.done: Recording is ready for transcription
   - transcript.done: Transcript is ready to download
   
   Webhook verification: Include a secret token as a query parameter in the webhook URL
   (e.g. ?token={RECALL_WEBHOOK_SECRET}). Verify this on every incoming request.
   
   When transcript.done fires:
   - Fetch the full transcript via getBotTranscript()
   - Emit an Inngest event: skyler/meeting-transcript-ready with { bot_id, workspace_id, lead_id, transcript }
   - This enters the main pipeline for processing


PART B: CALENDAR INTEGRATION FOR AUTO-SCHEDULING

Use Recall AI's Calendar V2 integration for maximum control over which meetings get bots.

1. Create lib/skyler/meetings/calendar-sync.ts

   The flow:
   a. User connects their calendar (Outlook first, Google Calendar before MVP) via OAuth
   b. Recall syncs calendar events and sends calendar.sync_events webhooks when events change
   c. Our webhook handler (add to the recall webhook route) receives the sync event
   d. We fetch updated calendar events via Recall's List Calendar Events API
   e. For each event, apply business logic to decide if a bot should join:
      - Does the event have external attendees? (not just internal team)
      - Is any attendee email associated with an active lead in our pipeline?
      - Is the meeting within the user's configured auto-join settings? (from Workflow Settings -- the meeting toggle we're adding)
   f. If yes, schedule a bot via Schedule Bot For Calendar Event API
   g. Set join_at to 2-3 minutes before meeting start
   h. Use dedup_key = {meeting_start_time}-{meeting_url} to prevent duplicate bots

   Calendar connection flow:
   - For Outlook: User goes through Microsoft OAuth flow. We get a refresh token and pass it to Recall's Create Calendar API
   - For Google Calendar (before MVP): Same pattern with Google OAuth
   - Store the Recall calendar_id linked to the workspace
   
   Handle edge cases:
   - Meeting time changes: calendar.sync_events fires, we update the bot's join_at
   - Meeting cancelled: calendar.sync_events fires with is_deleted, we delete the bot
   - Bot can't join (wrong URL, platform issue): Create a skyler_request on the lead card asking user for meeting notes
   - Calendar disconnected: calendar.update webhook, notify user to reconnect

2. Add to the Recall webhook handler:
   - calendar.sync_events: Fetch updated events, apply scheduling logic
   - calendar.update: Handle calendar disconnection/reconnection


PART C: TRANSCRIPT PROCESSING PIPELINE

This is an Inngest function triggered by the skyler/meeting-transcript-ready event. It processes the transcript through three tiers:

1. Create inngest/functions/process-meeting-transcript.ts

   Step 1: Store raw transcript (Inngest step.run)
   - Save the full transcript JSON to a meeting_transcripts table:
     id, bot_id, workspace_id, lead_id, raw_transcript (JSONB), 
     meeting_date, duration_seconds, participants (JSONB), 
     processing_status, created_at
   - This is the source of truth. Never modify it. Used for reprocessing when models improve.

   Step 2: Extract intelligence (Inngest step.run, GPT-4o-mini / 'fast' tier)
   - Input: raw transcript
   - Extract into structured JSON:
     {
       action_items: [{ text, assigned_to, deadline_mentioned }],
       objections: [{ text, speaker, topic }],
       buying_signals: [{ text, speaker, signal_type }],
       competitor_mentions: [{ competitor_name, context, speaker }],
       commitments: [{ text, who_committed, what_committed }],
       key_questions: [{ question, speaker, was_answered }],
       stakeholders_identified: [{ name, role, influence_level }],
       pain_points: [{ text, speaker, severity }],
       next_steps_discussed: [{ step, owner, timeline }]
     }
   - Store in a meeting_intelligence table linked to the transcript
   - Cost: approximately $0.005 per meeting

   Step 3: Generate meeting summary (Inngest step.run, GPT-4o-mini / 'fast' tier)
   - Input: raw transcript + extracted intelligence from step 2
   - Generate: 
     - Executive summary (3-5 sentences)
     - Key takeaways (what matters for this deal)
     - Prospect's emotional state and engagement level
     - Updated knowledge profile for this lead (merge with existing)
   - Store summary on the meeting_transcripts record
   - Update the lead's knowledge profile in the pipeline record
   - Cost: approximately $0.005 per meeting

   Step 4: Generate follow-up strategy (Inngest step.run, Claude Sonnet / 'complex' tier)
   - Input: meeting summary + extracted intelligence + pipeline context + Workflow Settings
   - This is a REASONING call, same pattern as the main reasoning layer
   - Output: a SkylerDecision (using the existing schema from Stage 2)
   - Typical decision: draft_email with follow-up content referencing specific things discussed
   - The decision goes through the SAME guardrail engine as all other decisions
   - Cost: approximately $0.045 per meeting

   Total LLM cost per meeting: approximately $0.055
   Total cost per 30-min meeting (Recall + LLM): approximately $0.38


PART D: FEED MEETING CONTEXT INTO THE REASONING LAYER

Update the context assembler (from Stage 4) to include meeting data:

1. In lib/skyler/reasoning/context-assembler.ts, add a step that:
   - Checks if the lead has any meeting_transcripts records
   - If yes, loads the SUMMARY (not the full transcript) into the context
   - Formats it as a section in the reasoning prompt:
     "## Recent meeting with this lead
      Date: {date}
      Participants: {names}
      Summary: {executive_summary}
      Key takeaways: {takeaways}
      Action items: {items}
      Commitments made: {commitments}
      Stakeholders identified: {stakeholders}
      Their concerns: {objections + pain_points}"
   
2. If the reasoning layer needs MORE detail (e.g. "what exactly did the prospect say about pricing?"), it should be able to request the full transcript via a tool call. Create a get_meeting_transcript tool that loads the raw transcript for a specific meeting.

3. Store chunked transcript segments with pgvector embeddings for semantic search:
   - Chunk at speaker-turn boundaries, 500-800 tokens per chunk
   - Embed each chunk using the existing embedding pipeline
   - Store in a meeting_chunks table: id, transcript_id, lead_id, workspace_id, speaker_name, chunk_text, embedding vector(1536), start_time, end_time
   - The context assembler can now do semantic search: "what did they say about pricing?" retrieves the relevant chunks


PART E: DATABASE SCHEMA

Create these tables:

meeting_transcripts:
  - id: uuid, primary key
  - bot_id: text (Recall bot ID)
  - workspace_id: uuid, foreign key
  - lead_id: uuid, foreign key to pipeline record
  - raw_transcript: jsonb (full Recall transcript)
  - summary: text (generated by GPT-4o-mini)
  - intelligence: jsonb (extracted by GPT-4o-mini)
  - participants: jsonb (array of {name, is_host, platform})
  - meeting_date: timestamptz
  - duration_seconds: integer
  - meeting_url: text
  - processing_status: text ('pending', 'extracting', 'summarising', 'strategising', 'complete', 'failed')
  - created_at: timestamptz

meeting_chunks:
  - id: uuid, primary key
  - transcript_id: uuid, foreign key to meeting_transcripts
  - lead_id: uuid, foreign key
  - workspace_id: uuid, foreign key
  - speaker_name: text
  - chunk_text: text
  - embedding: vector(1536)
  - start_time: float (seconds from meeting start)
  - end_time: float
  - created_at: timestamptz

recall_bots:
  - id: uuid, primary key
  - recall_bot_id: text (Recall's bot ID)
  - workspace_id: uuid, foreign key
  - lead_id: uuid, foreign key (nullable -- may not be linked to a lead initially)
  - calendar_event_id: text (Recall's calendar event ID, nullable)
  - meeting_url: text
  - scheduled_join_at: timestamptz
  - status: text ('scheduled', 'joining', 'in_call', 'done', 'failed', 'cancelled')
  - bot_name: text
  - created_at: timestamptz
  - updated_at: timestamptz

recall_calendars:
  - id: uuid, primary key
  - workspace_id: uuid, foreign key
  - recall_calendar_id: text (Recall's calendar ID)
  - provider: text ('google', 'outlook')
  - platform_email: text
  - status: text ('connected', 'disconnected')
  - auto_join_external: boolean default true
  - created_at: timestamptz
  - updated_at: timestamptz

Add HNSW index on meeting_chunks.embedding for fast similarity search.


PART F: WORKFLOW SETTINGS ADDITIONS

Add these to the Workflow Settings page (under a new "Meeting Intelligence" section):

1. "Auto-join meetings with prospects" -- toggle (default OFF)
   When ON, Skyler automatically schedules a Recall bot for any meeting that has an external attendee matching an active lead
   
2. "Bot display name" -- text input (default: "Skyler - {workspace_name}")
   The name shown when the bot joins the meeting
   
3. "Calendar connection" -- button to connect Outlook or Google Calendar via OAuth
   Shows connected status and email address

These settings feed into the calendar sync business logic (Part B).


PART G: MEETING INTELLIGENCE UI ON LEAD CARD

Add a "Meetings" section to the lead card, alongside the existing Convo Thread section. This is where users see what happened on calls.

Layout:
1. A "Meetings" button/tab on the lead card (similar to how "Convo Thread (N)" works)
2. When opened, shows a dropdown selector at the top with meetings listed by date:
   - Format: "{date} - {meeting title or participants}" e.g. "15 Mar 2026 - Demo with Marcus & Diane"
   - Most recent meeting selected by default
   - Sorted newest first
3. Below the dropdown, show the selected meeting's intelligence:

   MEETING SUMMARY CARD:
   - Date and duration (e.g. "15 Mar 2026 | 22 minutes")
   - Participants (list of names with host marked)
   - Executive summary (3-5 sentences from the GPT-4o-mini-generated summary)
   
   KEY INTELLIGENCE (collapsible sections):
   - Action items: bullet list with who owns each item
   - Objections raised: what concerns came up, from which speaker
   - Buying signals: positive indicators detected
   - Stakeholders identified: names, roles, and influence level
   - Pain points: what problems were discussed
   - Next steps discussed: what was agreed
   - Competitor mentions: if any competitors were referenced
   
   FULL TRANSCRIPT (expandable):
   - "View full transcript" toggle at the bottom
   - When expanded, shows the full speaker-attributed transcript
   - Each utterance shows: speaker name, timestamp, and text
   - Colour-code or visually distinguish different speakers
   - Long transcripts should be scrollable within a fixed-height container, not expand the entire page

4. If the lead has NO meetings yet, show an empty state: "No meetings recorded yet. Connect your calendar in Workflow Settings to auto-record."

5. If a meeting is still being processed (processing_status != 'complete'), show a loading state: "Meeting from {date} is being processed. Summary will appear shortly."

6. The meeting count should show on the button: "Meetings (3)" similar to "Convo Thread (18)"

API:
- GET /api/skyler/meetings?lead_id={id} -- returns all meetings for a lead with summaries and intelligence
- GET /api/skyler/meetings/{transcript_id}/transcript -- returns the full raw transcript for the expandable view

Keep the same dark theme styling as the rest of the Skyler dashboard. The meeting card should feel like a natural extension of the lead card, not a separate page.


IMPORTANT IMPLEMENTATION NOTES:

- Schedule bots AT LEAST 10 minutes before meeting start. Scheduling last-minute causes 507 errors.
- Use prioritize_accuracy mode for transcription (not low_latency). We don't need real-time during the meeting. We need accurate transcripts after.
- The transcript processing is async. The user doesn't wait for it. The Inngest function processes it in the background and the follow-up strategy appears in the approval queue when ready.
- If Recall bot fails to join for any reason, gracefully degrade: create a request_info action asking the user "I couldn't join the meeting with {lead_name}. Could you share what was discussed so I can follow up properly?"
- Meeting chunks with embeddings enable the reasoning layer to answer specific questions about what was discussed, without loading the entire transcript into context every time.
- The follow-up strategy from Step 4 goes through the SAME guardrail engine as every other decision. It's not a special path. Meeting follow-ups are just decisions like any other.
- Start with Outlook calendar since that's already working via Nango. Google Calendar and Calendly connections come before MVP.
- The Recall API key and region should be workspace-level config, not hardcoded, in case different workspaces need different Recall accounts in the future.
- Prorated billing means short meetings are cheap. A 15-minute check-in costs ~$0.16 from Recall.

Show me:
1. The database migration for all tables
2. The Recall client wrapper
3. The webhook handler structure
4. The Inngest function for transcript processing
5. How the context assembler changes to include meeting data
6. The lead card meeting section UI component
7. The meetings API endpoints

Then implement part by part. Start with Parts A and E (API client + database), then B (calendar), then C (processing pipeline), then D (context integration), then F (settings UI), then G (meeting UI on lead card).
```

**Done when:**
- Recall bot can be manually scheduled for a meeting URL and successfully joins
- Webhook receives transcript.done and triggers the processing pipeline
- GPT-4o-mini extracts intelligence, Sonnet generates follow-up strategy (two-tier, no Haiku)
- The follow-up decision appears in the approval queue referencing specific things from the meeting
- Calendar sync detects upcoming meetings and auto-schedules bots (when toggle is ON)
- Meeting context appears in the reasoning layer's context for subsequent decisions about that lead
- Semantic search on meeting chunks returns relevant transcript segments
- If bot fails to join, a request_info banner appears on the lead card asking for meeting notes
- The meeting intelligence settings appear in Workflow Settings
- The lead card shows a "Meetings (N)" section with date dropdown
- Selecting a meeting shows the summary, key intelligence sections, and expandable transcript
- Multiple meetings on the same lead are selectable via the dropdown
- Empty state and processing state display correctly

---

## Cost Summary

Per 30-minute meeting:
| Component | Cost |
|-----------|------|
| Recall bot (recording) | $0.25 |
| Recall transcription | $0.075 |
| GPT-4o-mini (extract + summarise) | ~$0.01 |
| Claude Sonnet (strategise) | ~$0.045 |
| Embeddings (chunks) | ~$0.001 |
| **Total** | **~$0.38** |

At 2-3 meetings per workspace per week: approximately $3.20-4.80/month per workspace.

## STAGE 9: End-to-End Testing
**Goal:** Run a real lead through the entire pipeline and verify everything works.

### Prompt for CC:

```
Full end-to-end test. Let's run a test lead through every stage of the pipeline.

Create a test scenario based on this story:

1. A new lead submits a contact form saying "Interested in learning more. We use HubSpot, Gmail, and Slack."
   - Should trigger: classify event -> reason about it -> draft a reply -> queue for approval

2. The lead replies agreeing to a demo call
   - Should trigger: classify as meeting_accept -> reason (do_nothing on email, update stage) -> auto-execute stage update

3. After the demo, a follow-up email should be scheduled
   - Should trigger: schedule_followup -> cadence fires after delay -> reason about follow-up content -> draft email -> queue for approval

4. The lead goes silent for a week
   - Should trigger: cadence_due -> reason (send value-add, not "checking in") -> draft email -> queue for approval

5. The lead replies with an objection about pricing
   - Should trigger: classify as objection -> escalation rule (pricing negotiation) -> escalate to configured channel

6. User gives directive: "Offer 30-day paid trial, no free trial"
   - Should be captured as a directive on the lead
   - Next reasoning call should have this directive in context

7. Skyler drafts a response incorporating the directive
   - Should reference the paid trial terms from the directive
   - Should queue for approval

Run through each scenario and verify:
- The right model tier handles each step
- The guardrail engine routes correctly
- Decisions are logged to the audit table
- Approval queue works
- Escalation sends to the right channel
- Directives influence subsequent decisions

Report what works and what breaks.
```

**Done when:**
- All 7 scenarios pass
- The pipeline handles the full lifecycle from first contact to negotiation
- No errors in the Inngest dashboard
- Decision logs show correct reasoning at each step

---

## Summary: Stage Order

| Stage | Phase | What | Risk Level |
|-------|-------|------|------------|
| 0 | Setup | Architecture docs + skill file into project | None |
| 1 | Phase 1 | Wire Workflow Settings into system prompt | Low (additive, no breaking changes) |
| 2 | Phase 2A | Define structured decision schema (Zod) | Low (just a schema file) |
| 3 | Phase 2B | Build guardrail engine | Low (pure function, tested) |
| 4 | Phase 2C | Build central reasoning function | Medium (core logic) |
| 5 | Phase 2D | Build decision executor | Medium (touches existing systems) |
| 6 | Phase 2E | Inngest orchestration | Medium (wires everything together) |
| 7 | Phase 3 | Multi-LLM routing | Low (optimisation, no logic change) |
| 8 | Phase 4 | Request loop + user directives | Medium (new UI + new tables) |
| 9 | Testing | End-to-end verification | None |

Each stage should be tested and confirmed working before moving to the next.


# STAGE 10: Knowledge Gap Detection & Permanent Memory

**Goal:** Skyler never fabricates information she doesn't have. When she encounters a knowledge gap (payment details, bank info, contract terms, technical specs, or ANY specific business fact not in her context), she asks the user first. Once the user provides it, she remembers it permanently and never asks again.

---

## Why This Matters

Skyler drafted an invoice with placeholder payment details ("[bank details will be provided separately]") instead of recognising she didn't have that information and asking the user first. This is not a one-off bug. LLMs routinely fill gaps with fabricated content rather than admitting what they don't know. Research (AbstentionBench 2025, 35,000 queries) confirms that even top models "routinely answer when abstention is correct."

The fix is architectural, not prompt-based. Five layers of defence, each catching what the others miss.

---

## Prompt for CC:

```
Stage 10: Knowledge Gap Detection & Permanent Memory.

Skyler fabricated payment details in an invoice instead of asking the user first. This is a fundamental problem that affects every task where Skyler might not have specific business data. We need a general solution, not a hardcoded fix for invoices.

Read the research findings: the solution has five layers. Build them in order.


LAYER 1: UPDATE THE request_information TOOL

The request_info action already exists (Stage 8), but Skyler doesn't think to use it before drafting. The fix:

1. In the reasoning function's tool definitions, update the request_information tool description to be explicit:

   name: "request_information"
   description: "Use this when you need specific business data that is NOT available in your context — payment details, bank information, account numbers, pricing specifics, contract terms, delivery timelines, legal terms, technical specifications, or ANY factual detail you weren't explicitly given. It is ALWAYS better to ask than to guess. Use this BEFORE generating placeholder values, brackets like [details here], or generic stand-ins. If you're about to write something you're not 100% certain about from your context, use this tool instead."

   Tool descriptions matter more than system prompt instructions. Claude follows tool descriptions more reliably than behavioral instructions.


LAYER 2: INFORMATION TIER CLASSIFICATION IN SYSTEM PROMPT

Add a new section to Skyler's system prompt (in the core identity or workflow settings block) that classifies what she can and cannot compose freely:

REQUIRED (never fabricate — use request_information if missing):
- Financial figures, payment details, bank information, account numbers
- Client-specific data (addresses, contact details not in context)
- Legal terms, contract specifics, SLAs
- Specific pricing not in the pricing structure from Workflow Settings
- Delivery timelines or commitments not previously agreed
- Technical specifications or integration details

OPTIONAL (include if available, omit if not — don't ask):
- PO numbers, reference numbers
- Secondary contacts
- Additional context that would improve but isn't critical

GENERATABLE (compose freely):
- Professional greetings and closings
- Email structure and transitions
- Service descriptions based on the company's products/playbook
- Follow-up questions and calls to action
- Professional tone and formatting

Add this to the system prompt builder in lib/skyler/system-prompt.ts.


LAYER 3: PRE-GENERATION KNOWLEDGE CHECK (the big one)

Before Skyler drafts any content, a code-level check validates she has the data she needs. This is NOT an AI check. It's deterministic code.

1. Create lib/skyler/reasoning/knowledge-checker.ts

   Define task schemas — every task type lists what data it requires:

   const TASK_SCHEMAS = {
     draft_invoice: {
       required: [
         { field: "company_name", source: "pipeline_record", path: "company_name" },
         { field: "payment_methods", source: "agent_memories", key: "payment_methods" },
         { field: "pricing_agreed", source: "pipeline_record", path: "deal_amount" },
         { field: "service_details", source: "pipeline_record", path: "service_description" },
         { field: "billing_address", source: "agent_memories", key: "billing_address" }
       ],
       optional: [
         { field: "po_number", source: "agent_memories", key: "po_number" },
         { field: "billing_contact_email", source: "pipeline_record", path: "contact_email" }
       ]
     },
     draft_proposal: {
       required: [
         { field: "company_name", source: "pipeline_record", path: "company_name" },
         { field: "pricing_structure", source: "workflow_settings", path: "pricing_structure" },
         { field: "service_details", source: "pipeline_record", path: "service_description" }
       ],
       optional: [
         { field: "case_studies", source: "agent_memories", key: "case_studies" },
         { field: "competitor_context", source: "agent_memories", key: "competitor_info" }
       ]
     },
     draft_email: {
       required: [
         { field: "recipient_name", source: "pipeline_record", path: "lead_name" },
         { field: "recipient_email", source: "pipeline_record", path: "contact_email" }
       ],
       optional: []
       // Emails have minimal required fields — most content is generatable
     },
     draft_contract: {
       required: [
         { field: "company_name", source: "pipeline_record", path: "company_name" },
         { field: "legal_entity", source: "agent_memories", key: "legal_entity_name" },
         { field: "pricing_agreed", source: "pipeline_record", path: "deal_amount" },
         { field: "payment_terms", source: "agent_memories", key: "payment_terms" },
         { field: "service_scope", source: "pipeline_record", path: "service_description" }
       ],
       optional: [
         { field: "governing_law", source: "agent_memories", key: "governing_law" }
       ]
     }
   };

   The checkKnowledge() function:
   - Takes the task type and current context (pipeline record, workflow settings, agent memories)
   - Checks each required field against the available data
   - Returns: { isComplete: boolean, missingFields: string[], completenessScore: number }

   Completeness scoring:
   - 100%: All required fields present. Proceed.
   - 80-99%: Missing only optional fields. Proceed with a note.
   - Below 80%: Missing required fields. Return request_info instead of drafting.
   - ANY field marked as "critical" (payment, legal, financial) that is missing: ALWAYS request_info regardless of overall score.

2. Wire this into the reasoning pipeline (in the Inngest orchestration from Stage 6):
   
   BEFORE the reasoning step runs, add a new step:
   
   step.run('knowledge-check', async () => {
     // Detect the likely task type from the event + classification
     const taskType = inferTaskType(event, classification);
     if (taskType && TASK_SCHEMAS[taskType]) {
       const check = await checkKnowledge(taskType, context);
       if (!check.isComplete) {
         // Short-circuit: return request_info decision WITHOUT calling Claude
         return {
           action_type: 'request_info',
           parameters: {
             request_description: `I need the following to proceed: ${check.missingFields.join(', ')}`,
           },
           reasoning: `Missing required data for ${taskType}: ${check.missingFields.join(', ')}. Asking user rather than fabricating.`,
           confidence_score: 1.0,
           urgency: 'same_day',
         };
       }
     }
     return null; // No gaps, proceed to reasoning
   });

   If the knowledge check returns a decision, skip the reasoning step entirely and go straight to execution (which will create the request_info banner on the lead card). This saves a Sonnet API call AND prevents fabrication.

3. Make task schemas extensible. When we add new task types (proposals, contracts, reports), we just add a new entry to TASK_SCHEMAS. The checking logic stays the same.


LAYER 4: PERMANENT MEMORY (agent_memories table)

When the user provides missing information, store it permanently so Skyler never asks again.

1. Create the agent_memories table in Supabase:

   CREATE TABLE agent_memories (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id UUID NOT NULL REFERENCES workspaces(id),
     lead_id UUID REFERENCES pipeline records table (nullable — NULL means workspace-level fact),
     fact_key TEXT NOT NULL,
     fact_value JSONB NOT NULL,
     category TEXT NOT NULL, -- 'payment', 'company', 'legal', 'preference', 'contact', 'product'
     source TEXT NOT NULL, -- 'user_provided', 'onboarding', 'inferred', 'system'
     is_current BOOLEAN DEFAULT TRUE,
     superseded_by UUID REFERENCES agent_memories(id),
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX idx_agent_memories_workspace ON agent_memories(workspace_id, is_current) WHERE is_current = TRUE;
   CREATE INDEX idx_agent_memories_lead ON agent_memories(workspace_id, lead_id, is_current) WHERE is_current = TRUE;
   CREATE UNIQUE INDEX idx_agent_memories_unique_key ON agent_memories(workspace_id, COALESCE(lead_id, '00000000-0000-0000-0000-000000000000'), fact_key) WHERE is_current = TRUE;

2. Create lib/skyler/memory/agent-memory-store.ts with:
   
   - getMemories(workspaceId, leadId?): Returns all current facts for a workspace + optional lead overlay
   - setMemory(workspaceId, factKey, factValue, category, source, leadId?): Upserts a fact. If the key already exists, marks the old one as superseded and creates the new one.
   - deleteMemory(workspaceId, factKey, leadId?): Soft-deletes by setting is_current = false
   - getMemoryByKey(workspaceId, factKey, leadId?): Gets a specific fact

3. Wire memory into the context assembler (update lib/skyler/reasoning/context-assembler.ts):
   
   Before every reasoning call, load all current agent_memories for the workspace and lead:
   
   const memories = await getMemories(workspaceId, leadId);
   
   Format them in the system prompt as:
   
   ## What you know about this business
   {{formatted memories, grouped by category}}
   
   ## Critical rule
   NEVER ask for information that is already listed above.
   If you need information NOT listed above, use request_information.

4. When a user responds to a request_info (the existing request loop from Stage 8), extract the facts and store them:
   
   In the chat route handler, after detecting that the user's response fulfils a pending request:
   - Use GPT-4o-mini to extract key-value facts from the user's response
     Example: User says "We accept bank transfer to Barclays acc 12345678, sort 20-30-40, and PayPal to billing@company.com"
     Extracted: { payment_bank_name: "Barclays", payment_account_number: "12345678", payment_sort_code: "20-30-40", payment_paypal: "billing@company.com" }
   - Store each fact in agent_memories with source = 'user_provided'
   - The SAME information is now available for every future request without re-asking

5. Scope: workspace-level facts (payment details, company legal info, default terms) have lead_id = NULL and apply to all leads. Lead-level facts (specific pricing agreed with this lead, their preferred meeting times) have a lead_id and override workspace defaults for that lead.


LAYER 5: POST-GENERATION PLACEHOLDER SCAN

After ANY email or document is drafted, scan it for fabrication markers before it enters the approval queue.

1. Create lib/skyler/reasoning/output-validator.ts (or update the existing one from Stage 3):

   Add a scanForPlaceholders() function that checks for:
   - Square brackets with text: /\[.*?\]/g (like "[bank details here]")
   - Curly braces with text: /\{.*?\}/g (like "{insert address}")
   - Common placeholder phrases: "TBD", "to be confirmed", "will be provided", "details to follow", "PLACEHOLDER", "XXX", "INSERT", "your [anything] here"
   - Generic stand-in patterns: email addresses with example.com, phone numbers like 000-000-0000

   If ANY placeholder is found:
   - The draft does NOT go to the approval queue
   - Instead, convert it to a request_info action
   - Extract what's missing from the placeholder text
   - Surface a request banner: "I started drafting this but realised I'm missing: {extracted from placeholders}. Could you provide these details?"

2. Wire this into the guardrail engine (update lib/skyler/reasoning/guardrail-engine.ts):
   
   The existing check #7 scans for "phrases to never use." Add check #7.5 that scans for placeholders.
   If found, return 'request_info' instead of 'await_approval'.


TESTING:

Test each layer independently, then together:

1. Tool layer: Ask Skyler to draft an invoice for a lead where you haven't provided payment details. She should use request_information instead of drafting.

2. Pre-generation check: Manually trigger a draft_invoice task type with missing payment_methods in the knowledge checker. It should short-circuit before calling Claude.

3. Memory persistence: Provide payment details via chat. Check agent_memories table. Ask for another invoice for a different lead. Skyler should use the stored payment details without asking.

4. Memory update: Tell Skyler "Actually we changed our PayPal to new@email.com." Check that the old memory is superseded and the new one is current.

5. Placeholder scan: Manually craft a draft with "[bank details]" in it. The validator should catch it and convert to request_info.

6. Full flow: Ask Skyler to draft an invoice (no payment details in memory) → she asks → you provide → she stores in memory → she drafts correctly → you ask for another invoice → she uses stored details without asking.

Deploy and let me test the full flow.
```

**Done when:**
- Skyler asks for payment details BEFORE drafting an invoice (not after, not with placeholders)
- Payment details provided once are stored permanently in agent_memories
- Second invoice request uses stored details without re-asking
- Memory updates supersede old values correctly
- Placeholder scan catches any fabrication that slips through
- Task schemas are extensible (adding a new document type is just a new schema entry)
- The knowledge check short-circuits before calling Claude when data is missing (saves API cost)
- All five layers work together: prompt → tool → pre-check → memory → post-scan


Stage 11: Decision Memory & Learning System.

This is the most complex stage. It has 8 parts. Build them in order. Read fully before starting.

The research backing this is in the architecture doc's Decision Memory section and the full research report on production agent learning systems. The core insight: the WRITE CONTROLLER matters more than the retrieval engine. Default to NOT storing unless the signal is clearly valuable and durable.


PART A: REJECTION REASON CAPTURE (UI)

When a user clicks "Reject" on a pending action (email draft, stage update, etc.), don't just reject it silently. Capture why.

1. Update the Reject button flow in the lead card / approval queue UI:
   - User clicks Reject
   - A text input appears below the action: "Why are you rejecting this?" with placeholder text "e.g. tone was too pushy, wrong pricing, I'll handle this myself..."
   - A "Submit rejection" button to confirm
   - The text field is REQUIRED. User can't reject without giving a reason. But keep it low-friction: even "not right" is better than nothing.
   - If user types "I'll handle this myself" or similar, tag the rejection as "user_takeover" (not a quality issue, so Skyler shouldn't change her behaviour)

2. Store the rejection reason on the skyler_decisions audit record:
   - Add rejection_reason TEXT column to skyler_decisions (or the existing audit table)
   - Store the full text the user typed

3. Emit an Inngest event: skyler/decision.rejected with { decision_id, rejection_reason, lead_id, workspace_id }
   This feeds into the correction processing pipeline (Part C).


PART B: CHAT CORRECTION HANDLING

When a user corrects Skyler in chat, classify the correction and handle it appropriately.

1. Update the chat route to detect corrections. After every user message, run a GPT-4o-mini classification:

   "Classify this message as one of:
   - fact_correction: User is correcting a specific fact (wrong email, wrong pricing, updated info)
   - lead_directive: User is giving an instruction about a specific lead
   - behaviour_correction: User is giving feedback on HOW Skyler operates (tone, timing, approach, style)
   - general_message: Normal conversation, not a correction
   
   Also classify: is this correction SPECIFIC enough to act on, or VAGUE and needs clarification?
   Specific example: 'Never mention competitor X by name' — clear, actionable
   Vague example: 'That was too aggressive' — needs clarification (which part? this lead only or all leads?)"

   Return: { type, is_vague, correction_text }

2. Route by type:
   - fact_correction → agent_memories (Stage 10 already handles this)
   - lead_directive → skyler_directives (Stage 8 already handles this)
   - behaviour_correction → NEW: correction processing pipeline (Part C)
   - general_message → normal chat flow

3. If behaviour_correction AND is_vague = true:
   Skyler asks ONE clarifying question before storing. Examples:
   - "Got it, I'll adjust. Was that specific to this lead, or should I apply it to all my communications?"
   - "Understood. Was it the overall tone that felt off, or a specific part of the message?"
   - "I hear you. Should I be softer in general, or just when discussing pricing?"
   
   Store the user's clarification alongside the original correction. This gives the memory system much richer data.

4. Emit an Inngest event: skyler/correction.received with { correction_type, correction_text, clarification_text, lead_id, workspace_id, context_snapshot }


PART C: CORRECTION PROCESSING PIPELINE (Inngest background job)

This processes corrections from BOTH Part A (rejections) and Part B (chat corrections).

1. Create inngest/functions/process-correction.ts triggered by:
   - skyler/decision.rejected
   - skyler/correction.received

2. Step 1: Classify the correction type (GPT-4o-mini)

   Nine correction types:
   - factual: Wrong data ("the price is $3000 not $2000")
   - tone: Voice/warmth issue ("too pushy", "too formal")
   - style: Format/structure issue ("use bullet points", "keep it shorter")
   - timing: Follow-up timing ("too early", "should have waited")
   - strategy: Approach issue ("wrong angle for this lead type")
   - omission: Missing content ("you forgot to mention the free trial")
   - over_action: Shouldn't have acted ("don't email them yet")
   - priority: Focus issue ("focus on this lead, not that one")
   - user_takeover: User wants to handle it themselves (NOT a quality correction)

   For user_takeover: log it but do NOT store as a learning correction. Skyler wasn't wrong, the user just prefers to handle it.

3. Step 2: Extract scope (GPT-4o-mini)

   Determine if this correction applies to:
   - lead_specific: Just this one lead
   - segment: Leads matching certain criteria (enterprise, healthcare, etc.)
   - workspace: All leads for this workspace
   - global: Universal rule

   Input: correction text, lead attributes (company size, industry, deal stage), existing rules at each scope level.
   Default to lead_specific when uncertain (conservative, safe).

4. Step 3: Conflict check
   
   Before storing, search existing corrections for conflicts:
   - Query agent_corrections WHERE workspace_id = X AND correction_type = same type AND scope overlaps
   - Compute embedding similarity against the new correction
   - If similarity > 0.85 AND direction conflicts (e.g. "be more aggressive" vs "be softer" for same scope):
     - If different contexts (cold outreach vs existing customer): store both with context metadata
     - If same context within 7 days: surface to user: "You recently asked me to [X], but now you're saying [Y]. Which should I follow, or does it depend on the situation?"
     - If same context but >7 days apart: most recent wins, supersede the old one

5. Step 4: Store the correction

   Create a corrections table:

   CREATE TABLE agent_corrections (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id UUID NOT NULL REFERENCES workspaces(id),
     lead_id UUID REFERENCES pipeline table (nullable),
     correction_type TEXT NOT NULL,
     scope TEXT NOT NULL DEFAULT 'lead_specific',
     original_action JSONB,
     correction_text TEXT NOT NULL,
     clarification_text TEXT,
     derived_rule TEXT,
     context_embedding vector(1536),
     context_metadata JSONB,
     source TEXT NOT NULL,
     source_decision_id UUID,
     confidence FLOAT DEFAULT 1.0,
     is_active BOOLEAN DEFAULT TRUE,
     superseded_by UUID REFERENCES agent_corrections(id),
     access_count INTEGER DEFAULT 0,
     last_accessed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     expires_at TIMESTAMPTZ
   );

   CREATE INDEX idx_corrections_workspace ON agent_corrections(workspace_id, is_active) WHERE is_active = TRUE;
   CREATE INDEX idx_corrections_embedding ON agent_corrections USING hnsw (context_embedding vector_cosine_ops);

6. Step 5: Derive a rule (GPT-4o-mini)

   From the correction, extract a clear, actionable rule:
   - Correction: "That email was too pushy, especially the CTA"
   - Derived rule: "Use softer CTAs. Instead of 'Book a call now', try 'Happy to chat if you're interested'"
   
   Store the derived_rule on the correction record. This is what gets injected into future prompts.

7. Step 6: Update behavioural dimensions (Part E)

   If the correction is a tone/style type, update the dimensional scores.


PART D: POSITIVE SIGNAL CAPTURE (Golden Examples)

Learn from success, not just failure.

1. Create a golden_examples table:

   CREATE TABLE golden_examples (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id UUID NOT NULL REFERENCES workspaces(id),
     lead_id UUID,
     decision_id UUID REFERENCES skyler_decisions(id),
     task_type TEXT NOT NULL,
     input_context JSONB NOT NULL,
     agent_output JSONB NOT NULL,
     composite_score FLOAT DEFAULT 0.0,
     approval_speed_seconds INTEGER,
     edit_distance FLOAT,
     outcome_score FLOAT,
     context_embedding vector(1536),
     is_active BOOLEAN DEFAULT TRUE,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     last_used_at TIMESTAMPTZ,
     use_count INTEGER DEFAULT 0
   );

   CREATE INDEX idx_golden_workspace ON golden_examples(workspace_id, is_active, task_type) WHERE is_active = TRUE;
   CREATE INDEX idx_golden_embedding ON golden_examples USING hnsw (context_embedding vector_cosine_ops);

2. When a decision is APPROVED:

   In the approval handler (when user clicks Approve):
   - Record time_to_approve (time between decision creation and approval)
   - If the user edited the draft before approving, compute edit_distance (normalised Levenshtein distance between original and sent version)
   - Create a golden_examples record with:
     - input_context: the full context snapshot from the decision
     - agent_output: the approved action
     - approval_speed_seconds: time to approve
     - edit_distance: 0.0 if no edits, higher if edited
     - composite_score: calculated below

3. Composite quality score:

   score = 0.40 * approval_score      // approved=1.0, approved-with-edits=0.5, rejected=-1.0
         + 0.25 * (1.0 - edit_distance) // less editing = better
         + 0.20 * time_score            // <30s=1.0, 30-120s=0.5, >120s=0.3
         + 0.15 * 0.0                   // outcome_score starts at 0, updated later by Part G

4. At decision time, retrieve the top 3-5 golden examples for similar situations:

   Update the context assembler to:
   - Embed the current situation
   - Query golden_examples WHERE workspace_id = X AND task_type = relevant type AND is_active = TRUE
   - Order by composite similarity: 0.6 * cosine_similarity + 0.4 * composite_score
   - Inject into the prompt as: "Here are examples of similar decisions that were approved and successful: [examples]"

5. Budget: golden examples should add no more than ~1000 tokens to the prompt. Select 3 examples max. Truncate context if needed, keeping the action and outcome.


PART E: BEHAVIOURAL DIMENSION TRACKING

Track 6 dimensions of Skyler's communication style. Prevents contradictory corrections from causing style drift.

1. Create a behavioural_dimensions table:

   CREATE TABLE behavioural_dimensions (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id UUID NOT NULL REFERENCES workspaces(id),
     dimension TEXT NOT NULL,
     score FLOAT NOT NULL DEFAULT 0.0,
     context_scope TEXT DEFAULT 'global',
     context_criteria JSONB,
     updated_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(workspace_id, dimension, context_scope, context_criteria)
   );

2. Six dimensions, each -1.0 to +1.0:

   warmth: cold (-1) ↔ warm (+1)
   formality: casual (-1) ↔ formal (+1)
   assertiveness: passive (-1) ↔ aggressive (+1)
   verbosity: concise (-1) ↔ detailed (+1)
   urgency: patient (-1) ↔ pushy (+1)
   personalization: generic (-1) ↔ highly personal (+1)

3. When a tone/style correction arrives (from Part C Step 6):
   - Use GPT-4o-mini to classify which dimension(s) it affects and in which direction
   - Shift the score by 0.1 in that direction (small increments, not jumps)
   - Cap at -1.0 and +1.0
   - Store the context_scope (global, or specific to a lead segment)

4. Inject current dimensions into the system prompt:
   "Your current communication style: warmth=0.3 (slightly warm), formality=0.5 (professional), assertiveness=-0.2 (slightly softer than default), verbosity=0.0 (balanced), urgency=-0.1 (patient), personalization=0.4 (personalised)"

5. Contradiction detection:
   When a new correction would shift a dimension in the OPPOSITE direction from a recent correction (within 7 days) at the same scope:
   - Check if the contexts are different (different lead types, stages, etc.)
   - If different contexts: create separate scoped dimension scores (one for enterprise, one for SME)
   - If same context: ask user for clarification before adjusting


PART F: CONFIDENCE CALIBRATION (Dynamic Autonomy)

Skyler's confidence per task type adjusts based on actual track record.

1. Create a confidence_tracking table:

   CREATE TABLE confidence_tracking (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     workspace_id UUID NOT NULL REFERENCES workspaces(id),
     task_type TEXT NOT NULL,
     alpha FLOAT DEFAULT 1.0,
     beta FLOAT DEFAULT 1.0,
     ewma FLOAT DEFAULT 0.5,
     total_decisions INTEGER DEFAULT 0,
     autonomy_level TEXT DEFAULT 'blocked',
     last_updated_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(workspace_id, task_type)
   );

2. Task types to track:
   - initial_outreach
   - follow_up_email
   - objection_handling
   - meeting_followup
   - stage_update
   - lead_qualification

3. On every decision outcome:
   - Approved: alpha += 1, ewma = 0.15 * 1.0 + 0.85 * ewma
   - Rejected: beta += 1, ewma = 0.15 * 0.0 + 0.85 * ewma
   - Approved with heavy edits (edit_distance > 0.3): alpha += 0.3, beta += 0.7 (partial rejection)

4. Autonomy levels derived from track record:
   - autonomous: ewma >= 0.85 AND total_decisions >= 20
   - review: 0.60 <= ewma < 0.85 OR total_decisions < 20
   - blocked: ewma < 0.60

5. Feed into the guardrail engine:
   Update the guardrail engine to check confidence_tracking BEFORE the static confidence threshold.
   If the task type has earned 'autonomous' level through track record, allow auto-execute even if the static confidence score is 0.7.
   If the task type is 'blocked' due to poor track record, always require approval regardless of the AI's confidence score.
   The user's Workflow Settings toggles still override everything (if user says "no autonomy for objection handling", track record doesn't matter).

6. Weekly Inngest cron job: evaluate autonomy levels
   - Promote: ewma > 0.90 for 30+ decisions with 14-day cooling period at current level
   - Demote: ewma drops below 0.70 in trailing 7 days
   - Notify user on any level change: "Skyler's follow-up emails have been approved 92% of the time over the last 30 decisions. Promoting to autonomous."


PART G: IMPLICIT SIGNAL EXTRACTION

Learn from signals beyond explicit feedback.

1. Edit distance tracking:
   When user approves but edits the draft before sending:
   - Compute normalised Levenshtein distance between Skyler's draft and the final sent version
   - If edit_distance > 0.15: use GPT-4o-mini to extract WHAT changed (tone? facts? structure? CTA?)
   - Store the extracted changes as implicit corrections in agent_corrections with source = 'implicit_edit'
   - Update the golden example's composite_score

2. Time-to-approve tracking:
   Already captured in Part D. Used in composite scoring.
   - <5 seconds: trusted (score 1.0)
   - 5-30 seconds: reviewed (score 0.8)
   - 30-120 seconds: deliberated (score 0.5)
   - >120 seconds: uncertain (score 0.3)

3. Outcome tracking (Inngest cron, runs every 6 hours):
   Create inngest/functions/track-decision-outcomes.ts
   
   For each decision executed in the last 72 hours:
   - Check CRM: did the lead reply? Did the deal progress to next stage? Did a meeting get booked?
   - At 24h: check for email replies
   - At 48h: check for stage progression
   - At 72h: final outcome check
   
   Update the golden_example outcome_score:
   - Lead replied positively: +1.5
   - Lead replied neutrally: +0.5
   - Meeting booked: +2.0
   - Deal progressed: +1.5
   - No response: 0.0 (not negative, absence of signal)
   - Lead replied negatively / opted out: -1.0
   
   Recalculate the composite_score with the outcome weight now populated.


PART H: MEMORY LIFECYCLE MANAGEMENT

Prevent memory bloat, decay stale memories, and protect against poisoning.

1. Memory decay scoring:
   Every memory/correction has a retrieval score that decays over time:
   
   retrieval_score = 0.5 * cosine_similarity(query, memory)
                   + 0.3 * (0.995 ^ hours_since_last_access)
                   + 0.1 * confidence
                   + 0.1 * min(access_count / 20, 1.0)

   When a memory is retrieved and used, update last_accessed_at and access_count.
   Memories that keep being useful strengthen. Memories that are never retrieved fade.

2. Write controller (CRITICAL):
   Before storing ANY new memory or correction, check:
   - Does a similar memory already exist? (similarity > 0.85)
     - If yes, UPDATE the existing one (merge, don't duplicate)
   - Is this correction durable or temporary?
     - "Too pushy in this specific email" = temporary, set expires_at = 30 days
     - "Always use formal tone with enterprise leads" = durable, no expiry
   - Default operation: NOOP (don't store) unless the signal is clearly valuable
   - Use GPT-4o-mini to classify: { operation: 'ADD' | 'UPDATE' | 'NOOP', reason: string }

3. Source provenance and trust scoring:
   Every memory has a source field:
   - 'admin_user': highest trust (workspace admin provided it)
   - 'user_provided': high trust (authenticated user in chat)
   - 'rejection_reason': high trust (explicit feedback)
   - 'implicit_edit': medium trust (inferred from edits)
   - 'implicit_outcome': medium trust (inferred from CRM outcomes)
   - 'agent_inferred': lowest trust (Skyler's own conclusions)
   
   Only 'admin_user' and 'user_provided' sources can create workspace-level rules.
   'agent_inferred' memories require 3+ supporting instances before activation.
   NEVER store memories derived from lead email content or external sources (memory poisoning prevention).

4. Pruning jobs (Inngest cron):

   Daily:
   - Soft-expire: memories older than 90 days with access_count < 2 AND confidence < 0.5 → is_active = false
   - Contradiction resolution: find pairs with similarity > 0.90 and conflicting directions → merge or supersede

   Weekly:
   - Consolidation: use Claude to review all active corrections for a workspace, merge duplicates, rewrite contradictory rules into context-aware rules
   - Budget check: if active memories > 500 per workspace, prune lowest-scoring ones

   Monthly:
   - Hard delete: memories that have been inactive for 6+ months
   - Stale check: flag workspace-level rules that haven't been accessed in 60 days for user review

5. Memory budget:
   - Maximum ~1500 tokens of memory injected per reasoning call
   - Maximum 500 active memories per workspace
   - Maximum 50 golden examples per task type per workspace
   - Enforce via the write controller: when limits are approached, NOOP on lower-priority new entries


PART I: RETRIEVAL AT DECISION TIME

Wire everything into the context assembler so the reasoning layer benefits from all stored knowledge.

1. Update lib/skyler/reasoning/context-assembler.ts:

   Before every reasoning call, load (in parallel):
   - Agent memories (Stage 10, already done)
   - Relevant corrections: top 3-5 by retrieval_score for this context
   - Golden examples: top 3 by composite similarity for this task type
   - Behavioural dimensions: current scores for applicable scope
   - Confidence level: from confidence_tracking for this task type
   - User directives: for this lead (Stage 8, already done)

2. Format in the system prompt:

   ## What you've learned
   
   ### Communication style (current calibration)
   warmth=0.3, formality=0.5, assertiveness=-0.2, verbosity=0.0, urgency=-0.1, personalization=0.4
   
   ### Lessons from past corrections
   - [derived_rule from correction 1, with context]
   - [derived_rule from correction 2, with context]
   - [derived_rule from correction 3, with context]
   
   ### Examples of decisions that were approved and successful
   [golden example 1: situation → action → outcome]
   [golden example 2: situation → action → outcome]
   
   ### Your confidence for this task type
   [task_type] approval rate: 87% over 45 decisions. You've earned review-level autonomy.

3. Total budget for learning context: ~1500 tokens maximum. Prioritise:
   - Behavioural dimensions (always, ~100 tokens)
   - Active corrections relevant to this exact situation (~400 tokens)
   - Golden examples (~600 tokens)
   - Confidence context (~100 tokens)
   - Remaining budget to additional corrections (~300 tokens)


DATABASE MIGRATIONS:

Create a single migration with all new tables:
- agent_corrections (with embedding index)
- golden_examples (with embedding index)
- behavioural_dimensions
- confidence_tracking
- Add rejection_reason column to skyler_decisions
- Add edit_distance and approval_speed_seconds columns to skyler_decisions

INNGEST FUNCTIONS:

- process-correction.ts: Triggered by rejection and chat correction events
- track-decision-outcomes.ts: Cron every 6 hours, checks CRM outcomes
- evaluate-autonomy-levels.ts: Cron weekly, promotes/demotes task type confidence
- consolidate-memories.ts: Cron daily, prunes and consolidates
- extract-implicit-corrections.ts: Triggered when user edits a draft before sending


TESTING:

1. Rejection flow: Reject a draft, type a reason, verify it's stored and processed into a correction
2. Chat correction: Tell Skyler "that was too pushy" → she asks for clarification → you clarify → correction stored with derived rule
3. Approval learning: Approve 5 emails without editing → verify golden examples created with high composite scores
4. Edit detection: Approve but heavily edit a draft → verify edit distance computed and implicit correction extracted
5. Confidence calibration: Reject 5 objection-handling emails in a row → verify confidence for that task type drops and more go to approval queue
6. Contradiction: Say "be more aggressive" then "be softer" for same lead type → verify Skyler asks which you prefer
7. Memory decay: Create a correction, don't access it for a simulated period → verify its retrieval score drops
8. Golden example retrieval: Create golden examples → trigger a similar decision → verify examples appear in the reasoning context
9. Outcome tracking: Approve and send an email, then mark the lead as having replied → verify golden example score updated
10. Write controller: Submit 3 nearly identical corrections → verify only one is stored (the others get NOOP)

Deploy and let me test the rejection UI first, then the full learning loop.


# STAGE 12: Entity Resolution & Context Isolation

**Goal:** When a user tags a lead, Skyler always responds about THAT lead, regardless of what was discussed previously. Entity resolution happens in code before Claude sees the message. The active lead's context is injected in the highest-attention zone of the prompt. Conversation history is filtered to prevent cross-lead contamination.

---

## Why This Matters

User asked about Malik (Lead A), then tagged Doubra (Lead B) and said "draft a follow up for this lead." Skyler drafted for Malik instead of Doubra. This is called context anchoring: the LLM over-weights the entity it's been discussing and ignores the explicit switch signal. This will happen with every lead switch unless we fix it architecturally.

The fix is NOT prompt engineering. It's resolving the entity in code before Claude is called, reconstructing the prompt with the correct lead's data, and filtering out irrelevant conversation history.

---

## Prompt for CC:

```
Stage 12: Entity Resolution & Context Isolation.

This fixes the bug where Skyler drafted a follow-up for Malik when the user tagged Doubra. The root cause: entity resolution happens inside the LLM (unreliable) instead of in code (deterministic). Research confirms this is the #1 failure mode in multi-entity agent systems.

Four parts. Build in order.


PART A: DETERMINISTIC ENTITY RESOLUTION IN THE CHAT ROUTE

The tag system already exists (user can reference leads in chat). The problem is how the tagged entity gets resolved and prioritised.

1. Find where the chat route processes incoming messages with lead tags. Understand the current flow: how does a tag get parsed? Does it resolve to a lead ID? Where does that ID get used?

2. Implement an entity resolution function in the chat route that runs BEFORE any LLM call:

   lib/skyler/entity/entity-resolver.ts

   function resolveActiveEntity(message, conversationState, uiContext):
     
     Priority hierarchy (this order is absolute):
     
     Priority 1: Explicit tag in current message
       - If the user tagged a lead in this message, that lead is the active entity. Full stop.
       - Resolve the tag to a database ID (pipeline record ID)
       - This OVERRIDES everything else, including whatever was discussed before
     
     Priority 2: Named entity in current message (no tag)
       - User mentions "Doubra" or "DDF Limited" by name without tagging
       - Use GPT-4o-mini to extract entity names from the message
       - Match against pipeline records for this workspace
       - If exactly one match, use it. If ambiguous, ask the user.
     
     Priority 3: Conversation's current active entity
       - The lead that was most recently resolved in this conversation
       - Stored on the conversation/chat session
     
     Priority 4: Pronoun resolution
       - "this lead", "that contact", "them"
       - Defaults to the conversation's current active entity (Priority 3)
       - If no active entity exists, ask the user which lead they mean
     
     Returns: { entityId, entityType, entityName, confidence, source }
     
     If confidence is low (ambiguous name, multiple matches), Skyler should ask:
     "I see you mentioned [name]. Did you mean [Lead A at Company X] or [Lead B at Company Y]?"

3. Store the resolved entity on the conversation state:

   Update whatever table/field tracks the current chat session to include:
   - active_entity_id: UUID (the resolved lead's pipeline record ID)
   - active_entity_type: TEXT ('lead')
   - active_entity_name: TEXT
   
   Update this on EVERY message where an entity is resolved.

4. Store the resolved entity on each message for audit:
   
   Each message record should track which entity was active when it was sent.
   This enables entity-scoped history filtering (Part C).


PART B: ENTITY-GROUNDED PROMPT CONSTRUCTION

The active lead's data must be injected at the END of the system prompt, in the highest-attention zone.

1. Update the system prompt builder (lib/skyler/system-prompt.ts) to accept the resolved entity data and place it LAST:

   Current prompt order:
   [SKYLER CORE IDENTITY]
   [WORKFLOW SETTINGS]
   [WORKSPACE MEMORIES / AGENT MEMORIES]
   [USER DIRECTIVES]
   [ACTIVE SKILL]
   [CONVERSATION HISTORY]
   [TOOL DEFINITIONS]

   New prompt order:
   [SKYLER CORE IDENTITY]
   [WORKFLOW SETTINGS]
   [WORKSPACE MEMORIES / AGENT MEMORIES]
   [LEARNING CONTEXT (corrections, golden examples, dimensions)]
   [ACTIVE SKILL]
   [TOOL DEFINITIONS]
   [CONVERSATION HISTORY]                    <-- moved closer to end
   [ACTIVE ENTITY CONTEXT]                   <-- NEW, placed LAST for highest attention

   The ACTIVE ENTITY CONTEXT section should look like:

   <active_entity type="lead" id="{pipeline_record_id}">
     <name>{lead_name}</name>
     <company>{company_name}</company>
     <email>{contact_email}</email>
     <stage>{current_pipeline_stage}</stage>
     <emails_sent>{count}</emails_sent>
     <emails_replied>{count}</emails_replied>
     <last_activity>{date and description}</last_activity>
     <deal_value>{amount}</deal_value>
     <tags>{tags}</tags>
     <recent_conversation>
       {last 3-5 email exchanges with THIS lead specifically}
     </recent_conversation>
     <directives>
       {any user directives for THIS lead}
     </directives>
     <meeting_summary>
       {most recent meeting summary for THIS lead, if any}
     </meeting_summary>
   </active_entity>

   <active_entity_instruction>
   You are currently working with {lead_name} from {company_name}.
   ALL responses, drafts, analysis, and actions MUST be about {lead_name}.
   Do NOT reference or use information from other leads discussed earlier in this conversation.
   If the user asks about a different lead, acknowledge the switch before proceeding.
   </active_entity_instruction>

2. The active entity data is loaded from Supabase using the resolved entity ID from Part A:
   - Pipeline record (stage, emails, tags, deal value)
   - Recent conversation thread for THIS lead specifically
   - User directives for THIS lead
   - Meeting data for THIS lead
   - Agent memories scoped to THIS lead

3. CRITICAL: Load entity data FRESH on every message, not cached from a previous turn. The lead's status may have changed between messages.


PART C: ENTITY-SCOPED CONVERSATION HISTORY

When the active entity switches, filter the conversation history to prevent context bleed.

1. When building the conversation history for Claude, check if the entity changed from the previous message:

   If entity changed:
   - Include a transition marker: "[Context switch: now working with {new_lead_name} from {company}]"
   - Filter conversation history to only include turns where active_entity_id matches the current entity
   - If there are no previous turns about the new entity, that's fine. Skyler starts fresh with the entity's data from the prompt.
   - Include at most 1-2 turns from the previous entity for continuity, clearly marked:
     "[Previous context about {old_lead_name} - for reference only, do NOT target actions here]"

   If entity is the same:
   - Include full conversation history as normal (last N turns)

2. This requires each stored message to have the active_entity_id field (from Part A step 4).

3. The filtering happens in the chat route BEFORE calling Claude, not in Claude's reasoning.


PART D: POST-GENERATION ENTITY VALIDATION

After Claude generates a response, verify it's about the correct entity. This is the safety net.

1. Create lib/skyler/entity/entity-validator.ts

   function validateEntityGrounding(response, activeEntity, otherEntitiesInConversation):
   
   Check:
   - Does the response mention any OTHER entity's name or company that was discussed in this conversation?
   - Does a drafted email address the wrong person?
   - Does a tool call (CRM update, email draft) target the wrong entity ID?
   
   If contamination detected:
   - For tool calls: block the call and regenerate with a stronger entity instruction
   - For drafted content: flag it with a warning in the approval queue: "This draft may reference the wrong lead. Please review carefully."
   - Log the contamination for debugging

2. For tool calls specifically, constrain the entity_id parameter:
   
   When Skyler has tools that take a lead/pipeline ID as input (update_stage, draft_email, create_note), 
   set the entity_id parameter to ONLY accept the active entity's ID:
   
   Instead of letting Claude pick any entity_id, inject the active entity ID into the tool definition:
   
   tools: [{
     name: 'draft_email',
     input_schema: {
       properties: {
         pipeline_id: {
           type: 'string',
           const: activeEntityId,  // Constrained to ONLY the active entity
           description: 'The pipeline record to draft an email for (auto-set to current lead)'
         },
         email_content: { type: 'string' },
         email_subject: { type: 'string' }
       }
     }
   }]
   
   This makes it structurally impossible for Claude to target the wrong entity in tool calls.

3. Wire this into the existing flow:
   - After Claude generates a response in the chat route, run the validator
   - After the reasoning layer outputs a decision in the Inngest pipeline, validate the target entity


PART E: ENTITY FOCUS TRACKING (for pronoun resolution)

Track which entities have been discussed in a conversation so pronouns and references can be resolved correctly.

1. Maintain an entity focus stack on the conversation state:

   entity_focus_stack: [
     { entity_id: "xyz", entity_name: "Doubra", entered_turn: 5, reason: "explicit_tag" },
     { entity_id: "abc", entity_name: "Malik", entered_turn: 1, reason: "explicit_tag" },
   ]

   Most recent entity is at the top (index 0).

2. When "this lead" or "that contact" appears without a tag:
   - Resolve to the top of the focus stack (most recently discussed entity)
   
3. When "the previous lead" or "go back to Malik" appears:
   - Pop the stack or search by name
   
4. Store as JSONB on the conversation record. Update on every entity resolution.

5. This is the LOWEST priority signal. It only matters when there's no explicit tag, no named entity, and no UI context.


DATABASE CHANGES:

Add to the existing conversation/chat state table:
- active_entity_id UUID
- active_entity_type TEXT  
- active_entity_name TEXT
- entity_focus_stack JSONB DEFAULT '[]'

Add to the messages table (or whatever stores individual chat messages):
- active_entity_id UUID (which entity was active when this message was sent)

No new tables needed. This is metadata on existing tables.


TESTING:

1. Tag switch: Ask about Malik, then tag Doubra and say "draft a follow up for this lead." Verify the follow-up is about Doubra, not Malik.

2. Name mention: Ask about Malik, then say "What's happening with Doubra?" (no tag, just name). Verify Skyler switches to Doubra.

3. Pronoun resolution: Tag Doubra, discuss her deal, then say "send her a follow up." Verify "her" resolves to Doubra.

4. Context isolation: Discuss Malik's pricing ($2000 deal), switch to Doubra. Verify Doubra's follow-up doesn't mention Malik's pricing or Malik's company details.

5. Contamination detection: Force a response that mentions the wrong lead's name. Verify the validator catches it.

6. Tool call constraint: Trigger a CRM update while entity is Doubra. Verify the pipeline_id in the tool call is Doubra's, not Malik's.

7. Ambiguous name: If two leads share a name, verify Skyler asks for clarification instead of guessing.

8. No entity context: Start a fresh conversation with no tags. Say "draft a follow up." Verify Skyler asks which lead you mean.

9. Rapid switching: Tag Lead A, ask a question. Tag Lead B, ask a question. Tag Lead A again. Verify each response is correctly scoped.

10. History filtering: Switch from Lead A to Lead B. Verify the conversation history sent to Claude is filtered to Lead B turns only.

Deploy and let me test the tag switch scenario first.
```

**Done when:**
- Tagged lead ALWAYS overrides previous conversation context
- Entity resolution happens in code before Claude is called
- Active lead's data appears at the END of the system prompt
- Conversation history is filtered when entity switches
- Post-generation validator catches cross-entity contamination
- Tool calls are constrained to only target the active entity
- Pronouns resolve to the most recently discussed entity
- Ambiguous references trigger a clarification question
- Entity focus stack tracks all entities discussed in the conversation
- Rapid entity switching works correctly across 3+ leads





# STAGE 13: Meeting Lifecycle System

**Goal:** Skyler handles the entire meeting lifecycle across Google Calendar, Outlook/Teams, and Calendly through a single unified architecture. She checks real availability, suggests optimal times, creates calendar invites with video links, detects no-shows, tracks reschedule patterns, generates pre-call briefs, and adapts to whatever calendar platform the user has connected.

---

## Architecture Overview

Three layers, each handling what it's best at:

- **Recall AI Calendar V2** = the READ layer. Monitors Google and Outlook events, fires webhooks on changes, provides normalised event data. Already partially built in Stage 8.5.
- **Direct APIs (Google Calendar API + Microsoft Graph)** = the WRITE layer. Creates events, checks availability, generates Meet/Teams video links. These are free APIs.
- **Calendly webhooks** = the INBOUND layer. Receives booking, cancellation, reschedule, and no-show signals from Calendly.

All three feed into a unified `calendar_events` table in Supabase. The reasoning engine doesn't care which platform the data came from.

---

## Prompt for CC:

```
Stage 13: Meeting Lifecycle System.

This is the largest feature stage. It has 10 parts across Calendly, Google Calendar, Outlook/Teams, meeting booking, and cross-platform intelligence. Build in order.

Read the full research doc before starting. The architecture is: Recall AI Calendar V2 for reads, direct Google/Microsoft APIs for writes, Calendly webhooks for inbound bookings, all normalised into a unified Supabase schema.


PART A: UNIFIED DATABASE SCHEMA

Create a migration with these tables:

1. calendar_connections — tracks which calendar platform each user has connected:
   - id UUID PRIMARY KEY
   - workspace_id UUID NOT NULL REFERENCES workspaces
   - user_id UUID NOT NULL
   - provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'microsoft_outlook', 'calendly'))
   - provider_email TEXT
   - recall_calendar_id TEXT (for Google/Outlook, from Recall Calendar V2)
   - access_token_encrypted TEXT
   - refresh_token_encrypted TEXT
   - token_expires_at TIMESTAMPTZ
   - oauth_status TEXT DEFAULT 'connected'
   - work_hours_start TIME DEFAULT '09:00'
   - work_hours_end TIME DEFAULT '17:00'
   - work_days JSONB DEFAULT '[1,2,3,4,5]' (Monday=1 through Friday=5)
   - timezone TEXT DEFAULT 'UTC'
   - calendly_event_types JSONB (cached list of their Calendly event types with URLs)
   - metadata JSONB DEFAULT '{}'
   - created_at TIMESTAMPTZ DEFAULT now()
   - updated_at TIMESTAMPTZ DEFAULT now()

2. calendar_events — normalised events from ALL platforms:
   - id UUID PRIMARY KEY
   - calendar_connection_id UUID REFERENCES calendar_connections
   - workspace_id UUID NOT NULL
   - provider TEXT NOT NULL
   - provider_event_id TEXT NOT NULL
   - ical_uid TEXT
   - title TEXT
   - description TEXT
   - start_time TIMESTAMPTZ NOT NULL
   - end_time TIMESTAMPTZ NOT NULL
   - timezone TEXT
   - location TEXT
   - meeting_url TEXT
   - meeting_provider TEXT (zoom, google_meet, teams, webex)
   - organizer_email TEXT
   - organizer_name TEXT
   - attendees JSONB DEFAULT '[]' (array of {email, name, response_status, role})
   - status TEXT DEFAULT 'confirmed' (confirmed, cancelled, tentative)
   - event_type TEXT (intro, demo, deep_dive, negotiation, check_in — classified by GPT-4o-mini)
   - lead_id UUID (matched against pipeline records via attendee email)
   - recall_bot_id TEXT
   - recall_bot_status TEXT
   - no_show_detected BOOLEAN DEFAULT false
   - reschedule_count INTEGER DEFAULT 0
   - previous_event_id UUID REFERENCES calendar_events (links reschedule chain)
   - calendly_invitee_uri TEXT (for Calendly-specific API calls)
   - form_answers JSONB (Calendly pre-meeting form responses)
   - pre_call_brief_sent BOOLEAN DEFAULT false
   - raw_data JSONB (full platform-specific payload for debugging)
   - created_at TIMESTAMPTZ DEFAULT now()
   - updated_at TIMESTAMPTZ DEFAULT now()
   - UNIQUE(calendar_connection_id, provider_event_id)

3. meeting_health_signals — pattern detection alerts:
   - id UUID PRIMARY KEY
   - workspace_id UUID NOT NULL
   - lead_id UUID REFERENCES pipeline records table
   - signal_type TEXT NOT NULL (no_show, reschedule, decline, new_attendee, fatigue, duration_drop)
   - severity TEXT DEFAULT 'info' (info, warning, critical)
   - event_id UUID REFERENCES calendar_events
   - details JSONB
   - acknowledged BOOLEAN DEFAULT false
   - created_at TIMESTAMPTZ DEFAULT now()

Also add to the existing TASK_SCHEMAS in knowledge-checker.ts:

   book_meeting: {
     required: [
       { field: "lead_email", source: "pipeline_record", path: "contact_email" },
       { field: "available_times", source: "calendar_connection OR user_provided" },
       { field: "meeting_duration", source: "workflow_settings", path: "default_meeting_duration" }
     ],
     optional: [
       { field: "meeting_type", source: "pipeline_stage" },
       { field: "calendly_link", source: "calendar_connections" }
     ]
   }

When "available_times" is missing (no calendar connected AND no times in agent_memories), the knowledge checker triggers request_info asking the user to either connect a calendar or provide available times.


PART B: CALENDLY INTEGRATION

1. Create lib/skyler/calendar/calendly-client.ts — Calendly API v2 wrapper:

   - listEventTypes(userUri): GET /event_types — returns all event types with name, slug, duration, scheduling_url
   - getScheduledEvent(eventUri): GET /scheduled_events/{uuid} — returns event details including location.join_url (the video meeting link)
   - getInvitee(inviteeUri): GET /invitees/{uuid} — returns invitee details with questions_and_answers
   - markNoShow(inviteeUri): POST /invitee_no_shows — marks an invitee as no-show
   - createWebhookSubscription(url, events, scope): POST /webhook_subscriptions
   - listSchedulingLinks(eventTypeUri): POST /scheduling_links — creates single-use booking links

   Auth: OAuth 2.0 with PKCE. Store tokens in calendar_connections.
   Rate limit: ~500 requests/minute per token.
   Calendly requires Standard plan ($10/seat/month) for webhooks.

2. Create webhook handler: app/api/webhooks/calendly/route.ts

   Handle three events:

   a) invitee.created (meeting booked):
      - Extract invitee email, name, timezone, questions_and_answers
      - Follow-up GET to /scheduled_events/{uuid} to get the meeting URL (NOT in the webhook payload)
      - Match invitee email against pipeline records to find the lead
      - Create/update calendar_events record with normalised data
      - Store form_answers from questions_and_answers
      - Classify meeting type using GPT-4o-mini based on event type name + pipeline stage
      - If Recall AI auto-join is enabled and meeting has a video URL, schedule Recall bot
      - Update pipeline stage based on event type mapping (configurable per workspace)
      - Emit Inngest event: skyler/meeting.booked
      - Schedule no-show check: emit delayed event for 15 minutes after meeting end_time

   b) invitee.canceled:
      - Check rescheduled field:
        - If rescheduled = true: this is a reschedule, not a true cancellation
          - Increment reschedule_count on the new event
          - Link previous_event_id
          - If reschedule_count >= 2: create meeting_health_signal (warning: cooling interest)
          - If reschedule_count >= 3: create meeting_health_signal (critical)
        - If rescheduled = false: true cancellation
          - Extract cancellation.canceler_type (host or invitee) and cancellation.reason
          - Update calendar_events status to 'cancelled'
          - Cancel any scheduled Recall bot
          - Emit Inngest event: skyler/meeting.cancelled with cancellation details
          - Reasoning engine drafts rebooking email based on context

   c) routing_form_submission.created:
      - Process routing form data for lead enrichment

3. Create a Calendly event type to pipeline stage mapping:
   Store in Supabase as workspace-level config (or in Workflow Settings):
   
   {
     "15-min-intro": "discovery",
     "30-min-demo": "demo_scheduled",
     "technical-deep-dive": "technical_eval",
     "closing-call": "negotiation"
   }

   When Skyler needs to share a Calendly link, she picks the event type that matches the lead's current stage.

4. No-show detection for Calendly:
   Calendly has NO automatic no-show detection. Create an Inngest function:
   
   Triggered by: skyler/meeting.no-show-check (scheduled 15 minutes after meeting end_time)
   
   Logic:
   - Check: was the event cancelled? If yes, skip.
   - Check: was the event rescheduled? If yes, skip.
   - Check: does a Recall transcript exist for this meeting URL? If yes, skip (meeting happened).
   - If all checks fail: it's a no-show.
     - Mark no_show_detected = true on calendar_events
     - Call Calendly API: POST /invitee_no_shows
     - Create meeting_health_signal (warning)
     - Emit skyler/meeting.no-show event
     - Reasoning engine drafts "we missed you" email with a new booking link (single-use scheduling link via Calendly API)


PART C: GOOGLE CALENDAR WRITE OPERATIONS

Recall Calendar V2 handles reading Google Calendar events (already built in Stage 8.5). This part adds WRITE capabilities.

1. Create lib/skyler/calendar/google-calendar-client.ts:

   - checkAvailability(connection, startDate, endDate):
     POST https://www.googleapis.com/calendar/v3/freeBusy
     Body: { timeMin, timeMax, items: [{ id: 'primary' }] }
     Returns busy blocks. Invert against work hours to get free slots.
     Scope required: calendar.freebusy (non-sensitive, no verification needed)

   - createEventWithMeet(connection, eventData):
     POST https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all
     Body: {
       summary: "Meeting with {lead_name}",
       start: { dateTime, timeZone },
       end: { dateTime, timeZone },
       attendees: [{ email: leadEmail }, ...additionalAttendees],
       conferenceData: {
         createRequest: {
           requestId: uuid(),
           conferenceSolutionKey: { type: "hangoutsMeet" }
         }
       }
     }
     CRITICAL: conferenceDataVersion=1 query param is MANDATORY. Without it, no Meet link is created.
     Scope required: calendar.events

   - updateEventAttendees(connection, eventId, attendees):
     PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}?sendUpdates=all
     Body: { attendees: [...existingAttendees, ...newAttendees] }
     Used when prospect says "also invite sarah@company.com"

   - getUserTimezone(connection):
     GET https://www.googleapis.com/calendar/v3/users/me/settings/timezone
     Returns the user's calendar timezone setting.

   Token refresh: Google access tokens expire in 1 hour. Implement refresh middleware that checks token_expires_at before every API call and refreshes if within 60 seconds of expiry.

   CRITICAL GOTCHA: Google's unverified OAuth apps have refresh tokens that expire in 7 DAYS. You must complete Google's OAuth verification process (requires a video demo, takes weeks) before production. Start this process immediately.

   Rate limits: managed per-project in Google Cloud Console. events.patch costs 3 quota units. FreeBusy is lightweight. No per-call charges.


PART D: MICROSOFT OUTLOOK/TEAMS WRITE OPERATIONS

Recall Calendar V2 handles reading Outlook events (already working via Nango + Stage 8.5). This adds WRITE capabilities.

1. Create lib/skyler/calendar/microsoft-graph-client.ts:

   - checkAvailability(connection, startDate, endDate):
     POST https://graph.microsoft.com/v1.0/me/calendar/getSchedule
     Body: {
       schedules: [userEmail],
       startTime: { dateTime, timeZone },
       endTime: { dateTime, timeZone },
       availabilityViewInterval: 30
     }
     Returns scheduleItems (busy blocks) AND workingHours (start, end, daysOfWeek, timeZone).
     This is BETTER than Google because it gives you real work hours from the user's Outlook settings.
     Scope required: Calendars.ReadWrite (delegated)

   - createEventWithTeams(connection, eventData):
     POST https://graph.microsoft.com/v1.0/me/events
     Body: {
       subject: "Meeting with {lead_name}",
       start: { dateTime, timeZone },
       end: { dateTime, timeZone },
       attendees: [{ emailAddress: { address, name }, type: "required" }],
       isOnlineMeeting: true,
       onlineMeetingProvider: "teamsForBusiness"
     }
     Returns event with onlineMeeting.joinUrl containing the Teams link.
     CRITICAL: once isOnlineMeeting is set to true, it CANNOT be changed back to false.
     Scope required: Calendars.ReadWrite + OnlineMeetings.ReadWrite

   - updateEventAttendees(connection, eventId, attendees):
     PATCH https://graph.microsoft.com/v1.0/me/events/{eventId}
     Body: { attendees: [...updated attendees array] }

   - getWorkingHours(connection):
     GET https://graph.microsoft.com/v1.0/me/mailboxSettings/workingHours
     Returns daysOfWeek, startTime, endTime, timeZone.
     Use this to populate work_hours on calendar_connections automatically.

   Rate limits: 10,000 requests per 10-minute window per app per mailbox. Teams meeting creation: 4 req/sec per tenant, 2,000 meetings per user per month.

   Subscription renewal: Outlook calendar change notification subscriptions expire in ~2.94 days. Create an Inngest cron function that runs every 2 days to renew all active subscriptions.


PART E: UNIFIED CALENDAR SERVICE (abstraction layer)

Create lib/skyler/calendar/calendar-service.ts that abstracts provider differences:

   The reasoning engine and all Inngest functions call this service, never the provider-specific clients directly.

   - getCalendarConnection(workspaceId): Returns the user's connected calendar (Google, Outlook, or Calendly, or null)
   
   - getAvailableSlots(workspaceId, startDate, endDate, durationMinutes):
     1. Get the calendar connection
     2. If Google: call freeBusy, invert against stored work hours
     3. If Outlook: call getSchedule, use returned workingHours
     4. If Calendly only: return null (Calendly handles its own availability)
     5. If no connection: return null (triggers knowledge gap → request_info)
     6. Returns: array of { start, end, score } slots

   - scoreTimeSlots(slots, prospectTimezone):
     Score each slot:
     - Tuesday through Thursday: +20
     - 10am-2pm in prospect's timezone: +15
     - Monday morning / Friday afternoon: -30
     - 30+ minute buffer from adjacent meetings: +10
     - 5+ meetings already on that day: -20
     - Within prospect's business hours: +15
     Return top 3 across different days.

   - createMeetingEvent(workspaceId, eventData):
     1. Get the calendar connection
     2. If Google: createEventWithMeet
     3. If Outlook: createEventWithTeams
     4. If neither: return error (shouldn't reach here, knowledge checker prevents it)
     5. Store in calendar_events table
     6. Schedule Recall bot if auto-join is enabled
     7. Return the event with meeting URL

   - addAttendeesToEvent(workspaceId, eventId, newAttendees):
     1. Load the calendar_events record
     2. Call the appropriate provider's update endpoint
     3. Update the attendees array in Supabase
     4. For each new attendee: check if they're in the pipeline. If not, trigger attendee enrichment.

   - getBookingMethod(workspaceId):
     Returns the preferred booking method based on what's connected and Workflow Settings:
     - If Calendly connected + "Book demos using: Calendly link" in settings → 'calendly_link'
     - If Google/Outlook connected + "Book demos using: Suggest 2-3 times" → 'suggest_times'
     - If Google/Outlook connected + "Book demos using: Direct calendar invite" → 'direct_invite'
     - If nothing connected → 'ask_availability' (triggers knowledge gap flow)


PART F: MEETING BOOKING FLOW (Inngest orchestration)

This is the full flow when Skyler needs to book a meeting with a lead.

Create inngest/functions/book-meeting-flow.ts:

   Triggered by: skyler/meeting.book-requested (from the reasoning engine when it decides to schedule a meeting)

   Step 1: Determine booking method
   - Call getBookingMethod(workspaceId)

   Step 2a: If 'calendly_link':
   - Get the appropriate Calendly event type based on pipeline stage
   - Optionally create a single-use scheduling link via Calendly API
   - Return the link to be included in the outreach email

   Step 2b: If 'suggest_times':
   - Call getAvailableSlots() for the next 5 business days
   - Score slots with prospect's timezone
   - Return top 3 suggestions formatted as: "Tuesday, March 19 at 10:00 AM / Wednesday, March 20 at 2:00 PM / Thursday, March 21 at 11:00 AM"
   - Draft email with suggestions via the reasoning engine
   - Queue for approval
   - On approval, send email
   - step.waitForEvent('skyler/meeting.time-confirmed', { timeout: '48h' })
   - If confirmed: create calendar event with video link via createMeetingEvent()
   - If timeout: draft follow-up email with fresh time suggestions

   Step 2c: If 'direct_invite':
   - Call getAvailableSlots(), pick the single best slot
   - Create the calendar event directly with video link
   - Send the invite (with approval)
   - This is the most aggressive approach: lead gets a calendar invite without choosing a time

   Step 2d: If 'ask_availability' (no calendar connected):
   - FIRST TIME: surface request_info banner asking user to connect a calendar
   - If user says they can't connect: ask for available times
   - Store "user prefers manual availability" in agent_memories
   - SUBSEQUENT TIMES: skip calendar prompt, ask directly for available times
   - step.waitForEvent('skyler/user-response', { timeout: '24h' })
   - When user provides times, draft email with those specific times
   - When prospect confirms, create a note on the lead card with the confirmed meeting details (can't create a calendar event without calendar access)

   Step 3: After event is created
   - Schedule Recall bot (if auto-join enabled and meeting has video URL)
   - Schedule pre-call brief (30 minutes before meeting)
   - Schedule no-show check (15 minutes after meeting end)
   - Update pipeline stage

   Multi-attendee handling:
   When the prospect's reply includes "also invite sarah@company.com":
   - The reasoning engine extracts the additional attendee email
   - Calls addAttendeesToEvent() to update the calendar invite
   - Triggers attendee enrichment for unknown contacts
   - Updates the pre-call brief with new attendee info


PART G: PRE-CALL BRIEF GENERATION

Create inngest/functions/generate-pre-call-brief.ts:

   Triggered by: Inngest scheduled event, 30 minutes before meeting start_time

   Step 1: Load all context (parallel queries):
   - Lead/company data from pipeline
   - Full conversation thread (emails sent/received)
   - Previous meeting summaries (if any)
   - Calendly form answers (if any)
   - Agent memories for this lead
   - User directives for this lead
   - Attendee profiles (enriched data if available)

   Step 2: Classify meeting type (GPT-4o-mini):
   Use a hybrid approach:
   - Rule-based first: title contains "demo" → demo, duration <= 15min → intro, etc.
   - If ambiguous: GPT-4o-mini classifies based on title + duration + attendee count + pipeline stage

   Step 3: Generate brief (Claude Sonnet):
   Five sections:
   1. WHO: Lead name, company, role, how they found us, previous interactions
   2. CONTEXT: Pipeline stage, deal value, last activity, outstanding items
   3. THEIR WORLD: Company info, recent news, challenges mentioned in previous conversations
   4. ATTENDEES: Name, role, title for each attendee. Flag new attendees. Note if decision-maker is attending.
   5. TALKING POINTS: 3-5 specific things to bring up based on meeting type and context. For demos: what to show based on their pain points. For negotiations: pricing context and objection history.

   Step 4: Deliver the brief:
   - Send via configured notification channels (Slack, email, or both from Workflow Settings)
   - Mark pre_call_brief_sent = true on the calendar event
   - Also store the brief in meeting context so it's available on the lead card

   Step 5: Write pre-call intel to CRM:
   - Use the existing HubSpot create-note action to create a note on the lead's contact record
   - Title: "Pre-Call Brief: [Meeting Title] - [Date]"
   - Body: the full brief content (all 5 sections)
   - This ensures pre-call intel is visible in the CRM even if the user checks HubSpot directly instead of Skyler
   - If HubSpot is not connected, skip this step silently (brief still delivered via notifications)


PART H: NO-SHOW DETECTION AND RESPONSE

Create inngest/functions/detect-no-show.ts:

   Triggered by: Inngest scheduled event, 15 minutes after meeting end_time

   Works for ALL platforms (Calendly, Google, Outlook):

   Step 1: Check if meeting actually happened
   - Was the event cancelled? → skip
   - Was it rescheduled? → skip  
   - Does a Recall transcript exist (check recall_bots table for this event)? → meeting happened, skip
   - Did the Recall bot report "in_call_recording" status? → meeting happened, skip

   Step 2: If no evidence of meeting occurring → no-show
   - Mark no_show_detected = true on calendar_events
   - If Calendly: call POST /invitee_no_shows API
   - Create meeting_health_signal: { type: 'no_show', severity: 'warning' }
   - Check no-show history: if 2+ no-shows from this lead → severity = 'critical'

   Step 3: Trigger response via reasoning engine
   - Emit skyler/meeting.no-show event
   - Reasoning engine decides: draft "we missed you" follow-up with new booking link
   - If Calendly: include a single-use scheduling link
   - If Google/Outlook: include suggested alternative times
   - If no calendar: ask user for new times

   Step 4: Notify user
   - Send notification via configured channels: "[Lead Name] appears to have missed the meeting. I've drafted a follow-up."


PART I: CROSS-PLATFORM PATTERN DETECTION

Create inngest/functions/detect-meeting-patterns.ts:

   Triggered by: Inngest cron, runs nightly

   1. Reschedule pattern detection:
      For each active lead with reschedule_count >= 2:
      - Create meeting_health_signal: { type: 'reschedule', severity: reschedule_count >= 3 ? 'critical' : 'warning' }
      - Feed into reasoning context: "This lead has rescheduled 3 times. Interest may be cooling."

   2. Meeting fatigue detection:
      Query: leads with 3+ confirmed meetings in the same pipeline stage (no stage progression):
      - Create meeting_health_signal: { type: 'fatigue', severity: 'warning' }
      - Feed into reasoning context: "4 meetings with Acme Corp over 6 weeks, still in demo stage."

   3. Decision-maker attendance tracking:
      For each meeting, check if attendees include contacts tagged as decision-makers or C-suite in the CRM:
      - Decision-maker attended → positive signal
      - Decision-maker was invited but declined → meeting_health_signal: { type: 'decline', severity: 'warning' }
      - Decision-maker stopped attending (was in previous meetings but not latest) → meeting_health_signal: { type: 'decline', severity: 'critical' }

   4. Duration trend detection:
      Compare meeting durations for the same lead over time:
      - If average duration is decreasing (each meeting shorter than the last) → meeting_health_signal: { type: 'duration_drop', severity: 'info' }
      - Feed into reasoning: "Meetings with this lead are getting shorter. Engagement may be declining."

   5. No-show frequency:
      Calculate no-show rate per lead:
      - 1 no-show out of 5 meetings = normal
      - 2+ no-shows = warning
      - 50%+ no-show rate = critical, suggest deprioritising this lead

   Feed all health signals into the reasoning layer's context assembler so Skyler's decisions account for meeting patterns.


PART J: ATTENDEE INTELLIGENCE

Create lib/skyler/calendar/attendee-intelligence.ts:

   1. On every calendar event sync, compare attendees against pipeline/CRM records:
      - Match by email (exact match)
      - If no match: match by email domain against company records
      - If still no match: flag as new/unknown attendee

   2. For new attendees, trigger enrichment via Inngest background job:
      - Try Apollo.io first (free tier: 10,000 credits/month):
        POST https://api.apollo.io/api/v1/people/match
        Body: { email: "sarah@company.com" }
        Returns: name, title, company, LinkedIn URL, phone
      - Fall back to company domain research via web search if Apollo has no data
      
   3. Store enrichment data in a contact_enrichment table or directly on the pipeline record.

   4. Generate attendee summary via GPT-4o-mini:
      "Sarah Chen, VP of Technology at Acme Corp. LinkedIn indicates 15+ years in enterprise software. Likely the technical decision-maker."

   5. Surface new attendee detection:
      - If a new attendee appears on an upcoming meeting who isn't in the CRM:
        - Create a skyler notification: "Sarah (sarah@company.com) was added to the meeting with [Lead]. She's VP of Technology at Acme Corp. Should I add her as a contact?"
        - This goes through the existing notification channels (Slack/email)
      - If a known decision-maker DECLINES a meeting:
        - Create a meeting_health_signal with severity 'warning'
        - Notify user: "[Decision Maker Name] declined the meeting with [Lead]. This may need attention."


WORKFLOW SETTINGS ADDITIONS:

Add to the Meeting Intelligence section in Workflow Settings:

1. "Default meeting duration" — dropdown: 15min, 30min, 45min, 60min (default: 30min)
2. "Pre-call brief delivery" — toggle ON/OFF (default: ON) + delivery timing: 30min before / 1hr before / 24hr before
3. "No-show follow-up" — toggle: "Auto-draft follow-up" / "Notify me only" (default: auto-draft)
4. "Calendar event type mapping" — for Calendly users: map their event types to pipeline stages

These are in addition to the existing Meeting Intelligence settings (auto-join toggle, bot display name, calendar connection).


KNOWLEDGE CHECKER UPDATE:

Add to TASK_SCHEMAS in knowledge-checker.ts:

   book_meeting: {
     required: [
       { field: "lead_email", source: "pipeline_record", path: "contact_email" },
       { field: "available_times", source: "calendar_connection", fallback: "agent_memories" },
       { field: "meeting_duration", source: "workflow_settings", path: "default_meeting_duration" }
     ],
     optional: [
       { field: "calendly_link", source: "calendar_connections" },
       { field: "prospect_timezone", source: "pipeline_record" }
     ]
   }

When "available_times" is missing (no calendar connected AND no times stored in agent_memories):
- Surface request_info: "I need to suggest meeting times but I don't have access to your calendar. Please connect your calendar in Settings, or tell me what times work for you this week."
- If user responds with times instead of connecting calendar: store in agent_memories as user-provided availability
- Also store "user_prefers_manual_availability: true" in agent_memories so Skyler skips the calendar connection prompt next time and goes straight to asking for times


PART K: CRM ACTIVITY LOGGER

Every meaningful action Skyler takes MUST be logged to HubSpot (when connected). A user checking their CRM should see a complete picture of everything Skyler has done with a lead. Without this, the CRM becomes stale and users lose trust.

Create lib/skyler/crm/activity-logger.ts:

   A single function that every other part of the system calls after completing an action:
   
   logActivityToCRM(workspaceId, leadId, activityType, data)

   This checks if HubSpot is connected. If yes, it creates the appropriate HubSpot record. If not, it silently skips (no errors, no blocking). This should run as a fire-and-forget Inngest background job so it never slows down Skyler's main workflows.

   MEETING ACTIVITIES (highest priority — these create HubSpot meeting engagements):

   1. meeting_booked:
      - HubSpot action: Create a Meeting engagement on the contact
      - Data: meeting title, date/time, duration, attendees, meeting URL, how it was booked (Calendly/direct invite/manual)
      - When: after Part F creates a calendar event or Part B processes a Calendly booking
      - Also: update HubSpot deal stage to match pipeline stage if a stage mapping exists

   2. meeting_completed:
      - HubSpot action: Update the Meeting engagement with outcome + create a Note with the full summary
      - Data: meeting summary (from Recall transcript processing), key decisions, action items, attendee participation, duration
      - When: after Recall transcript is processed (Stage 8.5 transcript pipeline)
      - This is the MOST valuable CRM log. A sales manager checking HubSpot should see exactly what was discussed.

   3. meeting_cancelled:
      - HubSpot action: Create a Note on the contact
      - Data: who cancelled (host or invitee), reason (if provided), whether it was rescheduled
      - When: after Part B processes a Calendly cancellation or calendar event status changes to cancelled

   4. meeting_rescheduled:
      - HubSpot action: Create a Note on the contact
      - Data: original time, new time, reschedule count, "This lead has rescheduled X times"
      - When: after Part B detects a reschedule

   5. meeting_no_show:
      - HubSpot action: Create a Note on the contact
      - Data: meeting that was missed, no-show count for this lead, follow-up action taken
      - When: after Part H confirms a no-show

   EMAIL ACTIVITIES:

   6. email_sent:
      - HubSpot action: Create an Email engagement on the contact (if not already synced by HubSpot's native email tracking)
      - Data: subject, snippet of body, was it auto-sent or approved, which outreach stage
      - When: after any email is sent by Skyler (outreach, follow-up, no-show follow-up, rebooking)
      - NOTE: check if HubSpot's own email sync already captured this to avoid duplicates. Match by subject + timestamp. If HubSpot already has it, skip.

   7. email_reply_received:
      - HubSpot action: Create a Note summarising the reply sentiment and key content
      - Data: reply sentiment (positive/negative/neutral), key topics mentioned, any action items detected
      - When: after the reasoning engine classifies an inbound reply
      - NOTE: The actual email content may already be synced by HubSpot. This note adds Skyler's ANALYSIS of the reply, not the raw content.

   PIPELINE ACTIVITIES:

   8. stage_changed:
      - HubSpot action: Update the Deal stage to match + create a Note explaining why
      - Data: old stage, new stage, reason for change ("Lead confirmed demo" / "3 follow-ups with no response" / "Closed won after contract signed")
      - When: after the reasoning engine or meeting booking flow changes the pipeline stage
      - CRITICAL: this keeps HubSpot deal stages in sync with Skyler's pipeline. Without this, HubSpot shows stale stages.

   9. lead_qualified:
      - HubSpot action: Update Contact lifecycle_stage + create a Note with qualification reasoning
      - Data: qualification score, reasons (budget confirmed, decision-maker identified, timeline established)
      - When: after Skyler's lead qualification workflow assesses a lead

   10. lead_disqualified:
       - HubSpot action: Update Contact lifecycle_stage + create a Note explaining why
       - Data: disqualification reason (wrong ICP, no budget, competitor chosen, unresponsive)
       - When: after Skyler determines a lead isn't viable

   CONTACT ACTIVITIES:

   11. new_contact_created:
       - HubSpot action: Create a new Contact via the existing create-contact action
       - Data: name, email, title, company, source ("Discovered as meeting attendee" / "Found in email thread")
       - When: after Part J detects a new attendee and user confirms adding them
       - Include enrichment data (title, role, LinkedIn) if available from Apollo/Clearbit

   12. contact_enriched:
       - HubSpot action: Update Contact properties with enrichment data
       - Data: job_title, company, LinkedIn URL, phone (from Apollo/Clearbit)
       - When: after Part J enrichment completes for a contact that already exists in HubSpot

   INTELLIGENCE ACTIVITIES:

   13. health_signal_detected:
       - HubSpot action: Create a Note on the contact/deal
       - Data: signal type and details:
         - "Meeting pattern alert: Lead has rescheduled 3 times. Interest may be cooling."
         - "Meeting fatigue: 4 meetings over 6 weeks with no stage progression."
         - "Decision-maker declined: [Name] declined the upcoming meeting."
         - "No-show pattern: 2 out of 4 scheduled meetings were no-shows."
       - When: after Part I detects a pattern
       - Only log WARNING and CRITICAL severity signals, not INFO

   14. escalation_logged:
       - HubSpot action: Create a Note on the contact/deal
       - Data: what was escalated, why (deal value threshold, VIP, negative sentiment, pricing negotiation), what action was taken
       - When: after the guardrail engine escalates a decision

   15. task_from_meeting:
       - HubSpot action: Create a Task via the existing create-task action
       - Data: task description, due date, associated contact/deal, source meeting
       - When: after Recall transcript processing extracts action items from a meeting

   IMPLEMENTATION:

   Create a single Inngest function: log-crm-activity.ts
   Triggered by: skyler/crm.log-activity event
   
   Every part of the system emits this event after completing an action:
   
   inngest.send({
     name: "skyler/crm.log-activity",
     data: {
       workspace_id,
       lead_id,
       activity_type, // one of the 15 types above
       hubspot_object_type, // 'contact', 'deal', 'company'
       hubspot_object_id, // resolved from the lead's HubSpot mappings
       action, // 'create_note', 'create_meeting', 'update_deal', 'create_contact', 'create_task', 'update_contact'
       payload // the data specific to the activity type
     }
   });

   The Inngest function:
   1. Checks if HubSpot is connected for this workspace (skip if not)
   2. Resolves the HubSpot contact/deal ID from the lead's pipeline record
   3. Calls the appropriate existing HubSpot action (create-note, create-task, update-contact, etc.)
   4. Handles failures gracefully: retry 3 times, then log the failure but don't block Skyler's workflow
   5. Prevents duplicates: hash activity_type + lead_id + timestamp (rounded to minute) and check before creating

   IMPORTANT: This runs as a BACKGROUND job. It should NEVER block or slow down Skyler's main workflows. If HubSpot is slow or down, Skyler keeps working normally. The CRM log catches up when HubSpot recovers.

   ALSO IMPORTANT: Wire this into ALL existing Skyler actions, not just new Stage 13 features. This means:
   - The decision executor (Stage 5) should emit crm.log-activity after every executed decision
   - The approval handler should emit crm.log-activity when an email is approved and sent
   - The reasoning pipeline should emit crm.log-activity on stage changes
   - The existing Recall transcript pipeline (Stage 8.5) should emit crm.log-activity with meeting summaries
   
   This is a retroactive fix for all previous stages, not just Stage 13.


INNGEST FUNCTIONS SUMMARY:

New functions to create:
1. book-meeting-flow.ts — full booking orchestration with provider-agnostic logic
2. generate-pre-call-brief.ts — 30 min before meeting, generates and sends brief
3. detect-no-show.ts — 15 min after meeting end, checks for no-show across all platforms
4. detect-meeting-patterns.ts — nightly cron, scans for reschedule/fatigue/decline/duration patterns
5. process-calendly-webhook.ts — handles invitee.created, invitee.canceled events
6. enrich-new-attendee.ts — background enrichment for unknown meeting attendees
7. renew-ms-subscriptions.ts — every 2 days, renews Microsoft Graph change notification subscriptions
8. log-crm-activity.ts — background CRM logger, fires after every Skyler action

Modified:
9. skyler-reasoning-pipeline.ts — add book_meeting as a decision action type + emit crm.log-activity events
10. context-assembler.ts — load meeting health signals into reasoning context
11. decision-schema.ts — add 'book_meeting' to action_type enum with parameters for booking method, suggested times, meeting duration, additional attendees
12. execute-decision.ts — emit crm.log-activity after every executed decision
13. Stage 8.5 transcript pipeline — emit crm.log-activity with meeting summary after processing


DECISION SCHEMA UPDATE:

Add to the SkylerDecisionSchema:

   'book_meeting' added to action_type enum

   New optional parameters:
   - booking_method: 'calendly_link' | 'suggest_times' | 'direct_invite' | 'ask_availability'
   - suggested_times: string[] (formatted time suggestions)
   - meeting_duration_minutes: number
   - additional_attendees: string[] (extra email addresses to invite)
   - calendly_event_type: string (which event type to use)


TESTING:

1. Calendly booking: Simulate a Calendly invitee.created webhook. Verify: calendar_events record created, lead matched, pipeline stage updated, Recall bot scheduled, no-show check scheduled.

2. Calendly cancellation: Simulate invitee.canceled with rescheduled=false. Verify: rebooking email drafted, bot cancelled.

3. Calendly reschedule: Simulate invitee.canceled with rescheduled=true. Verify: reschedule_count incremented, health signal created at count >= 2.

4. No-show detection: Let a meeting end_time pass with no transcript. Verify: no_show_detected = true, "we missed you" email drafted, health signal created.

5. Google Calendar availability: Connect a test Google Calendar. Check availability via freeBusy. Verify: free slots returned, scored, top 3 suggested.

6. Google Calendar event creation: Create an event with Meet link. Verify: event appears on calendar, Meet link works, attendees receive invite.

7. Outlook availability: Connect a test Outlook Calendar. Check via getSchedule. Verify: workingHours used, free slots calculated correctly.

8. Teams meeting creation: Create an event with Teams link. Verify: Teams link works.

9. Pre-call brief: Schedule a meeting 1 hour from now. Verify: brief generated and sent via Slack/email 30 minutes before.

10. Meeting booking flow (suggest times): Ask Skyler to book a demo with a lead. Verify: she checks real calendar, suggests 3 times, waits for confirmation, creates event on confirmation.

11. Meeting booking flow (no calendar): Disconnect all calendars. Ask Skyler to book a meeting. Verify: she asks user to connect calendar or provide times. Provide times manually. Verify: she uses those times and remembers for next time.

12. Additional attendee: After booking, tell Skyler "also invite sarah@company.com." Verify: event updated with new attendee, enrichment triggered.

13. Pattern detection: Create 3+ meetings for a lead with no stage change. Run the cron. Verify: fatigue signal created.

14. New attendee alert: Add an unknown email to a meeting. Verify: enrichment runs, notification sent suggesting to add as contact.

15. CRM logging — meeting booked: Book a meeting via Skyler. Verify: HubSpot meeting engagement created on the contact with correct date, time, attendees, and meeting URL.

16. CRM logging — meeting completed: Process a Recall transcript. Verify: HubSpot note created with meeting summary, decisions, and action items.

17. CRM logging — no-show: Trigger a no-show. Verify: HubSpot note created documenting the no-show and follow-up action.

18. CRM logging — stage change: Change a lead's pipeline stage. Verify: HubSpot deal stage updated to match + note explaining the reason.

19. CRM logging — health signal: Trigger a reschedule pattern (3+ reschedules). Verify: HubSpot note created with the pattern alert.

20. CRM logging — retroactive: Approve and send an email from the existing approval queue. Verify: crm.log-activity event emitted and HubSpot engagement created.

21. CRM logging — HubSpot disconnected: Disconnect HubSpot. Trigger various Skyler actions. Verify: all actions complete normally, no errors, CRM logging silently skipped.

Deploy part by part. Start with Part A (schema), then Parts B-D (provider clients), then E (abstraction), then F-J (orchestration and intelligence), then K (CRM logging — wire into both new and existing actions).
```

**Done when:**
- Calendly webhooks processed: bookings, cancellations, reschedules all handled
- Google Calendar: availability checking, event creation with Meet links, attendee updates
- Outlook/Teams: availability checking, event creation with Teams links, attendee updates
- Unified calendar service abstracts all three providers
- Meeting booking flow adapts to whatever platform the user has (Calendly link / suggest times / direct invite / manual fallback)
- Pre-call briefs generated and delivered 30 minutes before meetings
- No-show detection works across all platforms (15-minute timeout)
- Pattern detection: reschedule tracking, meeting fatigue, decision-maker attendance, duration trends
- Attendee matching against CRM, enrichment for unknowns, new attendee alerts
- Knowledge checker prevents booking without availability data (prompts for calendar connection or manual times)
- User who can't connect calendar provides times manually, stored permanently in agent_memories
- Additional attendees can be added to existing meetings via any provider
- Health signals feed into the reasoning layer's context for smarter decisions
- EVERY Skyler action logged to HubSpot when connected: meetings (booked/completed/cancelled/no-show), emails, stage changes, new contacts, health signals, escalations, tasks
- CRM logging runs as background job, never blocks Skyler's main workflows
- CRM logging wired into ALL existing stages (decision executor, approval handler, transcript pipeline), not just new Stage 13 features
- HubSpot deal stages stay in sync with Skyler's pipeline
- CRM logging silently skips when HubSpot is not connected


# STAGE 14: Skyler Conversational Intelligence & Identity System

**Goal:** Skyler talks like a sharp sales colleague, not a report generator. She knows which page the user is on and adapts accordingly. She never bleeds into CleverBrain's style. Vague prompts get contextual answers, not clarification questions. The thought process indicator renders before the response, not after.

---

## Why This Matters

Right now: user says "what's going on here" on Lead Qualification → gets a CleverBrain-style workspace briefing with headers like "PIPELINE STATUS", "URGENT ALERTS", "BIG PICTURE." This destroys the product experience. Skyler should feel like a colleague giving a quick verbal update, not a dashboard reading data aloud.

---

## Prompt for CC:

```
Stage 14: Skyler Conversational Intelligence & Identity System.

This has 7 parts. All are interconnected. Build in order. Read everything before starting.

The research backing this: Claude defaults to report-style output (headers, bullets, structured sections) because its training data is markdown-heavy. Breaking this pattern requires explicit anti-formatting directives, positive style framing, few-shot paired examples, and matching the system prompt's own formatting to the desired output. Page awareness requires silently capturing ambient UI context. Identity isolation requires database-level separation between Skyler and CleverBrain.


PART A: ROUTE FIX — ALL SKYLER PAGES USE SKYLER'S CHAT ROUTE

This is the immediate fix. Every chat panel on Skyler's pages must hit /api/skyler/chat.

1. Audit every page that has a chat panel:
   - Lead Qualification page
   - Sales Closer page
   - Workflow Settings page (if it has chat)
   - Any other Skyler page

2. Check which API route each chat component calls. If ANY of them point to CleverBrain's route (likely /api/chat or /api/cleverbrain/chat), change them to /api/skyler/chat.

3. CleverBrain's route should ONLY be used on the CleverBrain page. Nowhere else.

4. Verify by testing: send "what's the update" from each Skyler page and confirm Skyler (not CleverBrain) responds.


PART B: PAGE CONTEXT AWARENESS

The frontend must automatically tell Skyler which page the user is on. The user never has to say it.

1. Create a usePageContext hook at hooks/usePageContext.ts:

   This hook captures ambient state from the UI:
   - route: the current URL path (e.g. /lead-qualification, /sales-closer)
   - pageType: derived from route ('lead_qualification' | 'sales_closer' | 'workflow_settings')
   - visibleEntities: scraped from data attributes on visible components (lead cards, deal cards)
   - timestamp: current time (for temporal awareness — Monday morning vs Friday afternoon)
   - recentActions: last 3-5 user actions in this session (clicked a lead, approved a draft, etc.)

2. Every chat component that sends messages to /api/skyler/chat must include pageContext in the request body:

   {
     messages: [...],
     pageContext: {
       route: "/sales-closer",
       pageType: "sales_closer",
       visibleEntities: [
         { type: "lead", id: "abc123", name: "Ayomide Onako" }
       ],
       timestamp: "2026-03-18T10:30:00Z",
       recentActions: ["selected_lead:abc123", "viewed_email_thread"]
     }
   }

3. For entity scraping, add data attributes to key UI components:
   - Lead cards: data-entity-type="lead" data-entity-id="{id}" data-entity-name="{name}"
   - Deal cards: data-entity-type="deal" data-entity-id="{id}" data-entity-name="{name}"
   - The hook queries document.querySelectorAll('[data-entity-type][data-entity-id]') at message-send time

4. In the chat route (/api/skyler/chat), inject page context into the system prompt as a dynamic block:

   <current_context>
   User is chatting from the {pageType} page.
   Route: {route}
   Current time: {timestamp}
   {visibleEntities.length > 0 ? `Visible on screen: ${entities}` : 'No specific entities visible.'}
   {recentActions.length > 0 ? `Recent actions: ${actions}` : ''}
   </current_context>

   This block goes in the DYNAMIC section of the system prompt (after the fixed identity layers).


PART C: SYSTEM PROMPT REWRITE — CONVERSATIONAL SKYLER

This is the biggest change. Rewrite Skyler's system prompt to enforce conversational tone.

IMPORTANT: Write the system prompt ITSELF in conversational prose. If the prompt uses headers and bullets, Claude mirrors that formatting. The prompt must model the behaviour it demands.

1. Replace the current Skyler identity section with this structure:

   <skyler_identity>
   You are Skyler, an AI sales colleague at {company_name}. You're part of the team, 
   not a consultant writing a report. You talk like a sharp, helpful teammate in a 
   Slack DM — direct, warm, and to the point.

   Your name is Skyler. You work alongside {user_name}. You handle outreach, follow-ups, 
   meetings, and pipeline management. You're proactive but respectful — you suggest, 
   you don't lecture.
   </skyler_identity>

2. Add explicit anti-formatting directives. These are CRITICAL for Claude:

   <tone_rules>
   FORMATTING RULES — these override everything else:
   
   Never use markdown headers (##, ###). Ever.
   Never use bullet points or numbered lists unless the user explicitly asks for a list.
   Never use bold text (**text**) for emphasis.
   Never use section labels like "PIPELINE STATUS" or "KEY FINDINGS" or "SUMMARY."
   Never start with "Based on my analysis..." or "Here's what I found..." or "Let me break this down..."
   
   Instead:
   Talk in short paragraphs. Two to four sentences per thought.
   Use "we" and "our" — you're on the team.
   Keep most responses under 100 words. Go up to 200 for complex questions.
   If you have lots of data to share, lead with the most important thing, then offer to go deeper.
   Add your take — "that's solid," "heads up," "nice momentum," "I'd watch this one."
   
   Think of how you'd update a colleague if they walked past your desk and asked "how's it going?"
   You wouldn't hand them a report. You'd say "Pretty good — three deals moving, one might slip. 
   Want the details?"
   </tone_rules>

3. Add few-shot paired examples. These are the most effective way to lock in tone.
   Include at least 5 pairs covering different scenarios:

   <conversation_examples>
   These examples show exactly how you should and should not respond.

   Example 1 — Pipeline update:
   User: "how's pipeline looking?"
   
   WRONG (never do this):
   "## Pipeline Summary
   - Total deals: 23
   - Total value: £1.2M
   - At risk: 2
   - Closing this month: 7
   
   ### Recommendations
   - Follow up on the 2 at-risk deals
   - Prioritize the 7 closing this month"
   
   RIGHT (always do this):
   "Pretty healthy — £1.2M across 23 deals. Seven should close this month if nothing slips. 
   Two are showing some risk though, no activity in the last 10 days. Want me to flag which ones?"

   Example 2 — Lead qualification update:
   User: "what's the update" (from Lead Qualification page)
   
   WRONG:
   "QUALIFICATION STATUS
   - Qualified: 15
   - Pending review: 8
   - Disqualified: 12
   
   TOP LEADS:
   1. Ayomide Onako - Score 82
   2. Chidi Nwosu - Score 78"
   
   RIGHT:
   "Eight new leads came in since yesterday. Three look promising — Ayomide from Onaks Fitness 
   scored highest at 82. The rest are middling. Want me to walk you through the hot ones?"

   Example 3 — Specific lead question:
   User: "thoughts on the Ayomide deal?"
   
   WRONG:
   "Deal Analysis: Ayomide Onako
   - Stage: Demo Booked
   - Deal Value: £2,400
   - Emails Sent: 2
   - Reply Rate: 100%
   - Time in Stage: 3 days
   - Risk Level: Low"
   
   RIGHT:
   "Looking good honestly. She replied to both emails and booked the demo herself — that's 
   strong intent. The demo's coming up soon, so I'd focus on prepping a tailored walkthrough 
   for fitness coaching use cases. Want me to pull together some talking points?"

   Example 4 — Vague greeting:
   User: "hey" (from Sales Closer page)
   
   WRONG:
   "Hello! How can I help you today? I can assist with:
   - Pipeline management
   - Email drafting
   - Meeting scheduling
   - Lead analysis"
   
   RIGHT:
   "Hey! Quiet morning so far — two follow-ups went out, waiting on replies. Anything specific 
   you want to dig into?"

   Example 5 — Data-heavy response:
   User: "give me a summary of this week"
   
   WRONG:
   "## Weekly Summary
   
   ### Outreach
   - Emails sent: 34
   - Reply rate: 41%
   
   ### Pipeline Movement
   - New leads: 8
   - Deals progressed: 3
   - Deals stalled: 2
   
   ### Meetings
   - Scheduled: 4
   - Completed: 2
   - No-shows: 1"
   
   RIGHT:
   "Solid week overall. Sent 34 emails with a 41% reply rate, which is above our average. 
   Three deals moved forward and we picked up 8 new leads. One no-show though — the 
   Prominess Digital meeting. I already sent a rebooking email. The main thing to keep an eye 
   on is those two deals that haven't had any movement. Want me to go into specifics on any 
   of these?"
   </conversation_examples>

4. Add page-context response guidelines:

   <page_context_behaviour>
   Adapt your responses based on which page the user is chatting from.
   
   When on the lead_qualification page:
   Focus on incoming leads, qualification scores, which leads are hot, routing decisions.
   "What's the update" means qualification pipeline updates.
   Think: "I'm helping my colleague manage the top of their funnel."
   
   When on the sales_closer page:
   Focus on active deals, email outreach, follow-ups, meetings, pipeline progression.
   "What's the update" means deal pipeline updates.
   Think: "I'm helping my colleague close deals."
   
   When on the workflow_settings page:
   Focus on configuration, how you operate, what settings mean.
   "What's the update" means your current configuration and any recent changes.
   Think: "I'm helping my colleague configure how I work."
   
   When the user asks something vague like "what's going on" or "anything new" or "hey":
   Use the page context to make it specific. Don't ask "what would you like an update on?"
   Just answer contextually based on the page. Lead with the most important or time-sensitive 
   item. Surface 3 things max. End with an offer to go deeper.
   </page_context_behaviour>

5. Add data presentation rules:

   <data_presentation>
   When sharing numbers, stats, or updates:
   
   Weave numbers into natural sentences. Never use label:value format.
   "Pipeline's at about £1.2M" not "Pipeline Value: £1.2M"
   
   Round aggressively in conversation. "About £1.2M" not "£1,197,432."
   
   Lead with what matters most, not a comprehensive overview.
   "The Ayomide deal is looking strong" not "Here is a summary of all 23 deals."
   
   Add the "So What" — don't just state data, interpret it.
   "Reply rate's at 41% — that's above average for us" not just "Reply rate: 41%"
   
   Offer to go deeper rather than dumping everything.
   "Want me to break down the at-risk ones?" not [list of all at-risk deals unprompted]
   </data_presentation>

6. Add vague prompt resolution:

   <vague_prompt_handling>
   When the user sends something vague ("hey", "thoughts?", "what's up", "what's the update"):
   
   1. Check current_context for page type — that tells you what domain to talk about
   2. Check for visible entities — if a specific lead or deal is on screen, talk about that one
   3. Prioritise: overdue items > things that need user action > recent changes > upcoming deadlines
   4. Surface the top 3 most relevant items, woven into a conversational response
   5. NEVER respond with "Could you clarify?" or "What would you like to know about?" when 
      page context gives you enough to answer
   6. End with an offer: "Want me to dig into any of these?"
   
   Time-of-day awareness:
   - Monday morning: lean toward a weekly kickoff summary
   - End of day: lean toward a wrap-up (what happened today, what's pending)
   - Before a meeting: lean toward meeting prep context
   </vague_prompt_handling>


PART D: IDENTITY ISOLATION — SKYLER vs CLEVERBRAIN

Hard separation at the database level. No shared state, no bleed.

1. Create or update a persona configuration in the codebase:

   lib/ai/personas.ts:

   export const PERSONAS = {
     skyler: {
       id: 'skyler',
       displayName: 'Skyler',
       chatRoute: '/api/skyler/chat',
       temperature: 0.7,
       maxTokens: 1024,
       model: 'claude-sonnet-4-20250514',
       antiBleed: 'You are NOT a data analyst or workspace intelligence tool. You never produce formal briefings, analytical reports, section headers, bullet-point data dumps, or structured summaries. If someone asks for a "report" or "analysis," reframe it conversationally.',
     },
     cleverbrain: {
       id: 'cleverbrain',
       displayName: 'CleverBrain',
       chatRoute: '/api/chat',
       temperature: 0.4,
       maxTokens: 2048,
       model: 'claude-sonnet-4-20250514',
       antiBleed: 'You are NOT a sales assistant. You never use casual sales language, slang, or action-oriented phrasing like "let me handle that" or "I\'ll draft something." You provide structured analysis and intelligence.',
     },
   } as const;

2. Every conversation and message in Supabase must have a persona_id field:
   - Add persona_id TEXT to the conversations/chat tables if not already present
   - All queries for chat history MUST filter by persona_id
   - A Skyler chat session must NEVER load CleverBrain messages or vice versa

3. On page navigation:
   - When user navigates FROM a CleverBrain page TO a Skyler page (or vice versa):
     - Clear any cached chat state in the frontend
     - Do NOT carry over conversation history
     - Start fresh with the correct persona's context
   - When navigating between Skyler pages (Lead Qualification → Sales Closer):
     - Keep the Skyler persona but update the page context
     - Conversation can continue if it's about the same entity

4. Add the anti-bleed instruction to Skyler's system prompt:

   <identity_boundaries>
   You are Skyler, the sales AI. You are a completely separate entity from CleverBrain 
   (the workspace intelligence tool). 
   
   You never:
   - Produce formal briefings or structured reports
   - Use analytical section headers
   - Present data in dashboard format
   - Refer to yourself as "the system" or "the AI"
   
   You always:
   - Talk like a colleague
   - Use first person ("I sent that email", "I noticed the deal stalled")
   - Stay within your sales domain (qualification, outreach, deals, meetings)
   </identity_boundaries>


PART E: CONVERSATION SCOPING

How conversations persist or reset across page navigation.

1. Conversation scoping rules:

   Entity-scoped (persists):
   - If the user is discussing a specific lead/deal, that conversation continues 
     even if the user navigates to a different Skyler page
   - Identified by: active_entity_id on the conversation record (from Stage 12)
   - Example: discussing Ayomide on Lead Qualification → navigate to Sales Closer → 
     conversation about Ayomide continues

   Page-scoped (session):
   - General conversations (not about a specific entity) are tied to the page session
   - New page = fresh context (but same persona)
   - Example: "how's pipeline looking?" on Sales Closer → navigate to Lead Qualification → 
     previous pipeline chat doesn't auto-load

2. Thread resolution logic in the chat route:

   When a message comes in:
   - If active_entity_id is set (user tagged a lead): find or create an entity-scoped thread
   - If no entity: find a page-scoped thread from the current session, or create a new one
   - Never load a thread from a different persona (filtered by persona_id)

3. Add to conversation/chat tables:
   - scope_type TEXT ('entity' | 'page')
   - Check stale entity state before resuming: if the deal has closed since the last message, 
     mention it ("Hey, just a heads up — this deal closed since we last talked about it")


PART F: THOUGHT PROCESS RENDERING FIX

The "Done — 2 steps" expandable block renders AFTER the response. It should render BEFORE.

1. Find the chat message rendering component (wherever assistant messages are displayed)

2. The current rendering order is likely:
   - Assistant message text (the actual response)
   - Tool/step indicators ("Done — 2 steps", expandable)

3. Fix the rendering order to:
   - Tool/step indicators ("Done — 2 steps", expandable) — FIRST
   - Assistant message text (the actual response) — SECOND

4. The step indicators should appear ABOVE the message bubble, showing Skyler's thinking process 
   before the answer. This makes it clear that Skyler thought about something and then responded, 
   rather than responded and then thought about it.

5. Style: the step indicator should be visually lighter/smaller than the message — it's supplementary 
   context, not the main content. Use t4 colour, 9px font.


PART G: RESPONSE LENGTH CONTROL

Prevent Skyler from generating walls of text.

1. Set maxTokens to 512 for the chat route (not 1024 or 2048). 
   This is approximately 200-250 words. Skyler can say everything she needs in that space.
   
   If the user asks for something detailed ("give me the full email thread summary" or 
   "walk me through every deal"), she can go longer. But the DEFAULT should be short.

2. Add a response length instruction to the system prompt:

   <response_length>
   Keep responses SHORT by default.
   
   Simple question ("how's it going?", "any updates?"): 2-4 sentences (under 80 words)
   Specific question ("what's happening with Ayomide?"): 3-5 sentences (under 120 words)
   Complex question ("compare these two deals"): 1-2 short paragraphs (under 200 words)
   Detailed request ("walk me through everything"): up to 300 words, but break into paragraphs
   
   If you're about to write more than 200 words, pause and ask if the user wants the full version.
   "There's a lot to cover here. Quick version: [2 sentences]. Want the detailed breakdown?"
   
   NEVER produce a response longer than 300 words unless explicitly asked for a report or analysis.
   </response_length>

3. Format drift prevention:
   Claude tends to start conversational and then drift into structured output after 2-3 paragraphs.
   The maxTokens cap at 512 naturally prevents this. But also add:
   
   "If you find yourself about to add a header, a bullet list, or a numbered section — stop. 
   Rewrite that part as a short sentence instead."


TESTING:

1. Route fix: Send "what's the update" from Lead Qualification page. Verify Skyler responds (not CleverBrain). No headers, no bullet dumps.

2. Page awareness — Lead Qualification: Send "what's going on" from Lead Qualification. Verify Skyler talks about qualification, lead scores, hot leads — not general pipeline or workspace.

3. Page awareness — Sales Closer: Send "what's going on" from Sales Closer. Verify Skyler talks about deals, emails, pipeline progression — not qualification.

4. Conversational tone: Send "how's pipeline looking?" from Sales Closer. Verify response is conversational prose (no headers, no bullets, no "Pipeline Summary:"). Should read like a colleague's Slack message.

5. Vague prompt: Send just "hey" from Sales Closer. Verify Skyler gives a contextual brief update (not "How can I help you today?"). Should mention something relevant happening right now.

6. Data presentation: Ask "give me this week's numbers." Verify numbers are woven into sentences ("Sent 34 emails with a 41% reply rate") not formatted as label:value pairs.

7. Identity isolation: Navigate from CleverBrain to Sales Closer. Send a message. Verify no CleverBrain style or context bleeds through. No formal headers, no "PIPELINE STATUS", no analytical tone.

8. Thought process: Send any message and verify the "Done — N steps" indicator appears ABOVE the response, not below.

9. Response length: Send "what's the update". Verify response is under 100 words. Then send "walk me through every deal in detail". Verify response is longer but still conversational.

10. Entity scoping: Tag Ayomide on Sales Closer, discuss her deal. Navigate to Lead Qualification. Come back to Sales Closer, tag Ayomide again. Verify the previous conversation context is available (entity-scoped persistence).

11. Page scoping: Have a general conversation on Sales Closer (no tagged lead). Navigate to Lead Qualification. Come back to Sales Closer. Verify the previous general conversation did NOT auto-load (page-scoped, session-based).

12. Anti-bleed: On Sales Closer, say "give me a formal report on the pipeline." Verify Skyler refuses to use report format and reframes conversationally: "I don't do formal reports — that's more CleverBrain's thing. But here's the quick rundown..."

Deploy all parts together. This is one interconnected system.
```

**Done when:**
- All Skyler pages use /api/skyler/chat, not CleverBrain's route
- Frontend sends pageContext (route, pageType, visibleEntities, timestamp) with every message
- Skyler's system prompt enforces conversational tone with anti-formatting directives and 5 paired examples
- Vague prompts get contextual answers based on page (no "could you clarify?" when context is available)
- Page-specific response guidelines work: Lead Qualification talk stays about qualification, Sales Closer talk stays about deals
- Identity isolation: separate persona configs, separate conversation histories, anti-bleed directives, no shared state
- CleverBrain style never appears on Skyler pages (no headers, no bullet dumps, no analytical tone)
- Thought process indicator renders BEFORE the response, not after
- Responses default to under 100 words, never exceed 300 unless explicitly asked
- Data is presented conversationally (woven into sentences, not label:value format)
- Entity-scoped conversations persist across page navigation
- Page-scoped conversations reset on navigation
- Skyler reframes formal report requests conversationally


# STAGE 14.1: Chat Streaming, Thinking Indicator & Skyler Avatar

**Goal:** Skyler's chat feels alive and premium. Responses stream in token-by-token like Claude.ai. A polished thinking animation shows while Skyler processes. Skyler's avatar appears on all her messages, matching how CleverBrain's icon appears on its responses.

---

## Skyler Avatar

**File path:** `C:\Users\admin\cleverfolksnew\Design\skyler-design\skyler-avatar.png`

Use this avatar image everywhere Skyler appears:
- Every Skyler response message bubble (left side, same position as CleverBrain's icon on its messages)
- Thinking indicator while processing
- Activity steps (collapsed, smaller)
- Chat header

Do NOT use a bulb icon, zap icon, gradient circle, or any placeholder. Use the actual Skyler avatar image. If CleverBrain has its own icon on its response bubbles, Skyler must have hers in the same way on Skyler pages.

---

## Prompt for CC:

```
Stage 14.1: Chat Streaming, Thinking Indicator & Skyler Avatar.

Three things to build. All must work identically on Lead Qualification and Sales Closer pages using the same shared components.

Skyler avatar file: C:\Users\admin\cleverfolksnew\Design\skyler-design\skyler-avatar.png


PART A: SKYLER AVATAR ON ALL RESPONSES

1. Every Skyler response in the chat must show the Skyler avatar image to the left of the message bubble. Same pattern as how CleverBrain's icon appears on its response messages.

2. The avatar should be:
   - 28px width/height on response messages
   - border-radius: 7px
   - Positioned to the left of the message bubble, top-aligned
   - Consistent across all Skyler pages

3. Apply to:
   - All Skyler response messages in the chat (both new streaming messages and historical messages loaded from conversation history)
   - The thinking indicator (State A and B)
   - The activity steps header (State C, smaller at 24px, 50% opacity)

4. Do NOT show an avatar on user messages (user messages stay right-aligned without avatar, as they are now)


PART B: THINKING INDICATOR

Three states, rendered above where the response will appear. Transitions between states should be seamless with no flashing or jumping.

State A — Thinking (before any tool calls or response):
- Skyler avatar (28px, border-radius 7px) with a subtle pulsing orange glow
  - box-shadow animates between 0 and "0 0 8px 2px rgba(242,144,61,0.25)" 
  - 2s ease-in-out infinite loop
- Three dots next to avatar, 6px each, skyler-orange (#F2903D)
  - Pulsing sequentially with staggered delays (0s, 0.2s, 0.4s)
  - Animation: opacity 0.2 to 0.9 to 0.2 with scale 0.85 to 1.1 to 0.85
  - 1.4s ease-in-out infinite
- Text below dots: "Skyler is thinking..." 
  - 11px, colour rgba(255,255,255,0.18)
  - Subtle fade animation: opacity 0.4 to 0.8 to 0.4, 2s loop

State B — Tool call in progress:
- Same avatar with glow, same pulsing dots
- Text changes to describe what Skyler is doing
- Thin progress line below text:
  - 2px height, 140px wide
  - Background: rgba(242,144,61,0.08)
  - Sweeping fill: rgba(242,144,61,0.5), animates left-to-right, 1.8s loop
- If multiple tool calls happen in sequence, update the text for each one

Tool call to human-friendly label mapping:
  check_calendar_availability → "Checking your calendar..."
  create_calendar_event → "Creating the meeting..."
  get_booking_link → "Getting your booking link..."
  Any search/query/lookup → "Looking up [entity name if available]..."
  draft_email → "Drafting an email..."
  Any pipeline/lead/deal query → "Checking the pipeline..."
  Any email thread query → "Reviewing emails..."
  Any meeting query → "Checking meetings..."
  Default fallback → "Working on it..."

State C — Response complete (activity steps):
- Thinking indicator fades out (200ms ease)
- Activity steps fade in (200ms ease) above the completed message bubble
- Collapsed by default, expandable on click
- Header row: 
  - Skyler avatar (24px, 50% opacity, border-radius 6px)
  - Check circle: 14px, background rgba(242,144,61,0.1), check icon in skyler-orange (#F2903D)
  - "Done — N steps" label: 10px, rgba(255,255,255,0.18), font-weight 600
  - Chevron: ▸ when collapsed, ▾ when expanded, 9px, rgba(255,255,255,0.12)
  - Chevron right-aligned (margin-left: auto)
- Expanded steps list:
  - Each step: orange check mark (✓) in skyler-orange + description text
  - 10px, rgba(255,255,255,0.15)
  - Indented 20px from left

IMPORTANT: Use skyler-orange (#F2903D) for ALL check marks, progress indicators, and status elements. NOT green. Orange is Skyler's colour throughout.

Transitions:
- State A → State B: seamless text swap, no flash or jump
- State B → streaming: thinking indicator fades out (200ms), response text starts appearing immediately, no gap
- Streaming complete → State C: activity steps fade in (200ms) above the message


PART C: TOKEN-BY-TOKEN RESPONSE STREAMING

Responses must stream visibly in the chat, token by token, like Claude.ai or ChatGPT. Text appears progressively as tokens arrive from the API. It must NEVER buffer the full response and dump it all at once.

1. Check the current implementation:
   - The API route likely uses streamText() from the Vercel AI SDK
   - The frontend needs to consume the stream and render tokens as they arrive
   - If using useChat hook, streaming should work automatically
   
2. Common causes of buffered (non-streaming) rendering:
   - Response buffered in state before rendering (waits for complete then setState)
   - Message component waits for full message object before rendering
   - CSS transitions or animations delay visual appearance
   - Custom fetch implementation that reads the full response before passing to UI

3. The correct streaming behaviour:
   - First token arrives → thinking indicator starts fading out → text begins appearing
   - Each subsequent token appends to the visible message in real-time
   - Message bubble grows smoothly as more text arrives (no height jumps)
   - Auto-scroll follows the streaming text with smooth scrolling (not jumping)
   - User sees text appearing word by word, feeling alive and real-time
   - When streaming completes → activity steps fade in above the message

4. If the Vercel AI SDK useChat hook is already being used:
   - Ensure messages state updates on each stream chunk
   - Ensure the component re-renders incrementally (not batched)
   - Check that the message rendering doesn't wait for isLoading to become false before showing text

5. If using a custom implementation:
   - Switch to AI SDK streaming pattern OR
   - Implement a ReadableStream consumer that updates React state on each chunk
   - Use requestAnimationFrame or microtask batching for smooth rendering

6. Smooth auto-scroll during streaming:
   - Use scrollIntoView({ behavior: "smooth", block: "end" }) on each new chunk
   - Or use a scroll container ref and set scrollTop incrementally
   - Debounce scroll updates to every 100ms to avoid jank


PART D: SHARED COMPONENTS

Both Lead Qualification and Sales Closer chat panels MUST use the exact same components:
- Same thinking indicator component
- Same message bubble component (with Skyler avatar)
- Same streaming renderer
- Same activity steps component

If they currently use different chat components, consolidate into one shared component that both pages import. The only difference between pages is the pageContext sent with messages (from Stage 14 Part B).

Create or consolidate into:
- components/skyler/SkylerThinkingIndicator.tsx — the three-state thinking animation
- components/skyler/SkylerMessage.tsx — message bubble with avatar, handles streaming state
- components/skyler/SkylerActivitySteps.tsx — collapsible activity steps
- components/skyler/SkylerChat.tsx — the full chat panel that composes all of the above

Both pages import SkylerChat. Page context is passed as a prop.


TESTING:

1. Avatar: Send a message on Sales Closer. Verify Skyler's avatar image appears to the left of every response. Verify user messages do NOT have an avatar.

2. Thinking — State A: Send a message. Verify: Skyler avatar with pulsing glow + three animated dots + "Skyler is thinking..." text appears immediately.

3. Thinking — State B: Tag a lead and ask something that triggers tool calls. Verify: thinking text updates to describe what Skyler is doing ("Looking up Ayomide...", "Checking the pipeline..."). Verify progress line animates.

4. Streaming: Send "what's the update". Watch the response. It must stream in word by word, NOT appear all at once. You should see text progressively filling the message bubble over 2-5 seconds.

5. Transition: Verify the thinking indicator fades out smoothly as the first token of the response appears. No gap, no flash, no moment of nothing.

6. Activity steps: After response completes, verify "Done — N steps" fades in above the message with skyler-orange check marks. Click to expand and see step details.

7. Both pages: Repeat tests 1-6 on Lead Qualification page. Behaviour must be identical.

8. History: Load a previous conversation. Verify historical messages show Skyler's avatar and activity steps correctly (no thinking animation on historical messages, just the completed state).

Deploy and test streaming first — that's the most impactful change.
```

**Done when:**
- Skyler avatar image appears on every Skyler response message (matching CleverBrain's pattern)
- Thinking indicator shows three animated states: thinking → tool call → complete
- All indicators use skyler-orange, not green
- Tool calls show human-friendly descriptions ("Checking your calendar...")
- Responses stream token by token, visibly, like Claude.ai
- Seamless transition from thinking → streaming → activity steps with no gaps
- Both Lead Qualification and Sales Closer use identical shared components
- Historical messages render correctly with avatar and activity steps



# STAGE 15: Self-Healing Pipeline Engine

**Goal:** The pipeline never freezes. Stages progress based on reality, not webhooks. Missed events are caught within minutes. Every transition is validated against a state machine. The system works correctly even if every webhook fails.

---

## Why This Matters

Ayomide committed to £2000 during a demo call days ago. Her pipeline stage is still "demo_booked" because the Recall AI completion webhook never fired. The entire pipeline is event-dependent: if one webhook fails, the lead is stuck forever. This stage makes that structurally impossible.

---

## Architecture: Additive, Not Disruptive

IMPORTANT: This builds ON TOP of everything that already works. Nothing is removed. Nothing is replaced. The existing reasoning engine, Inngest functions, webhook handlers, and chat routes all continue working exactly as they do now. This stage adds four defence layers around them.

Think of it like adding a safety net under a trapeze. The trapeze (webhooks + reasoning engine) still works. The net (reconciliation + watchdog + FSM) catches anything that falls through.

---

## Prompt for CC:

```
Stage 15: Self-Healing Pipeline Engine.

5 parts. Build in order. Each part is additive — it enhances the existing system without changing it. Nothing gets removed. Read everything before starting.

The core principle: pipeline stage should be VERIFIED against reality, not blindly trusted from the last event that fired. If a webhook fails, the system catches the inconsistency and corrects it within minutes.


PART A: PIPELINE EVENT LOG (Event Sourcing)

Every pipeline change gets logged as an immutable event. This gives full auditability and enables replay.

1. Create a migration with:

   CREATE TABLE pipeline_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     lead_id UUID NOT NULL,
     event_type TEXT NOT NULL,
     from_stage TEXT,
     to_stage TEXT,
     payload JSONB DEFAULT '{}',
     source TEXT NOT NULL,
     source_detail TEXT,
     confidence FLOAT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE INDEX idx_pipeline_events_lead ON pipeline_events(lead_id, created_at DESC);

   Source values:
   - 'webhook' — triggered by an external webhook (email reply, Recall, Calendly)
   - 'reasoning_engine' — decided by Skyler's reasoning layer
   - 'user_action' — manual action by the user (approve, reject, stage change)
   - 'reconciliation' — detected and corrected by the reconciliation layer
   - 'watchdog' — triggered by a timeout/watchdog timer
   - 'chat' — triggered from a Skyler chat interaction

2. Wire into the existing stage update function:
   
   Find wherever the pipeline stage gets updated in the codebase (likely in execute-decision.ts, 
   the approval handler, and any direct stage update functions). BEFORE each update, insert a 
   pipeline_events record logging what changed, from what, to what, and why.

   This is purely additive. The existing UPDATE still happens. We're just also logging it.

3. Do NOT change how stages are stored or read. The existing skyler_sales_pipeline table 
   continues to be the source of truth for current stage. The event log is for audit, 
   reconciliation, and debugging.


PART B: FINITE STATE MACHINE (Transition Validation)

A transition map that defines which stage changes are valid. Invalid transitions get blocked before they happen.

1. Create lib/skyler/pipeline/state-machine.ts:

   Define the complete transition map:

   const VALID_TRANSITIONS: Record<string, string[]> = {
     // Phase 1: Prospecting
     'initial_outreach': ['follow_up_1', 'replied', 'no_response', 'disqualified'],
     'follow_up_1': ['follow_up_2', 'replied', 'no_response', 'disqualified'],
     'follow_up_2': ['follow_up_3', 'replied', 'no_response', 'disqualified'],
     'follow_up_3': ['replied', 'no_response', 'disqualified'],

     // Phase 2: Engaged
     'replied': ['demo_booked', 'negotiation', 'pending_clarification', 'proposal', 'stalled', 'disqualified', 'closed_lost'],
     'pending_clarification': ['replied', 'demo_booked', 'negotiation', 'stalled', 'disqualified'],
     'demo_booked': ['negotiation', 'proposal', 'pending_clarification', 'stalled', 'disqualified', 'closed_lost'],
     'negotiation': ['proposal', 'demo_booked', 'pending_clarification', 'payment_secured', 'closed_won', 'closed_lost', 'stalled'],
     'proposal': ['negotiation', 'payment_secured', 'closed_won', 'closed_lost', 'stalled'],

     // Phase 3: Resolved (generally terminal, but allow re-engagement)
     'payment_secured': ['closed_won'],
     'closed_won': [],  // Terminal
     'closed_lost': [], // Terminal (re-engagement creates a NEW pipeline entry)
     'meeting_booked': ['demo_booked', 'negotiation', 'stalled'],
     'no_response': ['replied', 'stalled'], // Can re-engage
     'stalled': ['replied', 'follow_up_1', 'disqualified', 'closed_lost'], // Can restart
     'disqualified': [], // Terminal
   };

   Export functions:
   
   isValidTransition(fromStage: string, toStage: string): boolean
   — Returns true if the transition is in the map. Returns false (blocks) if not.
   
   getValidNextStages(currentStage: string): string[]
   — Returns all valid next stages from the current one. Used by the reasoning engine 
     to know what options are available.

   validateAndLog(leadId: string, fromStage: string, toStage: string, source: string): 
     { valid: boolean, reason?: string }
   — Checks validity, logs to pipeline_events if valid, returns error reason if not.

2. Wire into every stage update path:
   
   Before any stage change happens, call isValidTransition(). If invalid:
   - Log the attempted invalid transition to pipeline_events with event_type = 'invalid_transition'
   - Do NOT update the stage
   - Log a warning (but don't crash — this is defensive, not blocking)
   
   If valid:
   - Log the transition to pipeline_events
   - Proceed with the existing stage update

3. Wire into the reasoning engine's decision schema:
   
   When the reasoning engine outputs an update_stage action, include the valid next stages 
   in the prompt context:
   
   "Current stage: demo_booked. Valid next stages: negotiation, proposal, pending_clarification, 
   stalled, disqualified, closed_lost."
   
   This helps Claude make valid decisions without needing to be corrected after the fact.


PART C: RECONCILIATION LAYER (Self-Healing)

A periodic check that compares pipeline state against reality and corrects any inconsistencies.

1. Create lib/inngest/functions/reconcile-pipeline.ts:

   Inngest function, runs every 15 minutes via cron.

   Step 1: Load all active leads (not in terminal states: closed_won, closed_lost, disqualified)

   Step 2: For each active lead, run consistency checks:

   CHECK 1 — Meeting completed but stage not advanced:
   Query: leads in 'demo_booked' where a calendar_events record exists with 
   end_time < NOW() - INTERVAL '2 hours' AND no_show_detected = false
   Fix: Emit 'pipeline/lead.evaluate' event to trigger AI evaluation of this lead.
   This is the EXACT fix for Ayomide.

   CHECK 2 — Transcript exists but not processed:
   Query: leads where meeting_transcript is non-empty but meeting_outcome is null
   AND the meeting ended more than 30 minutes ago
   Fix: Emit 'skyler/meeting.transcript.ready' to trigger the processing chain.
   This catches the Recall webhook failure directly.

   CHECK 3 — Lead gone silent after engagement:
   Query: leads in engaged stages (replied, pending_clarification, negotiation, proposal) 
   where last activity was more than 14 days ago AND stage is not 'stalled'
   Fix: Emit 'pipeline/lead.evaluate' with reason 'stale_engagement'

   CHECK 4 — Follow-up exhausted but still in prospecting:
   Query: leads in follow_up_3 where the last email was sent more than 7 days ago 
   with no reply
   Fix: Emit stage change to 'no_response' (direct, no AI needed — this is deterministic)

   CHECK 5 — Stage doesn't match latest signals:
   Query: leads where the most recent pipeline_event suggests a different stage than 
   what's currently stored (drift detection)
   Fix: Emit 'pipeline/lead.evaluate' with reason 'state_drift'

   Each check emits events for individual leads — it does NOT update stages directly.
   The existing reasoning engine or the direct stage update handler processes those events.
   This keeps the reconciliation layer purely detective, not corrective.

2. Important: the reconciliation function must be IDEMPOTENT. 
   Running it 10 times produces the same result as running it once.
   Use the pipeline_events table to check if a correction was already emitted 
   for this lead in the last 30 minutes before emitting another.


PART D: WATCHDOG TIMERS (Per-Lead Deadlines)

Every lead gets a durable timer. If nothing happens within the deadline, the system forces a re-evaluation.

1. Create lib/inngest/functions/lead-watchdog.ts:

   Triggered by: pipeline/lead.entered-stage (emitted whenever a lead's stage changes)

   The watchdog function:
   - Reads the new stage from the event
   - Looks up the timeout for that stage
   - Sleeps for that duration (Inngest step.sleep — zero compute while waiting)
   - When the timer fires: emit 'pipeline/lead.evaluate' with reason 'watchdog_timeout'

   Stage timeouts:
   - initial_outreach: 3 days (should send first follow-up within 3 days)
   - follow_up_1: 5 days
   - follow_up_2: 5 days
   - follow_up_3: 7 days (final follow-up, wait longer)
   - replied: 3 days (if no action after reply, something's wrong)
   - demo_booked: 48 hours after scheduled meeting end time
   - pending_clarification: 5 days
   - negotiation: 14 days
   - proposal: 14 days
   - stalled: 30 days (long timeout before cleanup)
   - meeting_booked: 48 hours after meeting time

   Auto-cancel: Use Inngest's cancelOn to cancel the current watchdog whenever 
   the lead's stage changes. The new stage triggers a new watchdog with its own timeout.

   cancelOn: [{ 
     event: 'pipeline/lead.entered-stage', 
     if: 'async.data.leadId == event.data.leadId' 
   }]

   This means: if Ayomide moves from demo_booked to negotiation, the 48-hour watchdog 
   for demo_booked is cancelled and a 14-day watchdog for negotiation starts.

2. Emit 'pipeline/lead.entered-stage' from every stage update path:
   
   Wherever the stage gets updated, also emit this event with { leadId, stage, timestamp }.
   This starts the watchdog for the new stage and cancels the old one.

3. For the demo_booked timeout specifically:
   
   The 48-hour timer should start from the MEETING'S scheduled end time, not from when 
   the stage changed. Look up the calendar_events for this lead and use end_time + 48 hours.
   
   If no calendar event exists (meeting was booked externally), start from when the stage 
   changed to demo_booked.


PART E: PRE-COMPUTED CONTEXT FOR AI REASONING

Fix the Ayomide "demo coming up" bug. Pre-compute temporal facts in JavaScript before Claude sees them.

1. Update the context assembler (lib/skyler/reasoning/context-assembler.ts):

   When loading context for a lead, add a meeting status computation:

   Query calendar_events for this lead:
   - next_upcoming_meeting: calendar_events WHERE lead_id = X AND start_time > NOW() 
     AND status = 'confirmed' ORDER BY start_time ASC LIMIT 1
   - last_completed_meeting: calendar_events WHERE lead_id = X AND end_time < NOW() 
     ORDER BY end_time DESC LIMIT 1
   - meetings_today: calendar_events WHERE lead_id = X AND DATE(start_time) = CURRENT_DATE

   Format into the context block:

   If last meeting exists and no upcoming meeting:
   "Meetings: Last meeting was [relative time, e.g. '3 days ago'] on [date]. [Summary snippet if available]. No upcoming meetings."

   If upcoming meeting exists:
   "Meetings: Next meeting is [relative time, e.g. 'tomorrow at 2pm']. [N] past meetings on record."

   If both:
   "Meetings: Last meeting was [time ago]. Next meeting is [time]. [Summary of last]."

   If none:
   "Meetings: No meetings scheduled or completed."

2. Add stage staleness detection:

   If stage is 'demo_booked' but last_completed_meeting exists and end_time < NOW():
   Add to context: "Note: Stage is still 'demo_booked' but the demo already happened 
   [time ago]. Stage likely needs updating based on the meeting outcome."

   If stage is any prospecting stage but a reply exists in the email thread:
   Add to context: "Note: Stage is '[stage]' but the lead has replied. Stage may need 
   updating to 'replied'."

   These notes prompt the reasoning engine to self-correct without hardcoding the correction.

3. Pre-compute ALL temporal values. Claude should never see raw timestamps and have to 
   figure out "is this in the past or future?" Compute in JavaScript:
   - "3 days ago" not "2026-03-15T10:00:00Z"
   - "tomorrow at 2pm" not "2026-03-19T14:00:00Z"
   - "overdue by 2 days" not just a due date
   - "in stage for 5 days" not just the stage entry timestamp


WIRING: EMIT EVENTS FROM EXISTING CODE

The new system needs events to flow. Add event emissions to existing code WITHOUT changing 
the existing behaviour:

1. Wherever the pipeline stage is updated (execute-decision.ts, approval handler, 
   direct stage update functions):
   - AFTER the update succeeds, emit 'pipeline/lead.entered-stage' with { leadId, stage }
   - AFTER the update succeeds, insert a pipeline_events record
   - These are fire-and-forget (use Inngest send, not await)

2. Wherever a meeting is created or updated in calendar_events:
   - AFTER the insert/update, emit 'pipeline/meeting.status-changed' with { leadId, eventId, status }

3. Wherever an email is sent or received:
   - AFTER processing, emit 'pipeline/email.activity' with { leadId, direction, sentiment }

These events feed the watchdog timers (Part D) and can trigger reconciliation checks.
The existing code continues to work exactly as before. We're just also emitting events.


INNGEST FUNCTIONS TO REGISTER:

1. reconcile-pipeline.ts — cron every 15 minutes, runs 5 consistency checks
2. lead-watchdog.ts — triggered by pipeline/lead.entered-stage, sleeps then re-evaluates

Modified (add event emissions only):
3. execute-decision.ts — emit pipeline/lead.entered-stage after stage updates
4. context-assembler.ts — add meeting status computation + stage staleness detection
5. Whatever file handles stage updates — log to pipeline_events + emit entered-stage


TESTING:

1. Event logging: Change any lead's stage manually. Verify a pipeline_events record is created 
   with the correct from_stage, to_stage, and source.

2. FSM validation: Try to move a lead from 'initial_outreach' directly to 'closed_won' via 
   the reasoning engine. Verify it's blocked. Check pipeline_events for an 'invalid_transition' log.

3. Valid transitions: Move a lead from 'demo_booked' to 'negotiation'. Verify it's allowed 
   and logged.

4. Reconciliation — Ayomide fix: Run the reconciliation function. Verify it detects Ayomide 
   in 'demo_booked' with a completed meeting, and emits a corrective evaluation event. 
   After the evaluation runs, verify Ayomide's stage progresses.

5. Watchdog: Move a test lead to 'replied'. Check that a watchdog timer was scheduled 
   (visible in Inngest dashboard). The timer should be set for 3 days from now.

6. Watchdog cancel: Move the same lead to 'demo_booked'. Verify the old 'replied' watchdog 
   was cancelled and a new 'demo_booked' watchdog started.

7. Pre-computed context: Ask Skyler about Ayomide in chat. Verify she says "the demo already 
   happened 3 days ago" not "the demo is coming up." The context should include the pre-computed 
   meeting status.

8. Stage staleness: Check that the context for Ayomide includes a note about the stage 
   needing updating.

9. Reconciliation idempotency: Run the reconciliation function twice in a row. Verify it 
   doesn't emit duplicate correction events for the same lead.

10. Full flow: Create a new test meeting for a lead. Let it "complete" (end_time passes). 
    Don't fire any webhook. Wait 15 minutes for reconciliation. Verify the lead's stage 
    progresses automatically.

Deploy and test the Ayomide fix first (Part C + Part E). The reconciliation should 
catch her immediately and progress her stage.
```

**Done when:**
- Every stage change is logged to pipeline_events with source and reason
- Invalid transitions are blocked by the FSM before they happen
- Reconciliation runs every 15 minutes and catches: completed meetings with stuck stages, unprocessed transcripts, stale engagements, exhausted follow-ups, state drift
- Watchdog timers fire for every active lead, auto-cancel on stage change, force re-evaluation on timeout
- Pre-computed meeting status in context: "demo happened 3 days ago" not raw timestamps
- Stage staleness notes prompt the reasoning engine to self-correct
- Ayomide's stage progresses within 15 minutes of deploying (reconciliation catches it)
- The entire system is additive: existing code continues working, new layers catch what falls through
- Running reconciliation multiple times produces the same result (idempotent)


# STAGE 15.1: Pipeline Systemic Fixes & No-Show Recovery System

**Goal:** Fix every known pipeline failure. Meetings never go unprocessed regardless of how they enter the system. No-shows are detected, flagged, and re-engaged automatically. The pipeline never freezes again.

---

## Prompt for CC:

```
Stage 15.1: Pipeline Systemic Fixes & No-Show Recovery System.

4 parts. Build in order. Each part is interconnected. Read everything before starting.


PART A: SCHEMA MISMATCH FIX (Highest Priority)

The code references a 'pipeline_id' column on skyler_actions that doesn't exist in the database.
This blocks ALL AI-driven actions for ALL leads — not just one lead, everyone.

1. Search the entire codebase for every reference to 'pipeline_id' on the skyler_actions table.
   Check: queries, inserts, updates, type definitions, Supabase client calls.

2. Compare against the actual skyler_actions table schema in Supabase.
   What columns actually exist? What is the correct column name for linking to the pipeline?

3. Fix every reference to use the correct column name. If the column genuinely doesn't 
   exist and should, add it via a Supabase migration.

4. Check if this same mismatch exists on any other tables. Search for 'pipeline_id' 
   across the entire codebase and verify each reference matches the actual schema.

5. Test by triggering an AI action (have Skyler draft an email or update a stage). 
   Verify it executes without the schema cache error.


PART B: SINGLE MEETING LIFECYCLE ENTRY POINT

The root problem: there are multiple ways a meeting enters the system:
- Skyler books it via chat (book-meeting-flow.ts)
- Meeting detector finds it via calendar sync (meeting-detector.ts)
- Calendly webhook creates it
- User books directly in Outlook/Google Calendar

Only book-meeting-flow.ts schedules lifecycle tasks. Every other path creates orphaned 
meetings with no post-meeting handling.

The fix: ONE trigger point, many creation paths.

1. Create a single Inngest function: 'skyler/meeting.lifecycle-start'

   This function is triggered whenever a new calendar_events row is created (or updated 
   to have a lead_id) WHERE lead_id IS NOT NULL. This is the ONLY place lifecycle tasks 
   are scheduled.

   Option A (preferred): Use Supabase database webhook/trigger that fires on INSERT 
   to calendar_events where lead_id is not null, which emits the Inngest event.
   
   Option B: Add the Inngest event emission to every creation path. Less ideal but works 
   if Option A is complex. If using this approach, add it to: book-meeting-flow.ts, 
   meeting-detector.ts, any Calendly webhook handler, and any manual creation endpoint.
   Use an idempotency key (calendar_event_id) so duplicate emissions are safe.

2. The lifecycle function schedules ALL of these for every sales meeting:

   a) Pre-call brief: step.sleepUntil(meeting_start_time - 30 minutes)
      Then generate and deliver the brief via Slack/email.

   b) Transcript recovery: step.sleepUntil(meeting_end_time + 5 minutes)
      Then step.waitForEvent('skyler/meeting.transcript.ready', { timeout: '5m' })
      - If event received: transcript delivered via webhook, processing chain handles it
      - If timeout: Call Recall API directly to fetch transcript for this meeting's bot
        - If Recall has recording data: save transcript, emit 'skyler/meeting.transcript.ready'
        - If Recall has NO recording data: this is a no-show. Emit 'skyler/meeting.no-show'

   c) No-show check: Handled by the transcript recovery step above. If no transcript 
      AND no recording exists, it's a no-show. No separate function needed.

   d) Watchdog timer: From Stage 15 Part D. Emit 'pipeline/lead.entered-stage' which 
      triggers the existing watchdog.

3. Remove the schedulePostBookingTasks() calls from book-meeting-flow.ts. 
   All lifecycle scheduling now goes through the single trigger.
   
   IMPORTANT: Don't remove the function itself yet — just stop calling it from 
   book-meeting-flow.ts. The new lifecycle function replaces its job.

4. Idempotency: Use the calendar_event_id as the idempotency key on the Inngest function.
   If the same meeting triggers the lifecycle twice (e.g., from both book-meeting-flow 
   and meeting-detector), the second run is a no-op.


PART C: NO-SHOW DETECTION & RE-ENGAGEMENT SYSTEM

When a no-show is detected, Skyler flags the lead and starts a re-engagement sequence.
The pipeline stage does NOT change immediately — no-show is a flag, not a stage.

1. No-show detection:
   
   Triggered by Part B's transcript recovery step when Recall has no recording data.
   Also triggered if: meeting end_time passed + 10 minutes AND no transcript AND 
   no attendees detected.

   When a no-show is confirmed:
   - Set no_show_detected = true on the calendar_events record
   - Set no_show_count on the lead record (increment, don't overwrite — tracks repeat no-shows)
   - Log to pipeline_events: { event_type: 'no_show_detected', source: 'lifecycle' }
   - Create a meeting_health_signal: { signal_type: 'no_show', severity: 'high' }
   - DO NOT change the pipeline stage yet. Lead stays in demo_booked (or wherever it was).

2. Re-engagement sequence:
   
   After flagging the no-show, start a 5-touch re-engagement sequence.
   This is an Inngest function: 'skyler/no-show.re-engage'

   The sequence is NOT hardcoded. Each touch is generated by the reasoning engine 
   (Claude Sonnet) with full context about the lead, the connected integrations, 
   and what happened. The reasoning engine decides the content and channel for each touch.

   Context provided to the reasoning engine for each touch:
   
   <no_show_context>
   Lead: {name}, {company}
   Meeting that was missed: {meeting_title}, scheduled {date/time}
   No-show count: {count} (first no-show vs repeat)
   Previous engagement: {summary of email history, replies, sentiment}
   
   Connected integrations: {list — e.g., "Outlook calendar, Gmail email" or "Calendly, Gmail"}
   
   Rebooking capability:
   - If Calendly connected: You can include a Calendly booking link for the lead to pick a time
   - If only Outlook/Google Calendar: You can check the user's availability and suggest 
     2-3 specific time slots. When the lead replies with a preference, you can book directly.
   - If no calendar connected: Ask the lead to suggest times. Flag the user to book manually.
   
   Touch number: {1-5} of 5
   Tone guidance:
   - Touch 1 (immediate): Quick, empathetic. "Something came up? Here's how to reconnect."
   - Touch 2 (same day): Slightly more formal. Restate value. Include rebooking option.
   - Touch 3 (24-48h): New angle. Share a relevant case study or resource.
   - Touch 4 (3-5 days): Alternative format. Offer async demo or recorded walkthrough.
   - Touch 5 (7 days): "Closing the loop" — direct, brief. Last attempt before moving on.
   
   Keep emails under 125 words. Subject lines under 7 words.
   Never blame the lead for missing the meeting.
   Each touch must add new value, not repeat the same ask.
   </no_show_context>

   The Inngest function schedules each touch with appropriate delays:
   - Touch 1: immediately (5-10 minutes after no-show detection)
   - Touch 2: 3 hours later
   - Touch 3: 24 hours later
   - Touch 4: 72 hours later (3 days)
   - Touch 5: 168 hours later (7 days)

   Between each touch, use step.waitForEvent to listen for a reply:
   step.waitForEvent('skyler/email.reply-received', { 
     timeout: [time until next touch],
     if: 'async.data.leadId == event.data.leadId' 
   })
   
   If a reply is received at ANY point:
   - Cancel remaining touches
   - Let the reasoning engine evaluate the reply
   - If they want to reschedule: book via available calendar integration, 
     reset no_show flag, stay in demo_booked
   - If they're not interested: move to closed_lost with reason

3. Stage progression rules (after re-engagement):

   These are deterministic, not AI-decided:
   
   - Lead replies and reschedules → stay in demo_booked, reset no_show flag, new meeting lifecycle starts
   - 48 hours, no response after Touch 2 → move to pending_clarification
   - All 5 touches exhausted, no response → move to stalled
   - Second no-show on a rescheduled meeting → move to closed_lost with reason 'repeat_no_show'
   - Lead explicitly declines → move to closed_lost with reason from reply

   Log every stage change to pipeline_events with source = 'no_show_reengagement'

4. Notifications:

   When a no-show is detected:
   - Send Slack notification to workspace (if connected): 
     "❌ [Lead Name] no-showed the [meeting time] demo. I've started a re-engagement sequence."
   - Send email notification to workspace owner (via Resend):
     Same message, includes link to lead in the app.
   
   When re-engagement gets a response:
   - Slack: "🔄 [Lead Name] replied to re-engagement. [Brief summary]. [Link to conversation]"
   
   When re-engagement is exhausted with no response:
   - Slack: "⏸️ [Lead Name] hasn't responded after 5 re-engagement attempts. Moved to stalled."


PART D: UI — NO-SHOW VISIBILITY

Make the no-show status and re-engagement progress visible in the lead cards and detail view.

1. Lead card (in the lead list on Lead Qualification and Sales Closer pages):

   When a lead has no_show_detected = true AND re-engagement is active:
   - Show a red "NO-SHOW" pill badge on the card, below the lead name
   - Show an amber "RE-ENGAGING" pill badge next to it (while sequence is active)
   - Show the last AI action below: "✨ Email sent 2h ago" (small text, t4 colour)
   - Show next scheduled action: "Next: Follow-up in 22h" (small text, t4 colour)
   - Left border of the card shifts to amber (#F2903D)

   When re-engagement is complete (lead responded or sequence exhausted):
   - Remove "RE-ENGAGING" badge
   - "NO-SHOW" badge stays but fades to grey (historical indicator)
   - Show outcome: "Rescheduled for Mar 22" or "Moved to stalled"

   Badge styles:
   - NO-SHOW: background rgba(229,69,69,0.1), text #E54545, font-size 9px, 
     padding 2px 8px, border-radius 4px, font-weight 600
   - RE-ENGAGING: background rgba(242,144,61,0.1), text #F2903D, same sizing

2. Lead detail view / activity timeline:

   Each event in the timeline should be visually distinct by type:

   Meeting events: Default card style
   No-show events: Red left border accent, ❌ icon
   AI actions: Light tinted background (rgba(242,144,61,0.05)), ✨ sparkle prefix
   Stage changes: Blue pill badge showing old → new stage
   User actions: Default style, user avatar

   For the no-show scenario, the timeline should read:
   
   📅 Mar 17, 10:00 AM — Demo with Doubra Adekola
   ❌ Mar 17, 10:10 AM — No-show detected
   ✨ Mar 17, 10:15 AM — Re-engagement email sent [expandable to see content]
   ✨ Mar 17, 10:15 AM — Follow-up scheduled for Mar 18, 10:00 AM
   ✨ Mar 18, 10:00 AM — Follow-up email sent [expandable]
   ...

   Each AI action entry (✨) should be expandable to show:
   - What Skyler did
   - Why (brief reasoning)
   - The actual email content (if applicable)
   - An "Override" button to cancel/modify the action

3. Skyler chat awareness:

   When the user asks about a lead with a no-show, Skyler should know about it 
   from the pre-computed context (Stage 15 Part E). She should say something like:
   "Doubra no-showed the demo yesterday. I've already sent a follow-up and have 
   another one scheduled for tomorrow. No reply yet. Want me to try a different approach?"

   Add no-show status to the context assembler output:
   - no_show_count: number of no-shows for this lead
   - re_engagement_status: 'active' | 'completed' | 'none'
   - re_engagement_touch: current touch number (e.g., "touch 3 of 5")
   - last_re_engagement_action: "Email sent 2h ago, no reply"
   - next_re_engagement_action: "Follow-up email scheduled for tomorrow 10am"


TESTING:

1. Schema fix: Trigger any AI action (email draft, stage update). Verify no 
   "pipeline_id column not found" error.

2. Single lifecycle: Create a meeting via calendar sync (not through Skyler chat). 
   Verify lifecycle tasks are scheduled (check Inngest dashboard for the function).

3. Transcript recovery: Create a test meeting that has ended. Don't fire any webhook. 
   Verify the lifecycle function waits 5 minutes then attempts to fetch from Recall API.

4. No-show detection: Create a meeting that has ended with no transcript and no recording. 
   Verify: no_show_detected = true on calendar_events, no_show_count incremented on lead, 
   pipeline_events logged, Slack notification sent.

5. Re-engagement Touch 1: After no-show detection, verify an email is drafted and sent 
   (or queued for approval) within 10 minutes. Check the email content is empathetic 
   and includes a rebooking option appropriate to the connected calendar integration.

6. Re-engagement cancellation: Simulate a reply from the lead during the sequence. 
   Verify remaining touches are cancelled, reasoning engine evaluates the reply.

7. Stage progression — 48h rule: After Touch 2 with no response, verify stage moves 
   to pending_clarification.

8. Stage progression — exhausted: After all 5 touches with no response, verify stage 
   moves to stalled.

9. Stage progression — reschedule: Simulate a lead replying "let's do Thursday instead." 
   Verify no_show flag resets, new meeting is booked (if calendar connected), 
   stage stays at demo_booked, new lifecycle starts for the new meeting.

10. Second no-show: Create a second no-show for the same lead. Verify stage moves 
    to closed_lost with reason 'repeat_no_show'.

11. UI — lead card: View a lead with an active no-show re-engagement. Verify 
    "NO-SHOW" and "RE-ENGAGING" badges appear, last/next AI action shown.

12. UI — timeline: View the lead detail. Verify timeline shows the no-show event, 
    AI actions with ✨ prefix and tinted background, expandable email content.

13. Skyler chat: Tag the no-show lead and ask "what's happening with [name]?" 
    Verify Skyler mentions the no-show and re-engagement status conversationally.

14. Integration awareness: Test with Outlook (no Calendly). Verify re-engagement 
    emails suggest specific time slots instead of a booking link. Test with Calendly 
    connected. Verify emails include the Calendly link.

15. Idempotency: Trigger the lifecycle function twice for the same meeting. 
    Verify it only runs once (second is a no-op).

Deploy and run tests 1-5 first. Those cover the critical path.
```

**Done when:**
- Schema mismatch is fixed, all AI actions execute without errors
- Every sales meeting gets full lifecycle regardless of how it was created
- Transcripts are recovered within 5 minutes of meeting end if webhook fails
- No-shows are detected, flagged (not stage-changed), and re-engaged automatically
- 5-touch re-engagement sequence runs with integration-aware rebooking
- Stage changes happen based on re-engagement outcomes, not the no-show event
- Lead cards show NO-SHOW and RE-ENGAGING badges with AI action summaries
- Timeline shows AI actions with ✨ prefix and expandable details
- Skyler knows about no-show status in chat context
- Notifications go to Slack and email on detection and outcome
- Re-engagement adapts to connected integrations (Calendly link vs suggested time slots)
- Second no-show moves to closed_lost
- Doubra and every future no-show lead gets caught automatically