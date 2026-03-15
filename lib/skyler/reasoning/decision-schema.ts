/**
 * Structured decision schema for Skyler's AI reasoning engine.
 *
 * This is the contract between the reasoning layer (Claude Sonnet) and
 * everything downstream (guardrail engine, action executors, approval queue).
 * Every decision Skyler makes is expressed as a validated instance of this schema.
 */

import { z } from "zod";

export const SkylerDecisionSchema = z.object({
  action_type: z.enum([
    "draft_email",
    "update_stage",
    "schedule_followup",
    "create_note",
    "request_info",
    "escalate",
    "do_nothing",
    "close_won",
    "close_lost",
  ]),
  parameters: z.object({
    // Email actions (draft_email)
    email_content: z.string().optional(),
    email_subject: z.string().optional(),
    is_objection_response: z.boolean().optional(),
    is_meeting_request: z.boolean().optional(),
    involves_pricing: z.boolean().optional(),

    // Stage updates (update_stage)
    new_stage: z.string().optional(),

    // Follow-up scheduling (schedule_followup)
    followup_delay_hours: z.number().optional(),
    followup_reason: z.string().optional(),

    // Notes (create_note)
    note_text: z.string().optional(),

    // Request info — ask the user for something (request_info)
    request_description: z.string().optional(),

    // Escalation (escalate)
    escalation_reason: z.string().optional(),
    // AI suggests a channel, but the guardrail engine ALWAYS overrides this
    // with whatever the user configured in Workflow Settings. The AI does
    // not get to pick where escalations go.
    escalation_channel: z.enum(["slack", "email", "task"]).optional(),

    // Sentiment detection — used by guardrail engine for escalation checks
    detected_sentiment: z
      .enum(["positive", "neutral", "negative"])
      .optional(),

    // Close reasons (close_won, close_lost)
    close_reason: z.string().optional(),
    won_amount: z.number().optional(),
    lost_reason: z.string().optional(),
  }),
  reasoning: z
    .string()
    .describe(
      "Why this decision was made. Shown to the user for transparency."
    ),
  confidence_score: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How confident the AI is in this decision. Below 0.5 triggers escalation, below 0.7 requires approval."
    ),
  urgency: z
    .enum(["immediate", "same_day", "next_day", "standard"])
    .describe("How urgently this action should be taken."),
});

export type SkylerDecision = z.infer<typeof SkylerDecisionSchema>;
