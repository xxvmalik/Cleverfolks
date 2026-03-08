/**
 * Email Drafting Engine for Skyler Sales Closer.
 * Uses Claude Sonnet to craft personalised outreach emails based on
 * company research, sales voice, cadence step, and workspace context.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CompanyResearch } from "@/lib/skyler/company-research";
import type { SalesVoice } from "@/lib/skyler/voice-learner";

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

export type DraftedEmail = {
  subject: string;
  htmlBody: string;
  textBody: string;
};

const CADENCE_ANGLES: Record<string, string> = {
  initial_outreach: `This is the FIRST email to this prospect. They have never heard from us.
Lead with THEIR problem or a specific observation about their company. Connect it to our solution in one sentence. End with a low-friction CTA (reply, quick call, or a specific question).
Keep it under 150 words. Subject line under 7 words, no clickbait.`,

  different_value_prop: `This is FOLLOW-UP 1 (3 days after initial email). They did not reply to our first email.
Do NOT say "just checking in" or "following up on my last email". Take a completely different angle.
Share a different value proposition, a relevant insight, or a question that shows we understand their business.
Reference the initial email only briefly ("I reached out a few days ago about..."). Keep under 120 words.`,

  social_proof_or_case_study: `This is FOLLOW-UP 2 (7 days after initial). No reply to two emails.
Use social proof: mention a similar company we helped, a result we achieved, or a relevant case study.
If no case study is available, share a specific industry insight or trend they should know about.
Keep it short and direct. Under 100 words.`,

  breakup_final_attempt: `This is the BREAKUP EMAIL (14 days after initial). Final attempt.
Be honest and respectful. Acknowledge they are busy. Keep the door open.
No guilt trips, no passive-aggression. Simply say this is your last email, and if timing is ever right, you are here.
Under 80 words. Subject like "Closing the loop" or similar.`,
};

function buildDraftPrompt(params: {
  cadenceStep: number;
  cadenceAngle: string;
  companyResearch: CompanyResearch;
  salesVoice: SalesVoice | null;
  conversationThread: ConversationEntry[];
  workspaceMemories: string[];
  contactName: string;
  contactEmail: string;
  companyName: string;
}): string {
  const {
    cadenceAngle,
    companyResearch,
    salesVoice,
    conversationThread,
    workspaceMemories,
    contactName,
    companyName,
  } = params;

  const angleInstructions = CADENCE_ANGLES[cadenceAngle] ?? CADENCE_ANGLES.initial_outreach;

  const voiceBlock = salesVoice
    ? `
MATCH THIS WRITING STYLE:
- Greeting: ${salesVoice.greeting_style}
- Closing: ${salesVoice.closing_style}
- Tone: ${salesVoice.tone}
- Length: ${salesVoice.avg_length}
- CTA style: ${salesVoice.cta_style}
${salesVoice.vocabulary_notes ? `- Vocabulary: ${salesVoice.vocabulary_notes}` : ""}
${salesVoice.avoid_patterns.length > 0 ? `- NEVER: ${salesVoice.avoid_patterns.join(", ")}` : ""}
`
    : `
USE THIS DEFAULT STYLE:
- Professional but human
- Direct and concise
- No corporate jargon
- Friendly but not overly casual
`;

  const threadBlock =
    conversationThread.length > 0
      ? `\nPREVIOUS EMAILS IN THIS THREAD:\n${conversationThread
          .map((e) => `[${e.role}] (${e.timestamp}): ${e.content.slice(0, 300)}`)
          .join("\n")}\n`
      : "";

  const memoriesBlock =
    workspaceMemories.length > 0
      ? `\nABOUT OUR BUSINESS:\n${workspaceMemories.join("\n")}\n`
      : "";

  return `You are Skyler, a Sales AI Employee drafting an outreach email. You write like a real salesperson, not a bot.

PROSPECT:
- Name: ${contactName}
- Email: ${params.contactEmail}
- Company: ${companyName}

COMPANY RESEARCH:
${companyResearch.summary}
Industry: ${companyResearch.industry}
Size: ${companyResearch.estimated_size}
${companyResearch.pain_points.length > 0 ? `Pain points: ${companyResearch.pain_points.join("; ")}` : ""}
${companyResearch.talking_points.length > 0 ? `Talking points: ${companyResearch.talking_points.join("; ")}` : ""}
${companyResearch.recent_news.length > 0 ? `Recent news: ${companyResearch.recent_news.join("; ")}` : ""}
${memoriesBlock}${threadBlock}
CADENCE INSTRUCTIONS:
${angleInstructions}
${voiceBlock}
RULES:
- No "I hope this email finds you well"
- No "I wanted to reach out because..."
- No "I came across your profile"
- Lead with THEIR problem, not our product
- One CTA only. Never multiple asks.
- Subject line under 7 words, no clickbait, no emojis
- Use the prospect's first name, not full name

Respond with ONLY valid JSON:
{
  "subject": "...",
  "textBody": "...",
  "htmlBody": "..."
}

For htmlBody: use simple HTML (paragraphs, line breaks). No images, no heavy styling. Keep it looking like a real email, not a marketing newsletter.`;
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
}): Promise<DraftedEmail> {
  const { pipelineRecord, cadenceStep, companyResearch, salesVoice, conversationThread, workspaceMemories } = params;

  // Map cadence step to angle
  const angleMap: Record<number, string> = {
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
    contactName: pipelineRecord.contact_name,
    contactEmail: pipelineRecord.contact_email,
    companyName: pipelineRecord.company_name,
  });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    const parsed = JSON.parse(text) as DraftedEmail;
    console.log(`[email-drafter] Drafted step ${cadenceStep} email for ${pipelineRecord.contact_name}: "${parsed.subject}"`);
    return parsed;
  } catch {
    // If JSON parsing fails, try to extract from the text
    console.warn("[email-drafter] Failed to parse JSON, using raw text as body");
    return {
      subject: `Following up - ${pipelineRecord.company_name}`,
      textBody: text,
      htmlBody: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
    };
  }
}
