import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Fetch all deals and find the test ones
  const deals = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Deal" });
  for (const d of deals.records) {
    const r = d as any;
    if (r.name?.includes("TEST-StageField") || r.name?.includes("GhanaDigital") || r.name?.toLowerCase().includes("ghana")) {
      console.log(`\n"${r.name}":`);
      console.log(`  deal_stage: ${r.deal_stage}`);
      console.log(`  amount: ${r.amount}`);
      console.log(`  close_date: ${r.close_date}`);
      console.log(`  owner: ${r.owner}`);
      console.log(`  deal_description: ${r.deal_description}`);
    }
  }

  // Clean up: delete test deals
  console.log("\n=== Cleaning up test deals ===");
  for (const d of deals.records) {
    const r = d as any;
    if (r.name?.includes("TEST-StageField")) {
      console.log(`Deleting "${r.name}" (${r.id})...`);
      try {
        await nango.triggerAction("hubspot", CONNECTION_ID, "delete-deal", { id: r.id });
        console.log("  Deleted.");
      } catch (e: any) {
        console.log("  Delete failed (manual cleanup needed):", e.message?.slice(0, 100));
      }
    }
  }
}

main().catch(console.error);
