import { Nango } from "@nangohq/node";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const nangoKey = process.env.NANGO_SECRET_KEY!;

  const connRes = await fetch(
    `${supabaseUrl}/rest/v1/integrations?select=nango_connection_id&provider=eq.outlook&status=eq.connected&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const conns = await connRes.json();
  const connectionId = conns[0].nango_connection_id;
  const nango = new Nango({ secretKey: nangoKey });

  // Test 1: WITH filter (what reply-check uses)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  console.log("Filter datetime:", tenMinAgo);
  const filter = `receivedDateTime ge ${tenMinAgo}`;
  const qs = `$filter=${encodeURIComponent(filter)}&$top=20&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime`;

  console.log("\n--- Test 1: With $filter ---");
  console.log("Endpoint:", `/v1.0/me/messages?${qs}`);
  try {
    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages?${qs}`,
      connectionId,
      providerConfigKey: "outlook",
    });
    const messages = (response as any)?.data?.value ?? [];
    console.log(`Got ${messages.length} messages`);
    for (const m of messages) {
      console.log(`  ${m.receivedDateTime} | ${m.from?.emailAddress?.address} | ${m.subject}`);
    }
  } catch (err: any) {
    console.error("FAILED:", err.message);
    if (err.response?.data) console.error("Response:", JSON.stringify(err.response.data));
  }

  // Test 2: WITHOUT filter, wider window (what would work)
  console.log("\n--- Test 2: Without $filter (top 20 recent) ---");
  try {
    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: `/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime`,
      connectionId,
      providerConfigKey: "outlook",
    });
    const messages = (response as any)?.data?.value ?? [];
    console.log(`Got ${messages.length} messages`);
    for (const m of messages) {
      console.log(`  ${m.receivedDateTime} | ${m.from?.emailAddress?.address} | ${m.subject}`);
    }
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }
}

main();
