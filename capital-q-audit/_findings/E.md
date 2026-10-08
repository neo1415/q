# Investigator E — Rich results / generative UI and UI/UX architecture

HEAD `520bd123`. Reports: `06-GENERATIVE-UI.md`, `11-UI-UX-ARCHITECTURE.md`. Diagram: `diagrams/rich-response-rendering.md`. Excerpts: `evidence/ui/*.md`.

## CONFIRMED DEFECTS

(Each is confirmed by static reading. None was reproduced in a browser.)

- **D-E1 — HIGH — Arrival cards and voice card control vanish from the Q page as soon as Q speaks its briefing, or the person types.**
  - Symptom: the founder hears "Three things… tell me what you'd like done", but the side/below cards are gone and spoken decisions have nothing to act on. This matches "just listening and not doing anything" and "cards by the sides".
  - Evidence:
    - `ArrivalRoom` and the welcome render only in the `!conversing` branch (`apps/web/src/features/q/q-conversation.tsx:1166-1227`).
    - `conversing = lines.length > 0` (`:523`), `showWelcome` requires `lines.length === 0` (`:608`), and `lines` includes spoken-only lines (`:493-508`).
    - Q's opener is added via `onLine` (`q-session.tsx:233-239`; `voice/provider/duplex-line.ts:1376-1379`).
    - On unmount, the decider and standing note are removed (`briefing/arrival-briefing.tsx:751-755, 766-794`).
    - `ArrivalDock` is null on `/home` (`briefing/arrival-dock.tsx:42`).
  - Root cause: the briefing is modelled as part of the pre-conversation welcome, not as a persistent layer of the stage.
- **D-E2 — HIGH (product gap) — Investors get no "new companies matching my mandate, with Q's opinion" on arrival, and the only mandate-match line was suppressed.**
  - Evidence:
    - `ArrivalCard.kind` is `APPROVAL | HELD` only (`briefing/arrival.ts:35-56`).
    - `matches` means CONNECTED relationships (`apps/q-api/src/composition/work/page.ts:703-719`).
    - The R35 `pitchItems` (`home/briefing.ts:251-265`) is hidden when the arrival is READY (`home/returning-welcome.tsx:164-167`).
  - Root cause: the arrival read set (`arrival-actions.ts:109-117`) contains no slate/feed delta and no fit.
