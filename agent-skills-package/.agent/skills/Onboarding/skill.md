# CleverFolks Onboarding — Full Build Plan

---

## Visual Reference & CC Instructions

**Design files location:** `C:\Users\admin\cleverfolksnew\Design\onboarding design`

These Figma exports show the LAYOUT, SPACING, and COMPONENT STRUCTURE for both onboarding flows. CC should use them as visual reference only — the actual text, labels, placeholders, info banners, and helper copy come from THIS document, not from the Figma files.

**Why:** The Figma files are design mockups. Some screens mention "Skyler" or "SKYLER" in the general onboarding steps — those are Figma placeholders only. The general onboarding is about the ORGANISATION and ALL AI EMPLOYEES. Skyler is only mentioned by name in two places during general onboarding: (1) the transition banner on the final step, and (2) the info callout at the very end. Everywhere else, use "CleverFolks", "your AI employees", "CleverBrain", or "your workspace".

**Accent colours:**
- General Onboarding: Purple accent (#5B3DC8) — active tabs, buttons, highlights, info banners
- Skyler Onboarding: Skyler Orange accent (#F2903D) — active steps, buttons, highlights, Skyler avatar ring

**Text authority order:** This build plan document > Figma designs. If the Figma says one thing and this document says another, follow this document.

---

## Overview

Two onboarding flows that run back-to-back after a user signs up:

1. **General Onboarding** (7 steps) — sets up the workspace and business context for ALL agents
2. **Skyler Onboarding** (7 steps) — trains Skyler specifically on the user's sales process

When both are done, the user lands on the dashboard with Skyler and CleverBrain both fully operational.

---

## The User Journey

```
Sign up → Create workspace → GENERAL ONBOARDING (7 steps)
→ "Complete Setup" → SKYLER ONBOARDING (7 steps)
→ "Launch Skyler" → Dashboard (both agents ready)
```

**Gating rule:** If `onboarding_status.general_completed` is false, redirect to `/onboarding`. If general is done but `onboarding_status.skyler_completed` is false, redirect to `/onboarding/skyler`. Only when both are true can the user access the dashboard.

---

## Database Changes

### 1. Extend workspaces.settings JSONB

The `workspaces` table already has a `settings` JSONB column. We give it a clear, consistent structure. No new table needed for this — just a well-defined shape.

```
workspaces.settings = {

  // === SHARED BUSINESS DATA (all agents read this) ===

  business_profile: {
    company_name: "Acme Corp",
    website: "https://acme.com",
    company_description: "We build AI-powered...",    // General Step 1
    industry: "SaaS",                                  // General Step 1
    company_stage: "early_traction",                   // General Step 1
    team_size: "6-20",                                 // General Step 1
    business_model: "B2B",                             // General Step 2
    target_audience: "Mid-market e-commerce...",       // General Step 2
    differentiator: "Only platform that...",           // General Step 2
  },

  products: [                                          // General Step 4
    {
      id: "uuid",
      name: "ProPlan",
      description: "AI-powered sales automation...",
      pricing_model: "subscription",                   // subscription/one_time/usage/custom
    }
  ],

  competitors: [                                       // General Step 2 + Skyler Step 3
    {
      id: "uuid",
      name: "Competitor X",
      // Shared fields (from general onboarding):
      // (just the name for now)
      // Agent-specific fields (from Skyler onboarding):
      advantages: "We're faster, better support...",
      skyler_objection_responses: [
        { objection: "They're cheaper", response: "We save 40hrs/month..." }
      ],
      skyler_never_say: ["Never say they're bad"]
    }
  ],

  brand: {                                             // General Step 3
    voice: "professional_polished",                    // or friendly, bold, innovative
    tagline: "AI ideas worth millions",
    colors: {
      primary: "#4A6CF7",
      secondary: "#1A1A2E",
      accent: "#10B981"
    },
    fonts: {
      heading: "Plus Jakarta Sans",
      body: "Inter"
    },
    // brand_assets are in a separate table (files need storage)
  },

  team: {                                              // General Step 5
    primary_timezone: "Europe/London",
    working_hours: { start: "09:00", end: "18:00" },
    primary_language: "en",
  },

  goals: {                                             // General Step 7
    focus_areas: ["sales_automation", "meeting_management"],
    biggest_bottleneck: "Following up with leads...",
  },

  // === ONBOARDING STATUS ===

  onboarding_status: {
    general_completed: true,
    general_completed_at: "2026-03-20T10:00:00Z",
    general_steps_completed: ["company", "market", "brand", "products", "team", "tools", "goals"],
    skyler_completed: true,
    skyler_completed_at: "2026-03-20T10:15:00Z",
    skyler_steps_completed: ["business", "sales_process", "objections", "tone", "tools", "guardrails", "review"],
  }
}
```

### 2. New table: agent_configurations

One row per agent per workspace. Skyler's specific settings live here. When Vera or Martin arrive, they get their own row.

```sql
CREATE TABLE agent_configurations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_type      TEXT NOT NULL,       -- 'skyler', 'vera', 'martin'
  config          JSONB NOT NULL DEFAULT '{}',
  onboarding_completed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, agent_type)
);
CREATE INDEX idx_agent_config_lookup ON agent_configurations(workspace_id, agent_type);
```

**Skyler's config JSONB:**

```
agent_configurations.config (agent_type = 'skyler') = {

  // From Skyler Step 1 (some pre-filled from general onboarding)
  ideal_customer: "E-commerce stores doing £500K-£5M/year...",
  primary_pain_point: "Losing 70-80% of visitors...",
  primary_outcome: "15-25% cart recovery, ROI in week one",

  // From Skyler Step 2: Sales Process
  sales_journey: "Lead fills form → Skyler qualifies → Discovery call → Demo → Proposal → Close",
  cycle_length: "2-4 weeks",
  pricing_structure: "Starter: £99/month, Growth: £299/month, Enterprise: custom",
  average_deal_size: "2k-10k",
  outreach_goal: "book_discovery_call",

  // From Skyler Step 3: Objections (general, not tied to a competitor)
  general_objections: [
    { objection: "Too expensive", response: "Most customers recover the cost in week one..." },
    { objection: "Not the right time", response: "..." },
    { objection: "Using a competitor", response: "..." }
  ],
  never_say_about_competitors: "Never say Competitor X is bad...",

  // From Skyler Step 4: Tone & Voice
  formality_level: "conversational",     // casual/conversational/professional/formal
  communication_approach: "consultative", // consultative/direct/story_driven/data_led/relationship_first
  phrases_always_use: ["quick question", "worth a 15-min call"],
  phrases_never_use: ["just following up", "circle back", "synergy"],

  // From Skyler Step 6: Guardrails
  autonomy: {
    auto_send_followups: true,
    auto_handle_objections: true,
    auto_book_demos: false,
    auto_send_first_outreach: false,
  },
  confidence_thresholds: {
    auto_execute: 85,
    draft_for_review: 60,
    // Below 60 = flag for human
  },
  contact_hours: {
    start: "08:00",
    end: "18:00",
    timezone: "prospect"   // prospect's timezone
  },
  // Hard rules (always on, can't be disabled)
  hard_rules: [
    "escalate_ready_to_buy",
    "escalate_legal_mentions",
    "stop_on_unsubscribe",
    "never_below_minimum_price"
  ],
}
```

### 3. New table: brand_assets

Files need actual storage. JSONB can't hold uploaded logos and brand documents.

```sql
CREATE TABLE brand_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_type        TEXT NOT NULL,       -- 'logo_primary', 'logo_dark', 'brand_doc'
  file_name         TEXT NOT NULL,
  storage_path      TEXT NOT NULL,       -- Supabase Storage path
  mime_type         TEXT,
  file_size_bytes   BIGINT,
  processing_status TEXT DEFAULT 'pending',  -- pending/processing/completed/failed
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_brand_assets_workspace ON brand_assets(workspace_id);
```

---

## How Existing Systems Read Onboarding Data

### Skyler's System Prompt Assembly

Already loads workflow settings. The change: instead of reading ONLY from `workspaces.settings`, it now also reads from `agent_configurations` for Skyler's specific config.

```
buildSkylerPrompt(workspaceId):
  1. Load workspaces.settings (shared business data)
  2. Load agent_configurations WHERE workspace_id AND agent_type = 'skyler'
  3. Merge into the existing WORKFLOW SETTINGS XML blocks
  4. Everything else stays exactly the same
```

The system prompt assembly order stays the same:
- [SKYLER CORE IDENTITY] — no change
- [WORKFLOW SETTINGS: BUSINESS] — now reads from settings.business_profile + settings.products + settings.competitors + skyler_config
- [WORKFLOW SETTINGS: AUTONOMY] — now reads from skyler_config.autonomy + skyler_config.confidence_thresholds + skyler_config.hard_rules
- [WORKSPACE MEMORIES] — no change
- Everything else — no change

### CleverBrain's Business Context

CleverBrain already loads a business_context field into its system prompt. The change: populate that field from `workspaces.settings.business_profile` instead of (or in addition to) the current Settings page field.

### Sales Closer Workflow

Already loads knowledge profile + workspace memories + workflow settings. The change: the knowledge profile rebuild (background job) now incorporates onboarding data, making it richer.

### Guardrail Engine

Already reads confidence thresholds and autonomy rules. The change: reads from `agent_configurations.config.confidence_thresholds` and `agent_configurations.config.autonomy` instead of wherever it currently reads from.

### Context Assembler

The change: add `agent_configurations` to the parallel queries it runs at the start of each reasoning call.

### Decision Memory (Behavioural Dimensions)

The change: use `skyler_config.formality_level` and `skyler_config.communication_approach` to set initial baseline positions on the 6 behavioural spectrums.

---

## Pre-fill Logic (General → Skyler)

Some Skyler onboarding questions overlap with general onboarding. Instead of asking again, pre-fill from what the user already entered:

| Skyler Field | Pre-filled From | User Can Edit? |
|---|---|---|
| "What does your company do?" (Step 1) | settings.business_profile.company_description | Yes |
| "Who is your ideal customer?" (Step 1) | settings.business_profile.target_audience | Yes |
| Competitors (Step 3) | settings.competitors[].name | Yes, and add Skyler-specific fields |

If the user changes something during Skyler onboarding that was pre-filled from general, the Skyler version takes priority for Skyler's context. The general version stays as-is for CleverBrain.

Wait — actually, for "ideal customer" and "what you do", these should be ONE value, not two. If the user refines the answer during Skyler onboarding, it should update the shared business_profile too. Otherwise you end up with two different descriptions of the same business. The pre-fill fields are editable and on save, they write BACK to the shared source.

For competitors: the general onboarding captures names only. Skyler onboarding adds agent-specific fields (advantages, objection responses, never-say rules) onto those same competitor entries.

---

## Connect Tools — Dynamic List

Both onboarding flows have a "Connect Tools" step. The list of available tools should NOT be hardcoded. It should come from a config that updates as new integrations are built.

```
// Available integrations config (lives in code, updated when new integrations are added)
const AVAILABLE_INTEGRATIONS = [
  // Communication
  { id: 'slack', name: 'Slack', category: 'communication', description: 'Messages, channels, threads', icon: 'slack-icon', nango_id: 'slack' },
  { id: 'google-mail', name: 'Gmail', category: 'communication', description: 'Emails, threads, attachments', icon: 'gmail-icon', nango_id: 'google-mail' },
  { id: 'outlook', name: 'Outlook', category: 'communication', description: 'Emails, calendar, contacts', icon: 'outlook-icon', nango_id: 'outlook' },

  // Productivity
  { id: 'google-calendar', name: 'Google Calendar', category: 'productivity', description: 'Events, scheduling', icon: 'gcal-icon', nango_id: 'google-calendar' },

  // CRM
  { id: 'hubspot', name: 'HubSpot', category: 'crm', description: 'Contacts, deals, pipeline', icon: 'hubspot-icon', nango_id: 'hubspot' },

  // Scheduling
  { id: 'calendly', name: 'Calendly', category: 'scheduling', description: 'Booking links, events', icon: 'calendly-icon', nango_id: 'calendly' },
]
```

When a new integration is added (Google Drive, Notion, Salesforce, etc.), it's added to this config. The onboarding page renders whatever's in the config. The "Connect" button triggers Nango OAuth. Connected status is checked against the existing `integrations` table.

**For Skyler's Connect Tools step**, the categories are different (Email Required, CRM Required, Lead Intelligence Recommended, Scheduling Recommended, Team Notifications Optional). This uses the same config but with Skyler-specific categorisation and required/recommended/optional labels.

Tools that aren't built yet show as "Coming Soon" (greyed out, no Connect button) by adding a `status: 'coming_soon'` flag to the config entry.

---

## Onboarding Completion Pipeline

### When "Complete Setup" is clicked (end of General Onboarding):

**Synchronous (before page transition):**
1. Save all general onboarding data to `workspaces.settings` JSONB
2. Set `onboarding_status.general_completed = true`
3. Redirect to `/onboarding/skyler`

**Background (Inngest, doesn't block the user):**
4. If brand documents were uploaded → process them (extract text, chunk, embed into document_chunks)
5. If any tools were connected → Nango starts initial sync (this may already happen on connect)

### When "Launch Skyler" is clicked (end of Skyler Onboarding):

**Synchronous (before page transition):**
1. Save Skyler-specific data to `agent_configurations` (skyler row)
2. Write back any edited shared fields to `workspaces.settings`
3. Set `onboarding_status.skyler_completed = true`
4. Redirect to dashboard

**Background (Inngest, 5 parallel jobs):**
5. **Rebuild knowledge profile** — takes settings.business_profile + settings.products + settings.competitors + any synced data → synthesises into knowledge_profiles table. ~30-60 seconds.
6. **Seed workspace memories** — converts key onboarding facts (products, pricing, differentiator, ideal customer, never-say rules) into workspace_memories with embeddings. ~5-10 seconds.
7. **Embed onboarding data** — creates document_chunks from product descriptions and key business context for CleverBrain RAG search. ~5-10 seconds.
8. **Initialise behavioural dimensions** — sets Skyler's starting personality based on formality and communication approach settings. ~1 second.
9. **Process remaining brand docs** — if any brand documents are still pending from general onboarding. Varies.

**The key point:** After the synchronous writes, both agents work immediately. The background jobs make them progressively smarter over the next few minutes.

---

## General Onboarding — Step by Step

### Layout
- Horizontal tab navigation across the top (7 tabs)
- Purple accent colour for active tab and buttons
- CleverFolks logo top-left
- Back/Continue navigation at bottom
- Each step has a title, subtitle/info banner, and form fields

### Step 1: Your Company
**Route:** `/onboarding?step=company`

**Page title:** "Your Company"
**Info banner:** "Welcome to CleverFolks! Let's set up your workspace. This information powers CleverBrain and all your AI Employees. The more context you give, the smarter they are from day one."

**Fields:**
- Company Name* (text input, placeholder: "e.g. Cleverfolks")
- Company Website (text input, placeholder: "e.g. https://cleverfolks.com")
- What does your company do?* (textarea, placeholder: "Be specific. Not 'we help businesses grow' — more like 'we build AI-powered sales assistants that automate outreach for B2B SaaS startups.'", helper text below: "This becomes the foundation for how CleverBrain and all AI Employees understand your business.")
- Industry/Sector* (text input, placeholder: "e.g. SaaS, E-commerce, Healthcare, Fintech")
- Company Stage (selectable chips: Pre-revenue, Early Traction, Growth, Established)
- Team Size (selectable chips: 1-5, 6-20, 21-50, 50+)

**Saves to:** `workspaces.settings.business_profile`
**Also updates:** `workspaces.name` (from Company Name)

### Step 2: Your Market
**Route:** `/onboarding?step=market`

**Page title:** "Your Market"
**Info banner:** "Who do you serve and who do you compete with? CleverBrain uses this to understand your market position. Your AI Employees will reference this when engaging with prospects and handling competitive questions."

**Fields:**
- Who are your customers?* (selectable cards: B2B / "You sell to businesses", B2C / "You sell to consumers", Both / "Mix of both")
- Target Audience* (textarea, placeholder adapts: if B2B selected → "Describe your ideal customer in detail. For B2B: industry, company size, buyer role, geography." If B2C → "For B2C: demographics, interests, pain points." If Both → show both prompts)
- Key Competitors* Up to 5 (tag input with + Add button, helper text: "Your AI Employees use this to avoid outreach to competitor domains, position you correctly in conversations, and handle competitive objections.")
- What makes you different?* (textarea, placeholder: "Your one line positioning. What's the #1 reason someone picks you over a competitor?", helper text below: "This becomes your AI Employees' default value proposition in sales conversations.")

**Saves to:** `workspaces.settings.business_profile` (business_model, target_audience, differentiator) + `workspaces.settings.competitors[]` (names only at this stage)

### Step 3: Your Brand
**Route:** `/onboarding?step=brand`

**Page title:** "Your Brand"
**Info banner:** "Your brand identity. Your AI Employees use your branding in proposals, outreach materials, documents, reports, and presentations. The more you provide, the more professional everything looks."

**Fields:**
- Company Logo — Primary Logo upload (PNG or SVG, transparent background preferred)
- Company Logo — Dark version upload (optional — for dark backgrounds)
- Brand Colours — Primary Colour (colour picker + hex input), Secondary Colour, Accent Colour
- Brand Fonts — Heading Font (text input, placeholder: "e.g. DM Sans, Montserrat, Playfair Display"), Body Font (text input, placeholder: "e.g. Inter, Open Sans, Lato")
- Brand Guidelines & Documents (file upload zone, helper text: "Upload brand guides, style guides, pitch decks, or any documents that define how your brand looks and sounds. CleverBrain will reference these when creating materials.", accepts: PDF, DOCX, PNG, JPG, SVG)
- Brand Voice* (selectable cards: Professional & Polished / "Corporate, trustworthy, authoritative", Friendly & Approachable / "Warm, conversational, relatable", Bold & Confident / "Direct, assertive, no-nonsense", Innovative & Modern / "Forward thinking, tech-savvy, fresh", helper text: "How should your company sound in written communications? This applies to everything CleverBrain and your AI Employees produce.")
- Tagline or Slogan (text input, placeholder: "e.g. 'AI ideas worth millions' — used in documents and materials")

**Saves to:** `workspaces.settings.brand` (colours, fonts, voice, tagline) + `brand_assets` table (uploaded files)
**Background:** Uploaded brand docs → Supabase Storage → Inngest processes them into document_chunks

### Step 4: Products & Services
**Route:** `/onboarding?step=products`

**Page title:** "Products & Services"
**Info banner:** "What do you sell? Your AI Employees need to know exactly what you offer to have informed conversations with prospects — product names, what they do, and who they're for."

**Fields:**
- Your Products & Services* (repeating group: "Product or service name" text input + "One-line description — what it does and who it's for" textarea, with delete icon per entry, and "+ Add another product or service" button at bottom)
- Primary Pricing Model* (selectable cards: Subscription / "Monthly or annual recurring", One time / "Single Purchase", Usage-based / "Pay per use or consumption", Custom/Enterprise / "Tailored pricing per deal")

**Saves to:** `workspaces.settings.products[]`

### Step 5: Team & Work Style
**Route:** `/onboarding?step=team`

**Page title:** "Team & Work Style"
**Info banner:** "How does your team operate? This ensures your AI Employees respect your working hours, communicate in the right language, and know who's on the team."

**Fields:**
- What's your role?* (selectable chips: Founder/CEO, Sales Lead, Marketing, Operations, Product, Other)
- Timezone* (dropdown, auto-detect from browser, e.g. "GMT (London)")
- Working Hours (two time pickers: start "9:00AM" and end "6:00PM")
- Preferred Language* (dropdown, default "English", helper text: "Your AI Employees' outreach and responses will default to this language.")
- Invite Team Members (optional, helper text: "Optional — you can do this later", email input placeholder: "team@company.com" + role dropdown "Member" + add button)

**Saves to:** `workspaces.settings.team` (timezone, hours, language) + user profile (role) + workspace_memberships/invites (team members)

### Step 6: Connect Tools
**Route:** `/onboarding?step=tools`

**Page title:** "Connect Tools"
**Info banner:** "Connect the tools your team uses daily. CleverBrain syncs your data from these tools to create a unified knowledge base. Your AI Employees use this data to understand your business context and work smarter. Connect at least one to get started."

**Fields:**
- Dynamic list of available integrations, grouped by category (Communication, Productivity, CRM)
- Each shows: icon, name, description, Connect button
- Connected tools show green "✓ Connected" badge
- Tools not yet built show "Coming Soon" label (greyed out, no Connect button)

**Footer info banner:** "Connect at least one tool so CleverBrain has data to work with. You can always add more later from Settings."

**Minimum requirement:** At least one tool connected to proceed.

**Saves to:** Nango handles the OAuth. Connected status checked against `integrations` table. No onboarding-specific storage needed.

### Step 7: Your Goals
**Route:** `/onboarding?step=goals`

**Page title:** "Your Goals"
**Info banner:** "What do you want CleverFolks to help with? This helps us personalise your dashboard and configure your AI Employees to focus on what matters most to you."

**Fields:**
- What do you want CleverFolks to help with?* (multi-select cards: Sales Automation / "Lead follow-ups, outreach, pipeline management", Meeting Management / "Prep, scheduling, follow-ups, notes", Email Management / "Triage, drafts, summaries, organisation", Data and Insights / "Reports, trends, business intelligence", Content Creation / "Marketing copy, socials, campaigns", Team Coordination / "Status updates, task tracking, alignment")
- What's your biggest bottleneck right now?* (textarea, placeholder: "Be honest. What takes up the most time that shouldn't? What drops through the cracks? This directly shapes how your AI Employees prioritise their work.")

**Transition banner at bottom (this is where Skyler is mentioned):** "Almost there — SKYLER setup is next. Your AI Sales Assistant needs a few more details to start working. Once your workspace is ready, we'll walk you through setting up SKYLER — your AI Sales Assistant. She'll need to know about your sales process, messaging style, and a few rules. Takes about 5 minutes."

**Button:** "Complete Setup ✓" (not "Continue")

**Saves to:** `workspaces.settings.goals`
**On complete:** Sets `onboarding_status.general_completed = true`, redirects to `/onboarding/skyler`

---

## Skyler Onboarding — Step by Step

### Layout
- Left sidebar with progress tracker (numbered steps, green ticks for completed)
- Skyler avatar + "Setting up Skyler for your business" header in sidebar
- "~15 minutes to complete" at bottom of sidebar
- Main content area on the right
- Orange accent colour (#F2903D) for active step, buttons, and highlights
- Each step has: step counter (e.g. "STEP 2 OF 7"), title, subtitle, Skyler quote bubble, form fields
- Back/Continue navigation at bottom right
- Step counter at bottom centre (e.g. "3 / 7")

### Step 1: Your Business (Tell me about your business)
**Route:** `/onboarding/skyler?step=business`

**Page title:** "Tell me about your business"
**Subtitle:** "The more specific you are, the better Skyler will perform. Vague answers produce generic outreach. Specific answers produce conversations that convert."

**Skyler quote:** "Hi! I'm Skyler. Before I start handling your sales, I need to understand your business deeply. Let's start with the fundamentals — I'll ask you 7 sets of questions and then I'll be ready to work."

**Fields:**
- What does your company do?* (textarea, PRE-FILLED from settings.business_profile.company_description, helper text: "One or two specific sentences. Not 'we help businesses grow' — more like 'we help Shopify stores reduce cart abandonment using AI-powered popups.'")
- Who is your ideal customer?* (textarea, PRE-FILLED from settings.business_profile.target_audience, helper text: "Company size, industry, job title of buyer, revenue range, geography.")
- What is the #1 pain your customers have before finding you?* (textarea, helper text: "This is what Skyler leads every conversation with. Be specific and emotional — this is the hook.")
- What outcome do your customers get after using you? (textarea, helper text: "Numbers work best. Real results beat abstract benefits every time.")

**Saves to:** `agent_configurations.config` (skyler) for ideal_customer, primary_pain_point, primary_outcome. If user edits the pre-filled fields, also updates `workspaces.settings.business_profile`.

### Step 2: Your Sales Process
**Route:** `/onboarding/skyler?step=sales_process`

**Page title:** "Your sales process"
**Subtitle:** "Skyler needs to know how deals move through your pipeline so it can push conversations in the right direction at the right time."

**Skyler quote:** "Now I need to understand how you sell. A product-led self-serve motion needs a completely different approach from a high-touch enterprise sale. Tell me exactly how your deals flow."

**Fields:**
- What does your sales journey look like?* (textarea, helper text: "List each stage in order. Include what triggers the move to the next stage.", placeholder: "e.g. Lead fills form → Skyler qualifies → Discovery call (30 min) → Demo (45 min) → Proposal → Follow-up → Close")
- Average sales cycle length (selectable chips: Same day, 1–3 days, 1–2 weeks, 2–4 weeks, 1–3 months, 3+ months)
- Your pricing structure* (textarea, helper text: "Skyler needs exact pricing to handle budget conversations correctly. Include tiers and discounts.", placeholder: "e.g. Starter: £299/month (up to 5K sessions), Growth: £799/month, Enterprise: custom from £2,000/month. Annual = 20% off.")
- Average deal size (selectable chips: Under £500, £500–£2K, £2K–£10K, £10K–£50K, £50K+)
- Primary goal for Skyler's outreach (selectable chips: Book a discovery call, Book a product demo, Start a free trial, Direct purchase, Schedule a site visit)

**Saves to:** `agent_configurations.config` (skyler) — sales_journey, cycle_length, pricing_structure, average_deal_size, outreach_goal

### Step 3: Objections & Competitors
**Route:** `/onboarding/skyler?step=objections`

**Page title:** "Objections & competitors"
**Subtitle:** "This is where most AI sales tools fail — they don't know how to handle pushback. Teach Skyler exactly what to say when prospects hesitate."

**Skyler quote:** "Every conversation hits resistance. Tell me exactly how you handle the objections you hear most. Don't give generic answers — tell me what your best rep actually says when a prospect pushes back on price."

**Fields:**
- Objection #1: THE OBJECTION (text input, pre-filled: "It's too expensive / not in budget") + SKYLER'S RESPONSE (textarea, placeholder: "What your best rep says in this situation...")
- Objection #2: THE OBJECTION (text input, placeholder: "e.g. We're already using a competitor") + SKYLER'S RESPONSE (textarea, placeholder: "What your best rep says in this situation...")
- Objection #3: THE OBJECTION (text input, placeholder: "e.g. Now isn't the right time") + SKYLER'S RESPONSE (textarea, placeholder: "What your best rep says in this situation...")
- Competitors & your advantages over each* (textarea, helper text: "List up to 3 competitors and your strongest advantage over each one.", placeholder showing format: "Klaviyo — we're popup-specific with better exit intent targeting. They're broad email, we're focused.\nPrivy — we use AI-powered timing, they use manual rules. Our popups convert 3x better on average.\nOptinMonster — native Shopify integration, no code needed. They're generic.")
- What should Skyler NEVER say about competitors? (text input, placeholder: "e.g. Never say Klaviyo is a bad product. Never make claims we can't back up with data.")

**Pre-fill:** If competitors were entered in general onboarding, show their names in the competitors textarea.

**Saves to:** `agent_configurations.config` (skyler) — general_objections[], never_say_about_competitors. Also enriches `workspaces.settings.competitors[]` with advantages and Skyler-specific fields.

### Step 4: Tone & Communication Style
**Route:** `/onboarding/skyler?step=tone`

**Skyler quote:** "I'll match your communication style from day one. Set the tone and I'll learn the rest from how you actually talk to customers through your connected tools."

**Page title:** "Tone & communication style"
**Subtitle:** "Skyler will sound like YOU — not like a generic AI. Calibrate your communication style so every message feels authentic."

**Fields:**
- Formality level (slider with 4 stops: Casual ←→ Conversational ←→ Professional ←→ Formal. Below the slider, show descriptive chips that change based on selection. E.g. for "Conversational": "Hi [Name]", "Short sentences", "Contractions OK", "First name")
- Communication approach (selectable chips: Consultative — educate first, Direct — get to the point fast, Story-driven — use case studies, Data-led — numbers and proof, Relationship-first — build rapport)
- Phrases to always use (text input, placeholder: "e.g. 'quick question', 'worth a 15-min call'")
- Phrases to never use (text input, placeholder: "e.g. 'just following up', 'circle back', 'synergy'")

**Saves to:** `agent_configurations.config` (skyler) — formality_level, communication_approach, phrases_always_use[], phrases_never_use[]

### Step 5: Connect Your Tools
**Route:** `/onboarding/skyler?step=tools`

**Page title:** "Connect your tools"
**Subtitle:** "Skyler needs access to your email, CRM, and calendar to actually execute. These connections are what separates automation from intelligence."

**Skyler quote:** "I'll send emails from your actual address, log everything in your CRM, and book demos directly into your calendar. Your data stays yours — I just act on it. You can disconnect any integration at any time."

**Layout:** Tools grouped into categories with labels:
- **Email** (Required) — Gmail, Outlook. Show as already connected if done in general onboarding.
- **CRM** (Required) — HubSpot, Salesforce (coming soon), Pipedrive (coming soon)
- **Lead Intelligence** (Recommended) — Apollo.io (coming soon), Google Analytics (coming soon)
- **Scheduling** (Recommended) — Calendly, Google Calendar
- **Team Notifications** (Optional) — Slack, MS Teams (coming soon)

**Minimum requirement:** Email AND CRM must be connected to proceed.

**Pre-fill:** Any tools already connected during general onboarding show as "✓ Connected" with green highlight.

**Saves to:** Same as general Connect Tools — Nango handles OAuth. No onboarding-specific storage.

### Step 6: Set Skyler's Rules (Guardrails)
**Route:** `/onboarding/skyler?step=guardrails`

**Page title:** "Set Skyler's rules"
**Subtitle:** "Guardrails define what Skyler can do autonomously. These protect your relationships. You stay in control — loosen them over time as you trust Skyler more."

**Skyler quote:** "I'd rather ask for your approval than risk sending something wrong to an important prospect. Start strict — you can always give me more autonomy once you've seen how I perform."

**Fields:**

*Autonomy Rules (toggleable):*
- Send follow-up emails automatically (ON by default) — "Skyler can send routine follow-ups without approval. First contact emails are always drafted for your review."
- Handle objections autonomously (ON by default) — "Skyler responds to pricing, timing, and competitor objections without asking you first."
- Book demos automatically into calendar (OFF by default) — "When a prospect agrees to a demo, Skyler books it directly without checking with you first."
- Send first outreach email autonomously (OFF by default) — "Recommended: keep OFF until you've reviewed 20+ of Skyler's drafts and trust the output."

*Hard Rules — Always On, Cannot Be Disabled (shown with lock icons, orange/amber background):*
- Escalate immediately when prospect says "ready to buy"
- Escalate if prospect mentions legal or contract issues
- Stop all contact if prospect says unsubscribe or stop
- Never quote prices below your approved minimum

*Confidence Thresholds (display-only, not editable during onboarding):*
- 85%+ → Send Autonomously
- 60-84% → Draft + Ask You
- Below 60% → Flag for Human

*Contact Hours:*
- Earliest Skyler contacts prospects (dropdown, default 8:00 AM)
- Latest Skyler contacts prospects (dropdown, default 6:00 PM)
- Note: "(prospect's timezone)"

**Saves to:** `agent_configurations.config` (skyler) — autonomy, hard_rules, confidence_thresholds, contact_hours

### Step 7: Review & Launch
**Route:** `/onboarding/skyler?step=review`

**Page title:** "Review & launch Skyler"
**Subtitle:** "Everything looks good. Review your full setup before Skyler goes live. Click any section to edit."

**Skyler quote:** "I've absorbed everything — your business, your customers, your objection playbook, your tone, your rules. Once you launch me, I'll start monitoring your leads and drafting responses. **You approve everything for the first 7 days.**"

**Layout:** Summary cards for each section, each with an "Edit" button that takes the user back to that step:

- **BUSINESS CONTEXT** — What you do, Ideal customer, Core pain, Key outcome
- **SALES PROCESS** — Sales cycle, Avg deal size, Skyler's primary goal, Pricing tiers
- **OBJECTIONS & COMPETITORS** — Objections trained (count), Competitors mapped (names), Hard limits
- **TONE & VOICE** — Voice calibration (how many emails if applicable), Formality, Approach
- **CONNECTED TOOLS** — Email (which), CRM (which), Lead intelligence, Calendar/Scheduling, Team notifications
- **GUARDRAILS** — Supervised period ("7 days — all emails need approval"), Auto follow-ups, Auto objection handling, Auto demo booking, Contact hours

**Button:** "🚀 Launch Skyler" (purple/blue button)

**On launch:**
1. Synchronous: save all data, set `onboarding_status.skyler_completed = true`
2. Fire `workspace/onboarding.completed` Inngest event
3. Redirect to dashboard

---

## Background Jobs on Onboarding Completion

Triggered by `workspace/onboarding.completed` Inngest event. All 5 run in parallel.

### Job 1: Rebuild Knowledge Profile
- Loads business_profile, products, competitors from settings
- Loads any synced data from connected tools
- Sends to Claude Sonnet to synthesise a dense business summary
- Stores in `knowledge_profiles` table
- ~30-60 seconds

### Job 2: Seed Workspace Memories
- Takes key facts: products + pricing, differentiator, ideal customer, never-say rules, terminology
- Creates 8-15 workspace_memories with Voyage AI embeddings
- Tags each with `source: 'onboarding'` for easy update/delete if onboarding changes
- ~5-10 seconds

### Job 3: Embed Onboarding Data for RAG
- Creates document_chunks from: product descriptions, company description, target audience, differentiator
- Source_type: 'business_profile'
- Makes this data searchable by CleverBrain via hybrid search
- ~5-10 seconds

### Job 4: Initialise Behavioural Dimensions
- Reads formality_level and communication_approach from Skyler config
- Maps to starting positions on the 6 behavioural spectrums
- Stores in decision memory tables
- ~1 second

### Job 5: Process Brand Documents
- For each brand doc in brand_assets with processing_status = 'pending':
  - Download from Supabase Storage
  - Extract text (PDF parser for PDFs, direct extraction for DOCX)
  - Chunk with structure-aware splitting
  - Embed via Voyage AI
  - Store in document_chunks (source_type: 'brand_doc')
- ~1-5 minutes per document

---

## What Skyler's buildWorkflowSettings() Becomes

The existing function that builds Skyler's workflow settings for the system prompt now reads from TWO sources:

```
async function buildWorkflowSettings(workspaceId):
  // Parallel queries
  [settings, skylerConfig] = await Promise.all([
    loadWorkspaceSettings(workspaceId),        // workspaces.settings JSONB
    loadAgentConfig(workspaceId, 'skyler'),     // agent_configurations.config
  ])

  return {
    business: {
      company_name: settings.business_profile.company_name,
      description: settings.business_profile.company_description,
      industry: settings.business_profile.industry,
      products: settings.products,
      competitors: settings.competitors,
      target_audience: settings.business_profile.target_audience,
      differentiator: settings.business_profile.differentiator,
      ideal_customer: skylerConfig.ideal_customer,
      primary_pain: skylerConfig.primary_pain_point,
      primary_outcome: skylerConfig.primary_outcome,
      sales_journey: skylerConfig.sales_journey,
      cycle_length: skylerConfig.cycle_length,
      pricing_structure: skylerConfig.pricing_structure,
      deal_size: skylerConfig.average_deal_size,
      outreach_goal: skylerConfig.outreach_goal,
    },
    tone: {
      formality: skylerConfig.formality_level,
      approach: skylerConfig.communication_approach,
      phrases_always: skylerConfig.phrases_always_use,
      phrases_never: skylerConfig.phrases_never_use,
      brand_voice: settings.brand.voice,
    },
    objections: {
      general: skylerConfig.general_objections,
      competitor_specific: settings.competitors.map(c => ({
        competitor: c.name,
        responses: c.skyler_objection_responses,
        never_say: c.skyler_never_say,
      })),
      global_never_say: skylerConfig.never_say_about_competitors,
    },
    autonomy: skylerConfig.autonomy,
    confidence_thresholds: skylerConfig.confidence_thresholds,
    contact_hours: skylerConfig.contact_hours,
    hard_rules: skylerConfig.hard_rules,
  }
```

This merged object gets serialised into the XML blocks in the system prompt. The prompt assembly code stays the same — it just receives a richer settings object.

---

## Prompt Caching Strategy

Layer 1 (SKYLER CORE IDENTITY + CORE INSTRUCTIONS): ~3,000 tokens. Same for ALL workspaces. Cached globally. → cache_control breakpoint

Layer 2 (WORKFLOW SETTINGS from onboarding): ~2,000-5,000 tokens. Same for all requests from the SAME workspace. Only changes when user edits settings. → cache_control breakpoint

Layer 3 (MEMORIES + LEAD CONTEXT + CONVERSATION): Variable. Changes per request. Not cached via breakpoints (Anthropic auto-caches growing conversation history).

This means: the expensive part (Layer 1 + 2, up to ~8,000 tokens) hits cache on nearly every request. At 100+ workspaces with regular activity, Layer 1 cache stays warm permanently. Layer 2 stays warm per-workspace as long as there's a request every 5 minutes.

---

## Design Notes

**IMPORTANT FOR CC:** Visual reference designs are at `C:\Users\admin\cleverfolksnew\Design\onboarding design`. Use these ONLY for layout, spacing, and component structure. All text, labels, placeholders, info banners, and helper copy must come from THIS document. The Figma files contain placeholder text that is not final.

### General Onboarding Visual Style
- Dark background matching current app aesthetic
- Horizontal tab navigation across top (7 tabs, all visible, clicking jumps to that step)
- **Purple accent (#5B3DC8)** for active tab, buttons, info banner borders, highlights
- Plus Jakarta Sans font throughout
- Linear/Notion-style, clean, professional
- Each step has: an info banner at top (purple-bordered card with title + description), form fields below, Back/Continue buttons at bottom

### Skyler Onboarding Visual Style
- Same dark background as general onboarding
- **Different layout:** Left sidebar (dark, narrower) with vertical step progress tracker + Skyler branding. Main content area on the right.
- **Orange accent (#F2903D)** for active step highlight, buttons, Skyler avatar ring, progress indicators
- Skyler avatar (blue circle with white "S") appears on quote bubbles at the top of each step
- Quote bubbles have a subtle border, Skyler avatar sits to the left of the bubble
- Each step has: "STEP X OF 7" label, page title (large), subtitle, Skyler quote bubble, form fields, step counter "X / 7" at bottom centre, Back/Continue buttons at bottom right
- Sidebar shows: CleverFolks logo, Skyler avatar, "Setting up Skyler for your business" title, "Answer 7 sections..." description, numbered step list with labels and subtitles, green ticks for completed steps, "~15 minutes to complete" at bottom

### Shared Components (reusable across both flows)
- Selectable chips/cards (single-select and multi-select variants)
- Text inputs and textareas with consistent dark styling
- File upload drop zones
- Integration connector cards with Connect/Connected states
- Back (← Back) / Continue (Continue →) navigation buttons
- Slider component (for formality level)
- Toggle switches (for guardrail autonomy rules)
- Tag input with + Add button (for competitors, phrases)

---

## Build Order

**Phase 1: Database + API**
1. Create agent_configurations table
2. Create brand_assets table
3. Define the full JSONB shape for workspaces.settings
4. Build API routes for saving/loading onboarding data
5. Build onboarding completion pipeline (sync writes + Inngest events)
6. Wire buildWorkflowSettings() to read from both sources

**Phase 2: General Onboarding UI**
7. Build the 7-step general onboarding with all form fields
8. Build the Connect Tools step with dynamic integration list
9. Build the gating logic (redirect if not completed)

**Phase 3: Skyler Onboarding UI**
10. Build the 7-step Skyler onboarding with sidebar layout
11. Build the pre-fill logic from general onboarding
12. Build the Review & Launch summary page
13. Wire the "Launch Skyler" button to the completion pipeline

**Phase 4: Background Jobs**
14. Knowledge profile rebuild job
15. Memory seeding job
16. Onboarding data embedding job
17. Behavioural dimension initialisation job
18. Brand document processing job

**Phase 5: Testing**
19. End-to-end test: fresh workspace → general onboarding → Skyler onboarding → dashboard
20. Verify Skyler's first message uses onboarding data
21. Verify CleverBrain's first message uses business context
22. Verify background jobs complete and enrich agent responses