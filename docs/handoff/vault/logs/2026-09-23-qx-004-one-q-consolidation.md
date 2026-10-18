---
title: QX-004 one Q — typed and spoken share the interviewer
project: capital-q
date: 2026-09-23
tags: [session-log, qx-004, onboarding, q]
---

# QX-004 one Q — typed and spoken share the interviewer

**Objective:** remove the split brain — the typed onboarding screen was
running its own template conversation while the spoken one ran the q-api
interviewer — and then fix the data loss the consolidated path exposed.

**What changed**

- `packages/contracts/src/q/interview.ts` — new turn contract (`POST
  /v1/q/interview/turn`). The seam both modalities cross.
- `apps/q-api/src/voice/interview-route.ts` — thin transport over the
  existing interviewer; the caller's own bearer, no service credential.
- `apps/api/src/q/interview-client.ts` + `http/onboarding.ts` — `/say`
  delegates the whole turn to q-api and adapts the answer into the shape
  the screen already reads. No interviewer logic, no copied prompt.
- `packages/contracts/src/http/onboarding.ts` — `understood` is nullable
  (the interviewer produces no such reading), `reply` and `degraded`
  added, `recentTurns` accepted, empty `text` opens the interview.
- `apps/web/.../conversation.ts` — the browser's acknowledgement composer
  deleted, tests and all. Q's words are rendered as written and the reply
  is also the live question.
- `apps/q-api/src/voice/interviewer.ts` — held values compared by value,
  not by the sentence describing them; a prerequisite Q cannot put on
  screen is named from the step's own prompt and Q returns to the
  question it was on, never to the refused step.
- `packages/q-core/.../interview-conductor.v6.ts` — a step in PENDING
  CONFIRMATIONS is decided in `confirmations`, never re-answered, and a
  turn about something else still answers what was said.

**Decisions**

- No fallback from `/say` to the old engine. Absent or unreachable
  interviewer → `PROVIDER_UNAVAILABLE`; the person can still tap through
  the step. Quietly reverting would hide the defect being closed.
- An empty `text` is an opening turn rather than a new flag or route: a
  refreshed screen gets Q's own question instead of the step's column
  heading, and nothing is recorded because there is no sentence.
- `understood` nullable rather than fabricated from the interviewer's
  outcome. A surface must not parse prose to learn what was recorded.

**Open questions**

- Eligibility and writability disagree in the investor journey: `I2.*`
  steps are listed eligible while their write targets refuse without
  `I1.mandate_context`. The interviewer now degrades gracefully, but the
  journey definition is the real place to fix it.
- Pre-organisation model usage is still unrecordable (P1, reported, not
  changed).

**Next step**

- Founder typed UI smoke, then ElevenLabs realtime voice on the same
  q-api conversation, then a deployment and a fresh deployed smoke.
