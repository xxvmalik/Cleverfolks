import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";
const PROVIDER = "hubspot";

// All models currently in PROVIDER_MODELS_MAP + variations
const MODELS = [
  "Company", "Contact", "CurrencyCode", "Deal",
  "HubspotKnowledgeBaseArticle", "HubspotOwner",
  "Note", "Product", "Task", "Ticket", "User",
  // The fix: lowercase 's'
  "HubspotServiceTicket",
  // Old wrong casing
  "HubSpotServiceTicket",
];

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  for (const model of MODELS) {
    try {
      const result = await nango.listRecords({ providerConfigKey: PROVIDER, connectionId: CONNECTION_ID, model });
      console.log(`${model}: ${result.records.length} records`);
    } catch (e: any) {
      const data = e?.response?.data;
      console.log(`${model}: FAILED - ${data ? JSON.stringify(data).slice(0, 120) : e.message?.slice(0, 120)}`);
    }
  }
}

main().catch(console.error);
