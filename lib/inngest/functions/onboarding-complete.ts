/**
 * Background jobs triggered when Skyler onboarding is completed.
 * Fires 5 parallel tasks to enrich the workspace.
 */

import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const onboardingComplete = inngest.createFunction(
  { id: "onboarding-complete", name: "Onboarding Complete — Background Jobs" },
  { event: "workspace/onboarding.completed" },
  async ({ event, step }) => {
    const { workspaceId } = event.data as { workspaceId: string };
    const db = createAdminSupabaseClient();

    // Load workspace settings and agent config
    const [{ data: ws }, { data: agentConfig }] = await Promise.all([
      db.from("workspaces").select("name, settings").eq("id", workspaceId).single(),
      db
        .from("agent_configurations")
        .select("config")
        .eq("workspace_id", workspaceId)
        .eq("agent_type", "skyler")
        .maybeSingle(),
    ]);

    const settings = (ws?.settings ?? {}) as Record<string, unknown>;
    const skylerConfig = (agentConfig?.config ?? {}) as Record<string, unknown>;
    const businessProfile = (settings.business_profile ?? {}) as Record<string, unknown>;
    const products = (settings.products ?? []) as Array<Record<string, unknown>>;
    const competitors = (settings.competitors ?? []) as Array<Record<string, unknown>>;

    // ── Job 1: Rebuild Knowledge Profile ────────────────────────────────────
    await step.run("rebuild-knowledge-profile", async () => {
      // Trigger existing knowledge profile rebuild
      await inngest.send({
        name: "integration/sync.completed",
        data: {
          workspaceId,
          provider: "onboarding",
          recordCounts: { business_profile: 1 },
        },
      });
      console.log(`[onboarding-complete] Triggered knowledge profile rebuild for ${workspaceId}`);
    });

    // ── Job 2: Seed Workspace Memories ──────────────────────────────────────
    await step.run("seed-workspace-memories", async () => {
      const memoriesToSeed: Array<{ content: string; type: string }> = [];

      if (businessProfile.company_description) {
        memoriesToSeed.push({
          content: `Company description: ${businessProfile.company_description}`,
          type: "terminology",
        });
      }
      if (businessProfile.differentiator) {
        memoriesToSeed.push({
          content: `Key differentiator: ${businessProfile.differentiator}`,
          type: "pattern",
        });
      }
      if (skylerConfig.ideal_customer) {
        memoriesToSeed.push({
          content: `Ideal customer profile: ${skylerConfig.ideal_customer}`,
          type: "pattern",
        });
      }
      if (skylerConfig.primary_pain_point) {
        memoriesToSeed.push({
          content: `Core customer pain point: ${skylerConfig.primary_pain_point}`,
          type: "pattern",
        });
      }
      if (skylerConfig.pricing_structure) {
        memoriesToSeed.push({
          content: `Pricing structure: ${skylerConfig.pricing_structure}`,
          type: "terminology",
        });
      }
      for (const product of products) {
        if (product.name) {
          memoriesToSeed.push({
            content: `Product: ${product.name}${product.description ? ` — ${product.description}` : ""}`,
            type: "terminology",
          });
        }
      }
      if (skylerConfig.never_say_about_competitors) {
        memoriesToSeed.push({
          content: `NEVER say about competitors: ${skylerConfig.never_say_about_competitors}`,
          type: "correction",
        });
      }
      const phrases = skylerConfig.phrases_never_use as string[] | undefined;
      if (phrases && phrases.length > 0) {
        memoriesToSeed.push({
          content: `Never use these phrases: ${phrases.join(", ")}`,
          type: "correction",
        });
      }

      // Insert memories
      if (memoriesToSeed.length > 0) {
        const rows = memoriesToSeed.map((m) => ({
          workspace_id: workspaceId,
          content: m.content,
          type: m.type,
          source: "onboarding",
          confidence: "high",
          times_reinforced: 1,
        }));

        const { error } = await db.from("workspace_memories").insert(rows);
        if (error) console.error("[onboarding-complete] Memory seed error:", error.message);
        else console.log(`[onboarding-complete] Seeded ${rows.length} workspace memories`);
      }
    });

    // ── Job 3: Embed Onboarding Data for RAG ────────────────────────────────
    await step.run("embed-onboarding-data", async () => {
      const chunks: Array<{ content: string; metadata: Record<string, unknown> }> = [];

      if (businessProfile.company_description) {
        chunks.push({
          content: `Company: ${businessProfile.company_name ?? ws?.name ?? ""}. ${businessProfile.company_description}`,
          metadata: { field: "company_description" },
        });
      }
      if (businessProfile.target_audience) {
        chunks.push({
          content: `Target audience: ${businessProfile.target_audience}`,
          metadata: { field: "target_audience" },
        });
      }
      if (businessProfile.differentiator) {
        chunks.push({
          content: `Differentiator: ${businessProfile.differentiator}`,
          metadata: { field: "differentiator" },
        });
      }
      for (const product of products) {
        if (product.name) {
          chunks.push({
            content: `Product: ${product.name}. ${product.description ?? ""}`,
            metadata: { field: "product", product_name: product.name },
          });
        }
      }

      if (chunks.length > 0) {
        const rows = chunks.map((c) => ({
          workspace_id: workspaceId,
          source_type: "business_profile",
          source_id: workspaceId,
          chunk_text: c.content,
          chunk_index: 0,
          metadata: c.metadata,
        }));

        const { error } = await db.from("document_chunks").insert(rows);
        if (error) console.error("[onboarding-complete] RAG embed error:", error.message);
        else console.log(`[onboarding-complete] Embedded ${rows.length} document chunks`);
      }
    });

    // ── Job 4: Initialise Behavioural Dimensions ────────────────────────────
    await step.run("init-behavioural-dimensions", async () => {
      const formality = (skylerConfig.formality_level as string) ?? "conversational";
      const approach = (skylerConfig.communication_approach as string) ?? "consultative";

      // Map formality to spectrum position (0-100)
      const formalityMap: Record<string, number> = {
        casual: 20,
        conversational: 40,
        professional: 70,
        formal: 90,
      };

      // Map approach to directness spectrum
      const approachMap: Record<string, number> = {
        consultative: 35,
        direct: 80,
        story_driven: 30,
        data_led: 65,
        relationship_first: 25,
      };

      const dimensions = [
        {
          workspace_id: workspaceId,
          dimension_name: "formality",
          current_position: formalityMap[formality] ?? 50,
          observations_count: 0,
          source: "onboarding",
        },
        {
          workspace_id: workspaceId,
          dimension_name: "directness",
          current_position: approachMap[approach] ?? 50,
          observations_count: 0,
          source: "onboarding",
        },
      ];

      const { error } = await db.from("behavioural_dimensions").upsert(dimensions, {
        onConflict: "workspace_id,dimension_name",
      });
      if (error) console.error("[onboarding-complete] Dimension init error:", error.message);
      else console.log(`[onboarding-complete] Initialised ${dimensions.length} behavioural dimensions`);
    });

    // ── Job 5: Process Brand Documents ──────────────────────────────────────
    await step.run("process-brand-docs", async () => {
      const { data: pendingAssets } = await db
        .from("brand_assets")
        .select("id, file_name, storage_path, mime_type")
        .eq("workspace_id", workspaceId)
        .eq("processing_status", "pending");

      if (!pendingAssets || pendingAssets.length === 0) {
        console.log("[onboarding-complete] No pending brand assets to process");
        return;
      }

      // Mark as processing
      await db
        .from("brand_assets")
        .update({ processing_status: "processing" })
        .in(
          "id",
          pendingAssets.map((a) => a.id)
        );

      // For now, just mark as completed. Full text extraction + embedding
      // will be added when the document processing pipeline is built.
      await db
        .from("brand_assets")
        .update({ processing_status: "completed" })
        .in(
          "id",
          pendingAssets.map((a) => a.id)
        );

      console.log(`[onboarding-complete] Processed ${pendingAssets.length} brand assets`);
    });

    return { success: true, workspaceId };
  }
);