- **D-E3 — MEDIUM — Voice→card decisions and screen notes work only on the duplex (OpenAI realtime) line.**
  - Evidence: `decideCardByVoice`, `cardInFocus` and `onLineNote` are referenced only in `voice/provider/duplex-session.ts:18,166-172,208-211` (grep across `features/`). The standard line (Deepgram + think + ElevenLabs, the lead's fallback today) has none of them.
  - Root cause: card seam built for duplex client tools only.
- **D-E4 — MEDIUM — Silent turns give no visible feedback.**
  - Evidence: `duplex-line.ts:1615-1616` (bubble + THINKING), then `1647-1652` (`silent` → LISTENING, nothing said). Labels at `voice/session.ts:24-33`.
  - Symptom: the person sees their words, then "Listening", and nothing else.
  - Root cause: no UI state for "Q heard you but chose not to answer / didn't catch that".
- **D-E5 — MEDIUM — The first typed question (and the Talk press) is delayed by the briefing reads, with no working indicator.**
  - Evidence: `qAsk` awaits `spokenWelcome` before `rawAsk` (`q-conversation.tsx:659-672`). `spokenWelcome` polls up to 1.5s, then `voiceBriefing` (2.5s timeout, `briefing/arrival-voice.ts:6, 22-29`), then the R35 race (1.5s) (`q-conversation.tsx:156-193`). `talk()` does the same (`:374-395`).
  - Worst case is about 5.5s before anything is sent; `q.working` stays false during the wait.
- **D-E6 — MEDIUM — A held draft dismissed from the arrival or Work is dismissed only in this browser's localStorage, and the next arrival briefing brings it back.**
  - Evidence: `dismissHeld` writes `localStorage["cq.work.dismissedHeld"]` (`work/decision-queue.tsx:141, 188-196`). The arrival calls `decisionGroups` without `dismissedHeld` (`briefing/arrival-actions.ts:136-142` vs. the parameter at `work/decisions.ts:132`). The Work page passes it (`work/work-page.tsx:151,175`).
  - Root cause: the decision is stored client-side rather than server-side.
- **D-E7 — MEDIUM — One invalid result block silently drops every block of an answer.**
  - Evidence: `packages/model-gateway/src/q/result-blocks.ts:428-429` (`safeParse` of the whole array, `undefined` on failure). No log at that point.
  - Root cause: all-or-nothing validation.
- **D-E8 — LOW/MEDIUM — Investor references and investor answer cards cannot be opened or identified.**
  - Evidence:
    - `INVESTOR_REFERENCE` renders as an unnamed "Investor" avatar with no link, and its ask is generic (`q-result-blocks.tsx:414-443`).
    - Card subjects are resolved only for COMPANY (`model-gateway/src/q/card-subjects.ts:1-10, 88-100`).
    - `answerCardsBlock` sets `subject: null` (`answer-cards.ts:122`).
    - COMPARISON headers read "Company 1/2" (`q-result-blocks.tsx:293-310, 463-470`).
- **D-E9 — LOW (UX) — Three greeting/briefing systems on one Home, chosen by a sessionStorage flag.**
  - Evidence: `home/returning.ts:115-160`, `home/briefing.ts` (R35), `features/briefing/*`. Gate at `arrival-gate.ts:69-77`; switching at `returning-welcome.tsx:131-167`; voice fallbacks at `q-conversation.tsx:164-193` and `q-session.tsx:49-58, 359-363`.
  - Symptom: a reload in the same tab shows "Welcome back, X. What would you like to work on today?" instead of the briefing.
- **D-E10 — LOW — Dead UI code.** `features/voice/voice-panel.tsx` (`VoicePanel`) and `features/home/activity-summary.tsx` (`ActivitySummary`) have no importers (grep).
- **D-E11 — LOW — Contract comment drift.** `result-block.ts:22-25` says TEXT has no Markdown contract, yet the web renders a Markdown subset (`features/q/markdown.tsx:14-38`) and the prompt requests lists and tables.

## UNVERIFIED RISKS

- **R-E1 — D-E1 timing per provider.**
  - Hypothesis: on duplex the cards disappear when the opener's transcript completes; on Deepgram, possibly as the greeting starts.
  - Verify: Playwright on `/home` as a seeded returning founder with a fake mic. Assert that `[data-arrival-sequence]` is still present after the first `[data-q-row="q"]` or spoken line.
- **R-E2 — Room feed is process-local** (`apps/q-api/src/room/feed.ts:35-38, 99-100`).
  - Hypothesis: with more than one q-api instance, or a restart, spoken answers' cards never reach the screen.
  - Verify: Render instance count and autoscaling for q-api; kill or redeploy during a call.
- **R-E3 — Workforce-job activity may be missing from the lowdown.**
  - Hypothesis: actions done by workforce jobs (e.g. `expressInterest` in `composition/workforce/jobs.ts:160-173`) do not write `q_runtime.instruction_steps`, so "what Q did" undercounts.
  - Verify: trace job outcome writes against the `readWorkSince` query (`work/page.ts:647-665`).
- **R-E4 — "Since" can be very recent.**
  - Hypothesis: the heartbeat writes `last-seen` every 60s while any page is visible (`arrival-gate.ts:61-84`), and the "since" a call uses is `decideArrival().since` from page load. If the person has another tab open, "since" is minutes ago and the lowdown says "All quiet" despite a day's work.
  - Verify: two-tab scenario.
- **R-E5 — No `(app)` error boundary.**
  - Hypothesis: any page render error unmounts the whole `(app)` layout, including `QSessionProvider` (voice line, conversation).
  - Verify: throw in a page under `(app)` and observe the voice line.
- **R-E6 — Arrival approve is read-then-approve, not atomic.**
  - Hypothesis: content could change between the `readQApprovalAction` check and `approveQApprovalAction` (`arrival-actions.ts:279-308`).
  - Verify: the Approval Engine binds the server-held payload hash (brain/approvals area).
- **R-E7 — Startup alert notices.**
  - Hypothesis: they are not `NEEDS_YOU`, so they never reach the arrival "waiting" line.
  - Verify: the notification priority set in `apps/workers/src/network/startup-alert-watcher.ts` and the column default.

## OPEN QUESTIONS

- Should the arrival briefing be a persistent stage layer (side columns kept while conversing), or should the cards move into the presence stage's object slot once Q speaks?
- What source of truth should "needs you" have across arrival, QNow, Work and voice answers (notices vs approvals vs relationship.lastMessage)?
- Is the standard voice line expected to support card verbs, or is duplex the only supported mode?
- What is the desired investor arrival content: slate delta since last visit, top N with `fit.top_candidates`, plus a short Q view (fit is not quality)?
- Should chart and map blocks be added to `QResultBlock`, or stay out of scope for V1?

## EVIDENCE INDEX

- Blocks are a closed typed union → `packages/contracts/src/q/result-block.ts:37-52, 285-309`
- Model cards get code-computed fit/order and a null subject → `packages/model-gateway/src/q/answer-cards.ts:52-67, 88-132`
- Company-only subject resolution → `packages/model-gateway/src/q/card-subjects.ts:1-10, 88-100`; `model-gateway/src/q/index.ts:4070-4083`
- All-or-nothing block validation → `packages/model-gateway/src/q/result-blocks.ts:428-429`
- `SHOW_IN_Q_ROOM`: model picks kind and id only → `packages/contracts/src/q/ui-intent.ts:368-449`; content read as the person → `apps/web/src/features/q/room/room-actions.ts:60-98`
- Inline / chip / stage split → `apps/web/src/features/q/q-answer.tsx:32-65`
- Answer cards follow speech → `apps/web/src/features/q/answer-canvas-logic.ts:87-169`; `use-answer-playback.ts:20-28`
- One object at a time in the centre → `apps/web/src/features/q/q-presence-stage.tsx:150-166, 301-416`
- Side columns only pre-conversation → `apps/web/src/features/q/q-conversation.tsx:1166-1227`
- Spoken lines make `conversing` true → `q-conversation.tsx:493-523`; `q-session.tsx:233-239`
- Arrival cards are APPROVAL/HELD → `apps/web/src/features/briefing/arrival.ts:35-56`
- Arrival read set → `apps/web/src/features/briefing/arrival-actions.ts:100-214`
- Lowdown sources → `apps/q-api/src/composition/work/page.ts:639-752`
- Greeting/lowdown words → `packages/q-core/src/speech/arrival.ts:50-288`
- Gate → `apps/web/src/features/briefing/arrival-gate.ts:26-104`
- R35 hidden when the arrival is ready → `apps/web/src/features/home/returning-welcome.tsx:164-167`
- Generic opener → `apps/web/src/features/home/returning.ts:115-160`
- Voice card seam duplex-only → `apps/web/src/features/voice/provider/duplex-session.ts:166-172, 208-213`; `voice/line-cards.ts:1-91`
- Silent turn → `apps/web/src/features/voice/provider/duplex-line.ts:1647-1652`
- Typed ask waits for briefing → `apps/web/src/features/q/q-conversation.tsx:156-193, 659-672`
- Process-local room feed → `apps/q-api/src/room/feed.ts:35-38, 91-122`
- Held dismissal local-only → `apps/web/src/features/work/decision-queue.tsx:141, 188-196`; `briefing/arrival-actions.ts:136-142`
- No chart or map libraries → `apps/web/package.json:15-39`
- Root-only error boundary → `apps/web/app/error.tsx:1-59` (find: no other `error.tsx`)
- Unnamed investor card → `apps/web/src/features/q/q-result-blocks.tsx:414-443`
- Investor fit room card = own top 8 → `apps/web/src/features/q/room/room-actions.ts:277-290`
- Founder→investor finder has location and reasons → `packages/q-tools/src/tools/find-prospective-investors.ts:169-170`

## COVERAGE

- **Inspected (read):**
  - `features/briefing/*` (all 8 files)
  - `features/home/` (`home-screen`, `returning-welcome`, `returning` greeting/questions, `briefing.ts` types and `pitchItems`, `returning-facts` head)
  - `features/q/` (`q-conversation` 60-1300, `q-session` complete, `q-answer`, `q-result-blocks` 286-622, `q-presence-stage` complete, `room-feed` complete, `room/room-stage` 1-247, `room/room-actions` 60-110 and 277-340, `answer-canvas-logic` 61-200, `stage-canvas`, `use-answer-playback` head, `wire`, `use-wire`, `q-now`, `markdown` head, `conversation` block filters)
  - `voice/line-cards`, `voice/session` labels, `use-voice-interview` 430-560, `duplex-session` 150-240, `duplex-line` 1360-1390 and 1454-1494 and 1560-1700, `deepgram-session` 190-240
  - `q-dock` header; `global-q` 1-80 and 240-300; `arrival-dock`; Work route and `workforce-live`; `decision-queue` `dismissHeld`; `decisions.ts` signature
  - contracts `result-block`, `answer-cards`, `ui-intent` (complete)
  - model-gateway `result-blocks` 1-200 and 280-430, `answer-cards` complete, `fit-cards` head, `card-subjects` head, `index.ts` 4070-4090
  - q-api `room/feed.ts` 20-130, `room/routes.ts`, `work/page.ts` 1-110, 195-245 and 600-752
  - q-tools `fit.ts` 30-120, `investor-promises.ts` 40-110, `client-actions.ts` 960-1040, tool provider-name list
  - `startup-alert-watcher` head; app routes (page imports); `app/error.tsx`; boundary and loading file listing; `apps/web/package.json`
  - e2e spec heads (`arrival-briefing`, `q-presence-room`)
- **Tests run:** 6 web vitest files, 51 tests, all passed. Providers disabled.
- **Not inspected:**
  - `answer-canvas.tsx` body; `static-answer-cards`; `comparison-cards`; `q-evidence` body; `q-board*`; `artifact-*`; `material-viewer`
  - `q-room-card`, `q-room-deck`, `q-room-document`; `client-actions.ts` (web)
  - the `work-page.tsx` body; `workforce-map` body
  - `q-sheet` beyond its `QNow` use
  - the elevenlabs session
  - `use-q-conversation` decide/approve internals; the Approval Engine
  - server voice think/turn-reader paths (brain/voice area); onboarding UIs; GateQ UIs; admin
  - `find_prospective_investors` implementation beyond its description
  - visual design and tokens; mobile layout at runtime; real Lighthouse or axe runs
