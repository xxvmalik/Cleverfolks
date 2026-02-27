/**
 * Query Analyzer — pure regex/pattern matching, no LLM calls.
 *
 * Extracts:
 *  - timeRange: concrete after/before Date bounds from natural language
 *  - searchTerms: meaningful keywords after stop-word removal
 *  - originalQuery: untouched input
 */

export type TimeRange = {
  after?: Date;
  before?: Date;
};

export type QueryAnalysis = {
  timeRange: TimeRange | null;
  searchTerms: string[];
  originalQuery: string;
  /** True when the query asks for a broad summary of a time period rather than
   *  searching for a specific topic.  Triggers the chronological fetch path. */
  isBroadSummary: boolean;
  /** True when the query asks for a count, ranking, or comparison of quantities.
   *  Triggers the direct-SQL aggregation path instead of RAG. */
  isAggregation: boolean;
};

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","about","into","through","during","is","are","was",
  "were","be","been","being","have","has","had","do","does","did","will",
  "would","could","should","may","might","shall","can","need","dare",
  "ought","used","what","which","who","whom","whose","when","where","why",
  "how","that","this","these","those","i","me","my","we","our","you","your",
  "he","him","his","she","her","they","them","their","it","its","not","no",
  "nor","so","yet","both","either","neither","whether","show","tell","get",
  "give","find","list","any","all","each","every","few","more","most","other",
  "some","such","than","then","too","very","just","also","much","many","did",
  "was","been","has","had","do","does","me",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  // Monday as first day
  const r = new Date(d);
  const day = r.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1 - day);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

const DAY_NAMES: Record<string, number> = {
  sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,
  sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,
};

// ---------------------------------------------------------------------------
// Time range extraction
// ---------------------------------------------------------------------------

export function extractTimeRange(query: string, now = new Date()): TimeRange | null {
  const q = query.toLowerCase();
  const today = startOfDay(now);

  // today
  if (/\btoday\b/.test(q)) {
    return { after: today, before: endOfDay(now) };
  }

  // yesterday
  if (/\byesterday\b/.test(q)) {
    const y = addDays(today, -1);
    return { after: y, before: endOfDay(y) };
  }

  // this week
  if (/\bthis\s+week\b/.test(q)) {
    return { after: startOfWeek(today), before: endOfDay(now) };
  }

  // last week
  if (/\blast\s+week\b/.test(q)) {
    const start = startOfWeek(addDays(today, -7));
    return { after: start, before: addDays(start, 6) };
  }

  // this month
  if (/\bthis\s+month\b/.test(q)) {
    return { after: startOfMonth(today), before: endOfDay(now) };
  }

  // last month
  if (/\blast\s+month\b/.test(q)) {
    const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { after: lm, before: endOfMonth(lm) };
  }

  // this year
  if (/\bthis\s+year\b/.test(q)) {
    return { after: startOfYear(today), before: endOfDay(now) };
  }

  // last year
  if (/\blast\s+year\b/.test(q)) {
    const ly = new Date(today.getFullYear() - 1, 0, 1);
    return { after: ly, before: new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59, 999) };
  }

  // past N days / last N days
  const pastDaysMatch = q.match(/\b(?:past|last)\s+(\d+)\s+days?\b/);
  if (pastDaysMatch) {
    const n = parseInt(pastDaysMatch[1], 10);
    return { after: addDays(today, -n), before: endOfDay(now) };
  }

  // past N weeks / last N weeks
  const pastWeeksMatch = q.match(/\b(?:past|last)\s+(\d+)\s+weeks?\b/);
  if (pastWeeksMatch) {
    const n = parseInt(pastWeeksMatch[1], 10);
    return { after: addDays(today, -n * 7), before: endOfDay(now) };
  }

  // past N months / last N months
  const pastMonthsMatch = q.match(/\b(?:past|last)\s+(\d+)\s+months?\b/);
  if (pastMonthsMatch) {
    const n = parseInt(pastMonthsMatch[1], 10);
    const d = new Date(today);
    d.setMonth(d.getMonth() - n);
    return { after: d, before: endOfDay(now) };
  }

  // recently / lately / of late → last 7 days
  if (/\b(recently|lately|of\s+late)\b/.test(q)) {
    return { after: addDays(today, -7), before: endOfDay(now) };
  }

  // on Monday / last Tuesday / this Friday (specific weekday)
  const weekdayMatch = q.match(/\b(?:on\s+|last\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/);
  if (weekdayMatch) {
    const targetDay = DAY_NAMES[weekdayMatch[1]];
    const currentDay = today.getDay();
    let diff = currentDay - targetDay;
    if (diff <= 0) diff += 7; // go back to the most recent past occurrence
    const target = addDays(today, -diff);
    return { after: target, before: endOfDay(target) };
  }

  // in January / in March 2024 / in January 2025
  const monthMatch = q.match(
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+(\d{4}))?\b/
  );
  if (monthMatch) {
    const monthIdx = MONTH_NAMES[monthMatch[1]];
    const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : today.getFullYear();
    const start = new Date(year, monthIdx, 1);
    return { after: start, before: endOfMonth(start) };
  }

  // on YYYY-MM-DD or on MM/DD/YYYY
  const isoDateMatch = q.match(/\bon\s+(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) {
    const d = new Date(isoDateMatch[1] + "T00:00:00");
    return { after: d, before: endOfDay(d) };
  }
  const slashDateMatch = q.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashDateMatch) {
    const d = new Date(
      parseInt(slashDateMatch[3], 10),
      parseInt(slashDateMatch[1], 10) - 1,
      parseInt(slashDateMatch[2], 10)
    );
    return { after: d, before: endOfDay(d) };
  }

  // since YYYY-MM-DD
  const sinceMatch = q.match(/\bsince\s+(\d{4}-\d{2}-\d{2})\b/);
  if (sinceMatch) {
    return { after: new Date(sinceMatch[1] + "T00:00:00") };
  }

  // before YYYY-MM-DD
  const beforeMatch = q.match(/\bbefore\s+(\d{4}-\d{2}-\d{2})\b/);
  if (beforeMatch) {
    return { before: new Date(beforeMatch[1] + "T23:59:59") };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Search term extraction
// ---------------------------------------------------------------------------

export function extractSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    // remove common time phrases so they don't pollute keyword search
    .replace(/\b(?:today|yesterday|this|last|past|next|on|in|since|before|after|during|the)\b/g, " ")
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/g, " ")
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/g, " ")
    .replace(/\b(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g, " ")
    .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, " ") // dates
    .replace(/\b\d+\s*(?:days?|weeks?|months?|years?)\b/g, " ") // durations
    // strip punctuation
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, "")) // trim leading/trailing punctuation
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Broad summary detection
// ---------------------------------------------------------------------------

