# Performance baseline and measured first improvements

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
