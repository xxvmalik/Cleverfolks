/**
 * Email Drafting Engine for Skyler Sales Closer.
 * Uses Claude Sonnet to craft personalised outreach emails based on
 * company research, sales voice, cadence step, and workspace context.
 *
 * Rules grounded in elite sales data:
 * - Cold emails: 50-100 words (sweet spot 60-80)
 * - 5th grade reading level (Boomerang data: 36% higher response)
 * - Interest CTAs beat calendar CTAs 2x (Gong)
 * - Trigger events → 5x conversion (Forrester)
 * - All-lowercase subject lines, 1-4 words
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CompanyResearch } from "@/lib/skyler/company-research";
import type { SalesVoice } from "@/lib/skyler/voice-learner";
import type { SalesPlaybook } from "@/lib/skyler/sales-playbook";
import { formatPlaybookForPrompt } from "@/lib/skyler/sales-playbook";
import { parseAIJson } from "@/lib/utils/parse-ai-json";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";

export type ConversationEntry = {
  role: string;
  content: string;
  subject?: string;
  timestamp: string;
};

export type SalesPipelineRecord = {
  id: string;
  contact_name: string;
  contact_email: string;
  company_name: string;
  stage: string;
  cadence_step: number;
  conversation_thread: ConversationEntry[];
};

export type LeadContext = {
  hubspot_deal_stage?: string;
  hubspot_deal_amount?: string;
  hubspot_deal_name?: string;
  hubspot_notes?: string[];
  form_data?: Record<string, string>;
  source?: string; // "form" | "hubspot" | "manual" | "scored"
};

export type DraftedEmail = {
  subject: string;
  htmlBody: string;
  textBody: string;
};

// ── Cadence angles with data-backed rules ────────────────────────────────────

const CADENCE_ANGLES: Record<string, string> = {
  initial_outreach: `FIRST COLD EMAIL. They have never heard from us.

STRUCTURE (50-100 words, sweet spot 60-80):
1. One sentence about THEIR situation (trigger event, pain point, or observation)
2. One or two sentences connecting our specific service to their situation
3. Interest CTA (NOT a calendar link)

SUBJECT LINE: all lowercase, 1-4 words, no punctuation. Examples: "quick question", "noticed something", "idea for [company]"
CTA EXAMPLES (interest-based, 2x booking rate vs calendar links):
- "Worth a look?"
- "Is this on your radar?"
- "Open to exploring this?"
- "Would this help?"
DO NOT use: "Let's hop on a call", "Book 15 minutes", "When are you free?"`,

  different_value_prop: `FOLLOW-UP 1 (3 days after initial). No reply yet.

STRUCTURE (50-80 words):
1. New angle — different value prop, insight, or question
2. DO NOT say "just checking in", "following up", "bumping this", "circling back"
3. Treat it as a brand new email with a fresh hook
4. Interest CTA

SUBJECT LINE: all lowercase, 1-3 words, completely different from first email.`,

  social_proof_or_case_study: `FOLLOW-UP 2 (7 days after initial). No reply to two emails.

STRUCTURE (40-70 words):
1. One specific result or proof point (number, percentage, company name if available)
2. Connect it to their situation in one sentence
3. Soft CTA

SUBJECT LINE: all lowercase, 1-3 words.
If no case study exists, share one specific industry insight.`,

  breakup_final_attempt: `BREAKUP EMAIL (14 days after initial). Final attempt.

STRUCTURE (30-60 words):
1. Acknowledge they're busy — no guilt, no passive-aggression
2. Close the loop cleanly
3. Leave the door open

SUBJECT LINE: "closing the loop" or similar. All lowercase.`,

  reply_followup: `PROSPECT REPLIED. This is now a warm conversation.

Read their reply carefully. Respond based on what they said:
- QUESTION → Answer directly with specific service details, then ask one follow-up
- INTEREST → Propose a specific next step (call, demo) with two time options
- OBJECTION → Use the PQVIR framework:
  * Pause: "That makes sense."
  * Question: Ask what specifically concerns them
  * Validate: Agree with the valid part
  * Isolate: "If we could solve X, would that change things?"
  * Reframe: Show how our service addresses it
- REMOVAL REQUEST → Be gracious, confirm removal, no guilt

Match their tone and energy. Reference what they actually said. Under 100 words.
SUBJECT LINE: Re: [original subject]`,
};

// ── Three lead scenarios ─────────────────────────────────────────────────────

function detectLeadScenario(params: {
  leadContext?: LeadContext | null;
  companyResearch: CompanyResearch;
  companyName: string;
  contactName: string;
}): { scenario: string; scenarioInstructions: string } {
  const { leadContext, companyResearch, companyName, contactName } = params;

  // Scenario 1: Form/inbound lead — they came to us
  if (leadContext?.source === "form" && leadContext.form_data) {
    const formFields = Object.entries(leadContext.form_data)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    return {
      scenario: "form_lead",
      scenarioInstructions: `SCENARIO: INBOUND LEAD — ${contactName} filled out a form on our site. They already showed interest.

FORM DATA:
${formFields}

APPROACH:
- Reference what they asked about or submitted
- They're warm — be direct about how we help
- Skip generic intros, go straight to value
- CTA: propose a specific next step`,
    };
  }

  // Scenario 2 & 2b: Company-level lead — we know the company, researched it
  if (companyName && companyName !== "Unknown" && companyResearch.summary && companyResearch.industry !== "Unknown") {
    const hasTrigger = !!companyResearch.trigger_event;

    // Check if we have meaningful service alignment
    const alignmentPoints = companyResearch.service_alignment_points ?? [];
    const GENERIC_PHRASES = ["help", "benefit", "improve", "support", "assist", "grow"];
    const hasWeakAlignment =
      alignmentPoints.length === 0 ||
      alignmentPoints.every((p) =>
        GENERIC_PHRASES.some((g) => p.toLowerCase().split(/\s+/).length <= 6 && p.toLowerCase().includes(g))
      );

    // Scenario 2b: Company researched but no clear service fit — universal benefits
    if (hasWeakAlignment && !hasTrigger) {
      const industry = companyResearch.industry || "their";
      return {
        scenario: "universal_benefits",
        scenarioInstructions: `SCENARIO: UNIVERSAL BENEFITS — We researched ${companyName} (${industry}) but there's no obvious direct link between our services and their core business. Do NOT force a connection that doesn't exist.

Instead, pitch the UNIVERSAL benefits of our services that apply to ANY business:
- Stronger brand credibility — more followers = more trust from prospects
- Social proof that attracts customers before you even pitch them
- Consistent social media presence without the manual effort
- Audience growth that compounds over time
- Buyers check your socials before reaching out, regardless of industry

APPROACH:
- Acknowledge their industry naturally, then pivot to why online presence matters for everyone
- Frame it as: "Most ${industry} companies underestimate how much a strong social presence drives inbound leads"
- Do NOT pretend our services directly relate to their core product
- Be honest and conversational — "even in ${industry}, buyers check your socials before reaching out"
- Use their company name or industry to personalise, but pitch the universal angle
- CTA: interest-based ("Is this something you've thought about?")`,
      };
    }

    // Scenario 2: Strong alignment — pitch the direct connection
    return {
      scenario: "company_lead",
      scenarioInstructions: `SCENARIO: COMPANY LEAD — We researched ${companyName} and are reaching out cold.
${hasTrigger ? `\nTRIGGER EVENT DETECTED (5x conversion — LEAD WITH THIS):\n"${companyResearch.trigger_event}"\nOpen the email by referencing this event. It is your strongest hook.` : ""}

APPROACH:
- ${hasTrigger ? "Lead with the trigger event, then connect to our service" : "Lead with a specific observation about their business"}
- Reference their industry, size, or a specific pain point
- Show you did your homework — mention something only someone who researched them would know
- Keep it about THEM, not about us`,
    };
  }

  // Scenario 3: Individual lead — minimal company data
  return {
    scenario: "individual_lead",
    scenarioInstructions: `SCENARIO: INDIVIDUAL LEAD — Limited company data for ${contactName}. We know their email but not much about their company.

APPROACH:
- Lead with a question about their role or a common industry challenge
- Keep it curiosity-driven — ask, don't pitch
- Shorter is better when you have less context (50-60 words)
- CTA: ask a question, not a meeting request`,
  };
}

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildDraftPrompt(params: {
  cadenceStep: number;
  cadenceAngle: string;
  companyResearch: CompanyResearch;
  salesVoice: SalesVoice | null;
  conversationThread: ConversationEntry[];
  workspaceMemories: string[];
  salesPlaybook?: SalesPlaybook | null;
  leadContext?: LeadContext | null;
  knowledgeProfile?: Record<string, unknown> | null;
  senderName?: string;
  senderCompany?: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  replyIntent?: string;
}): string {
  const {
    cadenceStep,
    cadenceAngle,
    companyResearch,
    salesVoice,
    conversationThread,
    workspaceMemories,
    salesPlaybook,
    leadContext,
    knowledgeProfile,
    senderName,
    senderCompany,
    contactName,
    companyName,
    replyIntent,
  } = params;

  const angleInstructions = CADENCE_ANGLES[cadenceAngle] ?? CADENCE_ANGLES.initial_outreach;

  // Intent-specific instructions for reply mode
  let intentInstructions = "";
  if (cadenceAngle === "reply_followup" && replyIntent) {
    const intentMap: Record<string, string> = {
      positive_interest: `REPLY INTENT: POSITIVE INTEREST — The prospect is asking questions or showing curiosity.

RESPONSE RULES:
- Answer their specific question with concrete details from our services
- Include a specific metric or result if available from the playbook/case studies
- Advance toward the next step (meeting, demo, or trial)
- Keep it 50-80 words
- End with a soft advance: "Want me to walk you through some examples?" or "Happy to share specifics for your niche"
- Do NOT treat this as an opt-out or removal request`,

      objection: `REPLY INTENT: OBJECTION — The prospect is pushing back but still engaged.

USE THE PQVIR FRAMEWORK:
- Pause: Don't be defensive. Start with "That makes sense." or similar
- Question: Ask a clarifying question about their specific concern
- Validate: Acknowledge their concern as legitimate
- Isolate: "If we solved that, would anything else hold you back?"
- Reframe: Offer a new perspective showing how our service addresses it
- Keep it 50-80 words`,

      meeting_accept: `REPLY INTENT: MEETING ACCEPTANCE — The prospect agreed to a call, meeting, or demo.

RESPONSE RULES:
- Confirm enthusiasm briefly ("Great, looking forward to it")
- Propose 2-3 specific time slots or ask for their availability
- Keep it under 50 words
- Make it easy for them to confirm`,
    };
    intentInstructions = intentMap[replyIntent] ?? "";
  }

  // Detect lead scenario for cold outreach (not replies)
  const { scenarioInstructions } = cadenceAngle !== "reply_followup"
    ? detectLeadScenario({ leadContext, companyResearch, companyName, contactName })
    : { scenarioInstructions: "" };

  const voiceBlock = salesVoice
    ? `
MATCH THIS WRITING STYLE:
- Greeting: ${salesVoice.greeting_style}
- Closing: ${salesVoice.closing_style}
- Tone: ${salesVoice.tone}
- CTA style: ${salesVoice.cta_style}
${salesVoice.vocabulary_notes ? `- Vocabulary: ${salesVoice.vocabulary_notes}` : ""}
${salesVoice.avoid_patterns.length > 0 ? `- NEVER: ${salesVoice.avoid_patterns.join(", ")}` : ""}`
    : "";

  // For follow-ups (steps 2-4), show previous emails so the AI drafts a fresh angle
  const isFollowUp = cadenceStep >= 2 && cadenceStep <= 4;
  const threadBlock =
    conversationThread.length > 0
      ? `\nPREVIOUS EMAILS IN THIS THREAD:\n${conversationThread
          .map((e) => `[${e.role}]${e.subject ? ` Subject: "${e.subject}"` : ""} (${e.timestamp}): ${e.content.slice(0, 300)}`)
          .join("\n")}
${isFollowUp ? "\nIMPORTANT: Do NOT reference or mention any of the previous emails. Write a completely fresh email with a new subject line, new hook, and new angle. The prospect should not feel like they are getting a follow-up — it should read like a standalone email." : ""}\n`
      : "";

  // Build knowledge profile summary (authoritative business context)
  let knowledgeBlock = "";
  if (knowledgeProfile && Object.keys(knowledgeProfile).length > 0) {
    const parts: string[] = [];
    const kp = knowledgeProfile;
    if (kp.business_summary) {
      parts.push(`About us: ${kp.business_summary as string}`);
    }
    if (kp.services && (kp.services as Array<{ name?: string; description?: string }>).length > 0) {
      const svcs = (kp.services as Array<{ name?: string; description?: string }>)
        .filter((s) => s.name)
        .map((s) => `${s.name}${s.description ? ` — ${s.description}` : ""}`)
        .join("; ");
      parts.push(`Our services: ${svcs}`);
    }
    if (kp.business_patterns && (kp.business_patterns as string[]).length > 0) {
      parts.push(`How we operate: ${(kp.business_patterns as string[]).join("; ")}`);
    }
    if (kp.key_topics && (kp.key_topics as string[]).length > 0) {
      parts.push(`Core focus areas: ${(kp.key_topics as string[]).join(", ")}`);
    }
    if (parts.length > 0) {
      knowledgeBlock = `\nBUSINESS INTELLIGENCE (verified):\n${parts.join("\n")}`;
    }
  }

  // Prefer structured playbook over raw memories
  let ourBusinessBlock: string;
  if (salesPlaybook && salesPlaybook.services.length > 0) {
    ourBusinessBlock = formatPlaybookForPrompt(salesPlaybook);
  } else if (workspaceMemories.length > 0) {
    ourBusinessBlock = workspaceMemories.join("\n");
  } else {
    ourBusinessBlock = "No specific business context available. Keep the pitch generic but professional.";
  }

  // Lead context block (HubSpot deal data, form data, etc.)
  let leadContextBlock = "";
  if (leadContext) {
    const parts: string[] = [];
    if (leadContext.hubspot_deal_stage) parts.push(`Deal stage: ${leadContext.hubspot_deal_stage}`);
    if (leadContext.hubspot_deal_amount) parts.push(`Deal value: ${leadContext.hubspot_deal_amount}`);
    if (leadContext.hubspot_deal_name) parts.push(`Deal: ${leadContext.hubspot_deal_name}`);
    if (leadContext.hubspot_notes && leadContext.hubspot_notes.length > 0) {
      parts.push(`Notes:\n${leadContext.hubspot_notes.join("\n")}`);
    }
    if (parts.length > 0) {
      leadContextBlock = `\nLEAD CONTEXT (internal — do NOT mention deal stages or amounts in the email):\n${parts.join("\n")}`;
    }
  }

  const alignmentBlock =
    (companyResearch.service_alignment_points ?? []).length > 0
      ? `\nSERVICE ALIGNMENT (how our services help this prospect):\n${companyResearch.service_alignment_points.join("\n")}`
      : "";

  // Objection handlers from playbook (for reply mode)
  let objectionBlock = "";
  if (cadenceAngle === "reply_followup" && salesPlaybook && salesPlaybook.objection_handlers.length > 0) {
    objectionBlock = `\nOBJECTION HANDLERS (use if prospect raised concerns):\n${salesPlaybook.objection_handlers
      .map((oh) => `• "${oh.objection}" → ${oh.response}`)
      .join("\n")}`;
  }

  // Sender identity
  const senderFirstName = senderName?.split(/\s+/)[0] ?? "";
  const signatureBlock = senderFirstName
    ? `\n## SENDER IDENTITY
You are drafting this email on behalf of ${senderName}${senderCompany ? ` from ${senderCompany}` : ""}.
Sign the email as:
${senderFirstName}
${senderCompany ?? ""}
NEVER sign as "Skyler". Skyler drafts the email but it sends FROM the user's identity.`
    : "";

  return `You are an elite sales representative drafting emails on behalf of a real person. You write like the top 1% of SDRs — short, specific, human.
${signatureBlock}

## YOUR COMPANY (what you sell)
${ourBusinessBlock}${knowledgeBlock}

You sell ONLY these services. If a service is not listed above, do NOT offer it.

## THE PROSPECT
- Name: ${contactName}
- Email: ${params.contactEmail}
- Company: ${companyName}

### Prospect research:
${companyResearch.summary}
Industry: ${companyResearch.industry} | Size: ${companyResearch.estimated_size}
${companyResearch.trigger_event ? `Trigger event: ${companyResearch.trigger_event}` : ""}
${companyResearch.pain_points.length > 0 ? `Pain points: ${companyResearch.pain_points.join("; ")}` : ""}
${companyResearch.recent_news.length > 0 ? `Recent news: ${companyResearch.recent_news.join("; ")}` : ""}
${companyResearch.talking_points.length > 0 ? `Hooks: ${companyResearch.talking_points.join("; ")}` : ""}
${alignmentBlock}${leadContextBlock}${objectionBlock}
${threadBlock}
## LEAD SCENARIO
${scenarioInstructions}

## CADENCE STEP
${angleInstructions}
${intentInstructions ? `\n## REPLY CLASSIFICATION\n${intentInstructions}` : ""}
${voiceBlock}

## ELITE SALES RULES (data-backed — follow strictly)

WORD COUNT:
- Cold outreach (steps 1-4): 50-100 words. Sweet spot is 60-80 words.
- Under 50 feels incomplete and robotic. Over 100 loses attention on mobile.
- Every sentence must add value or be cut. 3-4 short sentences max.
- Reply followup: under 100 words.

READING LEVEL: 5th grade. Short sentences. Simple words. No jargon.

SUBJECT LINE: all lowercase, 1-4 words, no punctuation, no emojis.

CTA: Interest-based only. "Worth a look?" "Is this relevant?" "Open to this?"
NEVER: "Book a call", "Grab 15 minutes", "When are you free?"

## NEVER WRITE (instant delete triggers)
- "I hope this email finds you well"
- "I wanted to reach out because"
- "I came across your profile/company"
- "Just checking in"
- "Bumping this to the top of your inbox"
- "Circling back"
- "Per my last email"
- "I know you're busy but"
- "We help businesses scale/grow/streamline"
- "Synergies between our teams"
- "Thought leadership"
- "Leverage our platform"
- Any sentence starting with "I" (start with "you" or their company name)
- Multiple CTAs in one email
- Exclamation marks in subject lines
- ALL CAPS words
- Emojis

## OUTPUT FORMAT
Respond with ONLY valid JSON. No markdown fences.
{
  "subject": "all lowercase, 1-4 words",
  "textBody": "plain text email body",
  "htmlBody": "simple HTML — paragraphs and line breaks only, no images or heavy styling"
}

Use the prospect's first name only. Write like a real person, not a bot.
${senderFirstName ? `Sign off as "${senderFirstName}" with "${senderCompany ?? ""}" on the next line. NEVER use "Skyler" as the signature.` : ""}`;
}

/**
 * Draft a personalised outreach email using Claude Sonnet.
 */
