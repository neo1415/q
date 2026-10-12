# Performance baseline and measured first improvements

## Paired live browser measurement — 2026-10-12 13:04 UTC

Same existing fictional investor, tracked actualbrowser, before5d9837bf and after221ff996(Q API/web stable at measurement; allfourservices verifiedSUCCESS before legion acceptance). BothDiscover/card/profile/explanation/followup/exactcomparison PASS; optional known-founder-record check omitted. One sample per phase, no p50/p95 or causal claim; first20renderedcharacters is an observable threshold, notfirstaudio.

| Phase                | Before first20/completion(ms) | After first20/completion(ms) |
| -------------------- | ----------------------------- | ---------------------------- |
| Topthree             | 2970/3442                     | 3626/4151                    |
| Selected explanation | 9868/23365                    | 2988/16616                   |
| Risks followup       | 17656/30914                   | 7716/23131                   |
| Exactcomparison      | 2432/2846                     | 2738/3087                    |

Owner/tenant/Q-run-bound usage: explanation before two selectors2830+2123ms, final13231ms; after zero selectors, final13949ms and11756inputtokens versus15225before. Risks after stillselectors1768+1984ms even thoughfresh company.get already succeeded32ms; mandatory named-other prompt forcessearch118ms andduplicateread32ms. Focused existing-tracker guard74dd49be has69tests/builds/root/package types/staticPASS, notdeployed. Measured3752ms overhead is a target, notpromised releasedsavings. Postanswerextraction completes later; don'tadd it tocriticalpath.

Realworkforce: firstQtext10051ms; plancard11363ms; approvedjob47408ms. Research15088, Documents3334, Reviewer18532, Diligence4824ms. Original-conversation resultfollowup16726/17397ms fails substantivecontinuity. Firstaudio remainsunverified; HTTPthink-then-TTS runner cannotmeasure livefirstspokenaudio. Privatefullreceipts stayoutsideGit. SeeSTATE for gates,reproduction and exactserviceIDs.

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
