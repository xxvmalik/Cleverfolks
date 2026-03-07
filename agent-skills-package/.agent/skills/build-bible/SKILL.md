---
name: build-bible
description: Use for understanding the full scope of the CleverFolks AI product -- what it is, who it serves, what has been built, what is planned, and how all the pieces fit together. Reference this when making architectural decisions, adding features, or when context about the business and product direction is needed.
---

# CLEVERFOLKS -- CTO Build Bible
## Tech Stack, Architecture, and Build Status
Version 2.0 | March 2026 | Status: Active Development (Sprint 4-5)

---

## WHAT WE ARE BUILDING

CleverFolks AI is a SaaS platform that provides **AI employees** for small and medium businesses (1-20 employees). Instead of hiring expensive specialists, SMEs get AI team members that connect to their existing tools, learn how the business operates, and work autonomously.

Every AI employee shares a single brain (workspace_memories). What one learns, they all inherit. The organisation's knowledge compounds over time. This is the core differentiator -- AI employees that learn organisational patterns from past behaviour and replicate them autonomously.

**Target market:** UK-focused SaaS (company: CleverFolks AI Ltd). SMEs with 1-20 employees already using tools like Slack, Gmail, Outlook, HubSpot but drowning in data across them. Also deployed in Nigeria under the brand **TheKclaut** (under Cleverfolks) for an SMM panel business.

---

## AI EMPLOYEES

### At Launch

**CleverBrain -- AI Business Intelligence Assistant**
"The ChatGPT for your business." Connects live transactional data across business tools and enables natural language querying. Main chat interface -- AI interaction is primary, everything else is secondary.
Status: **Built and working.**

**Skyler -- Sales AI Employee**
Handles sales outreach and customer acquisition. Has her OWN dedicated chat interface -- separate from CleverBrain. Users communicate with Skyler directly about each lead, prospect, and sales conversation. She is an autonomous sales agent, not a chatbot reporting through CleverBrain.
Status: **Identity and skill system designed. Not yet built. Waiting on HubSpot integration.**

### Future AI Employees (Post-Launch)

**Vera -- Virtual Assistant**
Personal productivity and scheduling assistant. Manages calendar, tasks, reminders, email triage, and daily briefings.

**Martin -- Marketing Manager**
Handles content creation, social media scheduling, campaign analysis, SEO research, and marketing performance reporting.

---

## PART 1: THE TECH STACK

Every choice is made for one reason: solo founder building with Claude Code, moving fast without building infrastructure you don't need yet.

### Frontend

| Choice | Why |
|---|---|
| Next.js 14+ (App Router) | Industry standard for SaaS. Server-side rendering, API routes, file-based routing. Claude Code knows it inside out. |
| TypeScript | Non-negotiable. Catches bugs before production. Every file, every component. |
| Tailwind CSS | Fast styling, no context-switching. Perfect for AI-assisted development. |
| shadcn/ui | Pre-built, professional UI components built on Tailwind. Copies into your project so you own the code. |

### Backend and Database

| Choice | Why |
|---|---|
| Supabase | PostgreSQL + authentication + real-time + Row Level Security + pgvector -- all in one managed platform. |
| PostgreSQL (via Supabase) | Rock solid. Handles complex queries, JSON fields, and with pgvector doubles as your vector database. One database for everything. |
| pgvector (via Supabase) | How CleverBrain searches data intelligently. Stores embeddings and finds semantically similar content. No separate vector database needed. |
| Supabase Auth | Handles user signup, login, Google SSO, session management, password reset. Production-grade auth. |

### Background Jobs

| Choice | Why |
|---|---|
| Inngest | Managed job/workflow platform for serverless functions. Handles data sync processing, scheduled tasks, retries. No Redis or worker processes to manage. |

### Integrations

| Choice | Why |
|---|---|
| Nango | Handles OAuth, token refresh, API pagination, rate limiting, and data syncing for all integrations. Webhooks trigger Inngest functions for processing. |

### AI and LLM Layer

| Choice | Why |
|---|---|
| Claude API (Anthropic) | Powers both CleverBrain and Skyler. Sonnet 4 for agent intelligence, Haiku for extraction/summaries/knowledge profiles. |
| Voyage AI | Embeddings (voyage-3 model, 1024 dimensions). Best-in-class retrieval quality. First 200M tokens free. |
| Tavily API | Web search (search), page content extraction (extract with advanced depth), and site mapping (map). Three endpoints for comprehensive web intelligence. |

### Payments and Email

| Choice | Why |
|---|---|
| Stripe | Industry standard for SaaS billing. Per-user, per-workspace pricing. |
| Resend | Modern email API for Skyler's outbound emails. Handles deliverability, tracking, templates. |

### Deployment

