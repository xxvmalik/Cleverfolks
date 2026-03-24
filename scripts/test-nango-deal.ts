import { Nango } from "@nangohq/node";

async function main() {
  const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });

  // Step 1: List all connections to find the correct HubSpot connection ID
  console.log("=== LISTING ALL NANGO CONNECTIONS ===");
  const resp = await fetch("https://api.nango.dev/connection", {
    headers: { Authorization: `Bearer ${process.env.NANGO_SECRET_KEY!}` },
  });
  const connections = await resp.json();
  console.log(JSON.stringify(connections, null, 2));

  // Step 2: Find hubspot connections
  const hubspotConns = (connections.connections ?? connections).filter(
    (c: any) => c.provider_config_key === "hubspot" || c.provider === "hubspot"
  );
  console.log(`\nFound ${hubspotConns.length} HubSpot connection(s)`);

  if (hubspotConns.length === 0) {
    console.log("No HubSpot connections found in Nango.");
    return;
  }

  const connId = hubspotConns[0].connection_id;
  const providerKey = hubspotConns[0].provider_config_key;
  console.log(`Using connectionId="${connId}", providerConfigKey="${providerKey}"`);

  // Step 3: Try fetching Deal records
  const MODEL_CANDIDATES = ["Deal", "HubSpotDeal", "Deals"];
  for (const model of MODEL_CANDIDATES) {
    console.log(`\n--- Trying model: "${model}" ---`);
    try {
      const result = await nango.listRecords({
        providerConfigKey: providerKey,
        connectionId: connId,
        model,
      });
      console.log(`SUCCESS! Records returned: ${result.records.length}`);
      if (result.records.length > 0) {
        console.log("\n=== FIRST RAW DEAL RECORD ===");
        console.log(JSON.stringify(result.records[0], null, 2));
      }
      return;
    } catch (err: any) {
      const responseData = err?.response?.data;
      console.log(`FAILED: ${err?.response?.status} - ${JSON.stringify(responseData)}`);
    }
  }

  console.log("\nAll model names failed. Check Nango dashboard for correct sync model names.");
}

main().catch(console.error);
