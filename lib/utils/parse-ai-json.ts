/**
 * Parse JSON from Claude API responses, stripping markdown code fences
 * and handling HTML entity escaping that can occur in JSON string values.
 *
 * Handles common patterns:
 * - Clean JSON
 * - ```json ... ``` fenced JSON (at start or anywhere in text)
 * - Reasoning text before/after the JSON object
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAIJson<T = any>(text: string): T {
  let cleaned = text.trim();

  // 1. Try direct parse (clean JSON)
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    try {
      return JSON.parse(cleaned);
    } catch {
      // May have trailing text — try extracting the JSON object
    }
  }

  // 2. Extract from ```json ... ``` fences anywhere in the text
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Fenced content wasn't valid JSON
    }
  }

  // 3. Remove leading fences (original behavior)
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
    try {
      return JSON.parse(cleaned.trim());
    } catch {
      // Continue to bracket extraction
    }
  }

  // 4. Find the first { and last matching } — extract the JSON object
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Not valid JSON even after extraction
    }
  }

  // 5. Same for arrays
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Not valid JSON
    }
  }

  // Final: throw so callers can handle the fallback
  throw new SyntaxError(`Failed to extract JSON from AI response (length: ${text.length})`);
}