/**
 * Patterns that signal the user wants an overall summary of a time period
 * rather than a targeted search for a specific topic.
 */
const BROAD_INTENT_RE =
  /\b(summar(?:is|iz)|recap|overview|highlights?|key\s+(?:topics?|discussions?|points?|issues?|updates?|things?)|what(?:'s|\s+(?:has\s+)?been)\s+(?:going\s+on|happening|discussed?|said|talked\s+about)|what\s+happened|what\s+did\s+(?:the\s+team|everyone|we|they|people)\s+(?:discuss|talk\s+about|say|post)|what\s+were\s+(?:the\s+)?(?:topics?|discussions?|issues?|updates?|key)|update\s+me|catch\s+me\s+up|fill\s+me\s+in|what(?:'s|\s+is)\s+new|any\s+updates?|what\s+was\s+discussed)\b/i;

/**
 * Returns true when the query expresses broad summary intent AND contains
 * either an explicit time reference (timeRange !== null) or a word that
 * implies recency such that extractTimeRange already resolved it.
 */
export function detectBroadSummary(
  query: string,
  timeRange: TimeRange | null
): boolean {
  return BROAD_INTENT_RE.test(query) && timeRange !== null;
}

// ---------------------------------------------------------------------------
// Aggregation detection
// ---------------------------------------------------------------------------

/**
 * Patterns that signal the user wants a count, ranking, or comparison of
 * quantities rather than a semantic search over message content.
 * When matched, the aggregation strategy (direct SQL) is used instead of RAG.
 *
 * Deliberately broad — covers:
 *  - "how many", "total number of"
 *  - "who [verb] the most/least" (all tenses + variants)
 *  - "who has been [verb]ing the most"
 *  - "most active / most complaints / top N people"
 *  - "rank [by/everyone]", "sort by [activity]"
 *  - "leaderboard", "breakdown by person", "[noun] per person"
 */
const AGGREGATION_RE =
  /\b(how\s+many|total\s+(?:number\s+of\s+)?(?:messages?|complaints?|orders?|issues?|reports?|tickets?)|(?:who|which\s+(?:person|team\s+member|user|staff|channel))\s+(?:(?:has|have|had|sent|posted|reported|raised|filed|flagged|complained|mentioned|submitted|logged|created|opened|escalated|resolved|handled|responded|replied)\s+the\s+(?:most|least|more|fewer|fewest)|(?:is|are|was|were)\s+(?:the\s+)?(?:most|least)\s+(?:active|engaged|responsive|productive)|(?:sends?|sent|posts?|posted|reports?|reported|raises?|raised|files?|filed|flags?|flagged|complains?|complained|complaining|logs?|logged|creates?|created|escalates?|escalated|handles?|handled|responds?|responded|replies|replied)\s+(?:the\s+)?most)|who\s+(?:has\s+been|have\s+been|was)\s+\w+(?:ing)?\s+(?:the\s+)?most|most\s+(?:active|messages?|complaints?|reports?|issues?|tickets?|engaged|responsive|productive)|least\s+(?:active|messages?|responsive)|rank(?:ing|ed|s)?\s+(?:everyone|all|people|users?|team|by)|rank\s+(?:the\s+)?\w+\s+by|sort(?:ed|ing)?\s+by\s+(?:messages?|complaints?|activity|count|number|most)|compare\s+(?:all|everyone|each|team|channels?)|top\s+\d+\s+(?:people|persons?|users?|channels?|senders?|reporters?|team\s+members?|staff)|top\s+(?:people|persons?|users?|channels?|senders?|reporters?|team\s+members?)|breakdown\s+(?:of|by)\s+(?:messages?|complaints?|activity|channel|person|user)|count\s+(?:of\s+)?(?:messages?|complaints?|reports?|issues?|tickets?)|(?:messages?|complaints?|reports?|issues?|tickets?)\s+(?:per|by)\s+(?:person|user|channel|team\s+member|staff)|leaderboard|tallied?|frequency\s+of|most\s+(?:messages?\s+)?(?:sent|posted|reported|complained|flagged|filed)|who\s+(?:is|are|was|were)\s+(?:the\s+)?(?:most|top|highest|busiest)\s+\w+)\b/i;

export function detectAggregation(query: string): boolean {
  const result = AGGREGATION_RE.test(query);
  console.log(`[query-analyzer] detectAggregation="${result}" for: "${query.slice(0, 120)}"`);
  return result;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function analyzeQuery(query: string, now = new Date()): QueryAnalysis {
  const timeRange = extractTimeRange(query, now);
  return {
    timeRange,
    searchTerms: extractSearchTerms(query),
    originalQuery: query,
    isBroadSummary: detectBroadSummary(query, timeRange),
    isAggregation: detectAggregation(query),
  };
}
