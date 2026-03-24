---
name: skyler-reasoning-engine
description: Use when building, modifying, or debugging Skyler's AI-first reasoning engine, multi-LLM routing, structured decision outputs, guardrail engine, workflow settings integration, user directives, the request loop, or any part of Skyler's autonomous decision-making pipeline. This skill covers the architecture that replaces Skyler's rule-based event handling with a central AI reasoning layer. Always consult this skill when touching Skyler's system prompt assembly, event processing, action execution, approval workflows, or escalation logic. Also use when working on Recall AI meeting integration, decision memory, or context engineering for Skyler.
---

# Skyler Reasoning Engine -- Implementation Guide

## Before You Start

**Read the full architecture document first:**
`skyler-reasoning-architecture.md` (should be in the project root or provided alongside this skill)

That document explains the WHY and WHAT. This skill explains the HOW.

---

## Architecture Overview (Quick Reference)

Every event Skyler handles follows this pipeline:

```
Event -> Inngest -> Classify (GPT-4o-mini) -> Assemble Context -> Reason (Claude Sonnet) -> Guardrail Check -> Execute
```

Four possible outcomes from the guardrail engine:
1. **Auto-execute** -- do it immediately
2. **Await approval** -- queue with Approve/Reject buttons, pause via `step.waitForEvent()`
3. **Request info** -- surface banner on lead card, pause until user responds
4. **Escalate** -- send to configured channel (Slack/email/task from Workflow Settings)

---

## Implementation Phases (Build In This Order)

### Phase 1: Wire Workflow Settings into Skyler's System Prompt

**Goal:** Every decision Skyler makes is informed by the user's sales process, pricing, communication style, and autonomy rules.

**What to do:**
1. Find where Skyler's system prompt is assembled (look for the pattern in the skyler-identity skill where `SKYLER_CORE_IDENTITY`, `WORKSPACE_MEMORIES`, `ACTIVE_SKILL`, etc. are concatenated)
2. Add a new section between CORE IDENTITY and WORKSPACE MEMORIES called `WORKFLOW_SETTINGS`
3. Load the user's Workflow Settings from the database for the current workspace
4. Format them into a structured prompt section

**System prompt assembly order (this order matters for prompt caching):**
```
[SKYLER CORE IDENTITY]           <-- Static. Cache this.
[WORKFLOW SETTINGS: BUSINESS]    <-- Semi-static (changes rarely). Cache with identity.
[WORKFLOW SETTINGS: AUTONOMY]    <-- Semi-static. Part of cached prefix.
[WORKSPACE MEMORIES]             <-- Dynamic per workspace.
[USER DIRECTIVES FOR THIS LEAD]  <-- Dynamic per lead. (Phase 4)
[ACTIVE SKILL]                   <-- Dynamic per task.
[CONVERSATION HISTORY]           <-- Dynamic per conversation.
[TOOL DEFINITIONS]               <-- Static-ish. Could cache.
```

**Prompt caching strategy:**
Put `cache_control: { type: "ephemeral" }` after the WORKFLOW SETTINGS block. Everything above that line (identity + settings) stays cached for 5 minutes. Everything below is dynamic. This saves ~90% on input tokens for the cached portion.

**How to format Workflow Settings in the prompt:**
```markdown
## Your Sales Configuration

### Sales Process
- Primary goal: {primary_goal}
- Sales journey: {sales_journey}
- Pricing structure: {pricing_structure}
- Average sales cycle: {average_sales_cycle}
- Average deal size: {average_deal_size}
- Max follow-up attempts: {max_followup_attempts}
- Book demos using: {book_demos_method}

### Communication Style
- Formality: {formality_level}
- Approach: {communication_approach}
- Always use these phrases: {phrases_to_use}
- NEVER use these phrases: {phrases_to_never_use}

### Your Autonomy Level
- Global mode: {full_autonomy | draft_and_approve}
- Can send follow-up emails autonomously: {yes/no}
- Can handle objections autonomously: {yes/no}
- Can book meetings autonomously: {yes/no}
- Must get approval for first outreach: {yes/no}

### Escalation Rules (ALWAYS escalate when)
- Deal value exceeds: ${threshold}
- Contact is VIP/key account
- Negative sentiment detected
- First contact with new lead
- C-suite contact involved
- Pricing negotiation detected
```

**Critical rules for implementation:**
- Load settings ONCE at the start of each reasoning call, not per-step
- If settings are not configured yet (new workspace), use sensible defaults and note in the prompt: "Note: Your workspace settings are not fully configured. I will use conservative defaults and seek approval for all actions."
- The "phrases to never use" list must ALSO be checked in the guardrail engine's output validation step, not just included in the prompt (LLMs can ignore instructions, the validation step is the safety net)
- Autonomy toggles and escalation rules are NOT part of the prompt -- they're checked in the guardrail engine code AFTER the reasoning layer outputs its decision

### Phase 2: Central AI Reasoning Layer

**Goal:** Replace all rule-based event handling with a single reasoning function that outputs structured decisions.

