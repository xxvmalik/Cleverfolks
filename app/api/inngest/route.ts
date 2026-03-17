import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { syncIntegrationFunction } from "@/lib/inngest/functions/sync-integration";
import { buildKnowledgeProfileFunction } from "@/lib/inngest/functions/build-knowledge-profile";
import { salesCloserWorkflow, triggerSalesCloserOnHotLead, handlePipelineReply, handleClarificationReceived } from "@/lib/inngest/functions/sales-closer";
import { salesCadenceScheduler, salesCadenceFollowUp } from "@/lib/inngest/functions/sales-cadence";
import { replyCheckScheduler } from "@/lib/inngest/functions/reply-check";
import { meetingCheckScheduler } from "@/lib/inngest/functions/meeting-check";
import { processMeetingTranscript, actionNoteDeadlineChecker } from "@/lib/inngest/functions/meeting-transcript";
import { recallBotChecker } from "@/lib/inngest/functions/recall-bot-checker";
import { reasoningPipeline, reasoningCadenceScheduler } from "@/lib/inngest/functions/skyler-reasoning-pipeline";
import { processCorrection } from "@/lib/inngest/functions/process-correction";
import { trackDecisionOutcomes } from "@/lib/inngest/functions/track-decision-outcomes";
import { evaluateAutonomyLevels } from "@/lib/inngest/functions/evaluate-autonomy-levels";
import { consolidateMemories } from "@/lib/inngest/functions/consolidate-memories";
// Stage 13: Meeting Lifecycle System
import { bookMeetingFlow } from "@/lib/inngest/functions/book-meeting-flow";
import { generatePreCallBrief } from "@/lib/inngest/functions/generate-pre-call-brief";
import { detectNoShow } from "@/lib/inngest/functions/detect-no-show";
import { detectMeetingPatterns } from "@/lib/inngest/functions/detect-meeting-patterns";
import { enrichNewAttendee } from "@/lib/inngest/functions/enrich-new-attendee";
import { logCRMActivity } from "@/lib/inngest/functions/log-crm-activity";

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
    recallBotChecker,
    reasoningPipeline,
    reasoningCadenceScheduler,
    // Stage 11: Decision Memory & Learning
    processCorrection,
    trackDecisionOutcomes,
    evaluateAutonomyLevels,
    consolidateMemories,
    // Stage 13: Meeting Lifecycle System
    bookMeetingFlow,
    generatePreCallBrief,
    detectNoShow,
    detectMeetingPatterns,
    enrichNewAttendee,
    logCRMActivity,
  ],
});
