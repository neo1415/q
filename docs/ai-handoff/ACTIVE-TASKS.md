# Active tasks — authoritative cross-model board

> One owner per branch or worktree. Update the status words (CODE OBSERVED · IMPLEMENTED · MERGED · LOCAL TESTED · CI GREEN · DEPLOYED · LIVE VERIFIED · BLOCKED) with evidence.
> Snapshot 2026-10-11, HEAD `b021d53b`. **Every workstream below is MERGED, CI GREEN and DEPLOYED on `b021d53b`; none has uncommitted changes.** The "Live" line says exactly what was proven on production.

## Codex active continuation — 2026-10-11

- **IMPLEMENTED / LOCAL TESTED:** existing chart alignment/missing-data fix; existing authorized relationship TIMELINE adapter; workforce claim startup and lease-wait fix. Work is on `codex/preserve-optimize` from `e40b1d0f`.
- **CODE OBSERVED / LOCAL TESTED:** repeated 8.8 fixture is explainable by mandate fit. Locked InvestIQ Core Seven/contextual methodology is not the legacy readiness diagnostic; see SCORE-LINEAGE. Hosted score provenance is still unverified.
- **In progress:** integration/CI, deployment and authenticated browser acceptance. Previous workstream live evidence below is historical.
- **Still open:** durable DOCUMENTS bridge into the existing artifact pipeline (fresh authority, atomic job-step/artifact binding, READY/resume semantics); proprietary approved InvestIQ parameters; broader latency/DB/provider measurements and full founder/investor journeys.

## Next owner and first slice

- **Owner:** Codex (from this commit on). The Claude lead has stopped; no Claude worker holds a branch.
- **Recommended first slice:** P0 autonomous workforce, see [`AGENT-EXECUTION-MATRIX.md`](AGENT-EXECUTION-MATRIX.md), plus closing the live-verification gaps in rows C, D and B below.
- **Start:** `git fetch origin && git worktree add ../q-codex -b codex/<slice> origin/build/int-rc`
- **Release lane:** merge to `build/int-rc`, push it to `recovery/2026-09-12-8y2j4w` for CI, apply migrations, then push to `recovery/2026-09-12` to deploy. See `START-HERE.md`.

---

## P0 — Autonomous agent workforce (NOT STARTED as a slice; audited only)

- **Founder requirement:**
  - Agents autonomously research, draft, analyse, create and revise polished documents.
  - Agents coordinate specialists, recover from failures and talk to Lead Q and GPT-Live.
  - They ask only for consequential actions.
  - The document pipeline must be the existing one.
- **State:** CODE OBSERVED only. The detailed audit with file:line references is in [`AGENT-EXECUTION-MATRIX.md`](AGENT-EXECUTION-MATRIX.md).
- **Next action:** follow the "first three slices" in that matrix.
- **Rules:** CLAUDE.md "Q Architecture" (Authority, Tools and models, Write Gate); "Contracts / Events / Side Effects".

---

## Workstream records (Oct 9–11)

### R0 — Sub-second routine Q, preloaded welcome, round trips (W1, K5, K6, S1, S2)

- **Requirement:** routine answers under 1 s; welcome follow-ups with zero extra reads; no redundant fetching.
- **Implemented:**
  - Arrival Context Snapshot `arrival-snapshot.v2`: `GET /v1/q/arrival-snapshot`, `packages/model-gateway/src/q/arrival-answer.ts`, `apps/q-api/src/composition/arrival-snapshot.ts`.
  - Code-composed lanes in `packages/q-specialists/src/fast-lane.ts`: known-entity instant lane, investor discovery, Daily, cards, prepared follow-up.
  - Mandate recall by code: `packages/model-gateway/src/q/own-mandate-answer.ts`.
  - Named lookups skip the arrival skim and the wide reads: `packages/model-gateway/src/q/index.ts`, `decideArrival` and `withoutWideReads`.
  - Round-trip counter: `packages/database/src/round-trips.ts`.
- **Live (2026-10-11):**
  - Qatar identity takes 175–367 ms on the server with 0 model calls.
  - Mandate recall is 2.9–4.5 s client-side from the US (2 FAST_CLASSIFICATION calls remain: skim and reader).
  - The arrival snapshot API takes 0.7–1.1 s client-side.
- **Defects / open:**
  - Generic turns still pay 1–2 FAST_CLASSIFICATION calls (TURN_SKIM plus the turn reader, about 0.8–1.4 s each) before code lanes run for phrases the instant lanes don't catch.
  - DB round trips per request were not re-measured this round.
- **Next action:** measure p50/p95 per lane from q-api logs (`q fast lane`, `q answered … totalMs`). Move more deterministic lanes ahead of the skim. Report round trips with `createRoundTripCounter`.

### R1 — Public person research and discovery (W2, D1)

