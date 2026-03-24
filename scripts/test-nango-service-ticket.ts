import { Nango } from "@nangohq/node";

const CONNECTION_ID = "fff2de68-2a15-4637-aff0-c6d0f937fa12";
const PROVIDER = "hubspot";

const MODELS = [
  "HubSpotServiceTicket",
  "HubspotServiceTicket",
  "ServiceTicket",
  "Ticket",
  "HubSpotTicket",
  "HubspotTicket",
];

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Also test a known-working model to confirm the connection ID is valid
  console.log("=== Verifying connection ID with Deal model ===");
  try {
    const deals = await nango.listRecords({ providerConfigKey: PROVIDER, connectionId: CONNECTION_ID, model: "Deal" });
    console.log(`Deal: ${deals.records.length} records (connection ID is valid)\n`);
  } catch (e: any) {
    console.log(`Deal: FAILED - ${e?.response?.data ? JSON.stringify(e.response.data) : e.message}\n`);
  }

  console.log("=== Testing service ticket model name variations ===");
  for (const model of MODELS) {
    try {
      const result = await nango.listRecords({ providerConfigKey: PROVIDER, connectionId: CONNECTION_ID, model });
      console.log(`${model}: ${result.records.length} records`);
      if (result.records.length > 0) {
        console.log("FIRST RECORD:", JSON.stringify(result.records[0], null, 2));
      }
    } catch (e: any) {
      const data = e?.response?.data;
      console.log(`${model}: FAILED - ${data ? JSON.stringify(data) : e.message?.slice(0, 150)}`);
    }
  }
}

main().catch(console.error);
