/**
 * One-time script to score all existing HubSpot contacts for a workspace.
 * Usage: npx tsx --env-file .env.local scripts/score-existing-contacts.ts
 */

import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "../lib/skyler/lead-scoring";

const WORKSPACE_ID = "ab25098b-45fd-40ba-ba6f-d67032dcdbbc";

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`Scoring all HubSpot contacts for workspace ${WORKSPACE_ID}...\n`);

  // Fetch all contact chunks
  const { data: contactChunks, error } = await db
    .from("document_chunks")
    .select("chunk_text, metadata")
    .eq("workspace_id", WORKSPACE_ID)
    .eq("metadata->>source_type", "hubspot_contact");

  if (error) {
    console.error("Failed to fetch contacts:", error.message);
    process.exit(1);
  }

  console.log(`Found ${contactChunks?.length ?? 0} contact chunks\n`);

  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const chunk of contactChunks ?? []) {
    const meta = chunk.metadata as Record<string, unknown>;
    const contactId = meta?.external_id as string;
    const nameMatch = (chunk.chunk_text as string)?.match(/Name:\s*([^|\n]+)/);
    const contactName = nameMatch?.[1]?.trim() ?? "Unknown";

    if (!contactId) {
      console.log(`  SKIP — no external_id for "${contactName}"`);
      skipped++;
      continue;
    }

    console.log(`Scoring: ${contactName} (ID: ${contactId})...`);

    try {
      const result = await scoreLead(db, WORKSPACE_ID, contactId, { forceRescore: true });
      if (result) {
        const dims = Object.entries(result.dimension_scores)
          .map(([k, v]) => `${k}=${v.score}`)
          .join(", ");
        const referral = result.is_referral
          ? ` | Referral: ${result.referrer_name ?? "yes"}`
          : "";
        console.log(
          `  ✓ ${result.contact_name} → ${result.total_score}/100 [${result.classification.toUpperCase()}] (${dims})${referral}`
        );
        scored++;
      } else {
        console.log(`  - Skipped (no data)`);
        skipped++;
      }
    } catch (err) {
      console.error(
        `  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  console.log(`\nDone: ${scored} scored, ${skipped} skipped, ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
