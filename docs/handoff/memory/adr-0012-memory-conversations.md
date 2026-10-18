---
name: adr-0012-memory-conversations
description: "How Q memory, conversations, the learner and the decision reader are built (ADR 0012), and the rules that must not be broken when touching them"
metadata: 
  node_type: memory
  type: project
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T20:45:16.100Z
---

ADR 0012 (2026-09-17) added: `q_runtime.conversations` title/summary/last_message_at + `/v1/q/conversations` routes + chats sidebar (URL `?c=<id>`, no localStorage); `q_knowledge.memory_items` with the memory service in `packages/q-knowledge/src/memory` (gate: quote must be in USER turns, hash dedupe, supersede by key, server-internal RLS); the learner in `apps/q-api/src/composition/memory-learner.ts` (runs after every orchestrator start/resume, detached); `DECISION_READER` for spoken yes/no (`apps/q-api/src/voice/decision.ts`); `person.profile.update` action for the person's own name.

**Why:** the user wants an intelligent system that learns and remembers (corrections, pronunciation, preferences, prior Q&A across chats) without regex patches, inside security limits. Memory is prompt text only, never authority.

**How to apply:** new memory kinds go through the extractor's closed type list and the gate, never a direct insert. Prompt edits = new version + `prompts.lock.json` entry (analyst is v4, conductor v3). The checklist to re-run is `docs/modules/q-memory-conversations-audit.md`; three live probes were still pending at the time of writing (voice session landing in its chat, keyterms from memory, typed "call me John" end to end). See [[adr-0011-no-word-lists]], [[hosted-supabase-state]] (the two 20260925 migrations must be pushed to hosted).
