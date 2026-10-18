# 22 — Coverage matrix

What was inspected and what wasn't. Assembled from each investigator's COVERAGE section. The lead's live checks are listed in `21-EXECUTION-TRACES.md`.

| Subsystem                                                    | Report     | Investigator | Depth                                                                                                                        |
| ------------------------------------------------------------ | ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Repository, architecture, deploy, DB schema, live aggregates | 01, 02, 12 | A            | Broad; all package.json files and migrations; aggregate-only live reads                                                      |
| Q brain, prompts, memory/context                             | 03, 05     | B            | answer.ts, gateway index, orchestrator, firewall entry; not: memory learner, routing tables, retrieval SQL, non-typed agents |
| Voice (duplex and standard)                                  | 04         | C            | duplex-line, broker and routes read in full; not: ElevenLabs Speech Engine, onboarding voice, rehearsal                      |
| Work, agents, tools, integrations                            | 07, 08     | D            | Instruction engine, workforce, errands, tool registry; not: LangGraph node bodies, Gmail internals                           |
| Generative UI, UI/UX                                         | 06, 11     | E            | Briefing, Q page, presence stage, result blocks; not: several card bodies, mobile runtime, Lighthouse/axe                    |
| Providers, security, tests, observability                    | 09, 10, 13 | F            | Gateway, routing migrations, auth, firewall logging, CI; not: Groq body, admin authz, data room, webhook verifiers (partial) |

## Tests actually run during the audit

- **C:** 7 files, 131 tests passed (duplex and voice).
- **D:** 81 tests passed; WRITER-step repro.
- **E:** 6 web files, 51 passed.
- **F:** 268 tests, 1 known failure; then 70 files, 1,865 passed.
- **Lead (local Supabase):** pgTAP 130, 800, 886, 889, 890 and 891 passed; the full pgTAP run had 4 stale failures (010, 240, 450, 591).
- **Not run:** builds; e2e; live provider tests; A's suites (sandbox Node 22 vs engines 24).

## A — coverage detail

Inspected:

- Every `package.json` (apps + 52 packages) and `pnpm-lock.yaml` versions.
- `.railway/railway.ts`, `render.yaml` header, `docs/deployment/staging.md` (grep), ADR 0014 (first 60 lines), `docs/handoff/session-handoff-2026-10-08.md` (grep).
- api/q-api route registration across `apps/*/src` (static extraction) and the app-actions registry.
- `apps/web/app` route tree, `proxy.ts`, `src/auth/session.ts`, `cookie-options.ts`, `app/api/q-room/route.ts`, the q-stream proxy route (head).
- api/q-api security modules, `packages/security/src/supabase/access-token-authenticator.ts`.
- `packages/database/src/{client,transaction}.ts`, `packages/eventing/src/publisher/outbox-publisher.ts`, `apps/workers/src/{main.ts (loops), event-registry.ts}`.
- `apps/q-api/src/room/*`, `q-events.ts` (options), `voice/session-token.ts` (head), `voice/bindings.ts` (fields), `voice/turn.ts` (createRun, UNCLEAR, stopRun), `voice/duplex/transcript.ts` (head), q-api `main.ts` scheduler sites, the model-provider block and the voice secret.
- `packages/config/src/*` env names; `packages/observability/src/telemetry.ts`.
- Migrations: schema/table extraction for all 178; read in part: identity foundation and RLS, relationship foundation, voice_line_turns, network matches.
- Live: aggregate counts and catalog metadata only.

Not inspected (left to other investigators or out of scope):

- Q answer quality and prompts content, turn reader, specialists' logic, Context Firewall internals, tool authorization per tool.
- Voice provider adapters' internals beyond selection and persistence, and the web voice UI.
- Webhook verifiers, billing logic, the discovery/ranking pipeline, the document parser sandbox.
- pgTAP test contents; no test suites were run (sandbox Node 22 < engines 24).
- Railway runtime variables and logs (no access attempted).
- `apps/web` feature components beyond auth/proxy/voice selection.

