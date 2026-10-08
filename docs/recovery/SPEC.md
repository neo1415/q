# Capital Q recovery: master specification (RECOVERY-2026-10)

Lead-owned. This spec governs the full-system recovery requested by the founder on 2026-10-08. Each workstream writes its own detailed spec and research under `docs/recovery/specs/<X>-*.md` before coding, within the boundaries set here. Progress is tracked in `docs/recovery/TRACKING.md`.

## 0. Baseline (verified 2026-10-08 13:40 UTC)

- **Production.** Railway project `Q`, environment `production`, deploys branch **`recovery/2026-09-12`**. All four services (web, api, q-api, workers) run commit **`520bd123`**. Railway deploys on push, with `checkSuites: false`.
- **Integration branch.** **`recovery/2026-09-12-8y2j4w`** (not deployed). Workstreams push to `build/rec-<letter>`; the lead merges into the integration branch. **No pushes to `recovery/2026-09-12` without the founder's explicit approval.** That branch is production.
- **Other branches.** Older `build/*` branches were checked by content, not patch id, because HEAD's history was rewritten. The files they added exist in HEAD, apart from renumbered migrations, deliberately removed code and docs. HEAD is the baseline. Research docs worth reading are on `origin/build/research`, under `docs/research/2026-10-06/` (`voice-resilience.md`, `agent-workforce.md`, …).
- **Audit.** `capital-q-audit/` (14 = confirmed defects, 16 = failure map). Every defect ID below refers to it.
- **Database.** 178 migrations applied on hosted. The local Supabase stack runs in this VM (docker) for pgTAP.
- **Known failing tests on base.** `answer-turn-reading.test.ts` "hands on a manifest…" (stale list), and pgTAP 010, 240, 450 and 591 (stale assertions). Workstream F fixes them.

## 1. Research basis (summary; details in each workstream spec)

- **OpenAI Realtime server-side controls.**
  - Source: <https://developers.openai.com/api/docs/guides/realtime-server-controls>.
  - The WebRTC SDP answer's `Location` header ends in a call id (`rtc_…`). A server can attach a **sideband WebSocket** at `wss://api.openai.com/v1/realtime?call_id=…` with its API key and receive the session's events. It can update the session and handle tool calls server-side.
  - Assign one owner per function call. Keep keys server-side. Store history collected before attaching.
  - Community reports: the sideband may drop after long silence, so it must reconnect. The sideband doesn't control playback, so the browser must stop audio on barge-in.
  - **Implication:** move turn handling and tool calls from browser-relayed Next.js server actions (serialized per tab; audit C-08) to a q-api sideband, with the browser as audio I/O and UI. Workstream A decides, after a spike, between a sideband and a fixed relay.
- **Interruption** (community and SDK sources). Stop local playback first, then `response.cancel`, then `conversation.item.truncate` with `audio_end_ms` clamped to the audio actually played. Transcripts can overrun playback, so trust played duration only.
- **semantic_vad.** `eagerness` low/medium/high/auto. `create_response` and `interrupt_response` apply in conversation mode. Some reports say `interrupt_response` is unreliable, so keep browser-confirmed barge-in.
- **App control by an LLM.** Use an app-declared registry of typed actions keyed by stable semantic ids (accessibility-grounded); the model picks from candidates generated from the current page. Re-observe after each act. Invalidate ids across screens. Never trust page-declared semantics for authority; authority comes from the server.
- **Durable jobs.** Postgres `FOR UPDATE SKIP LOCKED` claims, plus a lease (`locked_until`), heartbeat and reclaim of expired leases. Optional LISTEN/NOTIFY for latency. Both graphile-worker and pg-boss build on this. Prefer extending the existing outbox/worker pattern over adding a library, unless D's spec shows a library is cheaper.
- **Prompt injection.** Microsoft spotlighting (delimiting, datamarking, encoding). Untrusted content never goes in system or instructions. Sanitize at the tool boundary and keep only needed fields. Trust tiers are enforced by the harness, not the model.

## 2. Workstreams and ownership

Ownership prevents seven incompatible versions of Q. A workstream edits only its own paths. A change needed elsewhere goes to the lead as a request, written in its report; the lead makes or assigns it.

