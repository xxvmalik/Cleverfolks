/**
 * Deterministic email pre-filters for the classification pipeline.
 * Zero AI cost — uses sender patterns, domain lists, and keyword matching
 * to eliminate emails that are provably not referrals.
 */

// ── Layer 1: Header & Metadata Pre-Filter ────────────────────────────────────

const AUTO_SENDER_PATTERNS = [
  "noreply@", "no-reply@", "notifications@", "alerts@", "updates@",
  "mailer-daemon@", "postmaster@", "donotreply@", "do-not-reply@",
  "newsletter@", "marketing@", "notification@", "info@github.com",
  "support@", "billing@", "receipts@", "invoice@", "order@",
  "calendar-notification@", "digest@", "weekly@", "daily@",
  "automated@", "system@", "bounce@", "feedback@",
];

const AUTO_DOMAINS = [
  "github.com", "gitlab.com", "bitbucket.org",
  "jira.atlassian.com", "atlassian.net",
  "notion.so", "slack.com", "trello.com",
  "stripe.com", "paypal.com", "paystack.com",
  "mailchimp.com", "sendgrid.net", "amazonses.com",
  "google.com", "facebookmail.com", "linkedin.com",
  "vercel.com", "netlify.com", "heroku.com",
  "supabase.io", "nango.dev",
  "hubspot.com", "intercom.io", "zendesk.com",
];

const NEWSLETTER_INDICATORS = [
  "unsubscribe", "opt out", "opt-out", "email preferences",
  "manage your subscription", "you are receiving this",
  "this email was sent to", "view in browser", "view online",
  "update your preferences",
];

/**
 * Extract sender email from chunk text or metadata.
 * Handles "From: sender@email.com" and "Name <email>" formats.
 */
export function extractSenderFromText(chunkText: string): string | null {
  // Try "From: email" pattern first (common in our chunk format)
  const fromMatch = chunkText.match(/From:\s*(?:[^<\n]*<)?([^\s>→|,]+@[^\s>→|,]+)/i);
  if (fromMatch) return fromMatch[1].toLowerCase().trim();
  return null;
}

export function extractSenderFromMetadata(
  metadata?: Record<string, unknown>
): string | null {
  if (!metadata) return null;

  const from = metadata.from ?? metadata.sender ?? metadata.from_email;
  if (typeof from === "string") {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : from.toLowerCase();
  }

  // Outlook: { emailAddress: { address: "..." } } or { address: "..." }
  if (typeof from === "object" && from !== null) {
    const addr = (from as Record<string, unknown>).emailAddress;
    if (typeof addr === "object" && addr !== null) {
      const email = (addr as Record<string, unknown>).address;
      if (typeof email === "string") return email.toLowerCase();
    }
    const directAddr = (from as Record<string, unknown>).address;
    if (typeof directAddr === "string") return directAddr.toLowerCase();
  }

  return null;
}

/**
 * Layer 1: Header/metadata pre-filter.
 * Checks sender address, domain, newsletter indicators, and length.
 * Returns { skip: true, reason } if the email should not be processed by AI.
 */
export function shouldSkipEmail(
  chunkText: string,
  metadata?: Record<string, unknown>
): { skip: boolean; reason: string } {
  const senderEmail =
    extractSenderFromMetadata(metadata) ?? extractSenderFromText(chunkText) ?? "";

  // 1. Automated sender patterns
  for (const pattern of AUTO_SENDER_PATTERNS) {
    if (senderEmail.includes(pattern)) {
      return { skip: true, reason: `automated_sender:${pattern}` };
    }
  }

  // 2. Automated domains
  const senderDomain = senderEmail.split("@")[1] || "";
  for (const domain of AUTO_DOMAINS) {
    if (senderDomain === domain || senderDomain.endsWith("." + domain)) {
      return { skip: true, reason: `automated_domain:${domain}` };
    }
  }

  // 3. Newsletter/marketing indicators (need 2+ to skip)
  const textLower = chunkText.toLowerCase();
  let newsletterScore = 0;
  for (const indicator of NEWSLETTER_INDICATORS) {
    if (textLower.includes(indicator)) newsletterScore++;
  }
  if (newsletterScore >= 2) {
    return { skip: true, reason: "newsletter_indicators" };
  }

  // 4. Very short emails (notifications, not referrals)
  const bodyText = chunkText.replace(/^From:.*$/m, "").trim();
  if (bodyText.length < 50) {
    return { skip: true, reason: "too_short" };
  }

  return { skip: false, reason: "passed_prefilter" };
}

// ── Layer 2: Keyword Referral Filter ─────────────────────────────────────────

const REFERRAL_PATTERNS = [
  /\brefer(?:red|ring|ral|s)?\b/,
  /\brecommend(?:ed|ing|ation|s)?\b/,
  /\bintroduc(?:e|ed|ing|tion|es)\b/,
  /\bconnect(?:ed|ing)?\s+(?:you|them|us|me)\b/,
  /\bput\s+(?:me|you|us|them)\s+in\s+touch\b/,
  /\bvouch(?:ed|ing|es)?\b/,
  /\bsuggested?\s+(?:i|you|we|they)\s+(?:reach|talk|speak|meet|contact)\b/,
  /\bmentioned?\s+(?:your|you|the)\s+(?:name|company|service|product|business)\b/,
  /\btold\s+me\s+(?:about|to\s+contact)\b/,
  /\bspoke\s+(?:highly|well)\s+of\b/,
  /\bhighly\s+recommend\b/,
  /\bword\s+of\s+mouth\b/,
  /\bpersonal\s+recommendation\b/,
  /\bheard\s+(?:good|great)\s+things\b/,
  /\bfriend\s+(?:of|at|from)\b.*\bsuggested\b/,
  /\bcolleague\s+(?:of|at|from)\b.*\b(?:mentioned|recommended|suggested)\b/,
  /\bgave\s+(?:me|us)\s+your\s+(?:details|contact|email|number)\b/,
  /\bpassed\s+(?:your|along)\b/,
];

/**
 * Layer 2: Keyword-based referral signal detection.
 * If no referral-related keywords exist, the email is definitely not a referral.
 */
export function hasReferralSignals(chunkText: string): boolean {
  const textLower = chunkText.toLowerCase();
  for (const pattern of REFERRAL_PATTERNS) {
    if (pattern.test(textLower)) return true;
  }
  return false;
}
