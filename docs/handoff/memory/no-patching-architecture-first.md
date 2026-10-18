---
name: no-patching-architecture-first
description: "User's binding rule after repeated loops — conversational failures map to general capabilities (planning/state/tools/validation/persistence), never phrase/step patches; test properties with paraphrases"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-25T03:39:33.275Z
---

2026-09-25, the user's "final nudge": onboarding was "a step engine with an AI model attached"; reproduce→smallest-fix loops only polished the wrong machine. Rule: no new semantic phrase/regex/step-specific patches in the legacy interviewer. Every conversational failure must map to a missing general capability in planning, state, tool semantics, validation or persistence. The interview is being rebuilt as one tool-calling Q loop (model plans over full objective + state, calls typed tools like record_answers/recommend/accept_recommendation/confirm_mandate; code validates and writes; Q replies from tool results). Progress is judged by milestones M1–M5, not transcript fixes.

**Why:** hours were lost patching symptoms of a structural design flaw; the user repeatedly complained about patching.

**How to apply:** when a worker proposes a transcript-specific fix, ask which general capability is missing instead; ACC tests semantic PROPERTIES with varied unseen paraphrases (transcripts are fixtures but passing them isn't sufficient); stop any worker that drifts into phrase lists. Run ~4 useful workers in parallel lanes (Q loop, voice, media/C7, Wave 8, UX) — see [[machine-freeze-concurrency-cap]], [[adr-0011-no-word-lists]].
