# Performance baseline and measured first improvements

## October 13 16:50 UTC — sprint close: production 5ce3d76b, full investor journey PASS

Same fictional investor and browser journey; single observations, not p50/p95. First 20 rendered characters / first card / settled:

| Turn             | Baseline cfc694b3                          | Final 5ce3d76b               | Result                              |
| ---------------- | ------------------------------------------ | ---------------------------- | ----------------------------------- |
| Top three        | 3,500 / 3,802 / 3,969 ms                   | **3,025 / 3,146 / 3,401 ms** | 3 exact cards                       |
| Selected profile | 5,984 / – / 24,974 ms                      | **5,493 / – / 14,199 ms**    | 7 findings (baseline 5)             |
| Risks follow-up  | 15,095 / – / 29,825 ms, 0 findings, FAILED | **4,817 / – / 13,884 ms**    | 8 findings                          |
| Comparison       | not reached                                | 14,171 / – / 30,828 ms       | rendered table, exact two companies |

- Between the two runs after #59/#61 (16:15 and 16:50 UTC), comparison first text varied from 7.9 s to 14.2 s; treat it as unstable.
- Model work (ledger, run after #59/#61):
  - profile: one answer call, 21.5 → 12.3 s, 2,104 → 1,206 output tokens;
  - risks: answer calls 3 → 1, and no turn-reader refusals.
- Outstanding measured items are in STATE.md (tool overhead, comparison generation, first-call cache, reader fallback, first audio).

## October 13 16:15 UTC — after PR #59/#61 (production c2f08536), same journey

Same fictional investor, same browser journey, one observation each (not p50/p95). First 20 rendered characters / settled:

| Turn             | Before (cfc694b3)  | After (c2f08536)      | Answer model calls                              | Answer output tokens | Findings                                                               |
| ---------------- | ------------------ | --------------------- | ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Top three        | 3,500 / 3,969 ms   | 3,654 / 4,061 ms      | 0 (code)                                        | –                    | 3 cards                                                                |
| Selected profile | 5,984 / 24,974 ms  | **5,035 / 15,536 ms** | 1 → 1 (21.5 s → **12.3 s**)                     | 2,104 → **1,206**    | 5 → **8**                                                              |
| Risks follow-up  | 15,095 / 29,825 ms | **4,630 / 17,324 ms** | 3 → **1** (14.4 s; 26k/38.5k cached)            | 1,628 → 1,529        | 0 (FAILED) → **10**                                                    |
| Comparison       | not reached        | 7,937 / 27,155 ms     | 2 (tool round 2.7 s + 20.9 s, 39k/40.8k cached) | 2,280                | 10; two canonical cards; table NOT rendered (uneven measures) → PR #62 |

- The turn reader made no refusal or timeout retries this run.
- The remaining dominant cost is answer output length (about 100 tokens/s). Unfocused own-records questions still offer 96 tools.
- Cost per profile answer: $0.0102 before (from the ledger); the after cost is not separately computed.

## October 13 15:00 UTC — Claude takeover baseline before PR #59 (production cfc694b3)

Single authenticated browser journey, fictional investor; private receipt in the newest `/tmp/cq-investor-demo-*`. First 20 rendered characters / settled:

| Turn             | First text |   Settled | Model calls (ledger)                                                                                                                               | Result                                              |
| ---------------- | ---------: | --------: | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Top three        |   3,500 ms |  3,969 ms | reader 1.2 s; code fit sweep, no answer model                                                                                                      | 3 cards                                             |
| Selected profile |   5,984 ms | 24,974 ms | reader 1.1 s; one NORMAL_DIALOGUE 21.5 s, 38,227 in / 0 cached / 2,104 out                                                                         | 5 findings                                          |
| Risks follow-up  |  15,095 ms | 29,825 ms | reader 2.5 s TIMEOUT + 3.3 s root-key refusal + 1.7 s; 2 tool rounds 2.3 + 2.9 s (cached 26k/39k); answer 15.8 s, 17,542 in / 0 cached / 1,628 out | **0 findings (points in companyFindings) → FAILED** |

Single observations, not p50/p95. The profile turn's 21 s is generation-bound (about 100 output tokens/s). The risks turn loses about 6 s before the answer starts.

## October13 v25 full authenticated investor browser acceptance

Production592b32ff, private receipt `/tmp/cq-investor-demo-1Tc4Lv`, full journey PASS. Individual observations: ranking first20 rendered characters4342ms/total5118ms; selected profile5571/26112 with seven native findings; risks4586/18920 with six native findings; comparison8244/34002 with exact two canonical companies. Native findings and company binding are verified from the current rendered answer. These are single observations of a text threshold, not semantic first useful content, first audio, p50/p95 or causal improvement. V24 zero-findings failure remains a failed product gate; this release corrects it without relaxing validation.

## October 13 deployed product browser sample and scoped model diagnostics

Deployed `f3fe5520`, existing authorized fictional investor, TLS verification enabled. Corrected harness matches current run/message/full visible answer and exact canonical cards/company paths. The complete investor journey passed. Individual observations:

| Turn                   | First 20 rendered characters | Settled total | Scope                                             |
| ---------------------- | ---------------------------: | ------------: | ------------------------------------------------- |
| Top three              |                     3,336 ms |      3,735 ms | Three exact current cards                         |
| Selected company       |                     4,513 ms |     54,112 ms | Full answer and all company references bound      |
| Risks follow-up        |                     7,932 ms |     27,756 ms | Same selected company                             |
| Two-company comparison |                     2,415 ms |      2,619 ms | Exact two companies and rendered comparison table |

These thresholds are visible text, not semantic first-useful-content or p95. No paired before/after speed claim. Scoped `ai_ops.model_usage` shows selected-company FAST_CLASSIFICATION 812 ms, three NORMAL_DIALOGUE calls totalling 50,532 ms, and STRUCTURED_EXTRACTION 2,010 ms. These are call sums, not mutually exclusive wall-clock phases. Normal-dialogue cached input was 0/88,660; the subsequent risks turn had 69,046/93,873 cached input tokens. No general cache-share claim from these samples.

Exact earliest-call logs identify strict schema refusal of invented root `followUps` (19,017 ms call), without truncation. A later 15,310 ms successful tool-model call was refused by text acceptance; bounded diagnostics included malformed company-finding fields. Those diagnostics alone do not explain its complete refusal. Final 16,205 ms model call completed the answer. Strict validation and safe invalid-item DROP remain unchanged. A separate versioned COMPANY_ANALYST v23 guidance correction is being gated, with actual after-release refusal/timing checks still pending.

Private receipts remain outside Git: `/tmp/cq-investor-demo-eeG3eg`, `/tmp/cq-browser-model-phase-summary.json` and `/tmp/cq-profile-schema-diagnostics-early.json`. Work Open exact memo v2 and stored workforce deliverables separately passed; full media/cutoff evidence is not inferred from these text/API checks.

## October 13 connected-memory live baseline (before PR #38 deployment)

Production revision `1165b92e3869832aedb4b54c63e5bf4cbd00bfd6`; existing authorized fictional investor, two fresh internal Q conversations. No contact, approval, account creation or paid audiovisual session. These are single observations, not p50/p95 or a causal speedup.

| Question                                                                       | API first nonempty persisted Q text (ms) | Completed run (ms) | Product observation                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------: | -----------------: | ---------------------------------------------------------------------------------------------------------------------------- |
| Which memos were revised, reviewer findings and remaining decisions            |                                   19,712 |             19,730 | Genuine Ledgerfold review/memo and missing-evidence discussion recalled.                                                     |
| Recently discussed companies, mandate fit, agent findings and unresolved risks |                                    2,763 |              3,635 | Answer mentioned Ledgerfold and the mandate; no memo, reviewer or unresolved-risk discussion. Not full multi-hop acceptance. |

Times include network/authentication and creation. First text is an upper bound observed through 500ms GET polling, not browser paint, semantic useful-content verification or first audio. Private receipts: `/tmp/cq-memory-live-sEqz6I`. Repeat exactly after the memory release before claiming improvement. A corrected SSE collector records `q.message.delta.data.text` separately; do not compare that metric directly with the earlier polling bound.

Code-observed PR #38 memory defects: graph rendering clipped diligence questions at 140 characters, although all five questions in the inspected actual owned job were 147–164 characters and canonical questions allow 180. It also inferred a current pending approval from a historical action ID. The follow-up patch keeps up to 180 characters and says the questions were filed for approval with current status unchecked. It preserves the bounded read-only graph and does not add another approval or memory truth. It also retains complete evidence lines when repeated jobs make one company exceed the 2,000-character context budget; the original renderer discarded that whole company. Live deployment/acceptance of this follow-up remains pending.

The production compound mandate question followed the deterministic fit-card early return: it made no dialogue synthesis call and omitted the requested work and risk analysis. The follow-up keeps the existing authorized fit reads but sends questions mentioning history, agent work, reviewers or risks through the existing answer synthesis. Pure ranking questions retain their deterministic fast path.

Reproduction: `CQ_PUBLIC_JSON=<public-config file> CQ_SESSION_FILE=<existing fictional investor session> CQ_BENCH_REVISION=<verified deployed SHA> NODE_USE_ENV_PROXY=1 node scripts/handoff/live/memory-recall-benchmark.mjs`. The runner reports polling and SSE timing separately; it never approves or sends anything.

A second baseline with the corrected stream collector, on the same production revision and exact prompts, recorded review/diligence first nonempty streamed text 6,663ms, persisted text 22,606ms and completion 22,607ms; compound mandate emitted no message deltas and completed with the same 418-character fit-only answer in 2,591ms. These are separate stochastic samples, not repeatable speed claims. Private receipts: `/tmp/cq-memory-live-bon622`. The runner additionally records a 20-character threshold on subsequent runs; earlier stream numbers establish only the first nonempty delta, not semantic usefulness.

Real-record replay of the graph overflow: the existing authenticated investor's API returned five owned jobs and four authorized documents. An owner-fenced canonical queue read joined matching job/queue tenant and user IDs and restricted IDs to the authenticated API results. Feeding those actual records into the existing graph produced one company's 3,608-character history. Original rendering retained only 257 characters, with no memo or reviewer; patched rendering retained 1,875 characters including both, within the unchanged 2,000-character budget. This is an offline replay of actual authorized records, not a synthetic fixture or deployed conversational acceptance. Private evidence: `/tmp/cq-owned-memory-gkXD9o`.

LOCAL TESTED follow-up: 52package builds successful; 98tests passed across graph recall, fit sweep and answer-tool integration. Before the graph fixes, the 2 new question/status regressions failed; removing the compound guard made the compound integration regression fail while the pure-fit control passed. Root types are deferred to release-owner coordination while other workers use the heavy typecheck slots. CI, deployment and live verification of the follow-up remain pending.

Scoped recorded model phases before release: review/diligence classification 801ms, dialogue 15,071ms, extraction 2,435ms ($0.006439 total ledger cost); compound mandate classification 792ms and extraction 2,195ms ($0.001377), no dialogue. Summed model durations are not a sequential critical-path measurement.

## Latest live browser acceptance — 2026-10-11 21:28 UTC

Exact deployed application `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`, all four Railway services SUCCESS; CI `38173610861` quality + pgTAP SUCCESS (manual e2e SKIPPED). Full tracked cold investor rehearsal PASS, including known authorized founder profile/follow-up.

| Phase                             | First 20 rendered characters (ms) | First rendered card (ms) | Client completion (ms) | Evidence                                              |
| --------------------------------- | --------------------------------- | ------------------------ | ---------------------- | ----------------------------------------------------- |
| Top three                         | 3,212                             | 3,565                    | 3,641                  | Three canonical/rendered cards + Open controls        |
| Selected-company explanation      | 3,656                             | none                     | 16,327                 | Six correctly bound findings, one reference           |
| Risk/evidence follow-up           | 6,927                             | none                     | 18,949                 | Ten correctly bound findings, one reference           |
| Exact two-company comparison      | 3,550                             | 3,550                    | 3,820                  | Exactly two requested canonical/rendered cards        |
| Authorized known founder question | 7,606                             | none                     | 15,462                 | Three bound findings, one reference, no PUBLIC_SOURCE |
| Known founder profile follow-up   | 3,654                             | none                     | 10,489                 | Four bound findings, one reference                    |

Previous warm selected explanation on `9261cdc4`: 8,341 ms first 20 characters, 18,978 ms completion, four unbound findings/no reference (failed acceptance). Its model usage: classification 798 ms; lookup selection 1,798 + 2,036 = 3,834 ms; generation 11,908 ms. Latest selected explanation: classification 675 ms; one generation 13,593 ms, no lookup-selection rounds; extraction 2,448 ms completes 2,647 ms after the answer. Do not claim a causal or repeatable speedup from a binding-only patch: unnecessary planning is intermittent, and these are one observation each. Known-card baseline remains 8,661/20,189 ms with two selection calls totaling 3,792 ms.

Cold first Discover attempt began with the SSR Ask Q button disabled/unbound and completed from its first click after actual enablement; no warm-only wait or second-click workaround. The runner's current-question MutationObserver captures a literal 20-character threshold and newly rendered card nodes; it waits for the current answer to settle. Text thresholds are not a semantic first-useful-content measurement, p95 or first audio. Voice remains cloud-transport BLOCKED; full paid session creation does not prove PCM playback.

Reproduce with the exact full-browser command at the top of STATE and `scripts/handoff/live/investor-demo-rehearsal.mjs`. Private receipts `/tmp/cq-investor-demo-8kF6hc`, metadata log `/tmp/cq-demo-readiness-live.log`, scoped usage `/tmp/cq-selected-company-model-latency-after.log`; never commit raw receipts/screenshots. Next measured optimization: known canonical company lookups using existing fresh authorized tool reads; retain exact-name/ambiguity/firewall checks and repeat before/after samples.

## Earlier measurements (historical)

2026-10-11, source baseline `e40b1d0`; hosted baseline `b021d53b` freshly
verified through Railway. Measurements below are separate from historical
voice benchmarks in STATE. No production speedup is claimed before deployment.

| Path                              | Evidence                                                                               | Result / scope                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated arrival snapshot    | Five sequential GETs to `/v1/q/arrival-snapshot`, Kathryn's existing account, cloud VM | 1,201, 388, 297, 304, 268 ms; all HTTP 200. Median 304 ms, maximum 1,201 ms. Includes network, authentication and body download. Five requests cannot establish a reliable p95.                        |
| Workforce claim scheduling before | New deferred-job regression executed against the original runner                       | Failed after its 1-second assertion window: second claimed job never started while first was held. Its lease was already running without its heartbeat.                                                |
| Workforce claim scheduling after  | Same regression against bounded concurrent runner; durable/job/authorization suites    | Second job starts and completes while first remains held; third stays queued; pass waits for both. 14 tests passed. Sequential steps and owner checks retained. No live queue benchmark yet.           |
| Presentation assembly             | Existing authorized relationship tool output projected into existing TIMELINE          | No added provider call or DB read. Strict output validation, one counterpart, at most 64 source milestones and 20 rendered events. This is a structural I/O observation, not a measured latency claim. |
| Chart correctness                 | New DOM regression run before and after                                                | Before: August value shown under July; after: category-aligned values, unknown cells and broken line across missing periods. Conflicting orders preserve original figures without a misleading plot.   |

Additional authenticated baseline: navigation `Open documents` returned NAVIGATE
five times in 500, 476, 283, 358, 338 ms (median 358 ms); `Open relationships`
returned NAVIGATE five times in 286, 274, 275, 279, 301 ms (median 279 ms).
These timings include network/auth and are not first-audio timing.
The founder browser reached Home, Documents and Relationships, then opened the
existing generated investor deck and rendered a slide in its viewer. This is a
bounded journey check, not complete founder/investor acceptance.

The subsequent own-mandate slice reuses the canonical authorized mandate read
and code answer before TURN_SKIM and turn-reader classification. Three plain
recall variants now make zero calls to both classifier seams under the same
actor/plan/run; 43 mandate/sequence/core regressions passed. Ambiguity, actions,
updates, scoring, absent/other-org scope, onboarding, speculation and durable
active sequences retain normal routing. This is a demonstrated provider-call
reduction in deterministic integration tests; live investor latency is pending.

Reproduce locally after package build:

```sh
pnpm exec vitest run --maxWorkers=2 apps/q-api/test/workforce-durable.test.ts apps/q-api/test/workforce-job.test.ts apps/q-api/test/workforce-ports-guard.test.ts
pnpm exec vitest run --maxWorkers=2 apps/web/test/chart-alignment.test.tsx packages/model-gateway/test/q-result-visuals.test.ts
```

Keep measuring the existing lanes separately: deterministic navigation,
prepared identity/mandate/research, company analysis, relationship actions,
document generation and GPT-Live first audio. Use correlation-bound model
usage and the existing round-trip counter. A health response, unit-test
duration or five arrival reads does not prove the requested end-to-end targets.

Remaining measured work: wider live p50/p95 samples, first-audio timing,
authenticated founder/investor journeys, provider-call counts and DB round trips.
The full local Supabase stack remains blocked by the 32 GB/vfs image expansion;
CI's existing pgTAP job is the database release gate.

Authenticated investor baseline on `b021d53b`: three isolated own-mandate
questions completed in 7,571 / 2,493 / 2,442 ms, with real Q message text
verified. Usage rows scoped by Q-run/user recorded FAST_CLASSIFICATION in every
run (906 / 710 / 708 ms); the middle run also recorded STRUCTURED_EXTRACTION
(1,788 ms). Earlier samples were 3,588 / 2,301 / 2,841 ms with one classification
row each. Client timings include start/poll/network overhead; rows scoped this
way may omit other correlations. These small samples are not a p95 estimate.
Post-deployment measurement must distinguish removal of classifier calls from
end-to-end latency and any remaining model calls.

Post-deployment `ab962576` mandate samples: 3,402 / 2,471 / 2,804 ms client
completion, with FAST_CLASSIFICATION 756 / 756 / 841 ms respectively. Real
answers were present, but classifier removal did not occur. The live actor's
identity organisation ID differs from the core investor organisation ID; the
early guard incorrectly compared them. Distinct-ID regression reproduces the
failure; the corrected scope-binding guard awaits release. These samples do
not establish a speedup or p95. Next samples must record first useful text as
well as completion, and separately verify usage rows.

## Live comparison at efcf49ab — 2026-10-11 17:35 UTC

Authenticated isolated SSE requests used the same existing investor and “What is my mandate?”; first useful answer text is the first assembled answer with at least 20 characters, excluding stage/heartbeat events. Original private receipts were preserved. All runs completed with actual mandate answers.

| Revision        | First useful text (ms) | Completion (ms)       |
| --------------- | ---------------------- | --------------------- |
| Before ab962576 | 2,742 / 2,098 / 1,895  | 2,830 / 2,163 / 1,946 |
| After efcf49ab  | 2,447 / 840 / 892      | 2,522 / 887 / 941     |

Median first text improved 2,098→892 ms (57.5%); median completion 2,163→941 ms. Three samples each are not a p95 estimate or a controlled load benchmark; include network/authentication and the first request after release.

After-release actor-scoped usage shows zero FAST_CLASSIFICATION calls. One STRUCTURED_EXTRACTION usage row per run remains (2,794 / 1,724 / 1,497 ms), recorded 2,954 / 1,852 / 1,603 ms after run completion. Do not sum these into elapsed answer time or claim that all model work disappeared.

Initial autonomous document acceptance: one private approved OWN_COMPANY ONE_PAGER, observed PREPARING/version zero with DOCUMENTS RUNNING, then DONE only after real READY/version one. Viewer renders and canonical export is a one-page A4 PDF (200, application/pdf, valid PDF header). This measures readiness/correctness, not final intelligent writing quality. Existing report revision reached actual version two in 21,961 ms, but workforce one-pager revision failed in 11,906 ms and stayed version one because runtime dropped its screen artifact reference. That loss is reproduced/corrected locally; release/retry required.

Actual UI voice testing with a meaningful synthetic spoken WAV also opened provider sessions but produced no observed PCM/playing event. First audio remains UNVERIFIED. No provider latency or voice success is inferred from session creation.

## Live continuation at ab962576 — 2026-10-11 15:36 UTC

- Investor Discover initially returned RECOMMENDATIONS_REFRESHING, then 20
  cards; pagination exposed 42 distinct authorized records. Canonical fit
  top-three returned three (1,458 ms client); Q's same top-three request
  returned one (first text 2,911 ms, terminal 3,399 ms). Scoped usage recorded
  classification 978 ms and extraction 1,492 ms.
- The Q candidate sweep requested ten rich profiles even for top-three.
  Reconstructing its envelope from actual authorized top-ten profiles and
  feed-disclosed raise views exceeded the unchanged 32,000-character tool
  limit (32,894 characters before full guidance). No matching Railway trace
  was available, so the observed oversized envelope is not claimed as a
  captured tool-failure trace. The regression models that failure and fails
  against the original sweep. The correction asks the existing domain for
  the requested count when no place filter requires a wider window; the
  domain still ranks all candidates. Geographic filters retain their window.
- A named company/mandate analysis took 23,835 ms to first text and 23,836 ms
  terminal. Scoped usage: classification 763 ms, three dialogue calls
  3,738 / 2,119 / 14,661 ms, extraction 1,930 ms. Its run remained about the
  investor organisation, with an INVESTOR_REFERENCE receipt. Correct company
  targeting and evidence require further verification; this is not a passing
  investor interrogation acceptance.
- An existing fictional GPT-Live cohort account passed availability, and the
  canonical SDP broker opened an actual provider session (201, 2,606 ms).
  WebRTC failed to connect from this VM; no data-channel events or audible
  PCM arrived. Session end returned 204. First audio is UNVERIFIED; no cohort,
  budget or flags were changed. This service transport check is not a full
  UI/spoken-voice acceptance.
- Founder private document preparation from the actual company returned a
  READY Q_REPORT version 1 (first useful text 43,686 ms, terminal 44,480 ms).
  The request asked for a one-page summary, but the result was a report and
  public research ran despite the existing-record wording. Do not present
  this as autonomous ONE_PAGER acceptance or a performance improvement.

## Authenticated first-useful-text baseline — 2026-10-11 16:09 UTC

Deployed `ab962576`, same existing fictional investor, three isolated typed
“What is my mandate?” runs through the canonical API and actual SSE. Time starts
before POST; stages/heartbeats are excluded. First useful text is the first
answer content reaching 20 characters; actual mandate answers were checked.
Acceptance: 1,075 / 561 / 560 ms; first text: 2,742 / 2,098 / 1,895 ms;
terminal: 2,830 / 2,163 / 1,946 ms. All three COMPLETED. Scoped usage records
classification 795 / 758 / 719 ms and extraction 2,172 / 2,015 / 1,853 ms.
Usage latency is not summed into client latency: extraction may overlap the
answer or continue after its receipt. These are small samples, not p95. Repeat
this same SSE method after the corrected guard is deployed; preserve baseline
receipts outside the repository. No first-audio success is claimed.

## Large candidate result continuation — 2026-10-11 17:54 UTC

On deployed efcf49ab, the same top-three request now returns three actual cards (10, 10, 8.5), versus one on the baseline. First text 3,065 ms, completion 3,068 ms by polling; this is a count/correctness improvement, not a speedup claim. A new top-ten run still returns one card (first text 2,974 ms). No live tool-failure trace was captured.

The existing tool repeats every parameter explanation in typed profiles and full prose. A local projection of the actual authorized ten-profile comparison and feed-disclosed raise views measures 33,377 chars with duplicated full prose; the unchanged executor ceiling is 32,000. An adaptive canonical summary yields 28,203 chars with all ten profiles, parameter reasons, order and raise views unchanged. No extra read/provider call or ranking/scoring formula is added. Smaller envelopes retain full text; typed envelopes that themselves exceed the limit remain refused. This correction is locally validated and awaits separate exact gates/live top-ten acceptance.

## Live named-company verification — 2026-10-11 19:23 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `e271242e6833d07820c32a8e679f3403ba1ca560`; exact CI `38164882385` quality and pgTAP SUCCESS, manual e2e SKIPPED. No new migration; hosted/local 201/201.
- **LIVE VERIFIED attribution:** three isolated authenticated questions naming an offscreen founder company now each return one correct COMPANY_REFERENCE and three findings whose company subjects all match the requested record. All mention the requested company; no PUBLIC_SOURCE substitution. Authorized declared profile evidence is not private interview disclosure.
- **No latency improvement claim:** first 20 answer characters after: 10,340 / 7,929 / 7,803 ms (median 7,929), versus before 10,395 / 6,454 / 4,389 (median 6,454). Terminal after: 19,597 / 16,969 / 15,607 ms (median 16,969), versus before 33,164 / 16,619 / 12,148 (median 16,619). Threshold timing is not a semantic first-useful-text metric, load percentile or audio measurement.
- **Document verification:** immediate post-arrival Open click failed to produce the viewer within 20 seconds. Retrying with a four-second page readiness pause opens the same existing artifact and renders one body plus all nine canonical gaps under “Evidence gaps.” This suggests a readiness race; it is not a fixed cold-open defect. Earlier PREPARING/version-zero versus real READY/version-row completion evidence remains valid.
- **COMMITTED / CI RUNNING:** dock cards and exact comparison subset `ad4703895d9736ab0c321324888697f59c5c1e5f`, exact CI `38166655996`: pgTAP SUCCESS, quality Test running. Neither is deployed or live verified yet. Preserve this gate.
- **LOCAL TESTED rehearsal runner:** `scripts/handoff/live/investor-demo-rehearsal.mjs` performs the real Discover → three visible canonical cards → Open correct profile → Q explanation → traction/risks/gaps → exactly two visible comparison cards journey. It checks current question/run completion and positive company references; private receipts/screenshots remain in a fresh protected temporary directory. Syntax/lint/format pass; actual execution awaits the dock release.
- **Next:** finish exact CI, deploy only its green SHA, verify all four services, run the actual browser rehearsal and fix any failure. Historical real-record 8.8, first audio, exhaustive source reconciliation and the full PROPOSED quantitative methodology remain incomplete.

## Named-company critical path — 2026-10-11 19:34 UTC

Existing usage ledger, scoped to the three owned after-change runs and their authenticated actor, shows two NORMAL_DIALOGUE tool-selection rounds before the final answer. Those rounds took 2,502+2,023 / 2,441+2,104 / 2,723+1,680 ms (4,403–4,545 ms combined), producing only 25 and 43 tokens. Their server-stage progression matches lookup followed by company review. This is measured model/tool-selection overhead before answer text, not proof that the underlying database query alone is slow.

Final answer generation took 10,437 / 9,746 / 8,704 ms with 1,326 / 1,224 / 1,101 output tokens. First server deltas arrived at 9,167 / 7,481 / 7,306 ms after run-start. Post-answer STRUCTURED_EXTRACTION completed 2,180 / 2,148 / 2,044 ms after the answer; removing it cannot be claimed to reduce these first-text timings. Next latency hypothesis: resolve unambiguous known conversation identities through existing authorized reads before requiring iterative model tool selection. No new latency fix or measured improvement is claimed yet.

## Exact demo release and continued evidence checks — 2026-10-11 20:24 UTC

- **CI GREEN / RELEASE IN PROGRESS:** `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`, exact CI `38169532816`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to the deployment branch. API/workers SUCCESS; web/q-api still building at this checkpoint. No new migration; 201/201. Do not call the selected-company fix live verified yet.
- Reusable browser rehearsal has an optional previously authorized `CQ_DEMO_FOUNDER_RECORD_FILE` phase: return to Discover, ask about that named existing founder company, require positive correctly bound findings/references without public-source substitution, open its authorized profile and check the follow-up. The earlier three mandate-ranked records do not by themselves prove genuine founder evidence. This additional phase is syntax/lint/format checked but awaits actual execution; no new account or outward action.
- **LIVE MEASURED additional latency baseline:** asking about a company already named in the conversation returned six correctly bound findings and one correct reference, zero public sources; first 20 answer characters 8,661 ms, terminal 20,189 ms. Actor/run-scoped usage shows two short model lookup-selection rounds, 1,946+1,846 ms, before 12,394 ms final generation. Next hypothesis is a fresh authorized profile read from an unambiguous canonical ID in durable conversation cards, avoiding model-planned lookup; it is not implemented or claimed faster.
- **BLOCKED voice measurement in this cloud browser:** credential-free Deepgram WebSocket probes fail immediately (13/19 ms); browser error diagnostics identify proxy/tunnel failure. Credential-free HTTPS probes also fail for agent/api.deepgram.com. No voice broker, settings or audio were sent by these probes. This explains the execution-environment transport limit, not a verified production voice defect. First audio remains unverified; no additional paid voice attempt.
- **LOCAL TESTED / PROPOSED ONLY:** offline methodology experiment 0.2 retains the same arithmetic but isolates assessment snapshot identity from investor-view metadata. New invariant fails against 0.1 because fit-only metadata changed the input hash; fixed experiment hashes only method/context/as-of/observations. Ten synthetic scenarios and ten invariants pass; old version/results preserved. Original FSR §16 D/E explicitly leaves exact match/InvestIQ math unresolved; PADL #142 generally calls for qualitative user-facing confidence. Internal uncalibrated percentages are not product certainty claims. No production math integration or calibration completed.
- **Next:** exact four-service readiness, then full authenticated browser journey with the known founder phase; fix any actual failure and update shared evidence. Preserve current release gate and private receipts. Historical real 8.8 and the cold document-open readiness race remain unresolved.

## Selected-company warm-browser measurement — 2026-10-11 20:44 UTC

At deployed `9261cdc4`, the diagnostic warm-only Discover rehearsal rendered three actual cards (terminal 3,202 ms), opened the correct profile, and returned selected-company analysis in 18,978 ms, first 20 rendered answer characters at 8,341 ms. This fixes the prior ten-card misroute but fails attribution acceptance: four findings have no company subjects and no COMPANY_REFERENCE. These are single observations, not semantic first-useful-text, cold opening, audio or p95 measurements. A separate fresh-page probe reproduces the unbound Discover Ask Q button and confirms that a hydrated second click opens the real panel. Both product corrections await exact release and live verification.

## Selected-company critical lookup overhead — 2026-10-11 21:01 UTC

The actor/run-scoped ledger for the warm selected-company explanation on deployed `9261cdc4` contains classification 798 ms; two lookup-selection rounds 1,798 and 2,036 ms; final generation 11,908 ms; structured extraction 2,100 ms finishing 2,219 ms after the answer. Lookup planning consumes 3,834 ms on the critical path despite the existing authorized on-screen profile prefetch. A turn-note correction is only an investigation; no next latency implementation or speedup is claimed. The browser first-20-character 8,341 ms / terminal 18,978 ms observation failed subject/reference acceptance.

The continuation rehearsal now identifies newly rendered Q card DOM nodes and waits for the current answer to settle before disconnecting its observer; existing cards and API-before-render timing no longer force a null card measurement. Syntax/lint pass; actual cold browser execution awaits the exact gated application release. These measurements remain literal rendering thresholds, not semantic usefulness or audio.

## 2026-10-13 — current profile samples around immutable analyst guidance

Before (912e594c, receipt2DSXfQ): selected profile23,133ms total; first20 rendered chars4,946ms; six native findings/exact company bindingsPASS. One NORMAL_DIALOGUE19,957ms,37,656input/0cached tokens, no schema refusal. After (23e3971c, receiptCWCP1L):13,046ms total/3,061ms first20chars; correct reference but zero native findings, full journeyFAILED. One dialogue10,728ms,12,446input/0cached; prepared-context path, no schema diagnostics. Subject identities matched. Different path/context size and failed evidence presentation prevent a speed success claim. v25 must preserve actual native findings before comparing further; no p95 from these samples.

## October 13 human pilot stage receipt and product surface checks

Private read-only provider verbose receipt `/tmp/cq-pilot-verbose-private.json` and owner/purpose/time-scoped model receipt `/tmp/cq-pilot-stage-metadata.json`:

- NORMAL_DIALOGUE eight calls, zero failures, model-stage p50 2582ms/p95 3556ms, sum21139ms. STRUCTURED_EXTRACTION two calls, zero failures, p50 10958ms/p95 11344ms, sum21916ms. These are descriptive quantiles of this single account's rehearsal-purpose calls during the pilot window, not user first-useful-text/first-audio/completion latency or a wider product p95. No paired speedup claim.
- Provider transcription receipt contains timing/duration fields but lacks a verified mapping from those stamps to browser-heard first audio. Do not derive first-audio latency by subtracting adjacent transcript stamps. Human perceived replies3–5seconds. Provider `system.shutdown`11:01:37.562700Z, reasonend_conversation_endpoint_hit, is1923ms after canonical endsAt11:01:35.640Z; DB end confirmation3688ms after. Exact physical180second cutoff from allocation was not proven. Bounded source follow-up removes iframe at canonical deadline and suppresses Q replies completed after deadline; provider duration backstop/timer/sweep remain.
- Authenticated existing investor and founder `/gateq`, `/work`, `/documents`, `/relationships` all200/route-bound/content/no visible load-error. Private receipts `/tmp/cq-investor-demo-dkTx8K` (investor), `/tmp/cq-investor-demo-B1lIOg` (founder). Elapsed checks included reading content and screenshot: investor10908/7143/4244/3201ms, founder9615/11315/7563/3116ms. These are one surface check per role, not first paint/useful-content quantiles or end-to-end application/approval acceptance.
- Source GateQ fixes: failed context remains unavailable rather than becoming founder; failed gateway lookup renders retry rather than “no gate”/creation; independent policy/public gateway/inbox reads for settings run together. Three focused regression testsPASS. Browser checks above precede that release; no deployed performance improvement claimed.