| WS                              | Mission                                                                                                                                                                              | Owns (edit rights)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A: Voice**                    | Realtime voice reliable and natural; standard fallback; every turn terminal                                                                                                          | `apps/web/src/features/voice/**`, `apps/q-api/src/voice/**` (except `voice/navigation.ts`), `packages/model-gateway/src/realtime/**`, `packages/contracts/src/q/voice.ts`, voice prompts in `packages/q-core/src/prompts/**voice*`/`spoken-*`                                                                                                                                                                                                                                                                                                                                                                                              |
| **B: Brain**                    | One coherent brain: intent, references, context, grounding, attention, prompt-injection placement, budgets                                                                           | `packages/q-specialists/**`, `packages/model-gateway/src/q/**` (except the result-block and card files given to E), `packages/q-core/src/prompts/**` (except voice), `packages/q-tools/src/tools/` read tools (`own-*`, `records`, `relationships`, new `attention`), `packages/q-knowledge/**`, `packages/q-orchestrator/src/` (except `workforce/`)                                                                                                                                                                                                                                                                                      |
| **C: App control**              | Universal application control: page registry, UI acts with receipts, navigation, tabs, scroll, documents, forms through app actions, capability parity matrix                        | `apps/web/src/features/q/ui-act-controller.ts`, new `apps/web/src/features/q/control/**`, `apps/web/src/features/q/{client-actions,follow-navigation}.ts`, `apps/q-api/src/voice/navigation.ts`, `packages/q-tools/src/tools/client-actions.ts`, control registrations in page components under `apps/web/app/(app)/**` and `apps/web/src/features/{discover,capital,company,investor,documents,relationships,profile,settings,explore,gateq,schedule}/**` (registration hooks only, no visual redesign), `packages/app-actions/**` (new actions), `apps/q-api/test/route-capability-parity.test.ts`, `docs/recovery/capability-parity.md` |
| **D: Work**                     | Real agent execution: executor registry, durable jobs, approvals that don't deadlock, honest states, Work page truth                                                                 | `apps/q-api/src/composition/{instructions,workforce,errands,work}/**`, `packages/q-orchestrator/src/workforce/**`, `packages/q-actions/**` (expiry and escalation), `apps/web/src/features/work/**`, `apps/api/src/q-work-port.ts`                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E: Rich UI and promises**     | Cards persist beside Q; charts, maps, tables, timelines, investor cards; partial block validation; the arrival experience; promises Q.01–Q.08 delivered                              | `packages/contracts/src/q/result-block.ts` (+ `answer-cards.ts`), `packages/model-gateway/src/q/{result-blocks,answer-cards,card-subjects,fit-cards}.ts`, `apps/web/src/features/q/{q-conversation,q-session,q-presence-stage,q-result-blocks,q-answer,answer-canvas*,room/**}`, `apps/web/src/features/{briefing,home}/**`, readiness and action-plan features (`apps/web/src/features/{readiness,capital}/**` with C for control ids only), `apps/q-api/src/http/readiness-blueprint.ts`                                                                                                                                                 |
| **F: Security and reliability** | Outbox registry, RLS runtime-role investigation and fix plan, CI on the integration branch, readiness probes, spend caps, retention, idempotency, stale tests, error monitoring hook | `apps/workers/**`, `.github/workflows/**`, `packages/eventing/**`, `packages/model-gateway/src/{gateway.ts,policy/**,providers/**}`, `packages/observability/**`, `packages/database/**`, `apps/*/src/app.ts` health routes, `supabase/tests/**`, stale unit tests listed in §0                                                                                                                                                                                                                                                                                                                                                            |
| **G: Verification**             | Independent tests: local full stack, browser e2e of scenarios A–H, voice failure simulations, permission-negative, promise acceptance, a11y, perf measurement                        | `apps/web/e2e/**`, `tests/**` (new top-level harness), `scripts/recovery/**`, `docs/recovery/evidence/**`. No product source edits. Defects go to the lead with reproduction steps                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Migrations.** Each workstream gets a timestamp band and must stay inside it. Lead approval is needed before any hosted apply; none are applied during build.

| WS  | Band             |
| --- | ---------------- |
| D   | `2026122018xxxx` |
| F   | `2026122019xxxx` |
| B   | `2026122020xxxx` |
| E   | `2026122021xxxx` |
| C   | `2026122022xxxx` |
| A   | `2026122023xxxx` |

pgTAP suite numbers: D 892–894, F 895–897, B 898–899, E 900–901, C 902, A 903.

## 3. Shared contracts (lead-owned, in code at the integration baseline)

- `packages/contracts/src/q/turn.ts`:
  - `QTurnDisposition` (ANSWERED, CLARIFIED, ACTED, FAILED, CANCELLED, SUPERSEDED, IGNORED)
  - `QFailureClass` (13 classes)
  - `QTurnId`, `QTurnOutcome`, `QTraceContext`
