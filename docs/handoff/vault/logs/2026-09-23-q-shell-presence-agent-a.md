---
title: Q shell — particle presence, voice-first Home, global Q (Agent A)
project: capital-q
date: 2026-09-23
tags: [session-log, q-shell, voice, design]
---

# Q shell — particle presence, voice-first Home, global Q (Agent A)

**Objective:** replace the letter-Q mark with a living particle presence, make Home's Q voice-first, and put a contextual mini-Q in the shell chrome (prototype sprint, worktree `agent-abc13cb2720e5a074`, branch on top of `recovery/2026-09-12` d791681).

**What changed**
- `apps/web/src/features/q-presence/*` — canvas 2D particle Q (ring, inner ring, tail); states IDLE/LISTENING/THINKING/SPEAKING/ACTION/SUCCESS/ERROR; tokens read from the element; paused off-screen/hidden; static under reduced motion; `size`/`state` props.
- `apps/web/src/features/q/q-stage.tsx`, `q-conversation.tsx`, `q-history-sheet.tsx`, `q-control-icons.tsx`, `spoken.ts` — Home Q surface: presence + one-word state + icon controls (talk/end, type, history, download, mute, settings); voice runs in place, not behind the modal stage; thread at reading width; answers as `cq-prose`.
- `apps/web/src/features/q/q-subject.tsx`, `q-sheet.tsx`, `components/app-shell/global-q.tsx` — Q in the sidebar/header on every page, opening a sheet bound to the page/own subject; `<QPageSubject>` for pages to declare an entity.
- `features/voice/voice-stage.tsx`, `features/welcome/welcome-screen.tsx`, `app/globals.css` — stage on `--cq-stage-*` tokens only; no orb/halo/gradient/literal alphas.
- `apps/web/app/dev/q-presence/*` — dev gallery of all states; `apps/web/test/q-presence.test.ts`.
- Screenshots: `design/screenshots/A/{q-page,presence,global-q,voice}`.

**Decisions**
- Semantic tokens are re-pointed at the stage tokens inside `.cq-stage`, so shared components paint on the stage unchanged — no stage-specific component variants.
- Voice on Home is in place (presence + controls), while onboarding keeps `VoiceStage`.
- Page subjects are declared client-side via context; authority stays with the Q API.

**Open questions**
- Doc 18 §35/§38 and Agent 0's brief forbid idle motion / particles; the lead commissioned them. Needs an ADR.
- Railway voice path produced no greeting/audio today on Home AND the proven interview path (same account, fake mic) — backend, not UI.
- "Q, show our previous conversations" needs a server voice destination (contracts + q-api).

**Follow-ups landed (same day)**
- A4 `bed8262`: presence is a swarm (loose annulus + inner cloud), not a letterform — the user's brief governs; the doc-18 conflict is the lead's ADR.
- A5 `069f2ee`: working state via QStateIndicator, interview question as `cq-title-lg` with one Progress line at reading width, unset-org collapsed, compact header scope cue, six Lucide icons in `@capital-q/ui/icons`, `.cq-step-enter` on the emphasis token.
- Voice on Railway: greeting and a typed turn answered after the ElevenLabs key switch; the headless fake-mic timing is the harness, not the product.

**Next step**
- None assigned; integration head 164150a carries everything of A's. `<QPageSubject>` remains for the Discover/company owners to wire.
