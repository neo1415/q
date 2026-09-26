---
title: Memory, conversations and the learning loop (ADR 0012)
project: capital-q
date: 2026-09-17
tags: [q, memory, conversations, adr-0012, voice]
---

## Objective
Fix profile-change tool calls (spoken "Approved.", typed name change), make conversations survive refresh with a multi-chat sidebar, and give Q persistent memory that learns across chats, per doc 13 §40 / doc 14 §55-§61, without regex patches.

## What changed
- q-core: DECISION_READER v1, MEMORY_EXTRACTOR v1, COMPANY_ANALYST v4 (memory in, displayName out), INTERVIEW_CONDUCTOR v3 (memory in); lock pinned; notes bound 2,900.
- q-api: `voice/decision.ts`, `composition/person-profile-action.ts`, `composition/memory-learner.ts` (+ `withLearning` orchestrator wrapper), `http/q-conversations.ts`; turn.ts branches use the reader and carry a remainder on; voice turn state carries `conversationId`; keyterms from remembered pronunciations.
- q-runtime: conversation title/summary/lastMessageAt, list/get/archive use cases and routes; message insert maintains `last_message_at`.
- q-knowledge: `src/memory/` (contracts, postgres repository, service = gate, render).
- contracts/api-client: `/v1/q/conversations` schemas and calls.
- web: `use-q-conversation` keyed by URL `?c=`, no localStorage; `chats-list.tsx` in the desktop sidebar and inline on Home.
- migrations 20260925090000 (conversations) and 20260925091000 (memory_items); RLS tests 390, 130, 370 updated.
- docs: ADR 0012, `docs/modules/q-memory-conversations-audit.md`, reliability audit §Q, hosted runbook note.

## Decisions
See decisions.md (ADR 0012, decision reader, person.profile.update).

## Open questions
- Live probes pending: voice session landing in its chat on screen; keyterms from memory; typed "call me John" end to end.
- USER_CONFIRMED memory writes and a forget path in the product are not built.

## Next step
Push the two migrations to hosted (`pnpm db:push`), restart the local stack, run the three live probes, then Render/Vercel deploy.
