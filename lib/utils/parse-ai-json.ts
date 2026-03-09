/**
 * Parse JSON from Claude API responses, stripping markdown code fences
 * and handling HTML entity escaping that can occur in JSON string values.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAIJson<T = any>(text: string): T {
  let cleaned = text.trim();

  // Remove ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
  }

  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}