- **Requirement:** Q researches anyone by itself, and "top three Arab investors that may be interested in this" (by meaning) returns cards, choose, then rehearse.
- **Implemented:**
  - `@capital-q/q-research`: Serper primary, Tavily corroboration, `providers/*`, `application/{person-search,person-lookup,counterpart-discovery}.ts`.
  - Tools `people.find` and `people.discover`: `packages/q-tools/src/tools/find-public-entity.ts`, `discover-counterparts`.
  - The code-level `investorDiscoveryLaneOf` (fast-lane).
  - Region map: `packages/q-research/src/domain/geography.ts`.
- **Live:** "I need the top three Arab investors…", "any Gulf money…", "who in the Middle East might back us? give me 3" and "find me 2 Saudi family offices" all return cards with 0 model calls. A web-found Saudi VC was returned.
- **Defects:**
  1. Web-found people were not saved before `16428c22`, because of a jsonb double-encoding bug, so their cards had no Rehearse. It is fixed, but **not re-verified live**.
  2. Role lines taken from a single search hit can be wrong; for example Tidjane Thiam was given as "with Publicis Groupe".
- **Next action:** live-check that a web-only candidate is saved with `q_runtime.external_persons` rows `RESEARCHED` and that Rehearse opens. Corroborate role lines across two or more hits.

### R2 — Qatar Five prepared research depth (A)

- **Requirement:** rich sourced follow-ups under 1 s, honest source status, no invented quotes.
- **Implemented:**
  - Source status columns, enrichment and upserts: migration `20261222110000`.
  - Seed: `scripts/seed/research/qatar-five.v1.json`.
  - `packages/q-research/src/application/prepared-follow-up.ts`.
  - The prepared follow-up lane: `lastShownEntityId` in fast-lane, wired in `answer.ts`.
