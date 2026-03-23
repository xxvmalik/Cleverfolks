import { createHash } from "crypto";
import { classifyWithGPT4oMini } from "@/lib/openai-client";
import { inngest } from "@/lib/inngest/client";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

// ── Types ─────────────────────────────────────────────────────────────────────

type TeamActivityRow = {
  user_name: string;
  message_count: number;
  directive_count: number;
  response_count: number;
  channel_set: string[] | null;
};

type MentionCountRow = {
  mention_name: string;
  mention_count: number;
};

type ChannelActivityRow = {
  channel_name: string;
  message_count: number;
  unique_speakers: number;
  key_speakers: string[] | null;
};

type PersonSampleRow = {
  user_name: string;
  chunk_text: string;
  channel_name: string | null;
  msg_ts: string | null;
};

type ChannelSampleRow = {
  channel_name: string;
  user_name: string | null;
  chunk_text: string;
  msg_ts: string | null;
};

type TeamData = {
  activity: TeamActivityRow[];
  mentions: MentionCountRow[];
  channels: ChannelActivityRow[];
};

type SampleData = {
  personSamples: PersonSampleRow[];
  channelSamples: ChannelSampleRow[];
};

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJSON(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) {
    try {
      return JSON.parse(raw[0]) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

type OnboardingData = {
  companyName?: string;
  companyDescription?: string;
  industry?: string;
  targetAudience?: string;
  differentiator?: string;
  businessModel?: string;
  products?: Array<{ name?: string; description?: string }>;
  brandVoice?: string;
};

function buildAnalysisPrompt(teamData: TeamData, sampleData: SampleData, onboarding?: OnboardingData | null): string {
  const { activity, mentions, channels } = teamData;
  const { personSamples, channelSamples } = sampleData;

  // Team activity section
  const activityLines = activity
    .slice(0, 30)
    .map((a) => {
      const chans = (a.channel_set ?? []).filter(Boolean).join(", ") || "unknown";
      return (
        `  ${a.user_name}: ${a.message_count} msgs, ` +
        `${a.directive_count} directives, ${a.response_count} replies, ` +
        `channels: [${chans}]`
      );
    })
    .join("\n");

  // Mention counts section
  const mentionLines = mentions
    .slice(0, 20)
    .map((m) => `  @${m.mention_name}: ${m.mention_count}x`)
    .join("\n");

  // Channel activity section
  const channelLines = channels
    .map((c) => {
      const speakers = (c.key_speakers ?? []).filter(Boolean).slice(0, 5).join(", ");
      return (
        `  #${c.channel_name}: ${c.message_count} msgs, ` +
        `${c.unique_speakers} speakers, active: [${speakers}]`
      );
    })
    .join("\n");

  // Person samples grouped by person
  const personMap = new Map<string, PersonSampleRow[]>();
  for (const s of personSamples) {
    const arr = personMap.get(s.user_name) ?? [];
    arr.push(s);
    personMap.set(s.user_name, arr);
  }
  const personSampleLines = [...personMap.entries()]
    .map(([name, samples]) => {
      const msgs = samples
        .map((s) => `    [#${s.channel_name ?? "?"}] ${s.chunk_text.slice(0, 140).replace(/\n/g, " ")}`)
        .join("\n");
      return `  --- ${name} ---\n${msgs}`;
    })
    .join("\n\n");

  // Channel samples grouped by channel
  const channelMap = new Map<string, ChannelSampleRow[]>();
  for (const s of channelSamples) {
    const arr = channelMap.get(s.channel_name) ?? [];
    arr.push(s);
    channelMap.set(s.channel_name, arr);
  }
  const channelSampleLines = [...channelMap.entries()]
    .map(([name, samples]) => {
      const msgs = samples
        .map((s) => `    [${s.user_name ?? "?"}] ${s.chunk_text.slice(0, 140).replace(/\n/g, " ")}`)
        .join("\n");
      return `  --- #${name} ---\n${msgs}`;
    })
    .join("\n\n");

  // Build onboarding ground truth section
  let onboardingSection = "";
  if (onboarding) {
    const lines: string[] = [
      "=== BUSINESS OWNER ONBOARDING DATA (GROUND TRUTH — always trust this over Slack inference) ===",
    ];
    if (onboarding.companyName) lines.push(`Company Name: ${onboarding.companyName}`);
    if (onboarding.companyDescription) lines.push(`Description: ${onboarding.companyDescription}`);
    if (onboarding.industry) lines.push(`Industry: ${onboarding.industry}`);
    if (onboarding.targetAudience) lines.push(`Target Audience: ${onboarding.targetAudience}`);
    if (onboarding.differentiator) lines.push(`Key Differentiator: ${onboarding.differentiator}`);
    if (onboarding.businessModel) lines.push(`Business Model: ${onboarding.businessModel}`);
    if (onboarding.brandVoice) lines.push(`Brand Voice: ${onboarding.brandVoice}`);
    if (onboarding.products && onboarding.products.length > 0) {
      lines.push("Products & Services (these are the ACTUAL services — do NOT override with Slack inference):");
      for (const p of onboarding.products) {
        lines.push(`  - ${p.name ?? "Unnamed"}${p.description ? `: ${p.description}` : ""}`);
      }
    }
    lines.push("");
    onboardingSection = lines.join("\n") + "\n";
  }

  return `You are building a company knowledge profile from workspace data.

CRITICAL: If onboarding data is provided below, it is the GROUND TRUTH entered by the business owner. Your business_summary and services MUST reflect the onboarding data accurately. Slack data supplements it but NEVER overrides it. Do NOT reinterpret or rename the owner's services.

${onboardingSection}=== TEAM ACTIVITY (behavioral signals) ===
${activityLines || "  (no activity data)"}

=== MENTION COUNTS (@-tags across all messages) ===
${mentionLines || "  (no mention data)"}

=== CHANNEL ACTIVITY ===
${channelLines || "  (no channel data)"}

=== SAMPLE MESSAGES PER PERSON ===
${personSampleLines || "  (no samples)"}

=== SAMPLE MESSAGES PER CHANNEL ===
${channelSampleLines || "  (no samples)"}

Analyze this data and build a comprehensive company knowledge profile.

BUSINESS ANALYSIS (critical):
Analyse the operational data carefully to determine what this business SELLS. Look at order complaints, payment discussions, product references, pricing mentions, and customer conversations to identify the actual products and services. For example, if you see discussions about Instagram followers, TikTok likes, or social media orders, the business is likely an SMM panel selling social media marketing services.

For each team member, assess their role based ONLY on BEHAVIORAL signals:
- High directive_count + high @-mention count → likely a manager, lead, or decision-maker
- High response_count → likely support, ops, or someone who handles requests
- High message_count in technical channels → likely engineering or product
- Frequent cross-channel presence → possibly company-wide role (COO, CEO, founder)
- Assign confidence:
  * "high"   — strong, consistent behavioral evidence across multiple signals
  * "medium" — some signals but limited data or ambiguous patterns
  * "low"    — minimal data (< 5 messages) or contradictory signals

Return ONLY a valid JSON object (no markdown, no code blocks, nothing else):
{
  "business_summary": "2-3 sentence description of what this business does, what industry it operates in, and who its customers are. Infer from operational data, channel names, conversation topics, and terminology.",
  "services": [
    {
      "name": "string — name of a product or service the business sells",
      "description": "string — brief description of this service/product"
    }
  ],
  "team_members": [
    {
      "name": "string",
      "detected_role": "string — inferred from behavior, not job title",
      "confidence": "high | medium | low",
      "active_channels": ["string"],
      "typical_activities": "string — what they actually do in messages",
      "notes": "string or null"
    }
  ],
  "channels": [
    {
      "name": "string — without the # symbol",
      "purpose": "string — what this channel is actually used for",
      "typical_content": "string — types of messages posted here",
      "key_people": ["string"]
    }
  ],
  "business_patterns": [
    "string — recurring workflow or operational patterns observed"
  ],
  "terminology": {
    "term": "definition — company-specific jargon or shorthand"
  },
  "key_topics": [
    "string — major ongoing themes across the workspace"
  ]
}`;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const buildKnowledgeProfileFunction = inngest.createFunction(
  {
    id: "build-knowledge-profile",
    name: "Build Knowledge Profile",
    retries: 1,
  },
  { event: "knowledge/profile.build" },
  async ({ event, step }) => {
    const { workspaceId } = event.data as { workspaceId: string };

    console.log(`[knowledge-profile] Starting build for workspace ${workspaceId}`);

    try {
      // ── Guard: 24-hour cooldown (runs FIRST, before any expensive work) ──
      const earlyCheck = await step.run("guard-cooldown", async () => {
        const db = createAdminSupabaseClient();
        const { data: workspace } = await db
          .from("workspaces")
          .select("settings")
          .eq("id", workspaceId)
          .single();

        const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
        const lastBuildTime = settings.last_profile_build_at as string | undefined;
        const lastProfileHash = settings.last_profile_hash as string | undefined;

        // Quick content hash: chunk count + latest updated_at
        const { count } = await db
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId);
        const { data: latest } = await db
          .from("document_chunks")
          .select("updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        const quickHash = createHash("sha256")
          .update(`${count ?? 0}-${latest?.updated_at ?? ""}`)
          .digest("hex");

        if (lastBuildTime) {
          const hoursSince = (Date.now() - new Date(lastBuildTime).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 24) {
            console.log(`[Knowledge Profile] Skipping rebuild — last build was ${hoursSince.toFixed(1)} hours ago`);
            return { skip: true, reason: "cooldown", quickHash };
          }
        }

        if (lastProfileHash === quickHash) {
          console.log(`[Knowledge Profile] Skipping rebuild — data unchanged (hash: ${quickHash.slice(0, 8)}...)`);
          return { skip: true, reason: "unchanged", quickHash };
        }

        console.log(`[Knowledge Profile] Guards passed — proceeding with build (hash: ${quickHash.slice(0, 8)}...)`);
        return { skip: false, reason: null, quickHash };
      });

      if (earlyCheck.skip) {
        return { status: "skipped", reason: earlyCheck.reason };
      }

      // ── Step 1: Set status to 'building' ──────────────────────────────────
      await step.run("set-status-building", async () => {
        const db = createAdminSupabaseClient();
        const { error } = await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: {},
          p_status: "building",
        });
        if (error) throw new Error(`Failed to set building status: ${error.message}`);
      });

      // ── Step 2: Extract behavioral signals (zero LLM cost) ────────────────
      const teamData: TeamData = await step.run("extract-team-data", async () => {
        const db = createAdminSupabaseClient();
        const [activityRes, mentionRes, channelRes] = await Promise.all([
          db.rpc("get_team_activity", { p_workspace_id: workspaceId }),
          db.rpc("get_mention_counts", { p_workspace_id: workspaceId }),
          db.rpc("get_channel_activity", { p_workspace_id: workspaceId }),
        ]);

        if (activityRes.error)
          console.warn("[knowledge-profile] activity error:", activityRes.error.message);
        if (mentionRes.error)
          console.warn("[knowledge-profile] mention error:", mentionRes.error.message);
        if (channelRes.error)
          console.warn("[knowledge-profile] channel error:", channelRes.error.message);

        const activity = (activityRes.data ?? []) as TeamActivityRow[];
        console.log(`[knowledge-profile] Found ${activity.length} team members, ` +
          `${(channelRes.data ?? []).length} channels`);

        return {
          activity,
          mentions: (mentionRes.data ?? []) as MentionCountRow[],
          channels: (channelRes.data ?? []) as ChannelActivityRow[],
        };
      });

      // No Slack data — check if we have onboarding data before giving up
      if (teamData.activity.length === 0 && teamData.channels.length === 0) {
        // Load onboarding data to check if we can still build a useful profile
        const earlyOnboarding = await step.run("check-onboarding-data", async () => {
          const db = createAdminSupabaseClient();
          const { data: ws } = await db
            .from("workspaces")
            .select("settings")
            .eq("id", workspaceId)
            .single();
          if (!ws?.settings) return null;
          const s = ws.settings as Record<string, unknown>;
          const bp = (s.business_profile ?? {}) as Record<string, string>;
          const products = (s.products ?? []) as Array<{ name?: string; description?: string }>;
          if (!bp.company_name && products.length === 0) return null;
          return { companyName: bp.company_name, productCount: products.length };
        });

        if (!earlyOnboarding) {
          await step.run("save-empty-profile", async () => {
            const db = createAdminSupabaseClient();
            await db.rpc("upsert_knowledge_profile", {
              p_workspace_id: workspaceId,
              p_profile: {},
              p_status: "ready",
            });
          });
          console.log("[knowledge-profile] No Slack data and no onboarding data — empty profile saved");
          return { status: "ready", members: 0, channels: 0 };
        }

        console.log(`[knowledge-profile] No Slack data but have onboarding (${earlyOnboarding.companyName}, ${earlyOnboarding.productCount} products) — proceeding with build`);
      }

      // ── Step 3: Bulk message sampling ─────────────────────────────────────
      const sampleData: SampleData = await step.run("build-smart-sample", async () => {
        const db = createAdminSupabaseClient();
        const personNames = teamData.activity.slice(0, 20).map((a) => a.user_name);
        const channelNames = teamData.channels.slice(0, 15).map((c) => c.channel_name);

        const [personRes, channelRes] = await Promise.all([
          personNames.length > 0
            ? db.rpc("get_person_samples_bulk", {
                p_workspace_id: workspaceId,
                p_person_names: personNames,
                p_samples_per_person: 6,
              })
            : Promise.resolve({ data: [] as PersonSampleRow[], error: null }),
          channelNames.length > 0
            ? db.rpc("get_channel_samples_bulk", {
                p_workspace_id: workspaceId,
                p_channel_names: channelNames,
                p_samples_per_channel: 5,
              })
            : Promise.resolve({ data: [] as ChannelSampleRow[], error: null }),
        ]);

        if ("error" in personRes && personRes.error)
          console.warn("[knowledge-profile] person samples error:", personRes.error.message);
        if ("error" in channelRes && channelRes.error)
          console.warn("[knowledge-profile] channel samples error:", channelRes.error.message);

        const personSamples = (personRes.data ?? []) as PersonSampleRow[];
        const channelSamples = (channelRes.data ?? []) as ChannelSampleRow[];
        console.log(`[knowledge-profile] Samples: ${personSamples.length} person msgs, ` +
          `${channelSamples.length} channel msgs`);

        return { personSamples, channelSamples };
      });

      // ── Step 3b: Load onboarding data (ground truth for business identity) ──
      const onboarding = await step.run("load-onboarding-data", async () => {
        const db = createAdminSupabaseClient();
        const { data: ws } = await db
          .from("workspaces")
          .select("settings")
          .eq("id", workspaceId)
          .single();
        if (!ws?.settings) return null;
        const s = ws.settings as Record<string, unknown>;
        const bp = (s.business_profile ?? {}) as Record<string, string>;
        const products = (s.products ?? []) as Array<{ name?: string; description?: string }>;
        // Only return if there's meaningful data
        if (!bp.company_name && products.length === 0) return null;
        return {
          companyName: bp.company_name ?? (s.company_name as string) ?? undefined,
          companyDescription: bp.company_description ?? (s.description as string) ?? undefined,
          industry: bp.industry ?? (s.industry as string) ?? undefined,
          targetAudience: bp.target_audience ?? undefined,
          differentiator: bp.differentiator ?? undefined,
          businessModel: bp.business_model ?? undefined,
          products: products.length > 0 ? products : undefined,
          brandVoice: ((s.brand ?? {}) as Record<string, string>).voice ?? undefined,
        } as OnboardingData;
      });

      // ── Step 4: Single GPT-4o-mini call to analyze all data ─────────────
      const finalProfile = await step.run("analyze-with-gpt4o-mini", async () => {
        const prompt = buildAnalysisPrompt(teamData, sampleData, onboarding);

        console.log(`[knowledge-profile] Calling GPT-4o-mini for analysis (prompt length: ${prompt.length} chars)`);

        let text: string;
        try {
          text = await classifyWithGPT4oMini({
            systemPrompt: prompt,
            userContent: "Analyze the data above and return the JSON profile.",
            maxTokens: 4000,
          });
        } catch (apiErr) {
          console.error("[knowledge-profile] GPT-4o-mini API call FAILED:", apiErr instanceof Error ? apiErr.message : String(apiErr));
          throw apiErr; // Let the outer catch handle it — do NOT silently return {}
        }

        console.log(`[knowledge-profile] GPT-4o-mini response length: ${text.length} chars`);
        if (text.length > 0) {
          console.log(`[knowledge-profile] GPT-4o-mini response received`);
        } else {
          console.error("[knowledge-profile] GPT-4o-mini returned EMPTY response");
        }

        const parsed = extractJSON(text);

        if (!parsed) {
          console.error("[knowledge-profile] Failed to parse JSON from response (length:", text.length, "chars)");
          return {} as Record<string, unknown>;
        }

        const memberCount = (parsed.team_members as unknown[] | undefined)?.length ?? 0;
        const channelCount = (parsed.channels as unknown[] | undefined)?.length ?? 0;
        const serviceCount = (parsed.services as unknown[] | undefined)?.length ?? 0;
        const hasSummary = !!parsed.business_summary;
        console.log(`[knowledge-profile] GPT-4o-mini returned: ${memberCount} members, ${channelCount} channels, ${serviceCount} services, summary=${hasSummary}`);
        return parsed;
      });

      // ── Step 5: Save profile + hash ────────────────────────────────────────
      await step.run("save-profile", async () => {
        const db = createAdminSupabaseClient();

        // Use 'pending_review' if any team member has low or medium confidence
        const members =
          (finalProfile.team_members as Array<{ confidence?: string }> | undefined) ?? [];
        const needsReview = members.some(
          (m) => m.confidence === "low" || m.confidence === "medium"
        );
        const status = Object.keys(finalProfile).length === 0
          ? "error"
          : needsReview
          ? "pending_review"
          : "ready";

        const { error } = await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: finalProfile,
          p_status: status,
        });
        if (error) throw new Error(`Failed to save profile: ${error.message}`);

        // Only save hash + timestamp on SUCCESS — never on error/empty profiles
        // Otherwise the cooldown guard blocks rebuilds after failures
        if (status !== "error") {
          const { data: workspace } = await db
            .from("workspaces")
            .select("settings")
            .eq("id", workspaceId)
            .single();

          await db
            .from("workspaces")
            .update({
              settings: {
                ...(workspace?.settings as Record<string, unknown> ?? {}),
                last_profile_hash: earlyCheck.quickHash,
                last_profile_build_at: new Date().toISOString(),
              },
            })
            .eq("id", workspaceId);

          console.log(
            `[knowledge-profile] Profile rebuilt and hash saved (${status}) — workspace ${workspaceId}`
          );
        } else {
          console.warn("[knowledge-profile] Profile was empty — NOT saving hash/timestamp so rebuild can retry");
        }
      });

      return {
        status: "saved",
        members: teamData.activity.length,
        channels: teamData.channels.length,
      };
    } catch (err) {
      console.error("[knowledge-profile] Build failed:", err);
      try {
        const db = createAdminSupabaseClient();
        await db.rpc("upsert_knowledge_profile", {
          p_workspace_id: workspaceId,
          p_profile: {},
          p_status: "error",
        });
      } catch (dbErr) {
        console.error("[knowledge-profile] Failed to set error status:", dbErr);
      }
      throw err;
    }
  }
);
