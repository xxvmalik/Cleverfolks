import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // 1. Dump all pipeline stages
  console.log("=== fetch-pipelines: all stages ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "fetch-pipelines", {});
    const pipelines = (result as any)?.pipelines ?? [];
    for (const p of pipelines) {
      console.log(`\nPipeline: "${p.label}" (id: ${p.id})`);
      for (const s of p.stages ?? []) {
        console.log(`  Stage: "${s.label}" → ID: ${s.id} (displayOrder: ${s.displayOrder})`);
      }
    }
  } catch (e: any) {
    console.log("fetch-pipelines FAILED:", e?.response?.data ?? e.message?.slice(0, 300));
  }

  // 2. Check existing deals to see what deal_stage values look like
  console.log("\n=== Existing deals: raw deal_stage values ===");
  const deals = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Deal" });
  for (const d of deals.records) {
    const r = d as any;
    console.log(`"${r.name}" | deal_stage=${r.deal_stage} | owner=${r.owner} | amount=${r.amount}`);
  }

  // 3. Get owners
  console.log("\n=== HubSpot Owners ===");
  const owners = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "HubspotOwner" });
  for (const o of owners.records) {
    const r = o as any;
    console.log(`Owner: ${r.firstName} ${r.lastName} | id=${r.id} | email=${r.email}`);
  }

  // 4. Find the GhanaDigital deal specifically
  console.log("\n=== GhanaDigital deal (raw record) ===");
  for (const d of deals.records) {
    const r = d as any;
    if (r.name?.toLowerCase().includes("ghana")) {
      console.log(JSON.stringify(r, null, 2));
    }
  }
}

main().catch(console.error);
