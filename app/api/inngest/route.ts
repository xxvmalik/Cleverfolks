import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { syncIntegrationFunction } from "@/lib/inngest/functions/sync-integration";
import { buildKnowledgeProfileFunction } from "@/lib/inngest/functions/build-knowledge-profile";
import { salesCloserWorkflow, triggerSalesCloserOnHotLead, handlePipelineReply, handleClarificationReceived } from "@/lib/inngest/functions/sales-closer";
import { salesCadenceScheduler, salesCadenceFollowUp } from "@/lib/inngest/functions/sales-cadence";
import { replyCheckScheduler } from "@/lib/inngest/functions/reply-check";
import { meetingCheckScheduler } from "@/lib/inngest/functions/meeting-check";
import { processMeetingTranscript, actionNoteDeadlineChecker } from "@/lib/inngest/functions/meeting-transcript";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncIntegrationFunction,
    buildKnowledgeProfileFunction,
    salesCloserWorkflow,
    triggerSalesCloserOnHotLead,
    handlePipelineReply,
    handleClarificationReceived,
    salesCadenceScheduler,
    salesCadenceFollowUp,
    replyCheckScheduler,
    meetingCheckScheduler,
    processMeetingTranscript,
    actionNoteDeadlineChecker,
  ],
});
