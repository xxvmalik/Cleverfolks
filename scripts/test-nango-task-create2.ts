import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Try with exact Nango Task model field names from listRecords
  console.log("=== Test 1: Nango Task model field names ===");
  const payload1 = {
    title: "TEST-Task-Model-Names",
    notes: "Testing with Nango model field names",
    priority: "MEDIUM",
    due_date: "2026-04-15T00:00:00Z",
    task_type: "TODO",
  };
  console.log("Payload:", JSON.stringify(payload1, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload1);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // Try minimal — just title
  console.log("\n=== Test 2: Minimal — just title ===");
  const payload2 = { title: "TEST-Task-Minimal" };
  console.log("Payload:", JSON.stringify(payload2, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload2);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // Try with hs_timestamp (required by HubSpot for engagements)
  console.log("\n=== Test 3: title + hs_timestamp ===");
  const payload3 = {
    title: "TEST-Task-WithTimestamp",
    notes: "Testing",
    hs_timestamp: new Date().toISOString(),
  };
  console.log("Payload:", JSON.stringify(payload3, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload3);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }
}

main().catch(console.error);