## B — coverage detail

**Inspected:**

- `apps/q-api/src/http/q-runs.ts` and `q-conversations.ts`
- `apps/q-api/src/composition/q-intelligence.ts` (233-556)
- `main.ts` (3700-3830 and 3252-3282)
- `q-orchestrator/src/orchestrator.ts`, `graph.ts`
- `q-specialists/src/answer.ts` (1-500, 637-3390, nearly complete)
- `pending-decision.ts` (outline)
- `model-gateway/src/q/index.ts` (317-1100, 1501-3500, 3640-3830, 4150-4340)
- `model-gateway/src/q/turn-reader.ts`
- `q-core/src/prompts/renderer.ts`, `definition.ts` (240-352), `schemas/common.ts`, charters
- `q-firewall/src/purpose.ts`, `firewall.ts` (620-800)
- `q-tools/src/registry.ts`, `executor.ts`, `tools/relationships.ts` (555-640)
- `profile-change-board.ts` (60-235)
- `q-runtime` postgres message reads, `utterances.ts`
- `contracts/src/q/request.ts`, `failure.ts`

**Not inspected:**

- voice routes and the duplex broker
- the realtime adapter
- the memory learner and extractor
- `references.ts`, `hand-over.ts`, `speculation.ts`, `page-request.ts` bodies
- the company specialist
- the model-gateway policy, providers and usage ledger
- `q-knowledge` retrieval SQL
- the workforce and review loop
- the rehearsal, interview and welcome agents
- `index.ts` 3500-3640 and 3830-4150 (tool-result handling, approval lines, cards)

No tests were run.

## C — coverage detail

Inspected (read implementation): `apps/web/src/features/voice/{session.ts, voice-line.ts, use-voice-session.ts, use-voice-interview.ts, duplex-actions.ts, line-cards.ts, voice-preference.ts}`, `provider/{duplex-line.ts (all), duplex-session.ts, deepgram-session.ts (all), narration-poll.ts, backchannel.ts (rules, detector), pcm-player.ts (head), pcm-schedule.ts (defaults), agent-socket.ts (constants/buffering)}`; `apps/web/src/features/briefing/arrival-briefing.tsx:740-805`; `apps/q-api/src/voice/duplex/{broker.ts (all), routes.ts, routing.ts, instructions.ts, config.ts, transcript.ts, spend.ts, listening.ts}`; `apps/q-api/src/voice/{routes.ts:380-940, think.ts, turn.ts:668-1453 and 1720-2176, turn-timing.ts (head, wrapper), narration.ts, speech.ts (speakable/bounded), utterance.ts, provider.ts, providers/deepgram.ts, providers/elevenlabs-speak.ts (header/constants)}`; `apps/q-api/src/main.ts:5005-5110, 5375-5500`; `packages/model-gateway/src/realtime/{index.ts, openai.ts}`; `packages/contracts/src/q/voice.ts:395-495`; `packages/q-specialists/src/answer.ts:2325-2470`; `packages/q-core/src/prompts/tasks/spoken-reply.v1.ts:19-47`; `packages/api-client/src/{q.ts:255-300, request.ts}`; Next 16.3.4 `app-router-instance.js` action queue.

Tests run: 7 files / 131 tests passed (duplex broker, duplex routes, transcription hint, turn timing, web duplex, duplex fallback, barge-in). One schema probe.

Not inspected: ElevenLabs Speech Engine transport (`elevenlabs-session.ts`, `providers/elevenlabs.ts`, `attach.ts`); interview/onboarding voice (`interview-agent.ts`, `interview-steps.ts`, `onboarding-*.ts`); rehearsal; one-way TTS (`use-q-speech.ts`, `synthesis.ts`); `bindings.ts`; `think-gate.ts`; `turn.ts:1-667`, `1604-1720`; `elevenlabs-speak.ts` stream body; `voice-stage.tsx` rendering; the turn reader prompt v44 body; Q answer correctness ("nothing is waiting"); production env and infrastructure.

