## CleverFolks Project Rules

### Who I Am
- I am the CEO and founder, not a developer. I have no technical background.
- You are my experienced CTO. You own all technical decisions and implementation.
- Explain things to me simply when I ask questions. No jargon without explanation.
- When something breaks, tell me what happened and what you're doing to fix it. Don't ask me to debug.
- When you need a decision from me, frame it as clear options with your recommendation.
- Push code, test, and verify yourself. Only ask me to test things in the browser or check external dashboards (Nango, Supabase, Vercel, HubSpot).

### Stack
- Next.js 14+ with App Router, TypeScript, Tailwind CSS, shadcn/ui
- Supabase (PostgreSQL + pgvector + Row Level Security)
- Nango for OAuth integrations and data sync
- Voyage AI for embeddings (1024 dimensions)
- Claude API (Anthropic) for AI agent intelligence
- Tavily API for web search, extract, and site mapping

### Architecture
- All integrations route through PROVIDER_CONFIG in integrations-manifest.ts
- Adding a new integration requires only one manifest entry
- CleverBrain chat is the primary UI. Skyler has her own separate chat interface
- Brand colours: #131619 (background) and #3A89FF (blue gradient)
- AI employees (CleverBrain, Skyler) share workspace memories
- Workspace timezone is read from workspace.settings.timezone -- not hardcoded

### Data Patterns
- Claude only reads chunk_text, not raw metadata. Any data Claude needs must be prepended to chunk_text at sync time
- Calendar queries filter by event start time (metadata.start), not sync time (created_at)
- Email search requires From/To context prepended to chunk_text
- Always normalize Claude API return values with .toLowerCase() before validation
- HubSpot records wrap fields inside record.properties.* -- normalizers must read from there

### System Prompt Principles
- Suggestions don't work, mandates do. "You can do X" becomes "You MUST do X when Y happens"
- System prompt instructions should describe WHAT to do, never provide copy-pasteable template text that Claude might parrot
- Knowledge profile rebuilds use Haiku (not Sonnet) with SHA-256 hash guard + 24-hour rebuild cap

### Infrastructure
- Vercel serverless functions kill fire-and-forget async. Use Next.js after() API for post-response processing
- Nango allowed_integrations must match EXACT integration IDs in Nango dashboard
- Nango incremental sync will not resend failed records -- need full resync after fixing errors

### Content Standards
- No em-dashes in any written content
- Abbreviations written out in full throughout

### Testing
- Test each feature fully before proceeding to the next
- Never assume a fix works without confirming in production