**What to do:**
1. Define the decision schema using Zod
2. Create a central `skyler-reasoning.ts` function that:
   - Receives any event type
   - Assembles full context
   - Calls Claude Sonnet with the structured output schema
   - Returns a validated decision object
3. Create a `guardrail-engine.ts` that checks the decision against settings
4. Create action executors for each action_type
5. Wire it all together in an Inngest function

**The decision schema:**
```typescript
import { z } from 'zod';

export const SkylerDecisionSchema = z.object({
  action_type: z.enum([
    'draft_email',
    'update_stage',
    'schedule_followup',
    'create_note',
    'request_info',
    'escalate',
    'do_nothing',
    'close_won',
    'close_lost',
  ]),
  parameters: z.object({
    email_content: z.string().optional(),
    email_subject: z.string().optional(),
    new_stage: z.string().optional(),
    followup_delay_hours: z.number().optional(),
    note_text: z.string().optional(),
    request_description: z.string().optional(),
    escalation_reason: z.string().optional(),
  }),
  reasoning: z.string().describe('Why this decision was made. Shown to the user for transparency.'),
  confidence_score: z.number().min(0).max(1),
  urgency: z.enum(['immediate', 'same_day', 'next_day', 'standard']),
});
```

**Guardrail engine check sequence (this order matters):**
```typescript
async function checkGuardrails(decision, settings, lead) {
  // 1. Escalation rules (hard overrides)
  if (settings.escalation_rules.deal_value && lead.deal_value > settings.escalation_rules.threshold) return 'escalate';
  if (settings.escalation_rules.vip && lead.is_vip) return 'escalate';
  if (settings.escalation_rules.negative_sentiment && decision.parameters.detected_sentiment === 'negative') return 'escalate';
  if (settings.escalation_rules.first_contact && lead.emails_sent === 0) return 'escalate';
  if (settings.escalation_rules.c_suite && lead.is_c_suite) return 'escalate';
  if (settings.escalation_rules.pricing_negotiation && decision.action_type === 'draft_email' && decision.parameters.involves_pricing) return 'escalate';

  // 2. If request_info, always allow (it's asking the user, not acting)
  if (decision.action_type === 'request_info') return 'request_info';

  // 3. Global autonomy check
  if (settings.global_autonomy === 'draft_and_approve') return 'await_approval';

  // 4. Per-action autonomy
  if (decision.action_type === 'draft_email' && !settings.can_send_followups) return 'await_approval';
  if (decision.action_type === 'draft_email' && decision.parameters.is_objection_response && !settings.can_handle_objections) return 'await_approval';
  if (decision.action_type === 'draft_email' && decision.parameters.is_meeting_request && !settings.can_book_meetings) return 'await_approval';

  // 5. First outreach override
  if (settings.require_approval_first_outreach && lead.emails_sent === 0) return 'await_approval';

  // 6. Confidence check
  if (decision.confidence_score < 0.5) return 'escalate';
  if (decision.confidence_score < 0.7) return 'await_approval';

  // 7. Output validation (for email actions)
  if (decision.action_type === 'draft_email') {
    const banned = checkBannedPhrases(decision.parameters.email_content, settings.phrases_to_never_use);
    if (banned.length > 0) return 'await_approval'; // Let user review flagged content
  }

  return 'auto_execute';
}
```

**Rollout strategy: Draft & Approve is the safety net.**
No shadow mode. Deploy the reasoning layer live but with the global autonomy level defaulted to "Draft & Approve." Every AI decision goes through the existing approval queue (Approve/Reject buttons on lead cards). Users see exactly what Skyler wants to do and why (the reasoning field from the structured output). Bad decisions get rejected with no harm done. Once the user trusts Skyler's decisions, they gradually toggle individual actions to Full Autonomy through Workflow Settings.

### Phase 3: Multi-LLM Routing

**Goal:** Route cheap tasks to GPT-4o-mini, medium tasks to Haiku, expensive reasoning to Sonnet.

**What to do:**
1. Install `@ai-sdk/anthropic` and `@ai-sdk/openai` if not already present
2. Create `lib/skyler/model-router.ts` with the customProvider setup
3. Create `lib/skyler/task-router.ts` that maps task types to tiers
4. Wrap all LLM calls in Inngest `step.run()` for durability
5. Add attempt-based fallback (retry with cheaper model on failure)

**Task-to-tier mapping:**
```typescript
const TASK_TIERS = {
  // Tier 1: GPT-4o-mini
  'classify_intent': 'fast',
  'detect_referral': 'fast',
  'extract_entities': 'fast',
  'classify_sentiment': 'fast',
  'extract_meeting_actions': 'fast',
  'summarise_company_research': 'fast',

  // Tier 2: Claude Haiku
  'summarise_thread': 'medium',
  'generate_knowledge_profile': 'medium',
  'extract_memories': 'medium',
  'summarise_meeting': 'medium',
  'generate_conversation_summary': 'medium',

  // Tier 3: Claude Sonnet
  'reason_about_event': 'complex',
  'compose_email': 'complex',
  'analyse_deal': 'complex',
  'handle_objection': 'complex',
  'plan_meeting_followup': 'complex',
} as const;
```

