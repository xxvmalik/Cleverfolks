/**
 * Shared constants for the Skyler chat system.
 * Used by both backend (SSE emitters) and frontend (event handlers, filters, rendering).
 */

// ── Activity labels (emitted by backend, filtered/displayed by frontend) ─────

/** Emitted at the start of the SSE stream before any processing */
export const ACTIVITY_THINKING = "Thinking...";

/** Emitted by agent-loop just before text streaming begins */
export const ACTIVITY_GENERATING = "Generating response...";

/** Fallback label for unknown tools in generateActivityLabel */
export const ACTIVITY_FALLBACK = "Processing...";

/** Activity labels that should be hidden from the step list (internal signals only) */
export const HIDDEN_ACTIVITIES = new Set([ACTIVITY_GENERATING, ACTIVITY_THINKING]);

// ── Error messages ───────────────────────────────────────────────────────────

export const ERROR_MSG_GENERIC = "Something went wrong. Please try again.";
export const ERROR_MSG_CONNECTION = "Failed to connect to Skyler. Please try again.";

// ── Streaming config ─────────────────────────────────────────────────────────

/** Delay (ms) before text streaming starts, gives frontend time to render activity steps */
export const ACTIVITY_RENDER_DELAY_MS = 50;

/** Characters per chunk when simulating streaming */
export const STREAM_CHUNK_SIZE = 30;

/** Delay (ms) between streaming chunks */
export const STREAM_DELAY_MS = 8;

// ── Markdown stripping ───────────────────────────────────────────────────────

/**
 * Strip markdown formatting from LLM responses so chat renders as plain text.
 * Handles: headers, bold, italic, bullet points, numbered lists, code blocks, backticks.
 * Preserves line breaks and the actual content.
 */
export function stripMarkdown(text: string): string {
  return text
    // Remove code blocks (```...```)
    .replace(/```[\s\S]*?```/g, (match) => {
      // Keep the content inside, strip the fences
      const inner = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
      return inner;
    })
    // Remove inline backticks
    .replace(/`([^`]+)`/g, "$1")
    // Remove headers (## Header → Header)
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold (**text** or __text__)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // Remove italic (*text* or _text_) — careful not to hit mid-word underscores
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
    // Remove bullet points at line start (- item or * item)
    .replace(/^[\s]*[-*]\s+/gm, "")
    // Remove numbered lists (1. item, 2. item)
    .replace(/^\s*\d+\.\s+/gm, "")
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
