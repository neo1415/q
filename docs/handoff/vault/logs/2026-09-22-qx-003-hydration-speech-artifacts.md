---
title: QX-003 A–C — durable conversations, Deepgram speech, artifact domain
project: capital-q
date: 2026-09-22
tags: [session-log, qx-003]
---

# QX-003 A–C

**Objective:** close Checkpoint A (`CQ-Q-BLOCKS-HISTORY-001`), Checkpoint B
(Deepgram one-way TTS) and as much of C–F (artifacts) as could be built
without cutting a foundation.

**What changed**

- `apps/web/src/features/q/use-q-conversation.ts` — the open-guard ref is
  restored in the effect cleanup when the open was abandoned.
- `apps/web/src/features/home/home-screen.tsx`,
  `apps/web/src/features/q/chats-list.tsx`,
  `apps/web/src/components/app-shell/desktop-sidebar.tsx` — Home's Q surface
  and chats list render in the page shell; `ChatsListForRoute` keeps the
  URL read (and its boundary) for the sidebar, which a layout cannot tell.
- `apps/q-api/src/voice/synthesis.ts`, `providers/deepgram-speak.ts`,
  `routes.ts` — `SpeechSynthesisPort`, its Deepgram adapter and
  `POST /v1/q/voice/speech`.
- `apps/web/app/api/q-speech/route.ts`,
  `apps/web/src/features/voice/use-q-speech.ts`,
  `features/welcome/welcome-screen.tsx` — first-run speech, autoplay
  fallback, mute, no replay for returning users.
- `packages/contracts/src/q/artifact.ts`, `packages/q-artifacts/**`,
  `supabase/migrations/20261005090000_q_artifacts.sql`,
  `supabase/tests/database/rls/460_q_artifacts.test.sql` — the artifact
  bounded context.

**Decisions**

- The reported "history hydrates then is destroyed" was two faults, and one
  of them was not a product fault at all: React 19.2 reveals streamed
  Suspense content on a `requestAnimationFrame`, which never fires in a
  hidden tab, so the previous session was reading an unhydrated
  server render. Do not put a page's primary content behind a streaming
  boundary it does not need.
- A guard ref committed before cancellable async work must be rolled back
  in the cleanup. Copied to [[decisions]].
- One-way synthesis is composed from the Deepgram key alone, deliberately
  not gated on `Q_API_PUBLIC_URL` or a realtime transport — those exist
  because the Agent calls back, and nothing calls back for TTS. This is why
  first-run speech can work on the preview stack, which has no tunnel.
- Artifact generation is **not** a Q tool. `packages/q-tools/src/registry.ts`
  refuses to register anything that is not `SAFE_READ`/`READ_ONLY` "before
  the approval engine exists", and a specialist may not write either
  (CQ-Q-020 §51). So the write seam is a real decision, not a mechanical
  edit. Copied to [[decisions]].

**Open questions**

- Where does the artifact write belong? A person-invoked route needs a
  `PermittedContextPlan` to read company material, and the only correct
  source is the Context Firewall's own `plan()`, which wants a `runId`.
  Options: give brief composition a real Q run (attribution is honest, the
  card lands in that run's answer), or build the approval engine and let a
  `PREPARE`-classified tool do it. Wants an ADR before code.
- `pnpm preview:update` runs `supabase db reset` on the preview project and
  `supabase/seed.sql` creates no `auth.users`, so every preview update
  signs the tester out with no account to sign back into.

**Next step**

- QX-003D: decide the artifact write seam (ADR), then the Investment Brief
  composer, then E (card, viewer, history) and F (Edit with Q → V2).
