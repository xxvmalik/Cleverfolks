import { Nango } from "@nangohq/node";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const nangoKey = process.env.NANGO_SECRET_KEY!;

  // Get outlook connection
  const connRes = await fetch(
    `${supabaseUrl}/rest/v1/integrations?select=nango_connection_id,provider&provider=eq.outlook&status=eq.connected&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const conns = await connRes.json();
  if (!conns || conns.length === 0) { console.log("No outlook connection"); return; }

  const connectionId = conns[0].nango_connection_id;
  console.log("Connection:", connectionId);

  const nango = new Nango({ secretKey: nangoKey });

  // Get recent messages (no filter, just top 15)
  try {
    const response = await nango.proxy({
      method: "GET",
      baseUrlOverride: "https://graph.microsoft.com",
      endpoint: "/v1.0/me/messages?$top=15&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime",
      connectionId,
      providerConfigKey: "outlook",
    });

    const messages = (response as any)?.data?.value ?? [];
    console.log(`\nRecent ${messages.length} messages:\n`);
    for (const m of messages) {
      const sender = m.from?.emailAddress?.address ?? "unknown";
      console.log(`  ${m.receivedDateTime} | ${sender} | ${m.subject}`);
    }
  } catch (err: any) {
    console.error("Error:", err.message || err);
  }

  // Also check: what pipeline contacts are we looking for?
  const pipeRes = await fetch(
    `${supabaseUrl}/rest/v1/skyler_sales_pipeline?select=contact_email,awaiting_reply,stage&resolution=is.null&awaiting_reply=eq.true&limit=10`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const pipes = await pipeRes.json();
  console.log("\nPipeline contacts awaiting reply:");
  for (const p of pipes) {
    console.log(`  ${p.contact_email} | stage: ${p.stage} | awaiting: ${p.awaiting_reply}`);
  }
}

main();