| Choice | Why |
|---|---|
| Vercel | Deploys Next.js with zero configuration. Push to GitHub, auto-deploys. Handles serverless functions, edge caching, custom domains, SSL. |
| GitHub | Version control. Claude Code integrates with git natively. |

### Cost at Scale (Per Active User Per Month)

| Category | Without Optimisation | With Optimisation |
|---|---|---|
| AI Model Costs | ~$44 | ~$22 |
| Integration Infrastructure (Nango) | ~$5-7 | ~$1.50 (self-hosted) |
| Cloud Infrastructure | ~$0.50-1.50 | ~$0.50-1.50 |
| Supporting Services | ~$1.20 | ~$0.70 |
| **Total** | **~$50-53** | **~$16-17** |

Optimisations: prompt caching (90% cheaper cache reads), Haiku routing for simple queries, Nango self-hosting, Serper.dev replacing Tavily at scale. Business plan target: $15-20/user direct cost.

---

## PART 2: WHAT HAS BEEN BUILT

### Sprint 0-1: Project Setup and Database (COMPLETE)
- Next.js project with TypeScript, Tailwind, shadcn/ui
- Supabase with pgvector, RLS policies
- Auth with email and Google SSO
- Workspace and team structure
- Multi-tenant database schema
- Deployed on Vercel

### Sprint 2: Onboarding (COMPLETE)
- 7-step org onboarding wizard
- 7-step Skyler onboarding wizard
- Data persistence between steps
- Integration connection via Nango OAuth
- Redirects to CleverBrain chat after completion

### Sprint 3: Integrations and Data Sync (COMPLETE for Slack/Gmail/Outlook, IN PROGRESS for HubSpot)

**Working integrations:**
- Slack: Full (messages, replies, reactions). Bot token scopes. 807 messages, 736 replies, 136 reactions synced.
- Gmail: Full (emails with From/To context prepended). 145 messages synced.
- Outlook: Email + Calendar. 1,232 emails, 5 calendar events synced.

**In progress:**
- HubSpot: Nango connected, all syncs and actions enabled. Normalizers fixed to read flat Nango fields (raw.name, raw.amount, etc.). CHECK constraint updated. Connection ID: 2fef56c8-0d8a-441e-b401-a208dfa41302. Sample data: 11 deals, 18 contacts, 17 companies, 2 tasks, 1 user.

**Not yet configured in Nango:**
- Google Calendar (Google Cloud APIs enabled)
- Google Drive

**Sync pipeline architecture:**
1. Nango syncs raw data from connected tools
2. Webhook from Nango triggers Inngest function (sync-integration.ts)
3. Inngest fetches records via nango.listRecords() with exact model names
4. Normalizers transform records into synced_documents (via upsert_synced_document RPC)
5. Context prepended to chunk_text (From/To for email, event times for calendar, deal name/amount/stage for CRM)
6. Voyage AI embeds chunk_text into 1024-dim vectors
7. Vectors stored in document_chunks table with pgvector

**Critical principle:** Claude only reads chunk_text. Any data Claude needs must be prepended directly into chunk_text at sync time. Metadata is for filtering, not for Claude to read.

### Sprint 4: CleverBrain (COMPLETE)

**Agent loop architecture:**
- Claude IS the agent. No separate planner, classifier, or router.
- Claude reads the system prompt, decides which tools to call, executes them, reads results, iterates. Up to 10 rounds per query.
- System prompt assembled dynamically: role identity + date/time + business profile + knowledge profile + memories + integration map + tool rules + response style rules.

**7 tools:**
1. search_knowledge_base -- semantic + keyword hybrid search across all synced data
2. fetch_recent_messages -- chronological time-range fetch for summaries and briefings
3. count_messages_by_person -- SQL aggregation for counting/ranking queries
4. search_by_person -- find messages from/about a specific person
5. search_web -- Tavily web search with mandatory regional context
6. browse_website -- Tavily Extract (advanced) + direct HTTP fetch fallback. Smart extraction scores chunks by keyword relevance + price pattern bonuses for pages with 2.4M+ characters.
7. map_website -- Tavily Map for discovering site structure before browsing

**Agent intelligence (all deployed and tested):**
- Web search mandatory for specific trigger patterns (competitors, market data, external companies)
- Search queries use Company Context for location-aware, industry-specific results
- Calendar queries use fetch_recent_messages with source_types, never search_knowledge_base
- Calendar time filtering with timezone awareness (read from workspace.settings.timezone)
- Response quality: lead with answer, match length to complexity, no padding, no narration
- Proactive suggestions mandatory for 5 trigger patterns (unanswered email, overdue payment, upcoming meeting, no reply, unresolved complaint)
- Source mentions brief and natural, not verbose audit trails
- Role-aware intelligence (CEO gets strategic view, support agent gets operational detail)
- Smart action detection (identifies emails/messages needing response)
- Resolved vs unresolved awareness (cross-references timeline before flagging issues)
- Website browsing: try obvious pages first (/pricing, /services) before mapping. Never fabricate data. Never use homepage marketing claims as real pricing.

