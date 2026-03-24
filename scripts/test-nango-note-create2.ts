import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Try with body + timestamp (Nango Note model field names guessed)
  console.log("=== Test 1: body + timestamp ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", {
      body: "TEST note v1",
      timestamp: new Date().toISOString(),
    });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try with content + created_date
  console.log("\n=== Test 2: content + created_date ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", {
      content: "TEST note v2",
      created_date: new Date().toISOString(),
    });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try wrapping in properties (raw HubSpot API)
  console.log("\n=== Test 3: properties wrapper ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", {
      properties: {
        hs_note_body: "TEST note v3",
        hs_timestamp: new Date().toISOString(),
      },
    });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }

  // Try body + due_date (like tasks)
  console.log("\n=== Test 4: body + due_date ===");
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-note", {
      body: "TEST note v4",
      due_date: new Date().toISOString(),
    });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error?.payload ?? e.message).slice(0, 300));
  }
}

main().catch(console.error);
