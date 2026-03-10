/**
 * Filters out HubSpot deal/pipeline data from workspace memories.
 * Deal records (prospect names, amounts, stages) pollute service descriptions
 * when passed to the playbook builder or email drafter.
 */

const DEAL_PATTERNS = [
  /₦[\d,]+/,                          // Naira amounts (deal values)
  /\$[\d,]+/,                         // Dollar amounts
  /€[\d,]+/,                          // Euro amounts
  /£[\d,]+/,                          // Pound amounts
  /is a (prospect|lead|contact) with/i,
  /deal (worth|valued|amount|stage)/i,
  /\b(New Inquiry|Proposal Sent|Qualification|Negotiation|Closed Won|Closed Lost)\b/,
  /pipeline stage/i,
  /deal stages include/i,
  /is a business entity/i,
  /prospect with a .+ deal/i,
  /closes? (on|by|in) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
];

export function filterDealMemories(memories: string[]): string[] {
  return memories.filter((memory) => {
    const isDealData = DEAL_PATTERNS.some((pattern) => pattern.test(memory));
    if (isDealData) {
      console.log("[Memory Filter] Excluded deal data:", memory.substring(0, 80));
    }
    return !isDealData;
  });
}
