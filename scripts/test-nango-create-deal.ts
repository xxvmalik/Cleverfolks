import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Test create-deal with Nango model field names
  const payload = {
    name: "TEST-StageField-Debug",
    amount: "999",
    deal_stage: "4979334349",  // Qualification stage ID
    close_date: "2026-04-15",
    deal_description: "Testing which field name sets the stage",
    owner: "89201505",
  };

  console.log("=== Creating deal with deal_stage field ===");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-deal", payload);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // Now try with dealstage (HubSpot API name) to compare
  const payload2 = {
    name: "TEST-StageField-Debug2",
    amount: "888",
    dealstage: "4979334349",  // HubSpot API field name
    closedate: "2026-04-15",
    description: "Testing dealstage field name",
    hubspot_owner_id: "89201505",
  };

  console.log("\n=== Creating deal with dealstage field (HubSpot API names) ===");
  console.log("Payload:", JSON.stringify(payload2, null, 2));

  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-deal", payload2);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }
}

main().catch(console.error);