- `packages/contracts/src/q/ui-act.ts`:
  - `QControlId` (semantic id, e.g. `tab.mandate`, `section.risks`, `list.investors`)
  - `QControlKind`, `QManifestControl`
  - `UI_ACT` intent (`SELECT_TAB`, `SCROLL_TO`, `SCROLL_DOWN/UP/TOP/BOTTOM`, `FOCUS`, `EXPAND`, `COLLAPSE`, `OPEN`, `CLOSE`, `SELECT_ITEM`, `ACTIVATE`, `SET`, `FILTER`, `NEXT`, `PREVIOUS`, `BACK`, `FORWARD`)
  - `QUiActReceipt` (DONE, TARGET_MISSING, NOT_APPLICABLE, FAILED)
  - The manifest gains optional `controls`. `UI_ACT` joins `QClientActionIntent` and `QUiIntent`. The model-facing tool name is `operate_screen`.
- `packages/contracts/src/q/attention.ts`: `QAttentionItem` (10 sources, including UNANSWERED_MESSAGE, AGENT_BLOCKED, DOCUMENT_REQUEST and NEW_MATCHES), `QActivitySummary`, and `QAttentionReport` with **`unread` sources, which are never reported as empty**.
- `packages/contracts/src/q/agent-capability.ts`: `QAgentRole` (8 roles), `QAgentExecutor` (tools, delivers, outward), `QWorkState` (10 durable states).
- `apps/web/src/features/q/ui-act-controller.ts`: the seam. `registerUiControl(id, handler)`, `performUiAct(intent)`, a receipt for every act, and `TARGET_MISSING` when unregistered.

Any change to these files goes through the lead. Add new contracts in your own files and request their export.

## 4. Non-negotiables

These come from CLAUDE.md and the audit, and apply in every workstream:

1. The model selects semantic actions; trusted code resolves, authorizes and executes them. There is no DOM, script, SQL or arbitrary-URL authority for any model.
2. Consequential actions use Prepare → Approve (exact payload) → Execute with an idempotency key. A spoken "yes" binds to exactly the one proposal currently presented. Destructive actions show the exact target and consequence. Archive and delete are distinct.
3. **Every accepted turn reaches a terminal disposition** (§3). Nothing silent unless IGNORED, and IGNORED is shown.
4. **Unknown is not empty.** A source that wasn't read is reported as unread.
5. The Context Firewall runs before any model sees data. Founder-private data never shapes investor-facing output.
6. Untrusted content (web, documents, chat, tool output) is data. It never goes in system or instructions.
7. **Budget is $0 (founder, 2026-10-08).** There are no new keys, accounts or paid services. No billable live AI call happens without the founder's explicit approval; an existing key is not permission. Tests use providers set to `disabled-locally-000000000000`, with fakes for models, WebRTC and realtime. Live provider and real-microphone verification is a written local procedure the founder runs on his own machine with the existing configuration. Every result is labelled MOCK, LOCAL-E2E or LIVE, and nothing is called production-ready without its live check.
8. No fake progress, numbers, investors or success claims. A job is complete only when its deliverable exists.
9. No unrelated redesign. Use semantic tokens. Glow on Q only.

## 5. Acceptance (definition of done)

These map to the brief's sections 8 and 12. Owners in brackets; G verifies them all.

- **Scenario A** (Capital, readiness tab, scroll to risks, "explain the second one") [C, E, B]
- **Scenario B** (Discover, investors, open the second, mandate tab, compare) [C, E, B]
- **Scenario C** (open deck, read financials, inconsistencies, download, delete with confirmation) [C, B]
- **Scenario D** (research 5 investors, drafts, reviewer, approval) [D]
- **Scenario E** (continuous voice across pages, interrupt, correct, continue) [A, C]
- **Scenario F** ("anything that needs my attention": all sources, unread is never "nothing") [B, E]
- **Scenario G** (voice → text → voice continuity) [A, B]
- **Scenario H** (failure simulations: mic, transcript, realtime timeout, relay failure, playback, network, expired approval, worker restart, duplicate event, agent failure) [A, D, F]
- **Promises Q.01–Q.08:** each has a journey, data, backend, UI, text, voice, persistence, authorization, failure and an integration test [E leads; B, D, C contribute]
- **Capability parity matrix:** generated from routes, pages and app actions. Every control is Q-operable or has a stated blocker [C]

Each capability is graded: VERIFIED LIVE / VERIFIED STAGING / VERIFIED LOCALLY / IMPLEMENTED BUT UNVERIFIED / PARTIAL / BLOCKED / NOT IMPLEMENTED. There is no staging environment today; F reports whether one can be created on Railway.

## 6. Process

1. Each workstream writes `docs/recovery/specs/<X>-*.md` (research, design, files, tests, risks), commits it, then implements.
2. Targeted tests only while building. **No full builds in parallel**: use the shared turbo cache, and run eslint on changed files only.
3. Each workstream commits and pushes `build/rec-<x>` after every meaningful step.
4. The lead merges in dependency order: F (CI/events) → B → A → C → D → E → G tests, resolves conflicts, runs full gates, and builds the release candidate.
5. The release candidate is deployed only on the founder's yes. Live verification follows.