- **Source coverage (read / listed):** Shadi 5/6 (LinkedIn profile blocked), QInvest 2/6 (qinvest.com has a TLS/503 problem), Muhannad 5/6, Invest Qatar 5/5, AlRayan 5/5. Quotes are verbatim from read excerpts only.
- **Live:** 8 asks (identity plus follow-ups: said about founders, what Invest Qatar does, pitching AlRayan, Shadi's likely questions, QInvest priorities) took about 1.7–4.0 s client-side with **0 model calls**. Logs show `lane="PREPARED_FOLLOW_UP" modelCalls=0`.
- **Open:**
  - QInvest coverage is thin.
  - The follow-up log line lacks `totalMs`.
- **Next action:** add `totalMs` to the follow-up log. Retry qinvest.com sources when TLS is fixed, through `NEEDS_REFRESH`.

### R3 — External research-informed rehearsals and demo access (W4, R5, B)

- **Requirement:**
  - All five are rehearsable by Kathryn (Spheros) and every seeded demo founder.
  - They are labelled simulations, each with a quirk.
  - No fake relationships.
- **Implemented:**
  - Migration `20261222100000`: unclaimed `network_visible` investor orgs for QInvest, AlRayan and Alchemist Doha, linked via `external_persons.investor_organisation_id`.
  - Migration `20261222120000`: the `q_runtime.demo_rehearsal_access` entitlement and `grant_demo_rehearsal_access()`.
  - Scenarios and quirks: `apps/q-api/src/composition/external-scenarios.ts` and `external-persona.ts`.
  - Rehearsals home "Researched rehearsals": `apps/web/src/features/rehearsal/rehearsals-home.tsx`.
- **Live:** `scripts/handoff/live/rehearsal-matrix.mjs` → **120/120 PASS** (24 founders × 5 entities, Kathryn included). Every lobby shows "Ready to rehearse" and the persona endpoint returns 200.
- **NOT live-verified:** a spoken rehearsal session with each persona, and first-audio latency. Both need a human on audio.
- **Next action:** run one spoken session per persona. Record first-audio ms and that each quirk shows.

### R4 — Meeting host waiting behaviour and scheduling approvals (C)

- **Requirement:**
  - Never leave on absence or silence.
  - Obey "wait".
  - Investors give final approval of meeting times.
- **Root cause fixed:** in `packages/communication/src/meeting-host/host.ts` the old code treated any utterance after "shall I reschedule?" (around line 1134) and two minutes of silence (around line 1275) as consent.
- **Implemented:**
  - KEEP_WAITING handling.
  - `MEETING_WAIT_MAX_MINUTES` (default 20).
  - Per-utterance diagnostics.
  - Conversational budgets, documented in `docs/specs/2026-10/meet-host.md`.
  - Proposal state machine in `packages/communication/src/schedule/proposal.ts` and `proposal-postgres.ts`, migration `20261222130000`.
  - Routes `/v1/relationships/:id/meeting-proposals[/review|/:pid/accept|decline|counter]`.
- **Live:**
  - founder propose → `INVESTOR_REVIEW` (201);
  - founder self-accept → **403**;
  - investor counter → `COUNTERPROPOSED`;
  - founder decline → `DECLINED`.

  Before fix `16428c22` every proposal returned 500, because jsonb was bound with `JSON.stringify()::jsonb`.

- **NOT live-verified:**
  - Investor accept → `CONFIRMED` plus booking (it creates a real calendar event and Recall bot).
  - One-party waiting in a real Google Meet.
- **Next action:** run the one-party test script in R5 below. Run accept → CONFIRMED with a test pair, then cancel the booked meeting.
- **Open decision:** in `createPostgresProposalParties`, any active member can bind their side. Narrowing that is a one-line change.

### R5 — Meeting Q intelligence, context and memory (D)

- **Requirement:**
  - Full Q in meetings.
  - Layered context with no cross-party leakage.
  - An append-only meeting record.
  - A post-call summary.
  - Proposals by voice.
- **Implemented:**
  - Meeting context snapshot layers.
  - The `MEETING_HOST_TURN` v5 prompt.
  - Code answers for "can you hear me", corrections, quiet/resume, "where are we", agenda, company, mandate and deck.
  - `communication.meeting_events`: migration `20261222140000`.
  - Five `schedule.proposal.*` app actions, with routes and Q tools.
  - Files: `apps/q-api/src/composition/meeting-host-runtime.ts`, `meeting-host-brain` (tests in `apps/q-api/test/meeting-host-brain.test.ts`), `packages/app-actions` (schedule-proposals).
- **Live:** **NOT VERIFIED.** Needs two humans in a booked Google Meet with a Recall bot.
- **Known gaps:**
  - Meeting turns go through the model gateway with MEETING_HOST_TURN v5, not the run-bound Q answer path.
  - The follow-ups table is not surfaced in the notes UI.
  - The in-memory summary resets on restart.
  - Relationship history is not in the snapshot.
  - Whether the mandate headline counts as shared is an assumption to confirm.
- **Live test script:**
  - **One-party:**
    1. Book a meeting through Capital Q and join as the founder alone.
    2. "Q, can you hear me?"
    3. "Q, wait for them" / "let's give them a few more minutes". Q stays.
    4. Ask an ordinary business question. Q answers.
    5. Stay silent until the cap. Q explains why it is leaving and the booking is intact.
  - **Two-party:**
    1. The investor joins late. Q greets and introduces them.
    2. "Q, what's the agenda?" / "what is the mandate?" are answered without private facts.
    3. Founder: "Let's do Tuesday 3pm". Status is pending, not confirmed.
    4. Investor: "Tuesday 3pm works, confirmed." Pending clears.
    5. "Q, hold on, that's not what I meant."
    6. End the call and check `communication.meeting_events` for SUMMARY and FOLLOW_UP rows.
  - Check the `meeting host utterance` log lines (received, transcribed, attributed, interpreted, answered) for each.

### R6 — Q Daily quiet-day welcome and exact-story navigation (E)

- **Requirement:**
  - The quiet day mentions real, relevant, dated stories.
  - Gist and open-the-exact-story run in under 1 s.
  - The voice session stays connected.
- **Implemented:**
  - `arrival-snapshot.v2` `daily[]`: `apps/q-api/src/composition/arrival-daily.ts`.
  - Wording: `packages/q-core/src/speech/daily-news.ts`.
  - `packages/model-gateway/src/q/daily-follow-up.ts`, with fuzzy referent, ordinals, gist-of-one, and open-the-story-just-summarised.
  - `dailyLaneOf` in fast-lane.
  - The `DAILY_EDITION` page intent with `#story-`/`#section-` anchors.
  - Web `DailyPrefetch` and `DailyAnchorFocus`.
- **Live:**
  - "Give me the gist" → "the other one" → "take me to the story": all three with **0 model calls**, opening `/daily/<edition>#story-<id>`.
  - A direct browser load of that URL puts the story in view.
- **NOT live-verified:**
  - The quiet-day welcome in a browser. All onboarded demo founders have items waiting; `founder.onboard*` accounts are mid-onboarding.
  - In-app router navigation from Q to the anchor during a live voice session.
- **Defect:** the newest Q Daily editions are dated **2026-10-05**, six days old at snapshot. Check the daily edition pipeline in workers.
- **Next action:** create or choose a quiet onboarded demo founder and browser-test the welcome. Check edition generation in `apps/workers`.

### R7 — Clear and restore Q cards (F)

- **Implemented:**
  - Controller `apps/web/src/features/q/cards/card-visibility-store.ts` (no React; server-safe), with hooks in `card-visibility.ts`.
  - `cardsLaneOf` / `cards-request.ts`.
  - The `CARDS` UI intent.
  - Click controls `cards-controls.tsx`.
  - e2e spec `apps/web/e2e/clear-cards.spec.ts`. Not run; its selectors are unverified.
- **Live (browser):** 6 Needs You cards cleared in **68 ms** and restored in **77 ms**, with no approve, decline, delete or message request.
- **Open:** "bring back the TensorGate card" (restore by name) is unit-tested, not live-tested.

### R8 — Deck, tabs and sub-tabs from anywhere (N2) and voice navigation (P7)

- **Implemented:**
  - The `COMPANY_DECK` intent with `tab`, `subTab` and `viewer`.
  - `packages/q-specialists/src/{tab-request,deck-speech}.ts`.
  - The `lastOpenedScreen` fallback.
  - Self-correction "no wait": `packages/q-specialists/src/page-request.ts`.
  - Pointer words ("that section") are not page names.
- **Live:**
  - "Open Tensorgate's pitch deck" opens the deck and Q reads the summary, with no analyst model call.
  - "Open their team tab" goes to `COMPANY_TEAM`.
  - The resolver `/v1/q/navigation/resolve` takes 0 ms p50 / 2 ms p95 on the server, with about 170 ms RTT from a US sandbox.
- **NOT live-verified:** a GPT-Live voice session in a browser with browser-confirmed route receipts.
- **Next action:** a Playwright run with the live voice session active, measuring final intent → route committed.

### R9 — Premium gold, themes and verified badge (G)

- **Implemented:**
  - `PublicBrandStyle` on landing, `/auth/*`, `/g/*`, `/u/*` and onboarding.
  - `landing.css` uses tokens.
  - `ThemeToggle` signed-out, persisted in `localStorage["cq.theme"]` with the pre-paint boot script.
  - `VerifiedBadge` (`apps/web/src/components/verified-badge.tsx`), rendered only for `VERIFIED`.
  - New `--cq-gold-*` tokens.
- **Live:** landing, sign-in and sign-up in light/dark/system on desktop and mobile, all gold. System follows the device.
- **NOT live-verified:**
  - The badge on a real verified account.
  - The GateQ public page with a real `/g/<id>` (a local harness screenshot only).
  - Contrast ratio not computed.

### R10 — Card layout overlap (tablet)

- **Fixed:** room side columns now start at `xl` (1280 px) in `apps/web/src/features/briefing/arrival-room.tsx`, with `WIDE_QUERY` in `arrival-briefing.tsx` and `arrival-stage.tsx`. They were crushed to about 95 px at 1024 px. Live-verified at 1024 px.

---

## Backlog of founder requirements → verified status

| Requirement                                     | Status at `b021d53b`                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sub-second routine interactions                 | Partial: code lanes have 0 model calls; generic turns still pay a 1–2 call skim/reader |
| Preloaded welcome and attention context         | DEPLOYED; welcome follow-ups LIVE VERIFIED (API)                                       |
| No redundant fetching of prepared facts         | DEPLOYED for named lookups, investor discovery, Daily; others pending                  |
| Correct relationship and message history        | Pre-existing (R1/R2 earlier); not re-verified this round                               |
| Voice navigation with confirmed browser results | Resolver LIVE VERIFIED; voice-session browser receipts NOT VERIFIED                    |
| Qatar Five prepared entities                    | LIVE VERIFIED                                                                          |
| Rich sourced research beyond URLs               | LIVE VERIFIED for the five; web-research persistence fix NOT re-verified               |
| External research-informed rehearsals           | Pages and persona LIVE VERIFIED; spoken session NOT VERIFIED                           |
| Kathryn/Spheros and demo founder access         | LIVE VERIFIED 120/120                                                                  |
| GPT-Live low latency and interruptions          | Earlier work; not re-measured this round                                               |
| Meeting Q context, listening, waiting           | DEPLOYED; NOT live-verified                                                            |
| Investor-final approval of meeting times        | LIVE VERIFIED up to INVESTOR_REVIEW/COUNTER/DECLINE; CONFIRMED path NOT live           |
| Q Daily quiet day and exact story               | Follow-ups LIVE VERIFIED (API); welcome in browser NOT VERIFIED                        |
| Clear and restore cards                         | LIVE VERIFIED (browser)                                                                |
| Gold design and theme parity                    | LIVE VERIFIED for landing/auth; badge and GateQ NOT VERIFIED                           |
| Reliable multi-agent autonomous work            | NOT STARTED as a slice; see the matrix                                                 |
| Document creation, revision, QA and approval    | Pipeline exists; workforce integration missing; see the matrix                         |
| Q-to-agent and agent-to-Q communications        | See the matrix                                                                         |
| End-to-end founder and investor journeys        | NOT VERIFIED end to end                                                                |
| Landing page and PADL promise fulfilment        | See [`PROMISE-COVERAGE.md`](PROMISE-COVERAGE.md)                                       |