## D — coverage detail

**Inspected (read in full or in the relevant sections):**

- `instructions/engine.ts` (all of the firing, `validateStep`, `messageProblem`, `retryHeld`)
- `instructions/triggers.ts`, `store.ts` (claim, notify, awaiting, waitingCards), `ask.ts`, `actions.ts` (grant card), `digest.ts` (`needsYouNotice`), `planner.ts` and `quarantine.ts` (config only)
- `workforce/review.ts`, `models.ts`, `jobs.ts`, `job-actions.ts` (execute), `store.ts` (`ensureJob`, `setJobStatus`), `page.ts` (drafts and outcomes)
- `q-orchestrator` `workforce/*` (all), `work/engine.ts` (head), node lists of lane, outreach and stand-in
- `errands.ts` (overview, runner, reply, post)
- `work/runtime.ts` (head)
- `main.ts` wiring for sweeps, engine, workforce ports, wake listeners, Recall
- `apps/api/src/q-work-port.ts`
- `q-actions` approval TTL, list, expire; `q-runtime` orphaned-runs
- Web: `app/(app)/work/page.tsx`, `work-page.tsx` (composition), `decision-queue.tsx` (head, count, message branch), `decisions.ts`, `held-actions.ts`, `notice-groups.ts`, `workforce-agents.ts` (state derivation)
- `q-tools`: `definition.ts`, `registry.ts` (header and lanes), `default-tools.ts`, `executor.ts` (limits), `app-actions.ts` (generation), metadata of every tool file
- `app-actions` names and classifications; delegation rules
- Prompts: `workforce.v1.ts`, `instructions.v1.ts` (plan v1/v8, reader)
- Integrations composition (research, video, push, Google, SMTP/Brevo, Recall)

**Not inspected:**

- LangGraph node bodies (`lane.ts`, `outreach.ts`, `stand-in.ts`)
- `instructions/material.ts` `checkMessage`; q-core `wooProblem` and `considerOutreach`
- `workforce/learning.ts`, `held-retry.ts` internals; `work/page.ts` beyond the done query
- Most of `workforce-map.tsx` and `workforce-panel.tsx`
- MCP connector internals; Gmail poller and inbound-email internals; data-room actions in depth
- Production DB rows and environment values (none were read; read-only rules)

## E — coverage detail

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

## F — coverage detail

**Inspected in full or substantially:**

- `packages/model-gateway/src/{gateway,catalog}.ts`
- `packages/model-gateway/src/policy/{eligibility,synthetic-demo,cost}.ts`
- `packages/model-gateway/src/providers/openai.ts`; `providers/google.ts` (composition and keys)
- `packages/model-gateway/src/realtime/openai.ts`; `images/config.ts`, `images/index.ts` (usage)
- `packages/model-gateway/src/infrastructure/postgres-usage.ts`
- every `ai_ops` routing migration
- `packages/config/src/model-providers.ts`
- `apps/q-api/src/main.ts:900-1030`
- duplex `config.ts`, `spend.ts`, `transcript.ts`, and `broker.ts` (cap, open, usage, rejoin)
- q-api `authentication.ts` and `actor-context.ts`; the security resolver and authenticator (partial)
- q-firewall `version.ts` and `firewall.ts` (disclosure and logging)
- q-tools `executor.ts`; q-actions approval excerpt
- q-core prompt fencing
- observability `logger.ts`, `telemetry.ts`, `correlation.ts`
- CI workflow; `vitest.config.ts`; the live-model runner
- `.railway/railway.ts`; `render.yaml`; staging docs
- the `voice_line_turns` migration
- webhook auth (Recall, inbound email, meeting host); GateQ apply throttle

**Not inspected:**

- Groq adapter body
- q-research provider internals beyond endpoints
- Cloudflare Stream
- discovery and ranking firewall enforcement
- web server actions
- admin console authorization
- `combination.ts`
- most pgTAP file contents (only 320, 590 routing, 730, 882, 889 read)
- q-evals graders
- problem handler
- data room
