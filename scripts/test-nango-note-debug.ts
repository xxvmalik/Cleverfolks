import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Check Note model fields
  console.log("=== Existing Notes (raw records) ===");
  try {
    const notes = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Note" });
    for (const n of notes.records.slice(0, 2)) {
      console.log(JSON.stringify(n, null, 2));
    }
    if (notes.records.length === 0) console.log("(no notes found)");
  } catch (e: any) {
    console.log("listRecords Note failed:", e.message?.slice(0, 200));
  }

  // Try create-note with body field
  console.log("\n=== Test create-note with body field ===");
  const payload1 = {
    body: "TEST note body content",
  };
  console.log("Payload:", JSON.stringify(payload1, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", payload1);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // Try with content field
  console.log("\n=== Test create-note with content field ===");
  const payload2 = {
    content: "TEST note content field",
  };
  console.log("Payload:", JSON.stringify(payload2, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", payload2);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // Try with hs_note_body
  console.log("\n=== Test create-note with hs_note_body field ===");
  const payload3 = {
    hs_note_body: "TEST note hs_note_body field",
    hs_timestamp: new Date().toISOString(),
  };
  console.log("Payload:", JSON.stringify(payload3, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", payload3);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }
}

main().catch(console.error);