export async function draftEmail(params: {
  workspaceId: string;
  pipelineRecord: SalesPipelineRecord;
  cadenceStep: number;
  companyResearch: CompanyResearch;
  salesVoice: SalesVoice | null;
  conversationThread: ConversationEntry[];
  workspaceMemories: string[];
  salesPlaybook?: SalesPlaybook | null;
  leadContext?: LeadContext | null;
  knowledgeProfile?: Record<string, unknown> | null;
  senderName?: string;
  senderCompany?: string;
  replyIntent?: string;
}): Promise<DraftedEmail> {
  const { pipelineRecord, cadenceStep, companyResearch, salesVoice, conversationThread, salesPlaybook, leadContext, knowledgeProfile, senderName, senderCompany, replyIntent } = params;
  let workspaceMemories = params.workspaceMemories;

  // Fallback: fetch memories directly if none were passed and no playbook
  if ((!workspaceMemories || workspaceMemories.length === 0) && !salesPlaybook) {
    console.log("[email-drafter] No memories or playbook passed — fetching directly from DB");
    const db = createAdminSupabaseClient();
    const { data } = await db
      .from("workspace_memories")
      .select("content")
      .eq("workspace_id", params.workspaceId)
      .is("superseded_by", null)
      .order("times_reinforced", { ascending: false })
      .limit(20);
    const raw = (data ?? []).map((m) => m.content as string);
    workspaceMemories = filterDealMemories(raw);
    console.log(`[email-drafter] Fetched ${raw.length} memories, ${workspaceMemories.length} after filtering deal data`);
  }

  // Map cadence step to angle (-1 = reply followup)
  const angleMap: Record<number, string> = {
    [-1]: "reply_followup",
    1: "initial_outreach",
    2: "different_value_prop",
    3: "social_proof_or_case_study",
    4: "breakup_final_attempt",
  };
  const cadenceAngle = angleMap[cadenceStep] ?? "initial_outreach";

  const prompt = buildDraftPrompt({
    cadenceStep,
    cadenceAngle,
    companyResearch,
    salesVoice,
    conversationThread,
    workspaceMemories,
    salesPlaybook,
    leadContext,
    knowledgeProfile,
    senderName,
    senderCompany,
    contactName: pipelineRecord.contact_name,
    contactEmail: pipelineRecord.contact_email,
    companyName: pipelineRecord.company_name,
    replyIntent,
  });

  console.log(`[email-drafter] Drafting step ${cadenceStep} (${cadenceAngle}) for ${pipelineRecord.contact_name}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    const parsed = parseAIJson<DraftedEmail>(text);
    console.log(`[email-drafter] Drafted: "${parsed.subject}" (${parsed.textBody.split(/\s+/).length} words)`);
    return parsed;
  } catch {
    console.warn("[email-drafter] Failed to parse JSON, using raw text as body");
    return {
      subject: `following up`,
      textBody: text,
      htmlBody: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    };
  }
}