### Phase 4: Request Loop + User Directives

**Goal:** Skyler can ask the user for information, and users can give Skyler per-lead instructions.

**What to do:**

**Request loop:**
1. Add `request_info` to the action execution handlers
2. When triggered: create a `skyler_requests` record in Supabase with the lead_id, request description, and status='pending'
3. The lead card UI renders a banner when there's a pending request for that lead
4. When user responds in chat referencing that lead, the response handler:
   - Marks the request as fulfilled
   - Stores the user's response on the pipeline record
   - Emits a new Inngest event (`skyler/user-response`) that re-enters the pipeline
   - The reasoning layer now has the information it needed

**User directives:**
1. Create a `skyler_directives` table: id, lead_id, workspace_id, directive_text, created_at, created_by, is_active
2. When user gives an instruction about a specific lead in chat, detect it as a directive (use GPT-4o-mini classification: "is this a general question or a directive about how to handle this lead?")
3. Store the directive
4. In context assembly, load all active directives for the current lead
5. Format them in the prompt as: "User instructions for this lead: [directive text] (given on [date])"
6. On the lead card UI, add a small icon that shows a popover with all directives on hover

---

## File Structure Conventions

When creating new files for the reasoning engine, follow the existing project structure:

```
lib/skyler/
  reasoning/
    skyler-reasoning.ts       -- Central reasoning function
    decision-schema.ts        -- Zod schema for structured decisions
    guardrail-engine.ts       -- Autonomy + escalation checks
    context-assembler.ts      -- Gathers all context for reasoning
    output-validator.ts       -- Checks emails for banned phrases, PII, etc.
  routing/
    model-router.ts           -- Vercel AI SDK customProvider setup
    task-router.ts            -- Maps tasks to model tiers
  actions/
    execute-decision.ts       -- Routes decisions to action handlers
    draft-email.ts            -- Email composition handler
    update-stage.ts           -- Pipeline stage update handler
    schedule-followup.ts      -- Cadence timer handler
    request-info.ts           -- Lead card banner handler
    escalate.ts               -- Routes to configured channel
  memory/
    decision-memory.ts        -- Store/retrieve past decisions + corrections
    correction-capture.ts     -- Capture user overrides
    preference-distiller.ts   -- Summarise patterns into rules
```

Inngest functions go in the existing Inngest function directory (likely `inngest/functions/`).

---

## Testing Approach

### Golden dataset:
Build 50-100 test cases covering:
- Lead qualification decisions
- Follow-up timing and content
- Email tone and content
- Objection handling
- Escalation triggers
- Edge cases (calendar notifications vs real replies, one-word responses, forwarded emails)

### Rollout via Draft & Approve:
No shadow mode needed. Deploy with "Draft & Approve" as the default global autonomy level. Every decision goes through the approval queue. Review Skyler's decisions in real time through the existing UI. Track:
- Approval rate (how often you agree with Skyler's decisions)
- Rejection reasons (what patterns does she get wrong)
- Edge case handling (does she handle the tricky scenarios better than the old rules)

When approval rate exceeds 85% consistently and no dangerous decisions have been made, users can start toggling individual action types to Full Autonomy.

### Regression testing:
Use promptfoo (Node.js native, YAML-driven) for automated eval. Every change to the system prompt or decision schema runs against the golden dataset. Target >85% accuracy, >98% regression pass rate.

---

## Common Pitfalls

- **Don't put autonomy checks in the prompt.** The prompt tells Skyler the user's preferences so she can reason about them. The guardrail engine ENFORCES them in code. Double-gating prevents both missed enforcement and over-restriction.
- **Don't skip the output validation step.** Even with "phrases to never use" in the prompt, LLMs can ignore instructions. The code-level check is the safety net.
- **Don't load full transcripts into every reasoning call.** Use the hierarchical context approach: summary by default, full transcript loaded via tool only when the reasoning layer requests it.
- **Don't assume Workflow Settings exist.** New workspaces won't have settings configured. Default to "Draft & Approve" with conservative behaviour and prompt the user to configure settings.
- **Always check stop_reason on structured outputs.** Refusals and token truncation produce invalid JSON. Handle both with retry logic.
- **Use Inngest step.run() for every LLM call.** This gives you durability, retries, and observability for free. Never call the LLM directly outside a step.
- **User directives are per-lead, not global.** "Push for paid trial" applies to one lead, not all leads. Store and retrieve by lead_id.
- **The request loop pauses the workflow.** When Skyler requests info, the Inngest function pauses via step.waitForEvent(). It does NOT poll. It resumes only when the matching event arrives. Set a reasonable timeout (e.g., 7 days).

---

## Key References

- Skyler's current identity and runtime skills: `/mnt/skills/user/skyler-identity/SKILL.md`
- Anthropic structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Inngest step functions: https://www.inngest.com/docs/features/inngest-functions/steps-workflows/step-ai-orchestration
- Inngest waitForEvent: https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event
- Vercel AI SDK providers: https://ai-sdk.dev/docs/introduction