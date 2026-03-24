import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Try the fetch-pipelines action
  console.log("=== Trying fetch-pipelines action ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "fetch-pipelines", {});
    console.log(JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("fetch-pipelines FAILED:", e?.response?.data ? JSON.stringify(e.response.data) : e.message?.slice(0, 200));
  }

  // Also dump all 11 deals to see the deal_stage + deal_probability values
  console.log("\n=== All deals: stage IDs and probabilities ===");
  const deals = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Deal" });
  for (const d of deals.records) {
    console.log(`${(d as any).name} | stage=${(d as any).deal_stage} | prob=${(d as any).deal_probability}`);
  }
}

main().catch(console.error);
