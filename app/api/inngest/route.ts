import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { syncIntegrationFunction } from "@/lib/inngest/functions/sync-integration";
import { buildKnowledgeProfileFunction } from "@/lib/inngest/functions/build-knowledge-profile";
import { salesCloserWorkflow, triggerSalesCloserOnHotLead, handlePipelineReply } from "@/lib/inngest/functions/sales-closer";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncIntegrationFunction,
    buildKnowledgeProfileFunction,
    salesCloserWorkflow,
    triggerSalesCloserOnHotLead,
    handlePipelineReply,
  ],
});