**Memory system (deployed and working):**
- workspace_memories table with pgvector similarity search
- memory-extractor.ts: Claude extracts learnings post-conversation (corrections, terminology, preferences, patterns, agent learnings)
- memory-store.ts: save/retrieve with conflict resolution (add, reinforce, supersede, skip)
- Case-sensitivity fix: always .toLowerCase() on Claude returned type values before validation
- Reinforcement: extraction prompt allows re-extraction of restated memories so saveMemory handles dedup
- Uses Next.js after() API to survive Vercel serverless function termination
- Memory trust rule: if memory fully answers the question, respond from memory only -- no tool calls, 2-3 sentences max

**Deep memory (deployed):**
- Chat history embedding: after() embeds conversations into document_chunks with source_type='cleverbrain_chat' for cross-chat RAG search
- Rolling conversation summary: Haiku summarises older messages (1 paragraph per ~10 messages), keeps last 15 messages in full. Replaces old .slice(-10) limit.

**Knowledge profile builder:**
- Haiku (not Sonnet) for cost efficiency
- SHA-256 content hash guard -- skips rebuild if data unchanged
- 24-hour daily rebuild cap
- Was burning $54 in 5 days from auto-rebuilds on every sync cycle before fix

**UI polish:**
- Source pills capped at 6 with "+N more" overflow, dedup by source_type:label, icons for all source types
- Prompt template leak fixed (removed bracketed placeholders Claude was parroting)
- Debug logging cleaned (removed verbose content dumps, kept one-liner status logs)

### Sprint 5: Skyler (NOT YET STARTED)

**Designed and ready:**
- Identity and runtime skill system (SKILL.md complete)
- Same agent loop architecture as CleverBrain (Claude is the agent, no planner)
- Shares workspace_memories with CleverBrain
- Runtime skills loaded on demand: cold outreach, lead qualification, deal progression, meeting prep, pipeline review
- Autonomy levels: full, approval required (default), read only
- Permission restrictions: CRM admin actions restricted to admin-level CleverFolks users
- HubSpot CRM actions configured in Nango: create/update contacts, deals, companies, tasks, notes

