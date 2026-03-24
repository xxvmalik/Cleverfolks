import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Dump ALL fields from first company
  const companies = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Company" });
  const c = companies.records[0] as Record<string, unknown>;
  console.log("=== All Company fields ===");
  for (const [k, v] of Object.entries(c)) {
    if (k !== "_nango_metadata") console.log(`${k}: ${JSON.stringify(v)}`);
  }

  // Try creating with phone field
  console.log("\n=== Test create with phone ===");
  try {
    const r = await nango.triggerAction("hubspot", CONNECTION_ID, "create-company", { name: "TEST-Phone", phone: "+1234567890" });
    console.log("SUCCESS:", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.status, JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try phone_number
  console.log("\n=== Test create with phone_number ===");
  try {
    const r = await nango.triggerAction("hubspot", CONNECTION_ID, "create-company", { name: "TEST-PhoneNum", phone_number: "+1234567890" });
    console.log("SUCCESS:", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.status, JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try update with phone on existing company
  console.log("\n=== Test update with phone ===");
  try {
    const r = await nango.triggerAction("hubspot", CONNECTION_ID, "update-company", { id: "415721154805", phone: "+9876543210" });
    console.log("SUCCESS:", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.status, JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try update with phone_number
  console.log("\n=== Test update with phone_number ===");
  try {
    const r = await nango.triggerAction("hubspot", CONNECTION_ID, "update-company", { id: "415721154805", phone_number: "+9876543210" });
    console.log("SUCCESS:", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.status, JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }
}

main().catch(console.error);
