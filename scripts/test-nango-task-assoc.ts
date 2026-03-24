import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // First, find Amina Osei's contact ID from synced contacts
  console.log("=== Finding contacts ===");
  const contacts = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Contact" });
  for (const c of contacts.records) {
    const r = c as any;
    console.log(`${r.first_name} ${r.last_name} | id=${r.id} | email=${r.email}`);
  }

  // Get a real contact ID for testing
  const testContact = contacts.records[0] as any;
  const contactId = testContact?.id;
  console.log(`\nUsing contact: ${testContact?.first_name} ${testContact?.last_name} (${contactId})`);

  // Test 1: associations array (HubSpot v3 format) inside payload
  console.log("\n=== Test 1: associations array in payload ===");
  const payload1 = {
    title: "TEST-Assoc-v3-format",
    notes: "Testing associations",
    priority: "MEDIUM",
    due_date: new Date(Date.now() + 86400000).toISOString(),
    task_type: "TODO",
    associations: [
      { to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] }
    ],
  };
  console.log("Payload:", JSON.stringify(payload1, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload1);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error ?? e.message).slice(0, 500));
  }

  // Test 2: contact_ids / contact_id field
  console.log("\n=== Test 2: contact_id field ===");
  const payload2 = {
    title: "TEST-Assoc-contact-id",
    notes: "Testing contact_id field",
    priority: "MEDIUM",
    due_date: new Date(Date.now() + 86400000).toISOString(),
    task_type: "TODO",
    contact_id: contactId,
  };
  console.log("Payload:", JSON.stringify(payload2, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload2);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error ?? e.message).slice(0, 500));
  }

  // Test 3: assigned_to field (from the Task model)
  console.log("\n=== Test 3: assigned_to field ===");
  const payload3 = {
    title: "TEST-Assoc-assigned-to",
    notes: "Testing assigned_to field with contact ID",
    priority: "MEDIUM",
    due_date: new Date(Date.now() + 86400000).toISOString(),
    task_type: "TODO",
    assigned_to: contactId,
  };
  console.log("Payload:", JSON.stringify(payload3, null, 2));
  try {
    const result = await nango.triggerAction("hubspot", CONNECTION_ID, "create-task", payload3);
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.log("FAILED:", JSON.stringify(e?.response?.data?.error ?? e.message).slice(0, 500));
  }

  // Check existing tasks to see how associations are represented
  console.log("\n=== Existing tasks with associations ===");
  const tasks = await nango.listRecords({ providerConfigKey: "hubspot", connectionId: CONNECTION_ID, model: "Task" });
  for (const t of tasks.records) {
    const r = t as any;
    if (r.returned_associations?.contacts?.length > 0 || r.returned_associations?.deals?.length > 0) {
      console.log(`"${r.title}" associations:`, JSON.stringify(r.returned_associations));
    }
  }
}

main().catch(console.error);
