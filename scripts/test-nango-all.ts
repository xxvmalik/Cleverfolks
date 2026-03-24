import { Nango } from "@nangohq/node";

const CONNECTION_ID = "2fef56c8-0d8a-441e-b401-a208dfa41302";
const PROVIDER = "hubspot";

const MODELS = [
  "Deal", "Contact", "Company", "Ticket", "Task", "Note",
  "Owner", "Product", "User", "KnowledgeBaseArticle", "ServiceTicket", "Currency",
];

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  for (const model of MODELS) {
    console.log(`\n=== MODEL: "${model}" ===`);
    try {
      const result = await nango.listRecords({
        providerConfigKey: PROVIDER,
        connectionId: CONNECTION_ID,
        model,
      });
      console.log(`Records: ${result.records.length}`);
      if (result.records.length > 0) {
        console.log(JSON.stringify(result.records[0], null, 2));
      }
    } catch (err: any) {
      const data = err?.response?.data;
      console.log(`FAILED: ${err?.response?.status} - ${JSON.stringify(data)}`);
    }
  }
}

main().catch(console.error);
