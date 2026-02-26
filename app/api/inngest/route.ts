import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { syncIntegrationFunction } from "@/lib/inngest/functions/sync-integration";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncIntegrationFunction],
});