**Blocked by:** HubSpot integration (Skyler's CRM backbone)

---

## PART 3: WHAT TO BUILD NEXT

### Immediate (Current Sprint)
1. Fix HubSpot listRecords 400 error -- verify model names match Nango exactly
2. Test HubSpot queries: "What's our pipeline worth?", "Show me all open deals", "High priority tickets?"
3. Begin Skyler build once HubSpot flows end-to-end

### Sprint 6: Skyler Core
- Skyler chat interface (separate from CleverBrain)
- Skyler agent loop (same pattern as CleverBrain with CRM write tools)
- Lead qualification workflow with BANT scoring
- Action approval UI (review, approve, reject, edit drafts)
- Confidence threshold logic
- Connect Resend for outbound emails
- Test in Draft and Approve mode only

### Sprint 7: Skyler Engagement and Polish
- Prospect engagement workflow (personalised outreach, follow-up cadence)
- Deal closer workflow (monitor stages, send proposals, handle objections)
- Split Integrations page into "Connectors" (data pipes) + "Business Profile" (editable onboarding data)
- Move business context from Settings to Business Profile
- Billing integration (Stripe per-user, per-workspace)
- Team permissions enforcement
- UI polish (loading states, error handling, empty states, responsive design)

### Sprint 8: Testing and Launch Prep
- End-to-end testing with real accounts
- Beta users (3-5 founders/team leads)
- Error monitoring (Sentry)
- Analytics (PostHog or Mixpanel)
- Custom domain
- Launch

---

## PART 4: THINGS TO BUILD LATER (Noted During Development)

### Cost Optimisations (Implement When Scaling)
- Prompt caching for system prompt + tools (cache reads 90% cheaper, estimated 30-40% Claude cost reduction)
- Route simple queries to Haiku, keep Sonnet for complex analysis (estimated 20-30% additional savings)
- Self-host Nango to eliminate per-connection pricing
- Replace Tavily with Serper.dev for cheaper web search at volume
- Target: bring per-user cost from approximately $50 to $20-25/month

### Real-Time Sync
- Nango webhooks for immediate sync (currently hourly batch)
- New Slack messages, emails sync instantly instead of waiting for next cycle

### Email Attachment Processing
- Download attachments from Gmail/Outlook APIs
- Parse PDFs, DOCX, images to text
- Chunk and embed for search

### Sync-Time Message Classification
- Claude Haiku tags messages at sync time (complaint, resolution, escalation)
- Stored in chunk metadata for context-aware aggregation
- Estimated cost: approximately $0.0004/message, $5-10/month ongoing

### Additional Integrations
- Instagram (support purposes)
- Apollo.io (sales enrichment for Skyler)
- Stripe (payments and revenue tracking)
- Zendesk (customer support)
- Notion (knowledge management)
- Trello (project management)
- Salesforce (alternative CRM)
- Calendly (meeting scheduling)
- Microsoft Teams (messaging)

---

## PART 5: KEY LEARNINGS FROM DEVELOPMENT

These are patterns discovered through building and debugging. They apply to all future development.

1. **Suggestions don't work in system prompts, mandates do.** Every agent fix changed "you can do X" to "you MUST do X when Y happens." LLMs take the path of least resistance -- generating from training data is always easier than making a tool call. Force the behaviour.

2. **Claude only reads chunk_text.** Any data Claude needs to reason about (event times, sender/recipient context, deal amounts) must be prepended directly into chunk_text at sync time. Not in metadata. Claude never reads metadata.

3. **Vercel serverless functions kill fire-and-forget async.** Use Next.js after() API for any post-response processing that must complete (memory extraction, chat embedding, auto-titling).

4. **Claude returns uppercase type values.** Always normalise with .toLowerCase() before validation filters. "TERMINOLOGY" fails validation that checks for "terminology".

5. **Calendar queries must filter by event start time** (metadata.start), not sync time (created_at). Semantic search ignores time entirely -- use time-filtered tools for calendar.

6. **Nango incremental sync won't resend failed records.** If records fail to store (CHECK constraint, foreign key), they won't be retried on next sync. Need full resync after fixing errors (delete existing data first).

7. **Tavily strips table/price data from HTML.** Large pages (2.4M+ chars) need smart extraction with keyword scoring and price pattern bonuses. Direct HTTP fetch fallback needed when Tavily's clean content misses structured data.

8. **System prompt instructions should describe WHAT to do, never provide template text.** Claude will parrot bracketed placeholders like "[list what you CAN see]" verbatim in responses.

9. **Nango flattens HubSpot records into top-level fields** (e.g. raw.name, raw.amount, raw.deal_stage), NOT nested under record.properties.*. Normalizers must read raw.name, not raw.properties.dealname.

10. **Model names in Nango are case-sensitive.** HubSpotServiceTicket (capital S) is different from HubspotServiceTicket (lowercase s). Must match exactly.

11. **Knowledge profile rebuilds are expensive.** Without guards, the profile builder ran on every sync cycle using Sonnet, burning $54 in 5 days. Fix: Haiku + SHA-256 hash guard + 24-hour cap.

12. **Test each feature fully before proceeding.** Never assume a fix works without confirming in production. Check Vercel logs, check the database, check the actual UI response.

---

## PART 6: WORKSPACE DETAILS (Current Deployment)

- Supabase workspace ID: ab25098b-45fd-40ba-ba6f-d67032dcdbbc
- Workspace timezone: Africa/Lagos (stored in workspace.settings.timezone, not hardcoded)
- Business Outlook account: Info@kclauthq.com (Microsoft account: koorbie023@gmail.com)
- Azure AD app Client ID: b1c7179c-5868-4867-8775-f14b73ddf521
- HubSpot connection ID: c13d1e42-b75f-40a2-a92e-f3e43fe060d7
- HubSpot OAuth app: CleverFolks AI (public app on developers.hubspot.com)
- Nango allowed_integrations: ["slack", "google-mail", "outlook", "hubspot"]
- Brand colours: #131619 (background) and #3A89FF (blue gradient)

### Current Document Chunks

| Source Type | Count |
|---|---|
| outlook_email | 1,232 |
| slack_message | 807 |
| slack_reply | 736 |
| gmail_message | 145 |
| slack_reaction | 136 |
| document | 67 |
| outlook_event | 5 |
| hubspot_* | Blocked by listRecords 400 error |

---

## RULES OF ENGAGEMENT

1. **Never skip a sprint.** Each one builds on the last. If data sync is shaky, CleverBrain is broken.
2. **Test with real data.** Fake data hides real problems.
3. **Start Skyler in Draft and Approve mode.** Do not enable Full Autonomy until you have personally reviewed at least 50 actions and trust the quality.
4. **When stuck, bring the error + context.** Paste the error, explain what you expected, diagnose together.
5. **One integration at a time.** Get it working perfectly before touching the next one. Each one teaches you the pattern.
6. **Commit to git constantly.** After every working feature, commit and push.
7. **No em-dashes in written content.** Use -- instead.
8. **Abbreviations written out in full** throughout any written materials.