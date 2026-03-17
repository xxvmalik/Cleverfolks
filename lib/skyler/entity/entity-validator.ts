/**
 * Post-Generation Entity Validator (Stage 12, Part D).
 *
 * After Claude generates a response, validates it references the correct entity.
 * Catches cross-entity contamination before it reaches the user.
 */

export type EntityValidationResult = {
  isClean: boolean;
  contaminations: Array<{
    wrongEntityName: string;
    wrongEntityCompany: string;
    context: string;
  }>;
  warning?: string;
};

/**
 * Validate that Claude's response is about the correct entity.
 * Checks for mentions of other entities from the conversation.
 */
export function validateEntityGrounding(
  response: string,
  activeEntity: {
    entityName: string;
    companyName: string;
    contactEmail: string;
  },
  otherEntitiesInConversation: Array<{
    entityName: string;
    companyName: string;
  }>
): EntityValidationResult {
  if (otherEntitiesInConversation.length === 0) {
    return { isClean: true, contaminations: [] };
  }

  const contaminations: EntityValidationResult["contaminations"] = [];
  const responseLower = response.toLowerCase();

  for (const other of otherEntitiesInConversation) {
    // Skip if the other entity shares a name/company with the active entity
    if (
      other.entityName.toLowerCase() === activeEntity.entityName.toLowerCase() ||
      other.companyName.toLowerCase() === activeEntity.companyName.toLowerCase()
    ) {
      continue;
    }

    let found = false;
    let context = "";

    // Check for the other entity's name in the response
    if (other.entityName && other.entityName.length >= 3) {
      const nameIdx = responseLower.indexOf(other.entityName.toLowerCase());
      if (nameIdx !== -1) {
        found = true;
        context = response.slice(Math.max(0, nameIdx - 30), nameIdx + other.entityName.length + 30);
      }
    }

    // Check for the other entity's company name
    if (!found && other.companyName && other.companyName.length >= 3) {
      const compIdx = responseLower.indexOf(other.companyName.toLowerCase());
      if (compIdx !== -1) {
        // Make sure it's not a generic word match
        const snippet = response.slice(
          Math.max(0, compIdx - 20),
          compIdx + other.companyName.length + 20
        );
        found = true;
        context = snippet;
      }
    }

    if (found) {
      contaminations.push({
        wrongEntityName: other.entityName,
        wrongEntityCompany: other.companyName,
        context,
      });
    }
  }

  if (contaminations.length > 0) {
    const names = contaminations.map((c) => c.wrongEntityName || c.wrongEntityCompany).join(", ");
    console.warn(`[entity-validator] Contamination detected: response mentions ${names} instead of ${activeEntity.entityName}`);

    return {
      isClean: false,
      contaminations,
      warning: `This response may reference the wrong lead (${names}). Please review carefully.`,
    };
  }

  return { isClean: true, contaminations: [] };
}

/**
 * Build an entity instruction to inject at the end of the system prompt.
 * Uses XML tags for highest LLM attention.
 */
export function buildActiveEntityBlock(
  entity: {
    entityId: string;
    entityName: string;
    companyName: string;
    contactEmail: string;
    stage?: string;
    emailsSent?: number;
    emailsReplied?: number;
    dealValue?: number;
    lastActivity?: string;
  },
  conversationThread?: Array<{
    role: string;
    content: string;
    subject?: string;
    timestamp: string;
  }>,
  directives?: Array<{ directive_text: string; created_at: string }>,
  meetingSummary?: string
): string {
  // Recent conversation — last 5 exchanges with THIS lead
  let recentConversation = "(No email history yet)";
  if (conversationThread && conversationThread.length > 0) {
    const recent = conversationThread.slice(-5);
    recentConversation = recent
      .map(
        (e) =>
          `[${e.role}]${e.subject ? ` Subject: "${e.subject}"` : ""} (${e.timestamp}):\n${e.content}`
      )
      .join("\n\n");
  }

  // Directives
  let directivesBlock = "";
  if (directives && directives.length > 0) {
    directivesBlock = `\n  <directives>\n${directives.map((d) => `    - "${d.directive_text}" (${new Date(d.created_at).toLocaleDateString()})`).join("\n")}\n  </directives>`;
  }

  // Meeting summary
  let meetingBlock = "";
  if (meetingSummary) {
    meetingBlock = `\n  <meeting_summary>\n    ${meetingSummary}\n  </meeting_summary>`;
  }

  return `
<active_entity type="lead" id="${entity.entityId}">
  <name>${entity.entityName}</name>
  <company>${entity.companyName}</company>
  <email>${entity.contactEmail}</email>
  <stage>${entity.stage ?? "unknown"}</stage>
  <emails_sent>${entity.emailsSent ?? 0}</emails_sent>
  <emails_replied>${entity.emailsReplied ?? 0}</emails_replied>
  ${entity.dealValue != null ? `<deal_value>$${entity.dealValue.toLocaleString()}</deal_value>` : ""}
  ${entity.lastActivity ? `<last_activity>${entity.lastActivity}</last_activity>` : ""}
  <recent_conversation>
${recentConversation}
  </recent_conversation>${directivesBlock}${meetingBlock}
</active_entity>

<active_entity_instruction>
You are currently working with ${entity.entityName} from ${entity.companyName}.
ALL responses, drafts, analysis, and actions MUST be about ${entity.entityName}.
Do NOT reference or use information from other leads discussed earlier in this conversation.
When using tools that affect a lead, use pipeline_id: "${entity.entityId}" and email: "${entity.contactEmail}".
If the user asks about a different lead, acknowledge the switch before proceeding.
</active_entity_instruction>`;
}
