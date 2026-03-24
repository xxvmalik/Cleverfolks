import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // 1. Dump existing tasks to see Nango's field names
  console.log("=== Existing Tasks (raw records) ===");
  const tasks = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Task" });
  for (const t of tasks.records) {
    console.log(JSON.stringify(t, null, 2));
  }

  // 2. Try creating a task with Nango model field names (guessing from record structure)
  console.log("\n=== Test create-task with Nango model names ===");
  const payload1 = {
    subject: "TEST-TaskField-Debug",
    content: "Testing task field names",
    priority: "MEDIUM",
    // Try various date field names
    createdAt: new Date().toISOString(),
  };
  console.log("Payload:", JSON.stringify(payload1, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload1);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }

  // 3. Try with HubSpot API names (our current code)
  console.log("\n=== Test create-task with HubSpot API names (current code) ===");
  const payload2 = {
    hs_task_subject: "TEST-TaskField-Debug2",
    hs_task_body: "Testing HubSpot API field names",
    hs_task_priority: "MEDIUM",
    hs_timestamp: new Date().toISOString(),
  };
  console.log("Payload:", JSON.stringify(payload2, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload2);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", e?.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message?.slice(0, 500));
  }
}

main().catch(console.error);
