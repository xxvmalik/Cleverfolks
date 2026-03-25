/**
 * GET /api/skyler/test-draft?pipelineId=xxx
 *
 * Runs the reply draft pipeline DIRECTLY (no Inngest) and returns
 * the result or error in the response. For debugging why drafts
 * aren't being created.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { draftEmail } from "@/lib/skyler/email-drafter";
import { draftOutreachEmail } from "@/lib/email/email-sender";
import { researchCompany } from "@/lib/skyler/company-research";
import { buildSalesPlaybook } from "@/lib/skyler/sales-playbook";
import { getSalesVoice, learnSalesVoice } from "@/lib/skyler/voice-learner";
import { filterDealMemories } from "@/lib/skyler/filter-deal-memories";
import { dispatchNotification } from "@/lib/skyler/notifications";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pipelineId = req.nextUrl.searchParams.get("pipelineId");
  if (!pipelineId) return NextResponse.json({ error: "pipelineId required" }, { status: 400 });

  const db = createAdminSupabaseClient();
  const log: string[] = [];
  const errors: string[] = [];

  try {
    // 1. Fetch pipeline
    log.push("1. Fetching pipeline...");
    const { data: pipeline, error: pipeErr } = await db
      .from("skyler_sales_pipeline")
      .select("*")
      .eq("id", pipelineId)
      .single();

    if (pipeErr || !pipeline) {
      return NextResponse.json({ error: "Pipeline not found", details: pipeErr?.message, log });
    }
    log.push(`   Found: ${pipeline.contact_name} (${pipeline.contact_email}), stage=${pipeline.stage}, resolution=${pipeline.resolution}`);

    // Get workspace
    const { data: membership } = await supabase
      .from("workspace_memberships")
      .select("workspace_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const workspaceId = membership?.workspace_id as string;
    log.push(`   Workspace: ${workspaceId?.slice(0, 8)}`);

    // 2. Fetch memories
    log.push("2. Fetching memories...");
    let memories: string[] = [];
    try {
      const { data: memData } = await db
        .from("workspace_memories")
        .select("content")
        .eq("workspace_id", workspaceId)
        .is("superseded_by", null)
        .order("times_reinforced", { ascending: false })
        .limit(20);
      memories = filterDealMemories((memData ?? []).map((m) => m.content as string));
      log.push(`   Got ${memories.length} memories`);
    } catch (err) {
      errors.push(`memories: ${err instanceof Error ? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // 3. Knowledge profile
    log.push("3. Loading knowledge profile...");
    let knowledgeProfile: Record<string, unknown> | null = null;
    try {
      const { data } = await db
        .from("knowledge_profiles")
        .select("profile, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (data?.profile && ["ready", "pending_review"].includes(data.status ?? "")) {
        knowledgeProfile = data.profile as Record<string, unknown>;
      }
      log.push(`   ${knowledgeProfile ? "Loaded" : "None found"}`);
    } catch (err) {
      errors.push(`knowledge: ${err instanceof Error ? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // 4. Playbook
    log.push("4. Building playbook...");
    let playbook = null;
    try {
      playbook = await buildSalesPlaybook(db, workspaceId, memories, knowledgeProfile);
      log.push(`   Built: ${playbook?.company_name ?? "no company"}, ${playbook?.services?.length ?? 0} services`);
    } catch (err) {
      errors.push(`playbook: ${err instanceof Error ? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // 5. Research
    log.push("5. Researching company...");
    let research;
    try {
      research = await researchCompany({
        companyName: pipeline.company_name as string,
        companyWebsite: (pipeline.website as string) ?? undefined,
        contactEmail: pipeline.contact_email as string,
        contactName: pipeline.contact_name as string,
        userContext: (pipeline.user_context as string) ?? undefined,
        workspaceId,
        pipelineId,
        db,
        businessContext: memories.join("\n"),
        salesPlaybook: playbook,
      });
      log.push(`   Done: ${research.confidence} confidence, industry=${research.industry}`);
    } catch (err) {
      errors.push(`research: ${err instanceof Error ? err.stack ?? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
      research = {
        summary: pipeline.company_name ?? "Unknown",
        industry: "Unknown",
        estimated_size: "Unknown",
        trigger_event: "",
        recent_news: [],
        pain_points: [],
        decision_makers: [],
        talking_points: [],
        service_alignment_points: [],
        website_insights: "",
        researched_at: new Date().toISOString(),
        confidence: "low" as const,
        confidence_reason: "Research failed",
      };
    }

    // 6. Voice
    log.push("6. Loading sales voice...");
    let voice = null;
    try {
      voice = await getSalesVoice(db, workspaceId);
      if (!voice) voice = await learnSalesVoice(db, workspaceId);
      log.push(`   ${voice ? "Loaded" : "None"}`);
    } catch (err) {
      errors.push(`voice: ${err instanceof Error ? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // 7. Sender
    log.push("7. Loading sender identity...");
    let senderName: string | null = null;
    let senderCompany: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: memberData } = await db
        .from("workspace_memberships")
        .select("profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .limit(1)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prof = (memberData as any)?.profiles;
      senderName = Array.isArray(prof) ? prof[0]?.full_name : prof?.full_name ?? null;
      const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      senderCompany = (settings.company_name as string) ?? playbook?.company_name ?? null;
      log.push(`   Sender: ${senderName} @ ${senderCompany}`);
    } catch (err) {
      errors.push(`sender: ${err instanceof Error ? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
    }

    // 8. Draft email
    const thread = (pipeline.conversation_thread ?? []) as Array<{
      role: string; content: string; subject?: string; timestamp: string;
    }>;

    log.push(`8. Drafting email (thread has ${thread.length} entries)...`);
    let draft;
    try {
      draft = await draftEmail({
        workspaceId,
        pipelineRecord: {
          id: pipelineId,
          contact_name: pipeline.contact_name as string,
          contact_email: pipeline.contact_email as string,
          company_name: pipeline.company_name as string,
          stage: "replied",
          cadence_step: pipeline.cadence_step as number,
          conversation_thread: thread,
        },
        cadenceStep: -1,
        companyResearch: research,
        salesVoice: voice,
        conversationThread: thread,
        workspaceMemories: memories,
        salesPlaybook: playbook,
        knowledgeProfile,
        senderName: senderName ?? undefined,
        senderCompany: senderCompany ?? undefined,
        replyIntent: "meeting_accept",
      });
      log.push(`   Drafted: "${draft.subject}" (${draft.textBody.split(/\s+/).length} words)`);
    } catch (err) {
      errors.push(`draftEmail: ${err instanceof Error ? err.stack ?? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
      return NextResponse.json({ status: "draft_failed", log, errors });
    }

    // 9. Store draft
    log.push("9. Storing draft in skyler_actions...");
    try {
      const action = await draftOutreachEmail(db, {
        workspaceId,
        pipelineId,
        to: pipeline.contact_email as string,
        subject: draft.subject,
        htmlBody: draft.htmlBody,
        textBody: draft.textBody,
      });
      log.push(`   Stored: actionId=${action.actionId}`);

      // 10. Notify
      await dispatchNotification(db, {
        workspaceId,
        eventType: "draft_awaiting_approval",
        pipelineId,
        title: `Reply draft ready: ${pipeline.contact_name}`,
        body: `Reply to ${pipeline.contact_email} is ready for your approval.`,
        metadata: {
          contactName: pipeline.contact_name,
          contactEmail: pipeline.contact_email,
          companyName: pipeline.company_name,
          intent: "meeting_accept",
        },
      });
      log.push("10. Notification sent");

      return NextResponse.json({
        status: "draft_created",
        actionId: action.actionId,
        subject: draft.subject,
        preview: draft.textBody.slice(0, 200),
        log,
        errors,
      });
    } catch (err) {
      errors.push(`store: ${err instanceof Error ? err.stack ?? err.message : err}`);
      log.push(`   FAILED: ${err instanceof Error ? err.message : err}`);
      return NextResponse.json({ status: "store_failed", log, errors });
    }
  } catch (err) {
    errors.push(`top-level: ${err instanceof Error ? err.stack ?? err.message : err}`);
    return NextResponse.json({ status: "error", log, errors });
  }
}
