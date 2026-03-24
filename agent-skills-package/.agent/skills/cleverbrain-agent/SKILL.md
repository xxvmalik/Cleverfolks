---
name: cleverbrain-agent
description: Use when working on CleverBrain's AI chat, agent loop, system prompt, tool definitions, or response generation.
---

# CleverBrain Agent Loop

## How It Works
1. User sends message via chat
2. Relevant memories retrieved from workspace_memories (vector similarity search)
3. Conversation history loaded: last 15 messages in full + Haiku summary of older messages
4. Memories + history + business profile + integration map assembled into system prompt
5. Agent loop: Claude decides which tools to call, executes them, reads results, iterates (up to 10 rounds)
6. Tools: search_knowledge_base, fetch_recent_messages, count_messages_by_person, search_by_person, search_web, browse_website, map_website
7. Claude generates final response when it has enough information
8. Response streamed to user via SSE
9. Post-response (via Next.js after() API): memory extraction + chat history embedding into document_chunks

## Intelligence Principles
- Lead with the answer, match response length to complexity
- Web search mandatory for specific triggers. Queries use Company Context for location-aware, industry-specific results
- Proactive suggestions mandatory for 5 trigger patterns (unanswered email, overdue payment, upcoming meeting, no reply, unresolved complaint)
- Source mentions should be brief and natural, not verbose audit trails
- If memory FULLY answers the question, respond from memory ONLY -- no tool calls, 2-3 sentences max
- Calendar queries MUST use fetch_recent_messages with source_types, never search_knowledge_base
- Website browsing: try obvious pages (/pricing, /services) before mapping. Never fabricate data from unvisited sites. Never treat homepage marketing claims as real pricing

## Memory System
- workspace_memories table with pgvector similarity search
- memory-extractor.ts: Claude extracts learnings post-conversation (corrections, terminology, preferences, patterns, agent learnings)
- memory-store.ts: save/retrieve with conflict resolution (add, reinforce, supersede, skip)
- Always .toLowerCase() on Claude returned type values before validation
- Reinforcement: extraction prompt allows re-extraction of restated memories so saveMemory handles dedup
- Uses Next.js after() API to survive Vercel serverless termination
- Chat history also embedded as cleverbrain_chat source_type for cross-chat RAG search

## Key Patterns
- Integration-agnostic routing via PROVIDER_CONFIG manifest
- Claude is the agent -- no separate planner/router. Claude decides tools in a loop
- System prompt injects: role identity, date/time, business profile, knowledge profile, memories, integration map, tool rules, response style rules
- browse_website uses Tavily Extract (advanced) with direct HTTP fetch fallback for large/JS-rendered pages
- Smart extraction scores page chunks by keyword relevance + price pattern bonuses for large pages (2.4M+ chars)