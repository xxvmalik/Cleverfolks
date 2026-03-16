/**
 * Post-generation Output Validator — catches fabrication markers.
 *
 * After any email/document is drafted, scans for placeholder text, bracket
 * markers, and generic stand-ins. If found, the draft is converted to a
 * request_info action instead of entering the approval queue.
 *
 * This is the last line of defence — if the AI slips a [bank details here]
 * through Layers 1-4, this catches it.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type PlaceholderScanResult = {
  hasPlaceholders: boolean;
  /** The placeholder strings found */
  placeholders: string[];
  /** Human-readable summary of what's missing */
  missingDescription: string;
};

// ── Patterns ─────────────────────────────────────────────────────────────────

/** Square brackets with text inside: [bank details here], [INSERT ADDRESS] */
const BRACKET_PATTERN = /\[[^\]]{3,}\]/g;

/** Curly braces with text inside: {insert address}, {your company name} */
const BRACE_PATTERN = /\{[^}]{3,}\}/g;

/** Common placeholder phrases (case-insensitive) */
const PLACEHOLDER_PHRASES = [
  "tbd",
  "to be confirmed",
  "to be determined",
  "will be provided",
  "details to follow",
  "placeholder",
  "xxx",
  "insert here",
  "your payment details here",
  "your bank details here",
  "will be provided separately",
  "details will be shared",
  "to be agreed",
  "pending confirmation",
];

/** Generic stand-in patterns */
const GENERIC_PATTERNS = [
  /\b\w+@example\.com\b/gi,                      // example.com emails
  /\b000[- ]?000[- ]?0000\b/g,                    // 000-000-0000 phone numbers
  /\b0000\s?0000\s?0000\s?0000\b/g,               // 0000 0000 0000 0000 card numbers
  /\b1234\s?5678\b/g,                              // 12345678 generic account numbers
  /\bXX+\b/g,                                       // XXX, XXXX etc
  /\b(?:sort|routing)\s*(?:code|number)?:\s*\d{2}-\d{2}-\d{2}\b/gi, // Only flag 00-00-00 sort codes
];

// Patterns to exclude (legitimate uses of brackets)
const BRACKET_EXCLUSIONS = [
  /^\[(?:skyler|lead|pipeline|user|system)\]/i,    // Role markers in conversation threads
  /^\[(?:sent|pending|draft|received|approved)\]/i, // Status markers
  /^\[\d{4}-/,                                       // Date stamps [2026-03-...]
  /^\[http/i,                                        // URLs [https://...]
  /^\[✓\]/,                                          // Checkbox markers
];

// ── Scanner ──────────────────────────────────────────────────────────────────

/**
 * Scan text content for fabrication markers / placeholders.
 * Returns details about what was found and what appears to be missing.
 */
export function scanForPlaceholders(content: string): PlaceholderScanResult {
  if (!content || content.trim().length === 0) {
    return { hasPlaceholders: false, placeholders: [], missingDescription: "" };
  }

  const found: string[] = [];

  // 1. Square brackets
  const bracketMatches = content.match(BRACKET_PATTERN) ?? [];
  for (const match of bracketMatches) {
    // Skip legitimate uses
    const isExcluded = BRACKET_EXCLUSIONS.some((re) => re.test(match));
    if (!isExcluded) {
      found.push(match);
    }
  }

  // 2. Curly braces
  const braceMatches = content.match(BRACE_PATTERN) ?? [];
  for (const match of braceMatches) {
    found.push(match);
  }

  // 3. Placeholder phrases
  const lower = content.toLowerCase();
  for (const phrase of PLACEHOLDER_PHRASES) {
    if (lower.includes(phrase)) {
      // Extract the surrounding context for clarity
      const idx = lower.indexOf(phrase);
      const start = Math.max(0, idx - 10);
      const end = Math.min(content.length, idx + phrase.length + 10);
      found.push(`"...${content.slice(start, end).trim()}..."`);
    }
  }

  // 4. Generic stand-in patterns
  for (const pattern of GENERIC_PATTERNS) {
    const matches = content.match(pattern) ?? [];
    for (const match of matches) {
      found.push(match);
    }
  }

  // Deduplicate
  const unique = [...new Set(found)];

  if (unique.length === 0) {
    return { hasPlaceholders: false, placeholders: [], missingDescription: "" };
  }

  // Build a human-readable description of what's missing
  const missingDescription = extractMissingFromPlaceholders(unique);

  return {
    hasPlaceholders: true,
    placeholders: unique,
    missingDescription,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a description of what's missing from the placeholder text.
 */
function extractMissingFromPlaceholders(placeholders: string[]): string {
  const items: string[] = [];
  for (const p of placeholders) {
    // Clean up bracket/brace content
    const cleaned = p
      .replace(/^\[|\]$/g, "")
      .replace(/^\{|\}$/g, "")
      .replace(/^"\.{3}|\.{3}"$/g, "")
      .trim();

    if (cleaned.length > 2 && cleaned.length < 100) {
      items.push(cleaned);
    }
  }

  if (items.length === 0) {
    return "Some details in the draft appear to be placeholders. Could you provide the missing information?";
  }

  return `I started drafting but realised I'm missing: ${items.join(", ")}. Could you provide these details?`;
}
