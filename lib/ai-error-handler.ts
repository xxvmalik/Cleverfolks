/**
 * Shared utility for detecting and handling AI credit/billing errors.
 * Used across all Claude API call points to return friendly errors.
 */

/**
 * Check if an error is an Anthropic credit/billing error.
 */
export function isAICreditError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "object" && err !== null
    ? (err as Record<string, unknown>).message as string ??
      ((err as Record<string, unknown>).error as Record<string, unknown>)?.message as string ??
      String(err)
    : String(err);

  return (
    msg.includes("credit balance is too low") ||
    msg.includes("billing") ||
    msg.includes("insufficient_quota") ||
    msg.includes("rate_limit") ||
    (msg.includes("credit") && msg.includes("balance"))
  );
}

/**
 * Sanitize an error message for end users — strip raw API details.
 */
export function sanitizeErrorForUser(err: unknown): string {
  if (isAICreditError(err)) return "ai_unavailable";
  const msg = err instanceof Error ? err.message : String(err);
  // Strip JSON payloads and status codes
  if (msg.includes("{") && msg.includes("}")) return "Something went wrong. Please try again.";
  if (msg.length > 200) return "Something went wrong. Please try again.";
  return msg;
}
