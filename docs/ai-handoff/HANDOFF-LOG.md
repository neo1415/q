# Append-only handoffs between Claude Code, Codex and other engineering agents

Newest entry last. Never edit past entries; correct them in a new entry.

## BOOTSTRAP — 2026-10-11 — context-pack generator (not a coding session)

- Kit installed from `capital-q-cross-model-handoff.zip`. It observed `build/int-rc` = `recovery/2026-09-12` = `eae55760` via public GitHub metadata. That snapshot is superseded by the entry below.

## 2026-10-11 ~13:40 UTC — Claude Code (Opus, final Claude-led session) — handoff to Codex Cloud

- **Workspace:** `/home/user/q-int`, branch `int-rc`, HEAD `b021d53b` before the handoff commit. All 21 `build/*` worker branches from Oct 7–11 are merged. Worktrees are clean. Nothing unpushed apart from this handoff commit (pushed with it).
- **Objective:** transfer engineering leadership to Codex with an accurate repository-native checkpoint. No new architecture was implemented.
- **Code changed in this session (Oct 10–11, all MERGED + CI GREEN + DEPLOYED at `b021d53b`):**
  - Qatar research depth and source status (A).
  - Demo rehearsal access (B).
  - Meeting host waiting and scheduling approvals (C).
  - Meeting intelligence and memory (D).
  - Q Daily quiet day and exact story (E).
  - Clear and restore cards (F).
  - Premium gold, themes and verified badge (G).
  - Investor discovery by meaning (D1).
  - Deck, tabs and sub-tabs (N2).
  - Researched-investor orgs (R5).
  - Navigation self-correction.
  - The Daily lane.
  - jsonb binding fix (`16428c22`).
  - RSC boundary fix (`eae55760`).
  - Tablet layout fix.
- **Handoff docs added:**
  - `AGENTS.md` (root, new).
  - Under `docs/ai-handoff/`: `START-HERE`, `STATE`, `ACTIVE-TASKS`, `DECISIONS`, `HANDOFF-LOG`, `PROMISE-COVERAGE`, `LANDING-PROMISES`, `AGENT-EXECUTION-MATRIX`, `SOURCES`, `PADL-DECISIONS`, `LEGACY-RECONCILIATION`, `SWITCH-GUIDE`.
  - `docs/product-sources/text/*.txt` (extracts; the originals are unchanged).
  - `docs/product-sources/landing-capture-2026-10-11/`.
  - A dated pointer section in `CLAUDE.md`.
- **Proven locally:** before each deploy, package builds, targeted vitest (full suite 11 752 tests green at `a8ef608a`+), the root `tsc`, app `tsc` and eslint on changed files.
- **Proven live (production, `b021d53b` or its parent):**
  - Qatar Five identity + 8 follow-ups with 0 model calls.
  - Rehearsal matrix 120/120 (24 founders × 5, Kathryn included).
  - Clear/restore cards in a browser: 68/77 ms, no business calls.
  - Scheduling: proposed → investor review; founder self-confirm 403; counter; decline.
  - Daily gist / "the other one" / open the exact story with 0 model calls.
  - Gold landing/auth in light/dark/system.
  - Navigation resolver p50 0 ms / p95 2 ms server-side.
- **NOT verified live:**
  - Real one-party and two-party meetings.
  - Spoken rehearsal sessions and first-audio latency.
  - Investor accept → CONFIRMED booking.
  - Quiet-day welcome in a browser.
  - Verified badge on a verified account.
  - The GateQ public page after the restyle.
  - GPT-Live voice navigation with browser receipts.
  - Web-researched person persistence after the jsonb fix.
- **Blocked / needs the founder:**
  - Humans on audio for meeting and rehearsal tests.
  - Approval to create a real confirmed booking.
  - A quiet onboarded demo account.
  - `capital-q-codex-source-pack.zip` (requirement index + proposed agent architecture) was not supplied to Claude.
  - Credentials exposed in chat on 2026-10-11 must be rotated: the Railway token, the Supabase management token and Kathryn's password.
- **Defects to pick up:**
  - Q Daily editions are stale (newest 2026-10-05).
  - qinvest.com TLS (QInvest has 2/6 sources read).
  - Single-hit role lines for web-researched people.
  - Generic turns still pay 1–2 classification calls.
  - In `ProposalParties`, any active member may bind.
  - Meeting follow-ups are not surfaced in the UI.
  - The workforce gaps in `AGENT-EXECUTION-MATRIX.md` §10.
- **Next three executable actions:**
  1. [ ] Workforce slice 1 (truthful roster + failure visibility) from `AGENT-EXECUTION-MATRIX.md` §11, then slice 2 (DOCUMENTS executor over `composition/artifacts.ts`).
  2. [ ] With the founder: run the one-party and two-party live meeting scripts in `ACTIVE-TASKS.md` R5, plus accept → CONFIRMED (R4). Fix what fails.
  3. [ ] Check the Q Daily edition pipeline (`apps/workers`). Create or choose a quiet onboarded demo founder and browser-verify the quiet-day welcome → gist → exact story with the voice session connected.
- **Parallel work / leases:** none. No Claude agent is running on any branch. Codex owns everything from here.
- **Secrets:** none recorded. Names and access methods are in `START-HERE.md`.

---

## TEMPLATE — copy for every handoff

### YYYY-MM-DD HH:MM TZ — [Codex / Claude Code / other] — [task]

- **Workspace:** [directory, branch, HEAD, clean/dirty, pushed commit]
- **Objective:** [what and why; user-facing acceptance]
- **Code changed:** [files/modules and commits]
- **Proven locally:** [commands and results]
- **Proven live:** [deployed revision, account/role, evidence] OR **NOT VERIFIED**
- **Unfinished:** [exact gaps]
- **Blocked:** [why; whether founder action is really needed]
- **Next three executable actions:** 1. [ ] 2. [ ] 3. [ ]
- **Parallel work / leases:** [worktrees and owners]
- **Secrets:** never recorded here.

## 2026-10-11 07:26 America/Los_Angeles — Codex — preserve/optimize first implementation packets

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`, implementation through `ccc93941`; pushed to the work branch. Presentation/workforce/score packet `cd981ecb` is also on integration and CI. No destructive history operation or migration.
- **Objective:** reuse existing Q, presentation, scoring and workforce paths; fix demonstrated defects and remove classifier work from plain authorized mandate recall.
- **Code changed:** presentation `60001d76`; concurrent workforce runner `63df8f70`; score lineage/comments `5bfd5f3e`; baseline/pipeline documentation `cd981ecb`; canonical mandate early routing `7ed54950` and durable-sequence guard `ccc93941`.
- **Proven locally:** 52 package builds; 142 presentation/voice/card tests; 14 workforce tests; 101 scoring/ranking/readiness tests; 16 executor tests; 43 mandate/core/sequence tests. Root typecheck, web/q-api typechecks and changed-file lint/format passed for the first packets. Latest root and q-api typechecks and mandate package build also passed. Chart, workforce and mandate regressions were also run against their original implementations and failed at the reproduced defects, then passed on the fixes.
- **Proven live baseline:** Railway API freshly reports all four services SUCCESS at `b021d53b`; CI `38142662370` green at baseline `e40b1d0f`; 200/200 migrations matched. Authenticated founder Home/Documents/Relationships rendered; existing generated deck opened in the in-place viewer and rendered its slide. Ten navigation requests returned NAVIGATE and five arrival reads returned 200. Timings and limitations are in PERFORMANCE-BASELINE.
- **Not live verified:** new code is not deployed. No end-to-end investor, spoken GPT-Live, full onboarding, document revision or workforce generation claim. The founder account's 22 result-block messages contained six cards and no numeric fit; this does not resolve the historical investor-score producer.
- **Unfinished:** exact-commit CI/release, broader provider/DB/voice timings, full journeys, durable existing DOCUMENTS bridge. Approved FDN numeric methodology was not located; a question is pending with the founder. Preserve fit/readiness history; no invented InvestIQ.
- **Blocked:** local full Supabase start exhausts 32 GB with Docker vfs; use CI pgTAP. Network initially denied endpoints but now works. Baseline CI quality takes about 28 minutes (lint ~9 minutes, tests ~13 minutes); do not call a running job a failure or bypass it.
- **Next three executable actions:** 1. Finish latest build/static gates and push integration/CI; inspect exact-commit quality + pgTAP. 2. Deploy only the green revision through the established deploy branch and verify Railway revision + authenticated browser/API. 3. Connect DOCUMENTS through canonical artifact preparation with durable idempotency and pending/READY recovery; use the agent matrix audit.
- **Parallel work / leases:** separate worktrees `/workspace/cq-score-audit` and `/workspace/cq-workforce-audit`; implementation commits cherry-picked. Workforce follow-up is read-only; no racing source writer in root.
- **Secrets:** values are outside the checkout and never recorded here. Read them only through supplied secret inputs; never copy raw service variables or signed URLs into handoff evidence.

## 2026-10-11 08:01 America/Los_Angeles — Codex — existing workforce document connection

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`; artifact replay foundation `40855bca`, provenance `cbea5ebf`, executor/schema `a42f25db`, followed by composition/zero-paid-stage completion. No unpushed customer data or secrets.
- **Objective:** an approved own-company document step uses existing company evidence, artifact persistence and workers, with one file identity across retries and truthful READY completion.
- **Code changed:** JOB_PLAN v3 typed request, optional DOCUMENTS registration, durable cancellation/lease continuation and pending polling; canonical artifact job-step binding and additive migration `20261222150000`; authorized resume lookup; existing specialist EVIDENCE_ONLY mode; composition adapter and workforce worker policy. Foreground document paid stages are preserved. WORKFORCE-DOCUMENTS explains scope and limitations.
- **Proven locally:** 52/52 package builds, 118/118 tests across 14 workforce/document/prompt files, root and q-api typechecks, changed-file lint/format and diff check. Initial prompt-lock regression failed for the absent new v3 entry; adding only that published version hash fixed it. The optional regeneration helper was skipped, not counted passed.
- **CI / release:** first packet `ab962576` is CI GREEN, run `38147234625`, quality + pgTAP; pushed to deploy branch. Railway api is SUCCESS at that revision; web/q-api/workers are still building. New document packet is not yet CI-green, deployed or live verified; migration is not applied hosted.
- **Unfinished:** document exact-commit CI and pgTAP, then additive hosted migration/release and authenticated private document job; first packet all-service revision verification and mandate before/after measurement. Complete voice and founder/investor acceptance remain open.
- **Blocked:** no approved proprietary FDN numeric criteria/contextual weights were found. Local full Supabase remains disk/vfs limited; independent-transactions database race integration is written but unrun. Usage accounting cannot enforce crash-safe aggregate paid document budget; initial workforce document path uses zero additional paid generation rather than approximate accounting.
- **Next three executable actions:** 1. Push locally validated document packet to work/integration/CI and inspect both exact gates. 2. Verify first packet Railway revisions and repeat investor mandate samples/browser smoke. 3. After document CI green, apply only its additive migration, deploy exact green revision and verify a real private READY artifact through an approved workforce step.
- **Parallel work / leases:** separate document bridge/executor worktrees; root integrated their commits and completed adapter/tests. All subagents stopped after account usage limits; root owns continuation. No active competing writer.
- **Secrets:** never recorded. Existing synthetic investor sign-in fallback exchanges an admin-generated link locally without sending email; customer screenshots and sessions stay outside checkout.

## 2026-10-11 15:17 UTC — Codex — live mandate guard and database gate correction

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`, after `dd8f9353`.
- **Objective:** correct a live routing defect and preserve the server-only artifact permission contract.
- **Code changed:** own-mandate scope guard compares core subject to its firewall filter, validates current actor/run/tenant; fixture uses actual distinct identity/core IDs. pgTAP browser read assertion now requires 42501, without permission changes.
- **Proven locally:** old guard fails three distinct-ID mandate regressions; corrected guard passes 37 mandate/core/sequence tests and six canonical gateway tests. Dependency builds, root typecheck and changed-file lint passed. q-api typecheck passed.
- **Proven live:** four services SUCCESS at `ab962576`; founder browser paths preserved. Three mandate runs still recorded classification, so no classifier-removal/speedup claim. Scoped hosted identity comparison confirms distinct IDs. Existing fictional GPT-Live cohort account is available; audio not yet measured.
- **CI:** `dd8f9353` database gate failed after database startup. Logs blocked by GitHub storage-host allowlist; code inspection found the invalid assertion above. Next exact-commit CI is required; document migration remains unapplied.
- **Unfinished:** release correction, actual first useful text/audio measurements, real authorized score reproduction, autonomous document READY/render/revision, investor Discover-to-Q journey, intelligent paid document stages with durable canonical budget enforcement.
- **Next three executable actions:** 1. Complete static checks and push corrected packet to CI. 2. Exercise existing authorized investor discovery/fit and bounded voice transport while CI runs. 3. After exact gates pass, apply additive migration, release and verify actual document job and latency.
- **Parallel work:** all workers stopped; root owns continuation. Secrets and private runtime evidence remain outside checkout.

## 2026-10-11 15:40 UTC — Codex — measured investor/document product checks

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`; release candidate `4d26e9e6` pushed to integration/CI, separate bounded-fit correction follows on work branch.
- **Code changed:** candidate sweep respects explicit count when no place filter requires a wider candidate window. Domain still computes/ranks every eligible candidate; result-size policy and scoring are unchanged.
- **Proven locally:** original oversized-result regression fails; corrected 36 fit/card/tool tests pass, then final 10-test rerun after correcting a fixture lint/syntax error. 33 dependency builds, root/q-api typechecks and changed-file lint/format pass.
- **Proven live baseline at ab962576:** canonical fit top-three has three, Q returned one; measured rich top-ten envelope exceeds 32,000 chars. No captured tool-failure trace is claimed. 42 authorized feed records show repeated values but no 8.8. Actual founder company is in feed and its network preview reads. Browser Discover opens Ask Q and accepts a server action; timing requires distinguishing new answer from history.
- **Document evidence:** private foreground Q_REPORT READY version 1, 44.5 s completion. It did not preserve the requested one-page shape or existing-evidence-only wording. Conversational revision yielded a document-opening UI intent, no revision receipt, and unchanged version 1. Explicit edit intent must reach the existing revision tool; no success claim.
- **Voice evidence:** existing synthetic cohort session broker 201; transport failed before any audio/data-channel event; closed 204. No voice policy changes.
- **Gates:** exact `4d26e9e6` run `38150727138` pgTAP success, quality tests still running. Migration not applied. Independent new packet is not CI green or deployed.
- **Next actions:** finish exact release gate/migration/deployment; measure mandate first text and classifier removal; execute typed autonomous document job and repair conversational revision routing through its existing tool; verify correct founder company targeting.
- **Parallel work:** root only. No private payloads, screenshots, credentials or signed links committed.

## 2026-10-11 16:09 UTC — Codex — document revision, actual READY and navigation preservation

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`, follows `2a77dc9e`; no parallel writer.
- **Code changed:** explicit edits of an existing document use the existing canonical revision tool offer before the opening shortcut, with research/outward/action/sequence exclusions. Mandate guard checks actual recall intent before its bound scope. Canonical detail/resume reject READY with an absent immutable version row.
- **Proven locally:** 52 package builds, 207 focused tests across six files, root/q-api typechecks, changed-file lint/format. Initial added fixture lint non-null assertion was corrected; final artifact rerun passed 13/13. Broad diagnostic suite: 1,125 passed files, one failed (six navigation cases), one skipped; 12,817 passed tests, six failed, one skipped. It loaded the old guard before correction and was not a frozen final-code suite. All six failures are in the now-passing 14-case navigation suite. Do not label the broad diagnostic green.
- **CI:** previous exact `4d26e9e6` run `38150727138` is quality RED at tests, pgTAP GREEN. Next candidate must pass both gates. No migration applied; four services remain `ab962576`.
- **Proven live baseline:** actual report viewer renders, PDF export 200/application-pdf; version remains 1 after the failed revision. Actual founder onboarding COMPLETED/23 responses/no pending question; shared profile/preview six non-null fields agree. Discover feed navigation reached its founder card after 29 moves, new SSE run has correct subject/reference and company findings, two declared facts and explicit UNKNOWN gaps. Private responses are not exposed. Off-screen named-company question still binds the wrong card.
- **Measured:** actual SSE mandate first useful text 2,742 / 2,098 / 1,895 ms, terminal 2,830 / 2,163 / 1,946 ms. Each still has classification and extraction usage; no speedup claim. First audio unverified.
- **Unfinished:** exact-commit CI, migration/release, live latency/provider-call comparison; autonomous typed ONE_PAGER READY/render and real conversational revision version increment; off-screen targeting; durable paid-generation reservations and genuinely intelligent document research/writing/design/critique. Actual historical 8.8 and approved FDN parameters remain open.
- **Next actions:** push final candidate to integration/CI; after exact green gates apply additive `20261222150000` and deploy exact SHA; verify all-service revisions and actual document/latency acceptance while continuing canonical targeting investigation.
- **Secrets:** private customer evidence and credentials remain outside checkout. Added GitHub storage-host draft needs environment review/save/publish to enable log downloads; independent work continues.

## 2026-10-11 16:17 UTC — Codex — preserve named-subject reading across the existing answer seam

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`, follows `efcf49ab`; root only. Separate correction is held off the integration/CI branch while its current release gate runs.
- **Code changed:** QAnswerRequest carries the existing reader's named-other flag; final request preserves it, both existing gateway path decisions use it, speculation is cancelled when it differs. No new business service, authorization path or tool.
- **Proven locally:** original answer-seam regression gets zero offered lookup tools and fails; corrected 181 tests across five answer/voice files pass. 36 dependency builds, root/q-api typechecks, changed lint pass. Changed-file format check and diff check passed.
- **Release:** exact `efcf49ab` run `38154358888` pgTAP passed, quality still running. All four services freshly SUCCESS at `ab962576`. Migration `20261222150000` unapplied.
- **Limits:** cannot claim the named-other flag caused the observed live specialist's wrong subject: scoped Railway filters returned no run logs. The working focused-founder journey is verified, off-screen targeting remains open. Do not convert privilege into access to private founder onboarding responses.
- **Next actions:** finish exact current release gates/migration/deployment and document/latency acceptance; then integrate the separately validated seam correction and its exact gates; continue intelligent workforce capability with durable canonical paid-budget reservations.
- **Secrets:** no credentials, customer text, identifiers or signed links recorded.

## 2026-10-11 17:22 UTC — Codex — retain canonical mismatch evidence and release green document candidate

- **Workspace:** `/workspace/q`, `codex/preserve-optimize`, root only; follows `2902ed22`.
- **Changed:** canonical fit projection retains MISMATCH with a distinct word/cross instead of dropping negative evidence; shared nine-measure limit replaces the local eight cap. Existing canonical scores and ranking unchanged. Additive card enum only, no model prompt version/formula replacement.
- **Actual evidence:** 42 authorized current profiles, 39 with mismatch; old projection had 39 coverage errors. All actual profiles have six applicable measures, so the original cap-only attribution was wrong. Corrected projection: zero coverage errors, zero canonical score changes. Separate ninth-known/ninth-unknown regressions prove the independent cap correction. Actor-scoped history: 14 block messages, one numeric card score 10, no 8.8; historical reproduction remains open.
- **Local validation:** all 52 package builds, 48 card/renderer/contract tests, root/web/q-api typechecks, changed lint/format and diff checks pass. CSS is deliberately ignored by eslint; checked by prettier. No gates weakened.
- **Release:** exact `efcf49ab` CI `38154358888` quality and pgTAP SUCCESS; manual e2e SKIPPED. Applied only additive migration `20261222150000` transactionally, hosted/local now 201/201. Deploy branch pushed to exact green SHA; builds still in progress. This new fit packet and named-other packet are not yet CI green/deployed.
- **Voice:** actual product Talk-with-Q opened provider sessions but produced no observed PCM/playing events. First audio remains unverified; no transport/product root cause claim. Do not repeat paid attempts without a new hypothesis.
- **Next:** verify four services SUCCESS; preserve original latency receipts and measure new live SSE first text/provider call removal; inspect/approve only the private own-company DOCUMENTS plan, then verify real READY version, render and conversational revision. Deterministic initial bridge is not final intelligent document capability.
- **Secrets:** all private receipts, profiles and credentials remain outside checkout.

## 2026-10-11 17:36 UTC — Codex — real autonomous document acceptance, measured mandate improvement and dropped viewer context

- **Workspace:** `/workspace/q`, root only, follows `14ed87c1`.
- **Release:** all four services SUCCESS at exact `efcf49ab`; quality and pgTAP CI green, manual e2e skipped, migration applied and hosted/local 201/201. Separate fit/named-other candidate `14ed87c1`, CI `38159120931`, pgTAP success and quality tests running; not deployed.
- **Actual product proof:** canonical proposal/approval yielded exactly one private OWN_COMPANY PREPARE ONE_PAGER DOCUMENTS step, only documents.own.prepare, approved budget $0.50. Observed agent RUNNING with PREPARING/version zero/no actual row; DONE only with READY/version one/actual row. Authenticated detail and viewer pass; exported PDF 200/application-pdf/valid header/one A4 page. Two sections, three USER_CLAIM findings, nine explicit gaps, audit passed. This is initial evidence-only capability, not final intelligent autonomous research/writing/design/critique.
- **Revision:** foreground report same conversation gained real READY version two and requested Evidence gaps section in 21,961 ms. Workforce one-pager revision failed in 11,906 ms, no receipt/version increment. Scoped hosted run stored only route: runtime discarded screen artifactId/version. No success claim for full workforce revision journey.
- **Changed:** runtime retains artifact/viewer references as hints, adds no entity subjects/grants; uploaded document page is kept only with resolved document. Firewall likewise preserves positions only with their parent references. Two new runtime regressions fail on original code; final 189 screen/firewall/routing/document tests, 52 builds, root/q-api types, changed lint/format and diff checks pass. Initial added test formatting and mistaken scope-name fixture were corrected before final validation. Exact-commit CI and live revision retry still required.
- **Latency:** same authenticated isolated mandate SSE: first useful text before 2,742/2,098/1,895 ms; after 2,447/840/892 ms. Median 2,098→892 ms (57.5%), three samples, not p95. All answers completed; zero classification usage after. Remaining extraction rows recorded 2,954/1,852/1,603 ms after completion, not answer elapsed time. Raw receipts preserved privately.
- **Voice:** one meaningful synthetic spoken-WAV UI retry still yielded no PCM/playing; first audio unverified. Existing live renewal max two and reconnect bounds were inspected; six opens alone do not prove unbounded retry. Stop additional paid attempts without a new hypothesis.
- **Next:** release this viewer-context correction through exact gates and retry the same workforce artifact/conversation; finish fit/named-other gated release/actual targeting; introduce canonical durable paid-job budget enforcement before enabling existing intelligent document stages. No competing platform/formula/service.
- **Secrets:** no private content, IDs, screenshots or credentials committed.

## 2026-10-11 17:57 UTC — Codex — preserve complete top-ten evidence within the existing tool bound

- **Workspace:** `/workspace/q`, root only, after `c950e29b`. This packet stays on the work branch while the viewer-context release candidate runs.
- **Live evidence at efcf49ab:** top-three now returns three actual cards (10, 10, 8.5), versus one before. A new top-ten request still returns one card. No captured production tool-failure trace is claimed.
- **Changed:** existing canonical fit formatter supports summary text; top-candidate tool uses it only when duplicating all typed parameter reasons in prose exceeds the envelope. All typed profiles/parameters, order and reader-disclosed raise data are retained. Small results retain full text; the unchanged executor still rejects oversized typed data. No new score/ranking service or read/provider call.
- **Measured actual data:** locally projected captured authorized ten-profile comparison plus feed-disclosed raise views: 33,377→28,203 chars, unchanged typed profiles/order, under unchanged 32,000-char limit. This is an actual-data projection measurement, not a fresh live tool invocation or proof of historical 8.8 provenance.
- **Local checks:** all 52 package builds; 82 fit/domain/tool/card tests, final complete-service fixture rerun 6/6, root/q-api types, changed lint/format and diff checks pass. Initial fixture was itself too large after compaction and correctly refused; revised valid fixture explicitly fits, old full-text representation produces RESULT_TOO_LARGE, new representation retains ten complete profiles. An additional oversized-profile case still refuses. Missing compare method/invalid union/async fixture lint corrected before final checks. No tests or limits weakened.
- **Current release:** exact c950e29b CI 38160313579 pgTAP success, quality format/lint/typecheck success, tests running. It superseded intermediate 14ed87c1 CI 38159120931 (quality cancelled, not failed; pgTAP success). Four services remain SUCCESS at efcf49ab; migration hosted/local 201/201.
- **Next:** release c950e29b only after exact gates; retry actual same-artifact workforce revision and off-screen founder targeting. Then send this bounded-envelope packet to its own exact gates and prove actual top-ten result. Continue canonical paid-job budget enforcement and intelligent document stages after the initial job/render/revision acceptance.
- **Secrets:** private baseline/revision receipts preserved outside checkout; no payloads, names, IDs or credentials committed.

## 2026-10-11 18:15 UTC — Codex — live viewer release and workforce spending guard

- **DEPLOYED:** all four Railway services SUCCESS at `c950e29b1be47d9d319311a151b59249fd70ff26`. Exact CI `38160313579`: quality and pgTAP SUCCESS; manual e2e SKIPPED. No additional migration; hosted/local remain 201/201.
- **LIVE VERIFIED partial document revision:** the same workforce ONE_PAGER in its original conversation now returns a READY same-artifact receipt, real current version 2 and history [2, 1]. Original findings and gaps remain identical. Client completion 18,295 ms is a functional observation, not an isolated latency benchmark. Requested Evidence gaps section is absent: full instruction acceptance remains FAILED. Existing writer only accepts bodies for existing headings and does not render the gap list into its model input. Structural/evidence-aware revision is the next writing correction.
- **LIVE VERIFIED unresolved targeting defect:** actual Discover Ask Q request named the genuine founder while its card was offscreen. Fresh run COMPLETED and mentioned the company, but its COMPANY_REFERENCE and all company findings still bind the other on-screen company. Five PUBLIC_SOURCE blocks do not establish founder-onboarding evidence. The flag propagation fix is deployed, but this journey remains FAILED; investigate canonical authorized reads and answer-subject projection without exposing private onboarding responses.
- **IMPLEMENTED / LOCAL TESTED spending guard:** unavailable or malformed monthly ledger data no longer counts as zero spend. New proposals are not planned; already-approved queued work is HELD with an accurate spending-check explanation. Explicit unlimited configuration and healthy/exhausted allowances retain their behavior. This is a start guard, not durable aggregate job-budget enforcement.
- Spending guard: old code fails four regression checks; corrected 40 tests across five workforce files pass. 52 package builds, root/q-api types, changed lint/format and diff checks pass. It is held on the work branch, not deployed.
- Separate top-ten candidate `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66` is integrated; exact CI `38162345315` pgTAP SUCCESS, quality running. Do not replace this active gate or deploy work HEAD. Actual top-ten acceptance follows its own exact green release.

- **Next:** preserve the exact top-ten CI gate; fix the real revision-section limitation and wrong answer binding through existing services. Require fresh exact gates and live retries for each. Paid intelligent document research/design/critique still needs canonical durable budget reservations. First audio and historical real-record 8.8 remain unverified.
- **Secrets:** private receipts retained outside checkout; no private contents, identifiers or credentials committed.

## 2026-10-11 18:28 UTC — Codex — canonical gaps correction and demo priority

- **LIVE VERIFIED:** the same workforce ONE_PAGER now has READY version 2, version 1 preserved, a rendered dialog and a valid changed one-page A4 PDF. All three original findings and nine canonical gaps remain identical. The viewer displays all nine gaps in its existing dedicated section. The earlier sections-array-only check was too narrow: a gap section already exists, rendered from `content.gaps`, with the old label “What isn't on record yet”. Do not introduce a duplicate gap source to fix that check.
- **IMPLEMENTED / LOCAL TESTED:** viewer and PDF consistently label that existing section “Evidence gaps”; the existing writer receives the canonical gap list as read-only input within its existing 40,000-character bound. No new artifact field, registry, prompt version or paid stage. Original gap-context regression fails; final 63 writer/viewer/export tests pass. 52 package builds, root/web types, changed lint/format pass; final fixture rerun passes 6/6. This packet is work-branch only.
- New founder directives make the October 12 investor demo the immediate priority. Stop expanding documents as the primary task after committing this packet. Prioritize wrong-company evidence attribution, named-company speed, existing top-three/top-ten cards, follow-ups and comparisons, and a repeatable authenticated live rehearsal. Preserve exact CI/release gates and rollback revisions. First audio remains unverified and is not a prerequisite for the text demo.
- The new InvestIQ addendum authorizes a serious implementation-ready proposed quantitative methodology and additive source reconciliation. It does not approve new production scoring semantics or label them official FDN methodology. Investigate repeated actual 6.0 and 3.5 values as well as the unresolved historical 8.8; preserve Core Seven, readiness, confidence and investor-match separation.

- **Next:** finish exact `5f3a0c8c` CI `38162345315` and release/live top-ten acceptance; continue authorized named-company binding and complete investor rehearsal. New spending guard and gap presentation packet remain separate work-branch changes pending their own exact gates.
- **Secrets:** private artifact/export/browser receipts remain outside checkout; no private data or credentials committed.

## 2026-10-11 18:38 UTC — Codex — demo release and named-company evidence binding

- Canonical gap packet committed/pushed as `0ea65ec4`. Workforce spending guard `78a5dde9` also remains work-branch only. Neither is called deployed.
- Exact top-ten revision `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66` passed CI `38162345315` quality and pgTAP; manual e2e skipped. Exact SHA pushed to Railway's deployment branch; readiness and live top-ten acceptance pending.
- Full-seam regression reproduces the wrong company reference, both with warm reads and cold reads. Named-company findings/references now bind only a single exact canonical name from this run's complete successful authorised profile read. Denied, failed, unclassified, search-only, malformed and ambiguous outcomes do not establish the target. Added turn guidance uses the final reader flag even when reads warmed earlier. No change to permission scope or scoring math.
- 52 package builds and 61 focused tests across four gateway files pass. Root/q-api types and changed lint/format pass. Initial fixture typing errors were corrected; both warm/cold cases pass in the final rerun. Exact gates pending. Real SSE named-company baseline completed: first 20 answer characters 10,395 / 6,454 / 4,389 ms; terminal 33,164 / 16,619 / 12,148 ms. All three lack the correct company reference. No after-change improvement or resolved live journey claimed.
- Next: commit/push and gate the bounded fix, verify four services/current cards, then authenticated demo rehearsal of named questions, follow-ups and comparison. Broader document capability work remains paused for the demo. No secrets or private customer contents committed.

- **Real repeated scores:** recomputed all 42 authorized canonical profiles with the shared function. Four known outcomes per company produce 6.0 for fourteen records and 3.5 for twenty-one; no 8.8. Different stage/sector/geography patterns collapse to the same coarse mean. See SCORE-LINEAGE.md; no score math changed.

## 2026-10-11 18:52 UTC — Codex — actual demo gaps and bounded corrections

- **DEPLOYED:** all four services SUCCESS at `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66`; exact quality/pgTAP CI `38162345315` SUCCESS, manual e2e SKIPPED. No additional migration; hosted/local 201/201. Rollback points include the prior exact green `c950e29b` and `efcf49ab`.
- **LIVE VERIFIED API:** top ten now produces ten distinct authorized company cards (previous actual result: one). Scores 10, 10, 8.5, then seven 6s; first 20 answer characters 4,350 ms, terminal 4,442 ms in this one cold observation. Top three produces three distinct company cards, scores 10/10/8.5, first text 1,836 ms, terminal 1,906 ms. These are mandate fit, not InvestIQ quality scores. No load/p95 or first-audio claim.
- **LIVE VERIFIED selected-company API:** company explanation/fit question and traction-risk-gap follow-up each returned correct company references/findings, no public sources. First text 4,284 / 3,641 ms; terminal 20,329 / 19,792 ms. This is existing authorized profile evidence, not access to private founder interview responses.
- **FAILED live comparison:** explicitly comparing two prior named cards after those prose follow-ups produced ten companies. Existing fit sweep lost the explicit subset because its latest answer had no cards and selected the candidate pool.
- **FAILED live browser presentation:** Discover Ask Q returned three canonical card blocks, but no card elements rendered. `QAnswer` drops ANSWER_CARDS because it assumes a separate Q stage; the dock has no stage and its Board also omits these blocks. API completion is not visible product capability.
- **IMPLEMENTED / LOCAL TESTED fixes:** exact named comparison targets resolve from bounded durable prior cards (ambiguous names omitted), then existing `fit_profile` reauthorizes those IDs; no `fit_top_candidates` expansion. Dock opts into the existing static card renderer; full Q stage retains existing ownership. Original comparison and dock-render regressions fail. Corrected 96 gateway tests and 36 web tests pass; 52 package builds, q-api/web types and changed lint/format pass. Final combined root types pass. These fixes await commit/push and exact CI; neither is deployed.
- **COMMITTED / CI RUNNING:** named-company evidence binding plus previously held spending/gap packets at `e271242e6833d07820c32a8e679f3403ba1ca560`, integrated and pushed; exact CI `38164882385` pgTAP SUCCESS, quality running. Preserve that gate; do not deploy current work HEAD without exact required checks.
- **Next:** commit the combined comparison/dock fix after final types, hold it off the active CI branch until that gate completes, verify and deploy exact green revisions, then rerun actual browser card-to-profile journey and offscreen named-company SSE before/after. Historical 8.8 and first audio remain unverified. Continue source reconciliation/proposed FDN methodology without changing approved production math.

## 2026-10-11 19:06 UTC — Codex — preserved directives and additive scoring register

- Exact October 11 investor-demo and InvestIQ directives are saved under `session-directives/` for cross-model continuation. DECISIONS.md links them and preserves their scope: demo first; serious proposed methodology independently authorized; no silent production math replacement.
- Added `INVESTIQ-RECONCILIATION.md`: initial stable chapter-qualified decision IDs, explicit legacy ten-to-seven mapping, preserved independent readiness/fit/confidence, and categorized identity defects, historical evolution, aggregation ambiguity, implementation gaps and validation gaps. The original Locked PADL and source DOCX/extracts remain unchanged. This is an initial sourced register, not an exhaustive reconciliation or approved quantitative methodology.
- Dock/comparison fixes are committed and pushed as `ad470389`, work-branch only, with 52 package builds, 96 gateway + 36 web tests, final root/q-api/web types and changed lint/format passing. Current exact named-company CI remains `38164882385` at `e271242e`; pgTAP passed, quality Test running. Keep that gate intact; integrate/deploy exact reviewed revisions only.
- Live top-ten/top-three API result counts are verified; actual dock rendering/card-to-profile rehearsal remains FAILED until the local presentation fix is gated/deployed and retried. Named-company before/after and voice first audio are still pending. No additional paid provider attempts for voice without a new hypothesis.

## Live named-company verification — 2026-10-11 19:23 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `e271242e6833d07820c32a8e679f3403ba1ca560`; exact CI `38164882385` quality and pgTAP SUCCESS, manual e2e SKIPPED. No new migration; hosted/local 201/201.
- **LIVE VERIFIED attribution:** three isolated authenticated questions naming an offscreen founder company now each return one correct COMPANY_REFERENCE and three findings whose company subjects all match the requested record. All mention the requested company; no PUBLIC_SOURCE substitution. Authorized declared profile evidence is not private interview disclosure.
- **No latency improvement claim:** first 20 answer characters after: 10,340 / 7,929 / 7,803 ms (median 7,929), versus before 10,395 / 6,454 / 4,389 (median 6,454). Terminal after: 19,597 / 16,969 / 15,607 ms (median 16,969), versus before 33,164 / 16,619 / 12,148 (median 16,619). Threshold timing is not a semantic first-useful-text metric, load percentile or audio measurement.
- **Document verification:** immediate post-arrival Open click failed to produce the viewer within 20 seconds. Retrying with a four-second page readiness pause opens the same existing artifact and renders one body plus all nine canonical gaps under “Evidence gaps.” This suggests a readiness race; it is not a fixed cold-open defect. Earlier PREPARING/version-zero versus real READY/version-row completion evidence remains valid.
- **COMMITTED / CI RUNNING:** dock cards and exact comparison subset `ad4703895d9736ab0c321324888697f59c5c1e5f`, exact CI `38166655996`: pgTAP SUCCESS, quality Test running. Neither is deployed or live verified yet. Preserve this gate.
- **LOCAL TESTED rehearsal runner:** `scripts/handoff/live/investor-demo-rehearsal.mjs` performs the real Discover → three visible canonical cards → Open correct profile → Q explanation → traction/risks/gaps → exactly two visible comparison cards journey. It checks current question/run completion and positive company references; private receipts/screenshots remain in a fresh protected temporary directory. Syntax/lint/format pass; actual execution awaits the dock release.
- **Next:** finish exact CI, deploy only its green SHA, verify all four services, run the actual browser rehearsal and fix any failure. Historical real-record 8.8, first audio, exhaustive source reconciliation and the full PROPOSED quantitative methodology remain incomplete.

## Demo release gate and methodology prototype — 2026-10-11 19:31 UTC

- **CI GREEN / RELEASE IN PROGRESS:** `ad4703895d9736ab0c321324888697f59c5c1e5f`, exact CI `38166655996`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to `recovery/2026-09-12`; four-service readiness and live browser card/comparison acceptance still pending. Previously verified deployed SHA is `e271242e`.
- **LOCAL TESTED, PROPOSED ONLY:** `INVESTIQ-METHODOLOGY-PROPOSED.md` and the isolated `scripts/handoff/live/investiq-proposed-evaluation.mjs` provide Core Seven subcriteria/anchors, context profiles, evidence/conflict/freshness handling, independent confidence, deterministic arithmetic, uncertainty and sensitivity, version lineage, calibration and approval requirements. Ten synthetic scenarios plus nine invariant checks pass; syntax/lint/format pass. No provider/DB/application imports or production integration.
- Evidence-withholding check failed in the first experimental formula: missing one known weakness still allowed a raised final score under the 80% gate. Corrected numeric finalization requires complete applicable Business Quality criterion coverage and retains wide missing-evidence bounds. Synthetic arithmetic is not calibration or real 8.8 provenance. Full source reconciliation and official methodology approval remain incomplete.
- Reusable browser demo runner now records first rendered current-answer text reaching 20 characters, in addition to terminal duration and positive evidence bindings. That is a visible-text threshold, not verified first useful semantic content or first audio.
- **Next:** finish exact four-service readiness, execute the actual browser journey, fix failures and record evidence before saying the demo works. No broad document expansion or production score rewrite.

## Actual browser rehearsal and focused-company fix — 2026-10-11 19:44 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `ad4703895d9736ab0c321324888697f59c5c1e5f`; exact CI `38166655996` quality + pgTAP SUCCESS, manual e2e SKIPPED. No new migration; hosted/local 201/201. Rollback remains exact green `e271242e` / `5f3a0c8c`.
- **LIVE VERIFIED presentation:** reusable authenticated browser rehearsal reaches Discover HTTP 200, receives three distinct canonical company cards, renders three card elements and Open controls, and opens the correct company profile with its name visible. Actual top-three terminal time 3,480 ms; no prose text on that card-only answer. First card timing was not captured in this initial run.
- **FAILED actual company analysis:** “What does this company actually do and why does it fit my mandate? Use its Capital Q records.” returned ten candidate cards and no company reference, terminal 2,344 ms. The selected company was in the run subjects and the conversation persisted across Open. This is fit-sweep routing, not missing page context. Follow-up and comparison stages were not reached; do not claim complete demo PASS.
- **IMPLEMENTED / LOCAL TESTED correction:** explicit single-company questions bypass candidate sweeps, including a FIT reading that arrives after warm reads. Existing authorized company analysis/tools remain in place. Original exact-word regression fails; full seam fails in both warm/cold cases when the fixture offers both canonical fit tools. Corrected 100 tests across six gateway files pass; two additional set-request preservation cases pass in the final 26-test fit-sweep rerun. 52 package builds, q-api types and lint/format pass. Root types exposed missing full scope fields in the new fixture; corrected fixture uses schema-parsed mandate scope; final 30-test full-seam rerun and complete root typecheck pass. Exact CI/live acceptance still pending.
- Work-branch commits include the explicitly PROPOSED offline methodology experiment `cb456be5` and source/latency checkpoint `6aec2061`; these have no production integration. Ten synthetic scenarios and nine invariants pass, not institutional calibration or real 8.8 provenance.
- **Next:** finish final fixture/types checks; commit, integrate and gate the focused-company correction; deploy only that exact green SHA; rerun the actual browser journey through evidence follow-up and exact two-company comparison. Preserve private receipts outside checkout. Continue measured latency work against the two short model tool-selection rounds, not post-answer extraction. Historical real 8.8 and first audio remain unresolved.

## Exact demo release and continued evidence checks — 2026-10-11 20:24 UTC

- **CI GREEN / RELEASE IN PROGRESS:** `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`, exact CI `38169532816`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to the deployment branch. API/workers SUCCESS; web/q-api still building at this checkpoint. No new migration; 201/201. Do not call the selected-company fix live verified yet.
- Reusable browser rehearsal has an optional previously authorized `CQ_DEMO_FOUNDER_RECORD_FILE` phase: return to Discover, ask about that named existing founder company, require positive correctly bound findings/references without public-source substitution, open its authorized profile and check the follow-up. The earlier three mandate-ranked records do not by themselves prove genuine founder evidence. This additional phase is syntax/lint/format checked but awaits actual execution; no new account or outward action.
- **LIVE MEASURED additional latency baseline:** asking about a company already named in the conversation returned six correctly bound findings and one correct reference, zero public sources; first 20 answer characters 8,661 ms, terminal 20,189 ms. Actor/run-scoped usage shows two short model lookup-selection rounds, 1,946+1,846 ms, before 12,394 ms final generation. Next hypothesis is a fresh authorized profile read from an unambiguous canonical ID in durable conversation cards, avoiding model-planned lookup; it is not implemented or claimed faster.
- **BLOCKED voice measurement in this cloud browser:** credential-free Deepgram WebSocket probes fail immediately (13/19 ms); browser error diagnostics identify proxy/tunnel failure. Credential-free HTTPS probes also fail for agent/api.deepgram.com. No voice broker, settings or audio were sent by these probes. This explains the execution-environment transport limit, not a verified production voice defect. First audio remains unverified; no additional paid voice attempt.
- **LOCAL TESTED / PROPOSED ONLY:** offline methodology experiment 0.2 retains the same arithmetic but isolates assessment snapshot identity from investor-view metadata. New invariant fails against 0.1 because fit-only metadata changed the input hash; fixed experiment hashes only method/context/as-of/observations. Ten synthetic scenarios and ten invariants pass; old version/results preserved. Original FSR §16 D/E explicitly leaves exact match/InvestIQ math unresolved; PADL #142 generally calls for qualitative user-facing confidence. Internal uncalibrated percentages are not product certainty claims. No production math integration or calibration completed.
- **Next:** exact four-service readiness, then full authenticated browser journey with the known founder phase; fix any actual failure and update shared evidence. Preserve current release gate and private receipts. Historical real 8.8 and the cold document-open readiness race remain unresolved.

## Cold Discover control and selected-company evidence binding — 2026-10-11 20:44 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`; exact CI `38169532816` quality and pgTAP SUCCESS, manual e2e SKIPPED. No new migration (201/201).
- **LIVE REPRODUCED:** a fresh Discover load exposes its Ask Q button before React binds it. Immediate click starts no Q run and opens no panel; after hydration, the second click opens one real Q sheet and the visible Ask Q textarea. Private authorized browser diagnostics contain counts/readiness only in console and create no Q runs. Discover's button now stays disabled through server rendering/hydration until its handler is attached; the SSR/hydration regression passes. Cold production verification awaits the next exact release.
- **LIVE REPRODUCED additional binding defect:** a warm-only rehearsal on `9261cdc4` renders three real cards, opens the correct profile, and now answers the selected-company question without a candidate sweep. Terminal 18,978 ms; first 20 rendered answer characters 8,341 ms. Four findings had no company subjects and no COMPANY_REFERENCE, so acceptance correctly FAILED. The reader's “other” flag can apply to an investor's selected counterparty. The correction preserves explicit-name attribution and ambiguity handling, and permits a deictic single-company fallback only to the exact selected screen subject after a successful schema-valid authorized profile read. The answer-seam regressions cover warm/cold and both flag values; existing named-company checks remain green.
- **LOCAL TESTED:** all 52 package builds pass; 65 web surface/global-Q checks pass; final combined SSR/hydration, answer-seam, authorized-card-binding and fit-sweep run passes 82 tests across four files. Root, web and q-api type checks, changed-file eslint, prettier and script syntax checks pass. These local gates permit commit/integration; exact CI and release verification are still required. The complete investor journey, exact two-company browser comparison and optional known-founder phase remain unverified; no full demo PASS claim.
- The offline proposed methodology v0.2 and optional known-founder rehearsal extension remain separate from production InvestIQ. Ten synthetic scenarios and ten invariants pass; historical real 8.8 is unresolved. First audio is blocked by this cloud browser's Deepgram proxy/tunnel failure. Broader intelligent workforce capability and durable aggregate job budgeting remain unfinished; the narrower real READY document/revision/export evidence stands.
- **Next:** finish local gates, commit/push/integrate, require exact CI quality + pgTAP, deploy that exact SHA, confirm all four services SUCCESS, then run the unmodified cold browser rehearsal through all required phases. Fix actual failures without weakening assertions. Continue measured lookup overhead work afterward.

## LATEST STATUS — lossless investor-demo continuation — 2026-10-11 21:01 UTC

**Capital Q is an existing substantial application. Immediate priority: a reliable October 12 investor demo. Finish the current release and actual browser acceptance before expanding the workforce or changing scoring.**

### Branches, release and gates

- Latest integrated application commit: **`06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`**, remote **`build/int-rc`**; working branch **`codex/preserve-optimize`**. Both are pushed. The CI lane **`recovery/2026-09-12-8y2j4w`** is at the same application SHA. Current handoff/timing checkpoint is a subsequent work-branch commit; it does not replace that gated application SHA.
- Exact CI **`38173610861`** for `06872c7c`: format/lint/typecheck completed successfully; full Test step running; pgTAP **SUCCESS**; manual e2e **SKIPPED**. Quality is **not yet green**. Do not deploy until exact quality and pgTAP both pass.
- Deployment lane **`recovery/2026-09-12`** remains at **`9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`**. Exact CI **`38169532816`**: quality + pgTAP **SUCCESS**, manual e2e **SKIPPED**. Fresh Railway check confirms:

| Railway service      | Deployed commit                            | Status  |
| -------------------- | ------------------------------------------ | ------- |
| `@capital-q/web`     | `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a` | SUCCESS |
| `@capital-q/api`     | `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a` | SUCCESS |
| `@capital-q/q-api`   | `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a` | SUCCESS |
| `@capital-q/workers` | `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a` | SUCCESS |

- No new migration: local/hosted **201/201**. Previous exact green rollback points: `ad4703895d9736ab0c321324888697f59c5c1e5f` (CI `38166655996`) and `e271242e6833d07820c32a8e679f3403ba1ca560` (CI `38164882385`). Current `9261cdc4` is the immediate known deployed baseline. `main` remains stale; do not reset from it.

### Product evidence and remaining demo defects

- **LIVE VERIFIED narrow journeys:** top-ten API returns ten distinct authorized cards; the actual Discover browser renders three real Q cards/Open controls and opens the correct company profile with its canonical name visible. Three isolated named-founder questions return correctly bound findings/references without PUBLIC_SOURCE substitution. The existing workforce ONE_PAGER has real READY versions 1 and 2, preserved canonical findings/gaps, a rendered viewer and a changed valid one-page PDF. All nine gaps appear in the existing dedicated Evidence gaps section after a warm retry.
- **LIVE REPRODUCED cold Ask Q defect on `9261cdc4`:** navigate immediately to Discover, click its visible Ask Q before React binds the handler; no Q run starts and no input opens. A hydrated second click opens the actual Q sheet. Fix in `06872c7c`: disable Discover's SSR button until hydration attaches its handler. SSR/hydration test passes; **cold production verification pending**.
- **LIVE REPRODUCED selected-company attribution defect:** the deployed routing correction now returns analysis instead of ten unrelated candidate cards, but a warm browser explanation produces four findings with no company subjects and no COMPANY_REFERENCE. Rehearsal fails `PROFILE_REFERENCE_MISMATCH`. Fix in `06872c7c`: preserve explicit named targets/ambiguity, allow a deictic single-company fallback only to the exact screen subject after a fresh schema-valid authorized profile read. Warm/cold/other-flag regressions pass; **production verification pending**.
- **NOT ACCEPTED:** full cold Discover → three cards → selected profile → explanation → evidence follow-up → exact two-name comparison → known authorized founder profile/follow-up. The last rehearsal stopped at explanation binding; later phases were unrun. Do not count a warm retry, API-only check, skipped CI e2e, or ranked demo records alone as full investor or genuine-founder acceptance.
- Cold document Open similarly failed once before hydration; a delayed retry rendered all nine gaps. **Cold readiness remains unresolved.** First audio remains unverified; cloud Deepgram transport fails with proxy/tunnel errors, not evidence of a production voice defect.

### Measurements and next task

- Actual known-card question baseline: first 20 visible answer characters **8,661 ms**, terminal **20,189 ms**, six correctly bound findings + one reference, zero PUBLIC_SOURCE. Two model lookup-selection rounds: **1,946 + 1,846 = 3,792 ms** before generation.
- Warm selected-company browser on `9261cdc4`: top-three terminal **3,202 ms**; explanation first 20 rendered characters **8,341 ms**, terminal **18,978 ms**, attribution failed. Actor/run-scoped usage confirms two lookup-selection calls **1,798 + 2,036 = 3,834 ms**, final generation **11,908 ms**; post-answer extraction ends 2,219 ms after completion and is not the first-response bottleneck.
- Earlier measured own-mandate improvement: three-sample median first 20 characters **2,098 → 892 ms**, terminal **2,163 → 941 ms**. No p95/load/semantic-first-useful-text or audio claim. Named-founder correctness improved, but its measured latency did not improve.
- **Exact next task:** observe CI `38173610861`; if exact required gates pass, push **explicit `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`** to the deployment lane (not an unrelated newer documentation HEAD). Verify all four Railway services SUCCESS at that SHA. Run the cold browser command below. Fix any real failure without weakening assertions; update these shared files in the same cycle. Then remove measured unnecessary lookup planning using existing authorized profile reads and measure before/after.

```bash
cd /workspace/q
CQ_DEMO_SESSION_FILE=/workspace/cq-secrets/investor-session.json \
CQ_DEMO_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key \
CQ_DEMO_CHROMIUM_PATH=/usr/bin/chromium \
CQ_DEMO_FOUNDER_RECORD_FILE=/workspace/cq-secrets/founder-company.json \
NODE_USE_ENV_PROXY=1 node scripts/handoff/live/investor-demo-rehearsal.mjs
```

The tracked runner creates internal Q turns for an existing authorized account only. It requires current run/question completion, rendered card counts, exact selected/named company bindings and comparison IDs. Receipts/screenshots/failure details are private mode-700 temporary directories with mode-600 JSON; never commit them. Latest timing-only continuation identifies newly rendered Q card nodes and waits for the current browser answer to settle; syntax/lint pass, actual execution pending. It does not relax acceptance. Local-only diagnostic scripts/logs live under `/workspace/cq-secrets` and `/tmp`; the tracked runner is the portable reproduction path. Session files are not portable Git artifacts: use existing authorized sign-in/refresh documented in START-HERE; do not create accounts or send sign-in emails.

### Preserved work and environment actions

- Five project worktrees inspected; only the old document bridge had unfinished code. Preserved/pushed **`codex/wip-workforce-documents-preserved-2026-10-11`**, **`35c23d7a7e4b84d191e6535154db2dda46dafcaa`**. **WIP / UNVERIFIED / DO NOT DEPLOY OR MERGE WHOLESALE:** this historical snapshot places `findForWorkforce` inside `toArtifact` and lacks the later real-version rejection. The integration branch already carries corrected implementations. Preserve for archaeology; reconcile individual patches only if actually missing.
- Original branch histories pushed: `codex/workforce-documents` at `74f4b6ce9b33658c46493a739c3567a60d50b43e`; `codex/workforce-documents-executor` at `621614a3ceeeba5d5e0b31433e37cff3d32c0a16`; detached score audit protected on `codex/preserved-score-audit-2026-10-11` at `cce99544988af127e6d0d13c39fdcd605fc841e6`. Detached workforce audit `ab96257644d21e7e27fbb72fd54a9946e23fa00c` is already an ancestor of the integrated application. Old branches are historical, not additional platforms or competing sources of truth.
- **PROPOSED ONLY:** offline InvestIQ experiment **0.2**, ten synthetic scenarios + ten invariants pass. No production import, calibration, approved official weights or real historical 8.8 reproduction. Canonical mandate fit and FDN Business Quality are separate. Preserve original Locked PADL/Product Specification; proposed math must not replace approved production scoring.
- Development package builds/types/tests work. Local Supabase/database startup remains blocked by Docker/vfs disk constraints; direct Postgres is unavailable; required pgTAP runs in CI. Existing authenticated hosted HTTPS reads work. No account action is needed for the current text demo while authorized session refresh remains available.
- Cloud configuration draft was saved with existing network domains preserved plus **`agent.deepgram.com` and `api.deepgram.com`**. **User action for cloud voice verification:** review and save in environment settings, then publish. Draft saving did not activate/publish or prove transport connectivity. Recheck credential-free transport before any paid voice attempt. Secret values are never in Git or setup drafts.
- **Do not rebuild:** GPT-Live, voice/navigation, Q cards, documents, relationships, onboarding, research or the existing LangGraph workforce. Reuse current services/tools/firewall/presentation/versioning. No second agent platform, duplicate business service, speculative rewrite, fabricated showcase record, private interview disclosure, arbitrary score precision or unverified WIP deployment. Do not weaken RLS, evidence bindings, tests or release gates.

## Rehearsal selector continuation — 2026-10-11 21:08 UTC

- The full-browser runner now uses Discover's visible Ask Q rail control when present, otherwise the existing `[data-q-dock-button]` on fresh profile pages. The dock's accessible name includes Q presence/subject, so an exact Ask Q role selector alone cannot exercise that route. It records disabled/handler-bound booleans before the click without waiting away a product readiness defect. All existing company-binding/card/comparison assertions remain. Changed eslint, formatting and script syntax pass; full actual execution is pending the release.
- Prior lossless checkpoint `23ae987868dc9f2512a12ff5a05dfebbc902b3b0` is pushed on `codex/preserve-optimize`; preserved WIP branch `35c23d7a` and original document/score histories are independently confirmed on the remote. Integration/CI application SHA remains `06872c7c`, CI `38173610861` full Test step in progress, pgTAP SUCCESS. All four services remain SUCCESS at `9261cdc4`; no unverified WIP was deployed.
- A free authenticated cold-profile open diagnostic completed on the current deployed baseline: HTTP 200, profile route, dock handler already bound at click, one real Q sheet and visible Ask Q textarea. No Q run was created. This is one successful opening observation, not the Discover fix or full demo acceptance. Continue exact release gates and the actual full browser rehearsal.

## 2026-10-11 21:20 UTC — exact demo readiness gates green, rollout started

- Exact application commit `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`; CI `38173610861`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Full CI tests/build passed; no migration.
- Pushed that explicit SHA to `recovery/2026-09-12`. All four Railway services are building/queued. Last verified successful release is `9261cdc4`; do not call the new fixes live verified yet.
- Next: confirm four-service SUCCESS and run the tracked cold investor browser rehearsal with the authorized existing-account session. Preserve phase failures and private receipts without committing customer data. Handoff/timing commits on `codex/preserve-optimize` are separate from the exact gated application SHA.

## 2026-10-11 21:21 UTC — strengthen remaining browser acceptance checks

- The portable rehearsal now refuses non-success Discover HTTP responses explicitly and requires all positive known-founder follow-up findings to bind to the exact founder, alongside its existing positive-reference requirement. These assertions strengthen acceptance; no application or deployment changes. Syntax, eslint and prettier pass. Full live execution remains pending the current rollout.

## 2026-10-11 21:28 UTC — exact release and full cold investor browser PASS

- Integrated/deployed application `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`; CI `38173610861` quality and pgTAP SUCCESS, manual e2e SKIPPED. Fresh Railway inspection confirms all four services SUCCESS at that SHA; deployment IDs and exact rollback `9261cdc4` are in STATE. No migration.
- Tracked browser rehearsal PASS, including cold Discover first click (SSR disabled/unbound control), three actual cards/Open controls, correct profile, positively bound explanation and risk follow-up, exact two-company cards/comparison, previously authorized founder evidence/profile/follow-up. Six actual completed Q turns; no new accounts or outward actions. This is one full rehearsal, not universal/load acceptance. Private receipts `/tmp/cq-investor-demo-8kF6hc` remain outside Git.
- Selected explanation first 20 rendered characters 3,656 ms, client completion 16,327 ms, six bound findings/one correct reference. Follow-up 6,927/18,949 ms; comparison first card 3,550 ms, completion 3,820 ms, exactly two canonical companies. Known founder 7,606/15,462 ms; profile follow-up 3,654/10,489 ms. Full phase metrics and portable command are in STATE/PERFORMANCE. These are character-threshold timings, not semantic first-useful-text/audio or p95.
- Latest selected run had classification 675 ms and one 13,593 ms generation, no lookup-selection rounds; the prior run paid 3,834 ms for two rounds. No causal latency improvement is claimed from a binding-only patch. Known-card before baseline still paid 3,792 ms and first text 8,661 ms. Next: remove measured intermittent known-company lookup overhead through existing fresh authorized tools; test/measure/rerehearse.
- Lossless preservation stands: all important code/historical WIP branches pushed, no pending application-code changes. WIP `35c23d7a` remains unverified/do not deploy; correct canonical READY guards and real persisted document v1/v2 are preserved. Cold Documents Open, first audio transport verification, real historical 8.8 reproduction, broad intelligent document workforce and calibrated official methodology remain unfinished. Proposed InvestIQ v0.2 remains offline only.

## 2026-10-11 22:45 UTC — Claude Code — product clarity on the demo baseline

- Verified start: \`build/int-rc\` @ \`11174c4d\`; Railway all four SUCCESS @ \`06872c7c\` (unchanged). Branch \`claude/capital-q-completion-mhzsiq\` pushed; LOCAL TESTED only (3,707 tests, root/web tsc, lint/format).
- Shipped in the branch: raise wording + explainer, deck coverage fold, FIT_Q_VIEW v2 + profile "Go deeper with Q", Questions to investigate (three paths), deal strip "Not recorded" + next-stage guide (live-observed defect), data-room copy. No schema/scoring change.
- Live read-only two-sided evidence recorded in STATE. Write-path runner committed but not run: permission classifier refused production writes and release-branch pushes. Needs owner action.
- Next: PR CI → integrate → deploy → rehearse; run \`two-sided-questions.mjs\`; then lookup latency and the Documents cold-open race.

## 2026-10-12 00:30 UTC — Claude Code — PR #2 released; workforce investor chain in PR #5

- Release via GitHub merges (PR #2 → int-rc, PR #3 → CI lane, PR #4 → deploy lane); Railway four SUCCESS at `e1266dd8` (tree = tested `f7ff0fdc`). Rollback `06872c7c`.
- Live rehearsal (fictional investor) failed at the selected-company question: reader read it as "open"; fixed in PR #5 (`70f1be86`), not yet deployed.
- PR #5: runner concurrency/error/lead-status; NAMED_COMPANY memo; SUBSTANCE_CRITIQUE revise; DILIGENCE questions → approval card. Local gates green; CI running.
- Next: release PR #5, rerun rehearsal, run the full workforce acceptance live, then Tavus.

## 2026-10-12 03:40 UTC — Claude Code — PR #5 live; team-job routing in PR #8

- PR #5 released: int-rc `450c67ce` → CI lane `e3654b53` → deploy `f23583ad`; Railway reports all four services SUCCESS. The investor rehearsal PASSES live.
- Live workforce acceptance found two routing defects:
  - the hand-over shortcut turned the goal into a connection-request card (fixed in `7c0315b6`, deployed);
  - the goal got a single in-run brief instead of a team job (fix in PR #8).
- PR #8 also carries the dormant Tavus REST adapter and ADR 0066 (Proposed).
- Next: release PR #8, then run `workforce-acceptance.mjs` and `--approve` live.

## 2026-10-12 04:50 UTC — Claude Code — PR #8 live; fit evidence and concision in PR #11

- PR #8 released: TURN_READER v49 `teamJob` plus honest planning failures, and parallel CI.
  - Lanes: int-rc `368c0e10` → CI lane `d9d19eb1` → deploy `6600e61d`.
  - Railway: all four services SUCCESS.
- Live acceptance:
  - Q now plans the investor job; the card is approved; Research is done.
  - The named-company memo step fails in 1.3 s, silently. PR #11 adds logging.
  - Next: release PR #11, rerun, root-cause, rerun until PASS.
- PR #11 (Tensorgate fit):
  - attributed stated round context, never scored;
  - lead requirement honest;
  - FIT_Q_VIEW v3 reads the confirmed deck;
  - progressive disclosure across the fit panel, Q's view, the raise fold and Questions to investigate (recorded in DECISIONS.md);
  - workforce card and lead-in fixes.

## 2026-10-12 05:35 UTC — Claude Code — PR #11 live; memo root cause found; PR #14

- PR #11 is released: int-rc `9a2e89a3` → CI lane `f829a5d1` → deploy `fdf04745`. All four Railway services report SUCCESS.
- Tensorgate profile verified live as Savanna Seed (`profile-capture.mjs`):
  - the Cheque and Round rows read "Stated";
  - FIT_Q_VIEW v3 cites the deck (four design partners, two paid contracts, $360k contracted ARR, a $4M raise);
  - Q's open questions are: whether a lead is required, why now, and retention, sales-cycle and acquisition-cost metrics.
- Live workforce acceptance on `fdf04745` (run `5b556924`, job `2faa77f2`):
  - Plan card after 10.9 s; the card was approved.
  - Research DONE in 15.1 s.
  - The memo FAILED in 1.0 s. The new log named the cause: ZodError, a finding statement over 2,000 characters in `requestDocument`.
- Fix (founder: "don't truncate, increase the budget"): `QArtifactFindingSchema` gives document findings an 8,000-character statement budget, and grounding gets the same. Stored claims and knowledge keep 2,000; no migration.
- PR #14 contains that fix and the fit rows showing values with sources:
  - "Cheque compatibility": raise, your cheque, minimum cheque, plus the open line about ticket fit;
  - "Round terms": instrument and cap, plus "Lead investor required: not stated".
- Next: release PR #14 → rerun the acceptance with `--approve` → verify memo v1 → critique → v2 → diligence card PENDING → capture the profile.

## 2026-10-12 06:20 UTC — Codex takeover, PR #14 CI failure reproduction and correction

- Recovered exact PR #14 head `3a0aea34` and failed run `38208967641`; verified current all-four-success Railway release `fdf04745`. New own branch `codex/takeover-release-pr14` preserves existing Claude history. User takeover directive is stored verbatim under session-directives.
- Both failures reproduced locally; corrected stale Cheque compatibility assertion and duplicate prose in compact multi-company fallback. Every rich typed field remains unchanged; 32,000 tool cap and 31,000 regression target unchanged. 52 builds/79 targeted tests/root/q-api/web types/changed lint and format pass. No new migration or score change. Preserve memo 8,000-character finding fix, new source-attributed fit values and superseded-run CI safeguards. Exact CI/deployment/live acceptance still required.
- Six Tavus keys secured outside Git, one account key only. Read-only provider probe blocked by cloud proxy tunnel 403. Network draft additions `tavusapi.com` and `docs.tavus.io` saved, not published/active; user environment action required for live Tavus. No paid video call attempted. Continue workforce/release work rather than idle.

## 2026-10-12 07:10 UTC — protected continuation while exact PR #14 CI runs

- Corrected PR #14 head `d493e7db`; exact run `38214769523` has static/types/build/pgTAP PASS, full tests pending. Release remains `fdf04745`. Own fix branch is pushed; no CI cancellation from independent work.
- `codex/workforce-tavus-integration`: strengthened existing real workforce acceptance with queue owner/run bindings, real persisted READY memo/review/version/PDF and pending founder-contact card; protected private receipts. Existing fictional-session option verifies actual authenticated email, preserving password fallback; positive sign-in and wrong-account refusal pass, no email/new account. Script syntax/eslint/format pass; full workforce execution pending release.
- Tavus paid boundary rejects invalid or >180-second durations, nine tests/q-api types/lint/format PASS. Not yet a working avatar. Provider API blocked by cloud network proxy; draft network additions saved but not published. Provider-owned January reference differs from dormant PAL adapter, so current endpoint verification remains required, without invented endpoints or quota-bypassing key rotation.

## 2026-10-12 07:46 UTC — release held at a genuine promotion test failure; Work documents protected

- PR #14 and #15 CI pass/merge documented above. PR #16 exact head d1266802: CI-lane push 38217786515 SUCCESS, promotion PR run 38217979145 Test/quality FAILURE. Deployment deliberately held; production stays fdf04745. All tested/merged code trees match. Recover actual failing test before any retry or release. CI log host is proxy-blocked; bounded GitHub diagnostic is next.
- Existing Work lacked artifact references. Added fresh-authorized canonical READY-document projection and existing viewer/Q-edit path; no new business source, extra model call or migration. Original four regressions fail before, pass after; 52 builds, 51 targeted tests, final branded/tenant negative checks, root/q-api/web types and lint/format pass. Local code protected on independent branch; no live or CI-green claim. Pending native diligence cards still need Work projection, and original conversation needs live verification.
- Tavus API and direct CI-log download need environment draft publishing; domain additions are saved, not activated. No paid Tavus session, quota bypass or unverified WIP deployment.

## 2026-10-12 08:27 UTC — real promotion failure identified; deferred Q warm-up corrected

- Native read-only GitHub diagnostic recovered blocked logs: promotion run 38217979145 has 12,933 passing tests and one uncaught window ReferenceError from q/wire.ts:70 after q-chat-reply teardown. No ignored error or retry-to-green. Diagnostic branch c8424bd3 is isolated/not for deployment; normal jobs canceled after evidence read.
- Own source branch codex/q-warm-lifecycle-fix binds delayed warming to its originating browser, preserving timing/schema/fast-load behavior. Two precise regressions fail before, pass after; final 15 targeted cases with native GitHub reporter pass, root/web types/lint/format pass. New exact CI/release required. Original memo/fit fixes preserved.
- Product branch 0d6c91a7 with Work canonical READY artifacts/viewer and stronger workforce acceptance is pushed and independent. No full intelligent-workforce/Tavus live completion claim; remaining native approval visibility/conversation verification recorded. Production stays fdf04745.

## 2026-10-12 09:25 UTC — native Work approvals and original conversation preserved

- Warm fix PR #17 exact CI 38224342952 quality/pgTAP PASS, merged 55ddf097. PR #18 run 38227999773 still tests pending; all other mandatory jobs pass. PR #16 held. Fresh production read confirms all four SUCCESS at fdf04745, including latest q-api deployment d51a934a. No deployment/migration claim.
- Pending product checkpoint exposes native approval previews through fresh canonical reads, completed-job Needs you and existing approval action. Diligence runs bind to the original owned conversation, with explicit failure for absent context. No new service, authorization bypass or automatic founder contact.
- Final 22 targeted deliverable/diligence/UI tests pass; corrected typed-mock four-case rerun passes. Root types passed; app types and final lint pending following null-context correction. Strong acceptance and live browser rerun remain required. See top STATE/ACTIVE for reproductions and preserved branches.

## 2026-10-12 09:28 UTC — latest combined release promoted; prior handoff reconciled

- Fresh GitHub confirms PRs #19–#22 merged, integrated 58812685. PR #23 exact CI 38242394741 and GitGuardian PASS; normal merge promotes deployment branch to 221ff996. Four-service rollout pending; previous all-four-success rollback 5d9837bf. PR18 also passed exact CI and merged a3a4eb6b. No migration or unverified WIP release.
- Native Work approvals/context continuation changes now pass root/q-api/web types and final lint/format. Diligence tests parse captured unknown inputs rather than unsafe nested matcher assignments; missing original conversation explicitly fails. Code checkpoint still separate from already merged Work documents.
- Attempted refreshed-fictional-session browser baseline failed before launch: documented /opt/pw-browsers/chromium does not exist. No product failure, timing or browser acceptance claim. Locate pinned browser and rerun after actual rollout. Latest user continuation directive stored verbatim; it explicitly authorizes independent parallel agent lanes.

## 2026-10-12 18:25 UTC — Claude: releases #19–#33 live, voice trial configured, two live defects in fix

- Production 047678e5 all four SUCCESS. See STATE top for contents, migration, voice-trial config (profile ids), live checks and rollback.
- Live failures found and fixed this session: plan schema `cannot` line >200 refused whole plans (now 600 end to end); planner failures said "reword" (now FAILED, honest); "yes, plan it anyway" re-planned the word "yes" (now the original goal with proceed); voice trial config first set with auth ids (corrected to profile ids before the code deployed).
- Open: diligence question length (bounded rewrite, branch claude/diligence-question-length); list_q_work v2 recall miss (branch claude/work-results-fix). Founder-contact card stays PENDING.
- Measured: prompt-cache share and turn latency after A2/A3 still need real-traffic volume; recheck ai_ops.model_usage cached_input_tokens by hour.

## 2026-10-13 — Codex independent voice reliability checkpoint

The cumulative active-speech guard is preserved on pushed `codex/oct13-voice-trial-guard` (`5d748085`), based on `6f47fd5d`. See [VOICE-TRIAL-DURABLE-GUARD.md](VOICE-TRIAL-DURABLE-GUARD.md). Existing unfinished source was also backed up as WIP `71518a20` on `codex/voice-trial-audit-takeover`. The continuation restores the strict concurrent-consumption regression, requires bounded confirmed observer readiness before SDP, checks observation again after context reads, and flushes replacement accounting across owned tenant contexts. Package-build and fresh local gates are pending at this checkpoint; no CI-green, migration-applied, deployed or live-verification claim. Migration `20261222170000` remains unapplied. Tavus and independent product release ownership remain with the root engineer.

## 2026-10-13 — Codex continuation after active network policy

- Preserved existing checkouts/worktrees and all uncommitted work; no restart. Network access verified with TLS checks enabled. PR #42 exact CI green, independently merged/deployed all four services at f3fe5520.
- Reviewed specialist fixes are committed and pushed: voice 3e49bac3 (81 tests), Tavus d1d068a2 (67), memory 1e5f16b8 (655); gates are described in STATE. Voice PR #43 exact CI passed and merged integration 9da9f057. Reviewed additive migration 20261222170000 applied under explicit owner's named migration instruction; DELETE exists only inside new release function. Hosted RLS/grants independently checked. No voice deployment/cutoff claim yet.
- Tavus PR #44 now 1fafd4f3 with truthful correction doc; additional refresh/admission/termination-before-review defects being corrected before rollout. Migration 180000 unapplied. Owner will join later; no paid room allocated or human AV success claim.
- Authenticated live investor API succeeds and three cards render in Discover rail; sheet-only harness fails, diagnosis underway. PR #42 compound answer omits stored workforce evidence; memory follow-up not yet live. Private receipts remain outside Git. No outward contact/approval. Latest next actions are at top STATE/ACTIVE.

## 2026-10-13 — current rendered product evidence and independent voice promotion

- Corrected validation-only investor harness pushed ad735fda and cherry-picked here: verifies full visible fresh canonical answer/run/message/card identities instead of a conditional person marker; TLS bypass removed, six native regressions PASS. Real authenticated browser journey PASS on deployed f3fe5520: top-three, exact selected-company Open, explanation/risks, exact two-company comparison. First rendered text 3.34/4.51/7.93/2.42 s; one profile answer took54.1s total, no p95/paired claim. Private receipts /tmp/cq-investor-demo-eeG3eg.
- Existing owned workforce job reverified read-only through deployed API: five sources, READY memo v2, real critique/material revision, PDF and five PENDING diligence questions. Work browser opened exact memo/version2 (/tmp/cq-investor-demo-eVAxKC); Tensorgate fit and Q view/stated terms/unknown disclosure visible (/tmp/cq-profile-fLJ5Bd). No contact approved/sent.
- Memory PR45 exact CI38350806455 SUCCESS, merged integration0a80ad76. Voice-only production PR46 headc18be404 local52builds/179tests/root+q-api+webtypes/staticPASS, CI38352448737 running. Prepared bounded real-media/ledger probe; read-only authorized trial preflight0speech/no heldclaim/available. No provider allocation.
- Tavus preceding head1fafd4f3 CI38351066500 SUCCESS; new refresh/admission/finish-order fixes still being gated. PAL and conversation catalogue reads200; three returned conversations ended, no creation. Owner will join later; paid pilot unallocated. New cloud start instructions saved with active-network/current-handoff/TLS/CI-db guidance; saved draft is not a new-task validation.

## 2026-10-13 — voice deployed, memory promotion merged, Tavus restricted port gated

- Voice PR46 source c18be404 exactCI38352448737 SUCCESS; merge cda9b767 tree identical and all four Railway services SUCCESS, old q-api drained; push CI38353585621 SUCCESS. Configured q-api one replica/one region independently checked. Bounded live probe admitted201 with server observer/held claim, end204 and final no claim/0speech; browser WebRTC stayedconnecting, no media proof. Receipt /tmp/cq-live-trial-probe-eYAVTV. No reset or replacement session.
- Memory PR47 fb8da07a local52builds/144tests/sixharness/root+qapi+webtypes/static and exactCI38353703017 SUCCESS; production merge08018ea3, rollout pending before actual compound recall validation.
- Final Tavus refresh/admission/review fix3dd6b0cf pushed,148tests/alllocalgates PASS. PR44 now6c118bb4 with truthful/read-only preparation docs/checker, exactCI38355041506 running. Production port1fb5629d retains voice+memory+harness and complete originalTavus slice, composition gates pending. Hosted175applied/180unapplied. Config read confirms testmode, first singlekey, one exactcanonicalprofile, stableciphersecret/publicbridgeorigin; no video rows. No paidTavus room allocated; owner joinslater.
- Scoped slow profile diagnosis distinguishes earliest strictroot followUps refusal from later malformedfindings/text acceptance; no guard weakened. Independent immutable COMPANY_ANALYSTv23 precise guidance being gated. PERFORMANCE records actual text thresholds/call sums/cache observations, no p95/causal claim.

## 2026-10-13 07:29 UTC — Tavus protected promotion and independent decision guidance

- Latest Tavus integration head0cb31c02 CI38359007324 and production headc3c6e705 CI38359532207 required quality + pgTAP SUCCESS; both normal protected merges complete. Production912e594c rollout has workers/api/web SUCCESS, q-api building; do not claim complete deployment yet. Corrected capability/navigation inventories after real CI failures, no gate suppression. Migration20261222180000 applied before promotion; hosted required170/175/180 all present, video RLS enabled/0policies/authenticated SELECT false/encrypted column present/video rows0.
- Owner requested preparation and joins later: zero Tavus allocations; test mode/single canonical profile/single selected account/one configured replica preserved. Founder authenticated Rehearsals browser page HTTP200/visible PASS, private receipt /tmp/cq-investor-demo-ktYF5i. This is page readiness, not video/audio/recovery acceptance. Wait all-four exact revision then fresh positive/negative catalogue.
- Memory08018ea3 all-four SUCCESS/drained old revision verified. Post-release compound query now includes stored memo/reviewer risks and correct unknown disclosure; mixed decisions subrequest omitted two existing unexpired owner approvals. No approvals or sends. Actual profile slowdown diagnoses strict invented followUps root refusal; immutable COMPANY_ANALYSTv23 shape guidance and v24 existing native pending-approval read guidance pushed b1660610. Local52builds/45focused tests/types/static PASS; composed with production Tavus in78453e4c, combined types in progress before independent CI. Do not claim live behavioral/speed improvement.
- All existing branches/work preserved, no restart or new implementation. Active network and reusable setup remain saved. Child usage quota reached; root continues necessary work independently without changing models.

## 2026-10-13 07:31 UTC — Tavus deployed and safe preparation verified

- Production912e594c all four Railway services SUCCESS with exact SHA; old deployments drained. Fresh root config receipt verifies test mode/single canonical profile/single selected provider account/stable cipher/bridge origin/one configured replica. Live founder catalogue videoAvailable true/partner-steve/180 seconds; unadmitted investor false/zero enabled interviewers. Read-only readiness checker PASS; zero room allocation, human audiovisual/recovery/end/nonprovisional-review acceptance still pending owner readiness.
- Combined prompt candidate78453e4c passes52builds/root/q-api/webtypes; protected production PR49 CI38362910282 running. Shared integration checkpoint PR50 CI running. Runtime limits, strict schema, authority and approval boundaries unchanged.

## 2026-10-13 08:24 UTC — guidance deployed; live gate catches missing native findings

- PR49 source7da9796f exactCI38364499150 SUCCESS; production23e3971c all-four Railway SUCCESS/old deployments drained, source/merge trees equal, pushCI38366361312 SUCCESS. First full CI caught stale v22 bundle assertion, locally reproduced then corrected to exact active24 with16tests/staticPASS. Shared checkpoint PR50 fullCI38363254188 passed/merged8086ab91. Root guidance integration copy15paths exactsource49/local52builds/16tests/types/staticPASS/pusheda61d6ca0.
- Fresh before profile912e594c23.1s/first20chars4.95s/six findings/one dialogue/no refusalPASS. After23e3971c13.0s/3.06s/zero native findingsFAILED although company reference correct. Reader selected prepared-context path; one dialogue/no refusal. The conversation renderer consumes findings; v23's shape guidance/example focused specialistcompanyFindings. An actual renderer regression now fails before clarification; new immutable v25 being gated, no validator change/harness weakening/speed success claim.
- Current decisions improved: mixed query calls approvals.pending.list READ_ONLY/SUCCEEDED and reports two pending items; fresh API still returns same two unexpired IDs. Compound evidence recall completed. Private QYUb1K receipt; no approvals or outward sends. Tavus config/catalogue rechecked after newrollout: testmode/one exactprofile/key/replica/partner-steve/180s founderpositive investornegative. Lobby selector and disclosurePASS/Join not clicked, zero rooms. Paid human acceptance remains postponed by owner's reply.

## 2026-10-13 09:22 UTC — v25 release and actual investor acceptance; founder ready for pilot

- PR51 exactCI38371772202 quality/pgTAP SUCCESS, normal protected production merge592b32ff, source/merge trees identical; all four services SUCCESS/drained verified. Active v25 includes both generic native findings and specialist company findings guidance, unchanged strict schema. Full authenticated investor browser PASS with seven profile and six risk findings plus exact ranking/reference/comparison binding; receipt1Tc4Lv. No general speed/media claim.
- Latest product-first addendum saved verbatim. Founder now ready and confirmed Tensorgate sign-in; changed only CQ_TAVUS_TEST_MODE=false under standing single-account <=180second authorization. Configuration redeployment pending; rows0, no allocation. Preserve one admitted profile/key/replica, wait physical deployment drain, then human join. No broad access/spend authorization.

- 09:26:16UTC configuration-only deployment9e1aa2f0 SUCCESS, exactly one active deployment/old instance drained. Fresh positive/negative ordinary-account catalogue PASS; pilot ready link sent, Join-once instructions and human observation request pending. Read-only allocation/provider/review monitor running; no room at09:26:17UTC. No restart/deploy during a live paid room.

## 2026-10-13 09:44 UTC — human join FAILED; pilot remains unallocated

- User screenshot confirms correct Savanna investor lobby URL, same canonical admitted Tensorgate profile (verified against the actual newly created rehearsal). User says Video/PartnerSteve options were absent. Screenshot is the voice rehearsal, no AI face; human audiovisual acceptance FAILED/NOT DELIVERED. Hosted video rows0: no Tavus provider allocation or successful video pilot.
- Actual q-api logs show repeated live voice refusals reason REHEARSAL. Account GET live/available200/available=true: voice was not globally disabled. Root incompatibility: trial bootstrap issues LIVE-only credentials, while live broker prepares external-person rehearsals only, rejecting investor-organisation rehearsals; alternative paid provider fallback is forbidden by the approved trial guard. Do not bypass its 300-second durable allowance or mint replacement paid credentials.
- Fresh same-profile lobby browser replay3WZRAx shows admitted Video/PartnerSteve without Join; this does not reproduce or invalidate the user's missing controls. Exact transient browser cause remains unproven. Code observation confirms options errors silently hide selector, and Join stays available before admission finishes. Source correction makes loading/failure explicit and retryable, prevents early Join, and allows explicit video-intent URLs to fail closed rather than silently start Voice. Voice room also stops claiming LIVE after its start callback reports an error.
- Pending owned source gates, protected CI/promotion and actual user's browser retry. Video remains restricted to the existing one profile/key/replica/180seconds; no room allocated. Reuse the owned canonical rehearsal when possible, avoid extra paid allocations. Q-backed live voice support for eligible investor/company counterparts remains a required root fix; not solved by clearer errors or typed fallback.

- Owned source follow-up: Q-backed Live rehearsal audio now verifies the same owned ACTIVE canonical rehearsal, delegates dialogue to the existing rehearsal-aware Q turn handler, speaks Q's returned counterpart line exactly, and avoids duplicating canonical transcript turns. Public external-person prepared lines retain their existing mode. The 300-second durable trial guard and provider sensitivity ceiling remain unchanged; no alternative paid credentials. 125 targeted broker/trial/claim/bootstrap/lobby tests PASS, plus preceding61 UI/recovery/voice-selection tests PASS. Package builds52 cached PASS; final root/q-api/web types and static gates pending before protected CI/promotion. Not deployed or human verified.

## 2026-10-13 10:20 UTC — protected core repair integrated; final rehearsal audio scope gated locally

- Core repair PR52 sourcebcc0b743 exactCI38380132523 required quality/pgTAP SUCCESS, normal merge integration2adf2a0654d3f8be7f91d451b104c87a4d68060b. Production candidate PR53 a4eeed95 exactCI38381207915 also SUCCESS, held for the final client audio scope safeguard. Production remains592b32ff; no new deployment, Tavus allocation or human AV acceptance.
- Final integration review found the common Live audio adapter could add Q's ordinary greeting and use general navigation shortcuts during a rehearsal. Owned rehearsal starts now explicitly disable those shortcuts and speak only Q's supplied counterpart opening. Regular Q voice starts retain their existing behavior. The Q-backed dialogue and durable trial guard remain intact.
- Final root focused run180tests/eight files PASS; production checkout62 UI/recovery/selection tests PASS plus prior125 broker/trial/claim/bootstrap/lobby tests PASS. Final root and web types/lint PASS in both owned checkouts; q-api unchanged since its passed types. All4445 tracked app/package/dependency files compare byte-identical between candidates. Exact final-head protected CI and four-service rollout still required; do not promote the superseded a4eeed95 candidate.
- Read-only provider preflight selectedSteve stock face present/status completed. Private sessions refreshed with exact existing identities. User's failed rehearsal belongs to admitted canonical profile; still zero video rows. No paid room reserved, no allowance reset or alternative paid provider minted. Next: gate final role scope, promote combined candidate, verify admission and explicit video URL in authenticated browser, then coordinate the one <=180second human pilot.

## 2026-10-13 10:57 UTC — rehearsal repair deployed and explicit Video lobby browser verified

- Final production PR53 sourcef031c152 exactCI38382841674 required quality/pgTAP and GitGuardian SUCCESS, normal mergef4c2e6035cff54cbd286664fa1adae02853e6f41. Source/merge trees identicalc8e2bef33b15910de6d2d39b5ecb86545e1e5dbd. Role integration PR54 a76275d8 CI38382772779 SUCCESS/merged50b833930a6a76aaaf1569fcc7efe12bdac269f7; core PR52 also green/merged. Root fast-forwarded to integration before this factual checkpoint.
- All four Railway services SUCCESS atf4c2e603, old deployments drained. q-api d4aacb3b-a70b-4ee1-ac53-8ec16941ed36; web e87abf33-2b4b-481c-a6fe-277bb5632f91; api945d81ae-339a-4c5c-aa70-b602f68bb554; workers5ea32d80-2d96-4867-bf7e-58bb6f647c73. App-only watch paths left unchanged api/workers at592b32ff, so root explicitly deployed the exact already-gated revision through normal serviceInstanceDeploy(commitSha), no configuration bypass. PushCI38384891335 still running at this checkpoint.
- Authenticated founder browser on explicit investor lobby `?video=1` PASS: Video already checked, PartnerSteve enabled/checked, disclosure visible, Join enabled after options settle, Join not clicked. Private receipt `/tmp/cq-investor-demo-KFuIeS`. Local screenshot helper initially shadowed node:path join; corrected and rerun to completion, not a product failure or skipped assertion. Fresh ordinary founder catalogue true/Steve/180; unadmitted investor false/zero enabled.
- Fresh q-api configuration receipt10:57UTC: paid mode/testMode=false, exactly one matching canonical pilot profile and first provider account key, stable cipher/bridge origin, one configured replica and old code instances drained. Latest observed video rows0. User confirms available and received verified explicit-Video link; read-only room/provider/canonical-review monitor active. Human face/audio/interruption/reconnect/deadline/review acceptance still PENDING, no allocation by engineer. Do not deploy/restart while the one <=180second paid room is open. Confirm provider physically ended and saved review before restoring test mode/admission.
- Live voice root incompatibility corrected in source/deployment: owned active non-external rehearsals delegate to the existing Q rehearsal-aware handler; external prepared mode preserved; trial meter/claim and provider sensitivity limits unchanged. Client role scope disables ordinary Q greeting/navigation and avoids claiming connection after failure. 180 targeted tests, types/static and protected CI PASS; physical investor-rehearsal Live voice remains human acceptance, not inferred from availability or tests.

## 2026-10-13 11:18 UTC — human Tavus pilot completed; bounded finish authorized

- Production remains f4c2e603, all four services previously verified SUCCESS/drained; production push CI38384891335 SUCCESS. One human paid Tavus room allocated at10:58:35.640Z, original deadline11:01:35.640Z. Seven Q exchanges/15 canonical turns, TIME_LIMIT, provider confirmed ended, canonical FINISHED and nonprovisional review persisted. End confirmation timestamp11:01:39.328Z is3688ms after deadline; exact physical cutoff instant is not separately proven. No engineer finish POST or second paid room.
- Ordinary resume reads retained identical room/private URL/original deadline. Authenticated saved-review browser PASS/private receipt /tmp/cq-investor-demo-I0Ti3y, correct counterpart/nonprovisional review. Checker originally used heading “review”; actual product heading is “Your rehearsal with”; fixed checker and reran, no product change. Human interruption/reconnect still not explicitly confirmed. User reports vendor UI displacement, narrow emotions, perceived3–5second reply delay, no spoken closing; do not claim those acceptance gates passed.
- Paid pilot window closed after provider end/review: only CQ_TAVUS_TEST_MODE restoredtrue. Same gated code configuration deployment9b1324c8-ac86-49ca-88fe-c568c042646a SUCCESS, exactly one active instance and prior paid configuration drained at11:15Z. Live voice settings untouched.
- New standing authorization: all legitimate accounts, one-time two allocations/six minutes total per account, max180sec each including reconnect. No automatic allowance reset. See session-directives/2026-10-13-close-tavus-product-completion.md. Implement durable account/global concurrency limits before broader paid access; no new paid allocation during source work. Finish only bounded UI/coverage/automatic stock avatar/closing/measurement slice, then immediately prioritize Q speed, intelligence, real founder/investor journeys, GateQ and locked InvestIQ.

## 2026-10-13 11:42 UTC — bounded video slice locally gated, product checks resumed

- IMPLEMENTED/LOCAL TESTED, not yet DEPLOYED: own canonical investor-company video admitted; all three supported kinds reuse existing rehearsal ownership/entitlement; Q selects enabled stock presentation from authorized persona style, no extra model/personality; original Q stage canvas/footer retained around provider iframe (vendor interior remains). New sparrow-2 turn detector, next-Q-turn wrap-up cue near original deadline, no unsolicited closing support through current iframe/REST path and limitation disclosed. Client drops iframe at deadline even if review save pending; bridge bounds in-flight Q work and suppresses late speech. Same-room recovery/immutable deadline/confirmed-close-before-review retained.
- Server allowance immutable migration20261222185000: two lifetime allocations per canonical profile, across tenants (pilot counts), failed starts count conservatively; one open room/account, two open provider rooms globally, advisory transaction lock across instances; no auto renewal; strict180second reservation constraint. RLS/grants unchanged, no new table or key rotation. Broader funding flag defaultsfalse until protected release/migration. Quota failures preserve same canonical voice fallback with clear reason. Tests916 new10pgTAP assertions still CI required; old914 fixture now179sec to avoid separately evaluated clock_timestamp microsecond overflow under new exact180 bound.
- Local package builds52PASS; focused rehearsal engine53, video50, lobby7, stage5, GateQ error-state3 testsPASS (118 distinct cases). Root final typesPASS; q-api typesPASS; web typesPASS; changed static/format PASS. Final protected quality+pgTAP and exact-head promotion still required. Owned production checkout fast-forwarded to f4c2e603 and same source patch applied, original production directive files preserved; its package build using shared valid cache in progress.
- Browser saved human reviewPASS/nonprovisional/seven exchanges. Existing founder+investor GateQ/Work/docs/relationships surfaces all200/bound/content/no visible errors, not full flows. GateQ unknown-vs-absent source correction and safe parallel settings reads add3regression testsPASS. Main speed/Graph/complete founder-investor/GateQ/locked InvestIQ work remains priority immediately after this bounded release. Model-stage sample p50/p95 recorded in PERFORMANCE-BASELINE, no valid first-audio quantiles yet.

## 2026-10-13 13:40 UTC — bounded slice deployed; allocation checkpoint closes wider-funding gate

- DEPLOYED: PR55 f0a89007 exactCI38393620721 SUCCESS/normal integration merge51a09275; PR56 e021d3ad exactCI38393622180 SUCCESS/normal production merge0a7e5f1abc61b9eea9bd9c994939ee026f381926. Source/DB4798files byte-identical. Production pushCI38397302675 SUCCESS. All four Railway services0a7e5f1a SUCCESS/drained: workersa3dd0e09-5ff8-4464-a4a8-db144ff0cb8d; api5072b12f-326b-4ec7-8221-599b59fbfd4b; q-apia955d3b6-4dd7-4721-b209-c0b4e1339cc8; web1f6f9b4b-e822-4e52-a168-ba3bea9d868a.
- Hosted allowance migration20261222185000 applied through approved HTTPS runner after exact quality/pgTAP gates; hosted206/local206 then no pending. Two allocations/account/no renewal, one open/account/two globally, strict180sec reservation. Paid window remains CLOSED/test mode; wider flag not enabled. No second paid room. No Live voice setting changed. Bounded UI/automatic stock selection/company coverage/next-reply closing are source/deployed, not broader human AV acceptance.
- Final CODE OBSERVED spending gap: uncertain remote create could release local slot before remote allocation resolved. Owned source follow-up persists selected account/PAL before paid create, bounds same-account PAL-specific recovery, retains unresolved financial/concurrency reservation independently of canonical voice fallback, never starts another room for recovery. Known live sessions retain confirmed close before final review. New immutable migration20261222190000 adds checkpoint columns/guard; not applied. New8pgTAP cases still CI required. 67 focused adapter/rehearsal testsPASS, root/q-api types and changed lint/formatPASS; packages unchanged from validated52build. Initial four regression failures exposed duplicate free-PAL cleanup and premature collapse of known allocations; root behavior corrected, assertions retained, final67PASS.
- Root and existing product checkout fast-forwarded to integration51a09275/production0a7e5f1a, preserving all prior source/helpers. Existing product branch now owns GateQ contact/interview/dossier work. New contact service source requires name/company/role/email and verified identity/email match without creating membership; not wired/deployed/accepted yet. Full new GateQ directive preserved verbatim in session-directives. No longer GateQ paid usage authorized by rehearsal allowance; start complete text flow/dossier first.

## 2026-10-13 15:10 UTC — Claude takeover: checkpoint release deployed; Q speed slice 1 in CI

- DEPLOYED: #57 and #58 were reconciled first. Their six code/migration files are byte-identical, both had green CI on their heads, and neither base had moved. #57 merged to integration (43c25e7f). Migration `20261222190000` passed review (additive columns, existing rows satisfy the check, the allowance guard is strictly tighter) and was applied through the HTTPS runner: hosted 207, none missing, columns verified. #58 then merged to production (cfc694b3). Railway q-api SUCCESS at cfc694b3; web/api/workers unchanged at 0a7e5f1a. No paid Tavus room was opened.
- RECOVERY: `apps/api/src/composition/gateq-contact.ts` is in no commit on any branch, and no `CLAUDE-NEXT-RUN.md` exists anywhere. Codex's workspace is not reachable from this container. Status: **LOCAL-ONLY/UNRECOVERED**; rebuild it only when GateQ resumes.
- Branch `claude/capital-q-completion-mhzsiq` now records its superseded tip 1f05df4c via an ours-merge. Its tree equals production; the #39/#40 content reached production through Codex's later merges.
- BASELINE (production cfc694b3, fictional investor savanna-seed, one browser journey; first 20 rendered characters / settled):
  - top three 3.5/4.0 s, three cards;
  - selected profile 6.0/25.0 s, five findings; one call 21.5 s, 38,227 input / 0 cached / 2,104 output tokens;
  - risks 15.1/29.8 s, **0 findings → journey FAILED**. The turn reader stalled about 6 s (2.5 s timeout, then a refusal over a tool's fields written at the root). Then came two tool rounds (2.3 + 2.9 s) and a 15.8 s answer that put all nine points in `companyFindings`, which no conversation surface renders.
- IN CI: PR #59 (`claude/q-speed-1`, model-gateway only):
  - the analyst answer and the turn reader drop unknown root keys (counted, never named) instead of refusing the reading;
  - conversation findings fall back to the specialist channel at the weakest honest evidence reading;
  - a trailing conversation note asks for `findings` only.
    Local gates PASS. Not yet deployed or live-measured.
- NEXT: deploy #59 and re-run the same journey. Then:
  - a stable tool set per task (96 tools ≈ 20k prefix tokens, and the set changes per turn);
  - card-first emission on the fast paths;
  - preloading the canvas when a run is followed.

## 2026-10-13 17:00 UTC — Q speed sprint CLOSED (Claude); next priority GateQ

- **DEPLOYED and live-verified** (production `5ce3d76b`; q-api/api/workers at `c2f08536`, server code identical; integration `ea3f71a0` has the same `packages`/`apps`/`supabase` code; hosted migrations: none pending):
  - #57/#58 video allocation checkpoint and migration `20261222190000`.
  - #59/#61 model-gateway:
    - unknown root keys are dropped, not refused (analyst answer and turn reader);
    - conversation findings fall back to the specialist channel;
    - a trailing findings note keeps output short.
  - #60/#63 web: card code and contracts load when a run starts.
  - #62/#63 web: a SIDE_BY_SIDE comparison renders as one table even when the cards' measures differ; a missing measure shows "Not recorded".
- **Full authenticated investor journey PASS** on 5ce3d76b (receipt `/tmp/cq-investor-demo-HZt53D`, private). See PERFORMANCE-BASELINE.md.
- **Tavus:** read-only check returned `videoAvailable:false`, so the paid window stays closed. No paid room was opened.
- **LOCAL-ONLY/UNRECOVERED:** `apps/api/src/composition/gateq-contact.ts` (Codex workspace unreachable; no commit on any branch). Rebuild it with GateQ.
- **MEASURED FOLLOW-UPS (not started; do opportunistically or when they block a product journey):**
  1. **Tool overhead.** Own-records questions offer 96 tools (about 20–25k prompt tokens). THEIR_OWN_RECORDS opens 5 areas (`tool-focus.ts`), and the set changes between turns, which breaks cache reuse. Candidate fix: a fixed core set per task plus `use_capability`, and a cache-friendly tool order.
  2. **Slow comparison generation.** One measurement each run: 7.9/27.2 s, then 14.2/30.8 s (one tool round plus a ~21 s answer of about 2,280 output tokens). Output length is the main cost; stream or shorten it without losing findings.
  3. **Caching.** A conversation's first analyst call is uncached (0/38k). Later turns cache 26–39k. A stable tool set (item 1) is the prerequisite.
  4. **Turn reader.** The first attempt sometimes goes to Gemini and is aborted at 2.5 s (seen once, about 6 s lost before the answer started). Watch for it.
  5. **First-audio latency.** Not measured this sprint (no provider-verified browser first-audio stamp). Measure within GPT-Live/duplex with no new paid usage.
- **NEXT PRIORITY (founder 2026-10-13):** GateQ complete adaptive interview, secure evidence collection and investor-facing dossier; see `session-directives/2026-10-13-gateq-adaptive-interview-and-inbox.txt`. Then the full voice/Tavus experience, then Q Pitch.

## 2026-10-13 21:40 UTC — GateQ text journey integrated; release in CI (Claude, integration owner)

- **MERGED to `build/int-rc`:**
  - #66 backend (f375202e):
    - append-only turns and contacts;
    - the six-digit code verifier (timing-safe, application-salted);
    - account-confirmed contact;
    - coverage;
    - submit v2 plus `GateqDossierV1`, written under one application lock.
  - #68 web (9612b04e): the contact, interview and review steps, plus the inbox dossier view.
  - #69 (47d87665): `POST /v1/gateq/apply/interview/open`, so Q asks the first question of a form-started interview.
    - It is idempotent: an existing transcript is returned with no model call.
    - The opening is stored once under client turn id `opening`.
- **Migration** `20261223090000` was already APPLIED (hosted 208, none missing).
- **RELEASE PR #70** (`claude/gateq-release` → `recovery/2026-09-12`) is in CI.
  - Its tree equals int-rc 47d87665, plus two production-only files (a takeover transcript and `workforce-acceptance.mjs`).
  - It is NOT deployed until #70 merges and Railway reports SUCCESS.
- **#67 Q Pitch foundations:** the IMPLEMENTATION_STATUS add/add conflict was resolved to the branch side (c36864d9); CI is running. It is package-only and not in the release.
- **LIVE ACCEPTANCE (not yet run):** `scripts/handoff/live/gateq-acceptance.mjs` covers:
  - fictional founder → fictional investor gateway;
  - account contact → answers → open → 3 timed turns (plus a dedup retry) → coverage → submit (plus a dedup retry);
  - inbox holds exactly one item with dossier and transcript;
  - a second fictional investor gets a 404.
  - Needs `CQ_SB_URL` and `CQ_SB_PUBLISHABLE` (public sign-in config), `CQ_SEED_ACCOUNT_PASSWORD` and `NODE_USE_ENV_PROXY=1`.
- **BLOCKERS:**
  - This session's `SUPABASE_ACCESS_TOKEN` is rejected (401 "Invalid access token"), so no hosted SQL reads or migrations are possible.
  - The public Supabase URL and publishable key are not in this environment.
- **OPEN GATEQ GAPS:**
  - guest document uploads (ADR 0067, required for full acceptance);
  - the nonbinding Q synthesis record (dossier `synthesis` is null);
  - quick answers ("I don't know" / "I'd rather not say") are sent as text;
  - the guest token lives in memory only;
  - `GATEQ_CONTACT_REQUIRED_FROM` is unset until live acceptance passes.

## GateQ shared contact limits and evidence labels — 2026-10-14

- IMPLEMENTED / LOCAL TESTED: transactional server-owned contact issue/verify budgets across application, intake session and keyed destination; resend preserves attempts within the hourly window. Parallel wrong-code attempts stop at five. New application interviews require confirmed contact before any paid model call; resume reuses the saved Q opening. Existing confirmed contacts remain usable.
- Q cannot promote a new applicant claim to document-supported without an existing authorized document-supported fact. Coverage now returns the owner-authorized contact details for review recovery, never verifier fields.
- All52 package builds and102 GateQ tests PASS. Changed-source lint produced no diagnostics; root combined type gate pending. New immutable migration20261223110000 and seven pgTAP assertions plus schema inventory guards are implemented but not CI tested or hosted. Existing Brevo sender configuration checked; dedicated API-only verifier secret still unbound. Not deployed or browser accepted.
- Founder flow and immutable investor dossier UI are pushed on the isolated frontend branch; integrating next. Selected application comparison is in progress there. Guest Evidence integration, immutable source versions, investor Q source access and follow-ups remain incomplete; see GATEQ-V1-CAPABILITIES.md. Q Pitch untouched.

## GateQ reconciliation and release preparation — 2026-10-14

- Integration advanced to f49e8c84 and production to20cb347e while the environment was paused. Railway API metadata now confirms20cb347e/SUCCESS; this is the previously released text journey, not the current repair. Normal merge reconciliation in progress, preserving contact-first form, authoritative Q opening, dossier fact/turn lineage and latency instrumentation. Q Pitch incoming ancestry is preserved without edits or ownership changes.
- LOCAL TESTED:122 tests/10files PASS after reconciling stricter contact and submission behavior. Concurrent openings now use the same durable claim/checkpoint/finalization path as answers, with no invented applicant utterance. Frozen investor Q summaries now include actual interview findings, source references and evidence labels rather than only the old form. Findings context is bounded and omissions disclosed; no extra model call or document-reading claim.
- Dedicated GATEQ_CONTACT_CODE_SECRET generated privately and bound to API only with skipDeploys:true. Readback confirms present; existing Brevo HTTPS sender configured. No secret value in Git/logs, no deployment triggered. Default contact-required boundary remains code-owned, not disabled by missing configuration.
- PR72 opened against build/int-rc; conflicts with newer shared GateQ work are being reconciled before protected CI. Guest uploads/exact document-version disclosure/investor source access and follow-ups remain incomplete. New migrations231000/231100 not CI tested/applied. Latest local frontend53tests passed before reconciliation; repeat combined gates required after source merge. No new live acceptance claimed.

## GateQ exact-head CI correction — 2026-10-14

- Reconciled source checkpoint336cf8c4 pushed in PR72. Local53 package builds PASS;122 domain tests PASS. Combined UI suite67tests ran:65PASS and2 legacy/display mismatches, then corrected actual legacy transcript display and test labels; affected inbox + intake rerun42tests PASS. Founder contact-first/recovery, comparison and dossier source assertions remain intact.
- Protected CI run38504152785 on336cf8c4: build and format/lint PASS; GitGuardian PASS. Database failed solely the strict inventory array's alphabetical order; all new claim/contact pgTAP suites passed. Typecheck failed a duplicate applications.lock property introduced by automatic fixture merge. Both corrected without weakening gates; fresh exact-head CI required. Current local root/API/web gates still completing. No hosted migration or new deployment.

## 2026-10-14 — resumed latest GitHub work

Preserved PR74 and normally merged its exact-green head into integration96d26b95. Recovered supersession concept from stale uncommitted backend work and implemented a narrow current-source retire-before-insert repair; no self-FK workaround. Actual PostgreSQL tests pending. Independently completed existing Relationship Hub design in PR75, preserving researched prototype; four playable synthetic walkthroughs and76 screenshots. Production remains10c81bda across four SUCCESS Railway services.

## October14 PostgreSQL proof checkpoint

ActualPG17.11 pgTAP20PASS and root independentlyrerun compiledrepository retry/MVCC/submissionlock/rollback proofPASS.53packagebuilds/root+API+webtypes/182GateQtests/67APItestsPASS. FullcanonicalpgTAP protectedCI38519705651 PASS on08821767; remainingstatic/tests pending then finalhead mustrepeatincluding newlywired concurrencydriver. Hostedpreflight0invalidlineage. AllfourstaleGateQlanes preservedon explicitlyUNVERIFIED/SUPERSEDED WIPbranches; doNOTapplyoldmigrations. No migration/deployment yet.

## 2026-10-14 06:32 UTC — GateQ merged and migration applied

PR76 source9c6c2607 passed protectedCI38520775540 including fullpgTAP and actual compiled-repository concurrency proof, normally merged f584f0bb. Reviewed241000 migration applied to hosted DB;211 recorded/nonepending; constraints read back correctly. Release77 exact75deba0d CI38521203727 still waits test/quality; deployment not claimed. Actual authorized test founder correction returned500; rollback preserved five original facts. Design75 original formatter failure fixed at1d49922a; a11y/video repeated PASS, latestfullCI pending. All prior unfinished GateQ work protected on explicit WIP branches. Next release gate then actual live second-answer verification.

## 2026-10-14 06:50 UTC — real correction verified; separate opening fix

PR77 exactCI38521203727 fully passed, normally merged23a65ce3 and allfourservicesSUCCESS. Same live form correction now succeeds; real first interview answer3.971s, second existing-country correction3.783s, completed retry646ms deduplicated, exactly2PERSONturns. First cold opening separatelyfailed23514/sessioncache7-characterkeyafterQtranscriptcommit; recovered byreopen. Narrow repair preservesdurablehistoricalkey and usesvalidlegacyfallback,121targetedtests/22realpgTAP PASS. ProtectedCI/release/coldfreshacceptance remain. Design75 nowaac14fd0 with real scopedlint/a11y/playback proof, fullCIpending.

## October 14, 07:35 UTC — verified GateQ release and independent Q follow-up repair

PR78/79 exact protected CI38524475537/38524638454 PASS; production62bd144a all four services SUCCESS. Fresh cold-opening3.558s, retry299ms; two real country corrections3.160/3.817s; completed retry589ms, exactly2 PERSON/3 Q turns. Fact repair remains strict, migration211 recorded, PostgreSQL22 assertions plus compiled concurrent repository proof PASS. Design75/aac14fd0 exactCI38523459354 PASS, review-only.

Existing investor browser rehearsal actually failed follow-up reference binding; selected company saved under DISCOVER, finding subjects empty. Independent patch8412bef3/5be2e476 preserves authorized profile checks and existing wide-read COMPANY attribution;62 targeted tests PASS, protected CI/release/live rerun pending. Navigation route race is not yet explained. Per-run known proxy-CA SPKI helper added after automatic review rejected persistent NSS import; no persistent trust expansion. Private records/logs/credentials remain outside Git. Latest STATE supplies exact release IDs, measurements, pending branches and reproduction.

## October14 takeover — recovered approved Hub and GateQ qualification lanes

Verified allfourRailway37b5414e SUCCESS. Recovered81/83 exactgreen sourceheads; reconciledHub to f4364d70,145 affectedtests PASS. GateQ83 normally merged05840d2a; release84/04fe9bee independentprotectedCI38552751739 pending. HubCI38552582766 pendingtest. Nativeinvestor desktop/mobile + actualfounder desktopoverview/tabs/Work/back verified againstrealAPI localweb; mobile/typedQ notyetcomplete. Wrongfounderfixture corrected byactualmembershipread, notroleguess. New boundedbrowserdriver preservesprivatefixtures/receipts and usesnative controls. Consolidatedownerhandoff stored under existingdocs/specs; functionalapproval acknowledged, prototypeCSS remainsunapproved. Exactconfirmedresearchrun is aviationcompetitor request; publictools succeeded, followuplosttarget. SeparateGENERAL scopingrepair72cfcc02 pushed/localtested, continuityrepairactive; nofalseproductinventory diagnosis.

## October14 — Q journey released; GateQ semantic defect found; functional Hub active

PR80/82 exact protected runs38531702123/38534322301 PASS; production37b5414e allfourSUCCESS/drained. Real investor top-three cards, selected-profile findings, risks follow-up attribution and exact two-company UI comparison PASS; old navigation bounce not reproduced, not root-cause-closed. Slow22–26second deep completions remain, no p95/voice claim. Native GateQ contact/form pass andQ/PERSON/Q persist, but stageCODE becameTEXT during interview and blocked Submit despite correct displayedseed. New typed-shape write guard and immutable promptv2 pushed7d1e57a4;144tests/35builds pass, exactCI/release/browser pending. HubPR81 final7919 repairs missing generated controls; functional owner approval preserved as original directives, prototype75 remains separate. Guest recoveryb35813de fully locally tested88tests but disclosure/Q/investor/retention missing; no migration/deploy. Preserve original facts/WIP and Q Pitch.

## October 14 — deployed acceptance and full GateQ / Hub continuation

- **Fresh production verified:** `71c5d4a58c314eca7981c08265b2e29015bc2b7b`; protected CI38556079265 SUCCESS. All four Railway services SUCCESS on this revision; previous revisions drained. GateQ canonical qualification-shape repair (PR83/84) and Hub H1 (PR81/85) are released. Historical checkpoints below are preserved, not current release authority.
- **Hub H1 LIVE VERIFIED:** authenticated fictional investor and founder, desktop1440×960 and mobile390×844, actual production UI. Role-aware headings/GateQ controls, Relationships/Overview tabs, Work return, no horizontal overflow PASS. Desktop typed Q generated successful navigation receipts to the existing overview; final-words-to-push62/7ms, settled heading5529/3912ms (single samples, not p50/p95). No voice certification, full CRM claim or Tavus room. Private browser evidence stays outside Git.
- **GateQ remains immediate priority:** native confirmed-account founder form → contextual Q interview → reload recovery → explicit reviewed Submit → exact-reference investor brief and expanded frozen three-turn transcript PASS on production71c. Separate existing fictional investor received404 for both foreign gateway and exact submitted dossier. All recorded facts remain applicant claims/self-reported; zero attached documents. No guest email OTP, uploaded documents, investor Q or p50/p95 certification claimed. Prior pre-repair session/history preserved; no historical fact rewrite or seed bypass. Guest Evidence is not released or evidence-complete.
- **Parallel ownership:** root owns native GateQ acceptance, intake/Q/disclosure/investor composition and integration. `hub_foundation` owns bounded H2 server-authorized list/filter/cursor/export, scoped personal saved views/columns, existing table/board and Q controls. `guest_evidence_recovery` owns actual signed-provider expiry/fencing, canonical Evidence storage/contracts/tests and draft migrations only. No duplicate CRM or Q engine; Q Pitch untouched.
- **Preservation:** unrelated older contact source/tests committed and pushed as `codex/wip-product-contact-preserved-oct14` at5049a718; not a merge target. No recoverable H2 branch or dirty Hub work found; continuing H2 from merged H1. PR86/87/88 preserved; research secondary.

## October14, 17:23 WAT — lossless recovery checkpoint

Refreshedproduction71c5allfourRailwaySUCCESS andintegration1b72e44d/PR89exactCI38572329768PASS. Preservedoperatorreportedproductiontextsubmission/dossier/transcript/404andH1browserproof; didnotrepeatpaidturns. Rootcreateddescriptionrelease90/fb882ffa, independentCI38596902328pending. NointerruptedINVQdirtyrepairfoundacrossallaccessibleworktrees; existingUIalreadyfocusesGATEQ_APPLICATION, backendreading/600-charoutputboundaryremainspriority. Capturednewownercontinuationwithoutarchitectureoverride. Preserved18-filecloudviewWIPb4a2a68e (53buildsPASS,50/52testsPASS,2undefinedfixturetestfailures+typesFAIL;pgTAP/CI/unreleased241100notapplied) and9-fileproductinventoryWIPaed12b0c (untested/unreleased). CanonicalnewH2pipeline2d9dfa1eandguestexpiry553316c5fetched; competingH2growthstopped, reconcileexistingbranch. Allimportantcodepushed, privatesessions/artifactsexcluded. Source87browserdriverretained; STATEtophasexactdeployIDs,CI,commands,nexttasksandlimitations.

## 14 October 2026, 17:49 WAT — updated release and protected claim-capture work

Handoff91 exactCI38597949683PASS merged80f5cd25. Description90 exactCI38596902328PASS promoted72d626cd; recordedfourRailwaytargetsbuilding/queued, nofalsebrowsercompletion. Claimcapture92/3fe079b0 clean/pushed: baselinepromptRED1/23, immutablev3,149tests/11files+changedlint/format/packagebuild/typesPASS; initialrootmissingdist/testreferencefailure followedbyprerequisiterebuild/recheckpending. NoCI/deploy/live/providerclaim. RootidentifiedINVQmanifest-factlist-onlyread and600-charsaysboundary, notyetfixed. ReclaimedonlygeneratedlocalNextcache514MB afterENOSPC/zerotestattempt; no source/privateproof/credentialsremoved. CanonicalH2/guestWIPs pluscloudview/productinventorycheckpoints recoverableonremote.

## October14, 17:55 WAT — latest release and claim-capture continuity

Direct Railway read confirmed all four services SUCCESS on72d626cdebbb2a177734db0a4125bd7b81cd4e9b following normally gated description PR90 (CI38596902328 PASS). No fresh browser description certification. Claim capture source08cacfd4861e8212b7a06f2f12e66c08cec4a76f is clean/pushed in PR92:53 builds, root/API/package types,149 suite tests and40 focused tests, lint/format PASS. Exact CI38601112916 still running for quality at16:54UTC; database/build/types PASS. No providers, migration or live model-adherence proof. Investor-Q remains traced but unimplemented; STATE records exact paths, boundaries and negative acceptance cases. PR93 updates shared handoff; older timestamped assertions remain historical. Source worktree audit is repeated before push; generated design node_modules and private artifacts remain excluded.

## 14 October 2026, 22:33 WAT — H2 protected release and real founder acceptance

PR99 exactefd2 protectedCI38617987342 allPASS; normalproductionmerge48c6. Web/API/workersSUCCESS, q-apibuilding. Actualfounderdesktop table/board/search/sort/filter/pagination/persistentselection/savedviewreload/selected+filterednativeCSV/recordreturn/overflow/securitynegatives PASS. Otherdevices/roles/Q stillpending. Nativeoption/Next hiddenstreamed-copy harness issues recorded and corrected without changingproductassertions. Priorproduction dcb2 failure is media requestId UUID4018 falsepositive;39focusedtestsPASS narrowfix. PR101 preserves driver/testrepair. OriginaldirtyQ/H2safeWIPs pushed ef515bc6/2fc703cc; no failing98/97 merged, noDDL/providerroom/outwardactions.

## 15 October 2026, 07:10 WAT — Claude four-lane round (releases A–C)

- Claude led as integration lead, with lanes G (GateQ and video), C (CRM), P (Q Pitch), S (speed) and M (InvestIQ).
- Released #107/#109, #108/#110 and #111/#112. All four services are on `242460c1`. Seven migrations were applied after pgTAP passed in CI.
- Superseded PRs #97, #98 and #100 are closed. #86, #104 and #106 merged by inclusion. #88 is superseded by #86 plus the pronoun rule.
- Paid spend this round, as estimated by the gateway (not vendor billing):
  - OpenAI about $0.46: lane S $0.41, lane G about $0.05;
  - Tavus $0.
- Next: batch D (#113), the paid Tavus test after 09:00 WAT, the dossier-Q re-acceptance, the Q Pitch pilot re-run, CRM screenshots and walkthroughs, and the S3 after-deploy measures.

## 15 October 2026, 11:20 WAT — releases E–H; batch I merged

Releases:

- E (#116)
- F (#118): Home loads in 0.6–1.4 s.
- G (#121): CRM redesign, the Discover rule that shows only companies with a pitch video, and the fictional-account presence guard.
- H (#124): founder onboarding v4+ fix and the video room fixes.

Batch I (#123: video allowance, Daily guard, Qatar research, Gulf taxonomy) is merged to `build/int-rc` and has 4 migrations pending. They will be applied, and the release made, after lane G's paid acceptance.

Paid usage:

- Tavus key#1 (disposable) ran out after 463.5 s: 13 pitch videos, plus two GateQ tests that ran on it by mistake before the Builder key was set.
- Q Pitch has spent about $0.15 of OpenAI and lane S about $0.46.

Lanes:

- G: video acceptance, all-accounts eligibility, Tavus in Google Meet.
- V: pitch videos.
- D: bulk seed (20 + 100 so far) and enrichment.
- C: CRM deep research and rebuild, founder documents access.
- S: speed, precision and memory.
- A: artifacts reliability.
- P: Q Pitch, all scenes certified except the mic test for Q-to-Q.

## 2026-10-15 — Claude Code (Opus 5.5) — lane A, Q artifacts reliability

- **Workspace:** `/home/user/q-a` (worktree). Branches from `origin/build/int-rc`:
  - `claude/a-artifacts-oct15`: web, the stage rule and one controller.
  - `claude/a-claims-oct15`: server, grounded artifact claims and the company map.
  - `claude/a-rendered-oct15`: both of the above, plus the `drawn` manifest field.
- **Status:** IMPLEMENTED + LOCAL TESTED (targeted vitest, web `tsc`, eslint/prettier on changed files). NOT merged, NOT deployed, NOT live-verified after the fix.
- **Audit:** `docs/ai-handoff/ARTIFACTS-AUDIT-2026-10-15.md` covers the inventory, failures F-1 to F-8 and the fixes.
- **Merge note:** `claude/a-rendered-oct15` adds an optional field to the strict `QPageManifestSchema`. Deploy q-api/api with or before web.
- **Next action:** merge `claude/a-rendered-oct15` into `build/int-rc`. Run CI, deploy, then re-run the live checks in the audit:
  - top three, then "what should I ask them first?" keeps the cards;
  - "show me on a map where they are based" draws a company map.

## 2026-10-16 — Claude Code (Opus 5.5) — lane lang, any language

- **Workspace:** `/home/user/q-lang` (worktree), branch `claude/lang-oct16` from `origin/build/int-rc` (int-rc merged in at c5333a9c).
- **What:** language is a setting, any language, switchable between any two. There is no per-language code: names, direction and dates come from Intl, and screens in a language without a hand catalogue are machine-translated once through the Model Gateway (new `UI_TRANSLATION` class), cached in `q_runtime.ui_translations` and shared. Arabic's hand catalogue still wins. Voice and video choose provider configuration from one documented capability table and fall back honestly. Full detail and sources: `docs/ai-handoff/LANGUAGES-2026-10-16.md`.
- **Status:** IMPLEMENTED + LOCAL TESTED (targeted vitest, root `tsc` clean, eslint/prettier on changed files). NOT merged, NOT CI-verified, NOT deployed, NOT live-verified. No live model, Tavus, Deepgram or ElevenLabs calls were made.
- **Migration:** `20261228150500_ui_translations.sql` with pgTAP `974`; `320`, `590` and `130_schema_guard` were updated. **Deploy the code first, then apply the migration:** an older catalog loader rejects an unknown task-class policy, and this branch's loader skips such policies.
- **Config:** `CQ_UI_TRANSLATION_DAILY_CAP_USD` (default 2).
- **Next action:**
  1. Merge into `build/int-rc` and run CI.
  2. Deploy, then apply the migration.
  3. Live check: choose French in Settings and watch `/v1/q/ui-text/fr` fill. Expect about USD 0.07, all of it in `ai_ops.model_usage` with task class `UI_TRANSLATION`.
  4. Switch fr → ar → es on Home.
  5. Choose Swahili, then open voice. Expect the 422 "type instead" message.

## 2026-10-16 — Claude lead (long session)

Fifteen releases (T through AI) went live; see STATE.md for the table. Owner directions recorded: any-language setting (generic, machine-translated, no per-language code); scores always present on every company from investor-visible material (ADR 0075); onboarding must save every stated fact without format demands ("Other" keeps their words); Overview follows the owner's 14-section template with a Diligence tab; Q Pitch v6 direction (see ACTIVE-TASKS). Demo-only deck confirmations were applied to 433 fictional companies (receipt in the lead's scratchpad, seed_reason demo-confirmation-2026-10-16). Next session: continue items 1–3 in ACTIVE-TASKS.

## 2026-10-17 — Claude lead (overnight session)

Releases AK to AR were each CI-green, released to `recovery/2026-09-12` and Railway-verified. Details are in `STATE.md` under 17 October.

- **Q Pitch v6:** certified live, both tracks started by natural-language triggers. Six trigger and lighting defects were found on production and fixed: `9863aff6`, `75499404`, `65609b9c`, `c9abf3b2`, `e85f5600`, `79492cfc`.
- **Onboarding:** saves every stated fact in English, with p50 3.2 s. Investor batch saves were cut from 4.46 s to about 3.3 s, the stage and cheque answers became one mandate update, and the 422 was removed.
- **Local Supabase:** started in `/home/user/q-ob1` (docker plus `scripts/recovery/local-stack.sh start db`, then `supabase migration up --local`). It caught a stale integration test before release.
- **Owner instructions:**
  - pause language work ("as long as english is good");
  - stop asking for permission. The user settings allow list was widened; cloud session mode itself can't be changed from chat.
- **Next:** see `ACTIVE-TASKS.md` under 17 October.

## 2026-10-17 midday — Claude lead, Q conversation fixes

The owner reported five problems live:

- wrong cards;
- no conversational memory;
- slow or failed tab opens;
- unreliable moves between pages that aren't Home;
- robotic Q Pitch narration, deferred.

Release AT (`9a25c149`) shipped the cards, memory and move fixes, and they were live-verified. Batch AU (PR #200) adds three more:

- fetched tool results stored per conversation (migration `20261228190000`);
- turn reader v55 page controls;
- the dialog-state fix.

Open items and every SHA: `docs/ai-handoff/Q-CONVERSATION-FIXES-2026-10-17.md`.

## 17 October 2026, 22:29 UTC — PR217 release repair checkpoint

Recovered latest PR21717ea9a33, preserved older overlapping WIP to pushed branches. Fixed locale gate and canonical structured evidence projection/mapping; added UUID-safe current-source authorization and separately authorized history. Targeted engine/repository and focused nativePG checks passed; full new protected CI and actual hosted461 audit remain pending. Production allfourSUCCESSa70e66a8; latest migration28190000; no Unicorn migration/grant/deployment performed.43existing-org plan reconstructed without widening signup/usage rules. Exact commits, migration/test limits and next gates recorded in workstreams/UNICORN-QFILES-OCT17.md. Continue this existing PR; do not merge preserved alternate foundations wholesale.

## 18 October,05:45WAT — Unicorn release continuation

Recovered narrativeWIP, verified42scoring tests, preserved current8693integration and fourproductionSUCCESS c36b99bb. Prior21727c7protectedCI39075445136 PASS; new sourcehead requires freshCI.461frozenaudit now recognizes342companies with partialevidence (baseline1), but0overall scores; maxcoverage33.5% belowunchanged60%. No migrations/grants/deployments performed. See workstreams/UNICORN-QFILES-OCT17.md latest checkpoint. Continue protected release and real unscored/gaps acceptance; never certify a numeric score without evidence.

### 18 October,05:56WAT — Integration recorded; production HOLD

PR217 integratedacba6869895001c0cada2817a574f5fa6159beb5 prematurely when normalghauto-merge immediately merged with two source checks pending. Production promotion HELD. Source485CI39098259746 database/build/types PASS, tests/lint pending; exactintegrationCI39098720633; draftrelease227/CI39098756517, candidateacba. Do not auto-merge227; explicitly verify allcompletedprotectedgates, then migrations, then normalmerge. Divergent recoveryCIbranch preserved; alternate allowedbuild/rec-unicorn-oct18 triggers exactintegrationCI withoutforce.

FreshactiveRailway: web914ae664a21c53acf4af8ed63abc88d672f72489, API/q-api/workersc36b99bb57a31c6946eef85bac0a11122132fae3 (their914entriesSKIPPED). Migration28190000 latest, bothUnicornversionsUNAPPLIED;43grantsunapplied. Actualinvestorbrowserbaseline200/twoexisting scores7.615s, noUnicornyet. CAtrustverifiedprocess-localpin; no blankTLSignore. Fixedoperatortest-onlywrongprofilepath in c8ee0269e aftersource217merged; sourcebranchpushed, candidateunchanged. Usecanonical `/company/:id`, founder `/gateq?tab=applications`. ExistingprivatefixturesbindactualsubmittedfounderKathryn; no newaccounts/emails. Allfourlocalapp/roottypes,119targetedtests and53buildsPASS. Numericpositiveproductioncase remains unavailable: all461insufficient,342partialcoverage,max33.5%. Continue release gates and truthful realbrowseracceptance; nevermarkcompleteatmerge.

### 18October06:17WAT — Protectedpromotion and migrations complete; rollout pending

Allprotectedsource39098259746/integration39098720633/candidate39098756517 PASS. PR227 normalmergedproductioncfd51ef60191e560a4726fa08695712fa62972f9; treeidenticaltocandidateacba. ProductionCI39100042323 running. Migrations20261228200000+20261228201500 applied throughreviewedHTTPSsequencer,248hosted/none missing. AllfournewRailwaycfdrollouts BUILDING/QUEUED, notyetactivecertified. Priorweb914/backendc36 remainrollbackbaseline; keepadditiveschema/history.43existing-org grants notyetapplied. Next: allfourSUCCESS, feature-onlygrants, boundedworkerfirstsweep500/250ms after2minstartupdelay, actualcountsandrealbrowser/Q/Discover/GateQ/securityacceptance. New226integrationwork610915 ispreservedbutnotpartofrelease. Privateoperatorfixtures/helpers undercq-secrets are notGitartifacts. Correctedharness source c8ee0269e usescanonical/companyroute; positive-scorecaseunavailable, unscored-onlymode explicitlycannotcertify numeric/rankedsortpath.

### 18October06:24WAT — External229overlap; realAPIbuildrepair

PR229/4ef8daeccbb6f6874cd52f8f2743b6fe7d457ac4 superseded227rollout andcontainscfdunchangedUnicorn plus226/228. APIbuildf1f5062d FAILEDwithTS2300 duplicateActorContextimports(main.ts2/241);229CI39100138762build/typesFAIL, oldcfdpushCIcanceled,new39100142562pending. Runtimefix0aca7b1470487c41839dc2e4d13dfb6d45d23224 removesoneleadingtypeimport, retainsallGateQ/onboarding/Unicornbehavior. Sourcebranchmergedlatest4e131int;53package rebuild+APIchecks running. Coordinationposted229,rootownsmain.tsrepair; no rollback/overwrite. API/q-api/workerscfdhealthy atlastread; web914with4efbuilding; do notcalluniformnewreleasecomplete. Schema248applied,43grantspreparedunapplied. Newrepairsource/protectedreleasegates, finalfourSHA, grants/backfill andrealbrowser/securityacceptance remainmandatory. Frozenall461unscored remainsanexplicitlimitation, notafabricatedpositivecertification.

### 18October06:29WAT — Onecanonicalrepair; grantsandactualAPIverified

Claudeopened231foridenticalActorContextcollision. Itsfixremovescentralcopy; our0acaremovesleadingcopy. DO NOTMERGEBOTH: Gitcandeletebothwithoutconflict. Withdrewown230/232; canceledown39100482101/39100544196/39100549036toavoidduplicategates;231singlecanonicalruntimepath, awaititsprotectedpromotion. Root0aca/9e1recoverablebutmustreconcilemain.ts toupstreamafter231beforeanotherPR. Coordinationposted231comment6246095819. RootlocalAPItypesand53packagebuildPASSforalternative, notnewproductionproof.

AllfourservicesnowserveUnicorncode (web/workers4ef,API/q-api cfdatlastread;4efAPIfailedandq-apibuilding). UniformfinalSHAstillopen. Applied43explicitfeature-onlyACCESSgrants, verified43; schema248. Actualpaused/pacedworkerbackfill394rows,0scored,394insufficient,292partial,max.335last05:28:48UTC. ActualpremiumAPI200andno-mandateAPI20012pillars/.335; free404nopayload; founderdirectinvestorroute404correct; founderGateQexistingapplication200. Secondunscoredcompany200/coverage0. CorrectedrealbrowserharnessstartedwithQ, privatefixturesandCApin; outcomespending. Neverclaimnumericpositivecertification; all461frozen0scored. Continuecanonicalrepaircoordination, livebackfill461, browser/Q/Discover/GateQ/free/withdrawalchecks andmanualscreenshots.

## Latest Unicorn checkpoint — 18 October 2026, 07:04 WAT

Unicorn is deployed from PR227/cfd51ef60191e560a4726fa08695712fa62972f9, with both reviewed migrations applied (248 hosted) and all 43 explicit existing-organisation feature ACCESS grants applied. No paid subscriptions or usage entitlements changed. Completed worker sweep: 461 companies, 0 scored, 461 insufficient, 342 with partial evidence, maximum coverage 33.5% under inputs.v2. This does not certify a positive numeric score.

Latest production release PR234/d5600677d018a5b82cffd5f909121d12c474826a contains canonical API repair231; all protected candidate checks39101756788 PASS. Actual active Railway revisions at06:00UTC: API d5600677 SUCCESS; web/q-api/workers4ef8daeccbb6f6874cd52f8f2743b6fe7d457ac4 SUCCESS (their d560 entries SKIPPED). Do not call those three services d560. Their Unicorn runtime is unchanged. Root reconciled apps/api/main.ts exactly to canonical231; withdrawn230/232 alternatives must not be reapplied.

Actual authenticated browser acceptance completed ten non-Q role/device checks: premium investor desktop/mobile, existing founder GateQ desktop/mobile, no-mandate investor desktop/mobile, free-account hidden-score denial, unscored company, and Discover API/native controls. Discover baseline39, premium filtered/sorted0 because no company legitimately meets scoring requirements. Evidence private `/tmp/cq-unicorn-live-eBbRO5/`; manual readable viewport inspection remains pending. Source withdrawal PASS: six deck references disappeared immediately, NOT_ASSESSED while private, exact original visibility restored. Entitlement revocation PASS: score404/filter403, restored200, no subscriptions changed. Private receipts under `/workspace/cq-secrets/`; do not commit them.

**Real remaining product defect:** Q returns a substantive persisted-assessment explanation but does not open the requested assessment (client receipts empty). Draft PR233 owns bounded guidance to invoke existing operate_screen DISCLOSURE EXPAND before answering and require DONE; not live verified. Its old head7302328d CI39101577665 was still finishing at checkpoint. Source branch `codex/unicorn-qfiles-oct17` now includes dated-metric normalization repair3b9604506 and canonical integration merge7f244cfbd; final source checks and updated233 head pending.

The live profile exposed additional preventable mapping misses. Inputs.v3 adds explicitly dated ARR comparisons, annotated NRR and current cash runway, without changing pillars, grades, weights or 60%/required-pillar gates. Same frozen461-company replay: 0 scored, 342 partial, 401 observed criteria (v2:398), max44.5%, two companies gain coverage, zero replay errors. 46 scoring tests and seven browser-proof tests PASS; 53-package rebuild and changed-file lint PASS after correcting a strict currency type guard. No fabricated score or positive production certification. Home files and public-web work remain paused.

**Next:** complete local build/types/lint; push final233 head and obtain fresh protected gates; coordinate production promotion without overlapping another deploy; verify all four services, paced inputs.v3 reassessment, Q exact-target DONE receipt and readable desktop/mobile screenshots. Full reproduction: `NODE_USE_ENV_PROXY=1 CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt NODE_OPTIONS=--import=/workspace/q/scripts/handoff/live/browser-proxy-pin.mjs CQ_UNICORN_FIXTURES_FILE=/workspace/cq-secrets/unicorn-acceptance-fixtures.json CQ_UNICORN_VERIFY_Q=1 node scripts/handoff/live/unicorn-potential-acceptance.mjs`. Refresh existing private actor sessions with preflight-unicorn-actors.mjs if expired. Do not recreate accounts, lower evidence gates, change production scoring, rebuild CRM/Q Pitch, or apply withdrawn duplicate-import patches. Environment setup draft requires review/save/publish in Environment Settings for future tasks; current tested tooling works.

## Unicorn completion continuation — 18 October 2026, 06:46 UTC

PR233 exact source df7874fdcd7fa301d04942da9b89c00e0a9beb5d passed protected CI39102654240 and was merged normally. Integration fba01f927f5c32d0a956cd96b234f099e8d876fb passed CI39104139040. Production release PR236 is OPEN: candidate39104140057 has build/types/lint/pgTAP green, tests pending. Production is still the documented234 baseline; no new deployment or inputs.v3 count is claimed yet.

Follow-up PR237 (`codex/unicorn-product-completion-oct18`) adds meaningful Discover empty score-filter recovery, editable Q missing-evidence drafts, existing founder documents/profile links and progressive disclosure of three priority gaps. No rubric/threshold/permissions/migration changes. 53 package builds, web types and34 focused UI tests passed; updated component11tests passed. Synthetic numerical proof is integrated but its first run stopped before tests on a react-dom dependency boundary; repair and root gates are pending. Source receipt proof now requires exact EXPAND + DONE. Do not call the synthetic proof passed or production numerical scores available.

Current source audit is read-only and in progress; report target `audits/UNICORN-COVERAGE-2026-10-18.md`. Earlier v1.1 adapter on preserved branches is obsolete and must not be applied blindly. Preserve older local branch `codex/unicorn-pre-takeover-preserved-oct18@6d743f209`.

Live actor fixtures privately reconstructed from existing sessions and explicitly provided Kathryn identity. Temporary feature-only access for existing fictional Kestrel no-mandate organisation3cb03c31-761b-49c1-814f-ede0994e0e34 expires2026-10-18T08:13:52.403Z; revoke only this own override after proof (`/tmp/cq-unicorn-nomandate-entitlement.mjs --revoke`). No account/email/subscription or paid-usage change, original43 grants untouched. Private fixtures `/tmp/cq-unicorn-oct18-live-fixtures.json`; no private bodies in Git. Existing safe helper files and sessions are ephemeral, not portable secrets.

Next: finish236candidate gates/release, verify Railway affected services and paced461v3 reassessment; execute exact Q EXPAND/DONE and real desktop/mobile acceptance; finish factual ten-company audit, genuine isolated numerical proof and237protected release. Never manufacture real scores or silently change methodology. No Home Q/web research/Q Pitch scope.

## Unicorn completion — 18 October 2026, 13:18 UTC

PR233 was normally integrated and released through protected PR236/72679cbec89d9a2d4ed9b139913587ea4b80455f. The current shared production release is PR243/a026a39a727faab0cf52866965c8900be40b53fb; all four Railway services are SUCCESS at that exact SHA. Root preserved and merged the newer integration e05528768; no Q Pitch changes.

Current focused PR237 (`codex/unicorn-product-completion-oct18`) contains useful unscored/Discover recovery, existing founder evidence links, three priority gaps, and a conservative typed P9.A staffing adapter (inputs.v4). All three dated positive functions are required; preserve individual source lineage; undated, partial, forecast and conflicting sets stay unknown. Weights, grading scale, 60% gate and mandatory pillars unchanged. Actual ten-company API/deck audit confirms four matching canonical sections. See `audits/UNICORN-COVERAGE-2026-10-18.md` for per-pillar sample and exact evidence needs; it is not a newly proven global top-ten ranking.

Fresh live Q exposed an additional root cause: Q emitted the correct EXPAND intent but answered that the assessment was unavailable because the screen prefetch loaded only get_company. The new bounded repair hydrates the visible single-company panel through existing authorized fit_profile before synthesis, including the actual stored summary and all twelve pillars. No new model round, engine or authorization path. This is locally tested, NOT yet deployed or client-DONE-certified. Do not mark Q acceptance complete.

Local validation: 53 package builds; 72 scoring/storage tests, 20 manifest tests, 35 UI tests; isolated actual PostgreSQL numerical test PASS under inputs.v4 (67→65), with explicit thin-parent/auth-port/static-CSS limitations. Root and app types passed before the final manifest patch; final checks/protected PR237 CI and live release acceptance remain required. Numerical receipts now persist under `/workspace/.cq-private/`; old /tmp sessions were lost after runtime replacement. Credentials are never committed.

**External audit blocker:** the previously authorized Supabase Management token now returns401 Invalid access token. A secure binding update was requested; Railway and existing-session auth work. Earlier direct v3 replay:461 assessed,0 scored,342 partial,401 observations,max44.5%; do not call those refreshed global counts. Fresh selected36-company feed:0 scored,28 partial,max29%; separate ten-company sample includes Shiftwell44.5%. Fresh global461 census/v4 replay remains blocked. No methodology change is applied or awaiting approval.

Existing investor, free-negative and provided Kathryn/Spheros founder API reads pass; the existing founder application remains5bc3daac-046f-4401-9418-38b03ed68e80. Temporary fictional Kestrel feature override expired at08:13UTC and currently correctly returns404; no fresh premium no-mandate acceptance is claimed and original43 customer grants are untouched. The earlier selected-context change was restored through its existing memberships; do not grant access to real customers to hide this proof gap.

Next: exact-head protected237 gates, protected promotion, all affected Railway revisions, fresh Q EXPAND/DONE and grounded answer, real desktop/mobile CTA/browser acceptance. Finish global census/replay after secure Management access is restored; never fabricate production numbers or lower gates.

## Discover A + Q home voice room — 20 October 2026, 06:45 UTC (Claude)

Founder-directed redesign released by pushing `claude/friendly-feynman-q9haun` to `build/int-rc` and `recovery/2026-09-12` (41e31d18d, fast-forward from 692e7cfb1). Contents: Q home voice room (captions, public web source cards, room presence), Discover A desktop stage + dossier (Q's read with coverage bars, Ask Q over the dossier, interest sending/sent + toast, save/pass toasts with Undo and optional pass reason, no-pitch still, end of slate, 1-of-N), Discover A phone (no bottom buttons, swipe right = interest confirm, swipe left = pass, captions toggle), Escape now closes sheets. Dev harness `/dev/discover` (404 in production). No migrations, no contract breaks (pass `reason` optional, UNPASS uses existing path).

CI39379450382 on 41e31d18d: build, types, lint, pgTAP green; test red only on route-capability-parity (new `/dev/discover` unclassified). Fixed forward by classifying it exempt and regenerating `docs/recovery/capability-parity.md`; parity test 11/11 locally. Railway status could NOT be read: the environment `RAILWAY_TOKEN` returns Not Authorized (rotation outstanding). Live web returns 200; deployed revision not yet confirmed per service.

Next: confirm CI on the fix commit and Railway revisions; founder to pick Profile / Data Room / CRM options (prototypes in the session, not in the repo).

## Chosen designs release — 20 October 2026, 22:00 UTC (Claude)

The founder-chosen redesign is integrated on `claude/friendly-feynman-q9haun` and pushed to `build/int-rc`, `recovery/2026-09-12-8y2j4w` and `recovery/2026-09-12` (93c336aeb).

Contents:

- **Company profile:** option 1, Decision brief, on every tab. Section by section has phone swipe and desktop side arrows. Code is in `features/company/brief/*`.
- **Data room:** option 1.
- **CRM, by page:**
  - Overview: Morning brief.
  - Pipeline: List / Table / Board.
  - Capital: investor option 3 and founder option 1.
  - Record: next-step rail, warm charcoal (`.cq-charcoal` scoped tokens).
  - Diligence: checklist.
  - Messages: inbox split.
  - Calls: week calendar.
  - Deal and close: new routes `relationships/{company|investor}/[id]/deal`.
- **Q stage follows light and dark mode:** the `--cq-night-*` tokens are used in dark; `.cq-cinema` keeps video dark.
- **Rounded corners are restored.**
- **New API:** `POST /v1/relationships/:id/meeting-availability`, which returns busy times only.
- **The shared button reads `--cq-primary-action`.**
- **Dev review pages:** `/dev/profile` and `/dev/crm` return 404 in production.
- **No migrations.**

Local checks on the merged head:

- root tsc: exit 0;
- vitest (web, ui, api, parity, communication): 433 files and 4103 tests passed.

Railway auto-deploy did NOT trigger for 1cb6c83f0, so the deploys were run manually through GraphQL `serviceInstanceDeployV2`. All four services reached SUCCESS at 1cb6c83f0. The live `/auth/sign-in` serves the new button class. 93c336aeb was triggered the same way; its verification is in the next entry.

Next:

- Real-data screenshots with Zino and Tensorgate need the founder's approval for production reads from the sandbox.
- The founder picks options for the remaining pages (the gallery artifact is in the session).
- Rotate the Railway and Supabase tokens pasted in chat, and add them as environment secrets.

## 21 October 2026, 21:05 UTC — Claude coordinator (speed + Q Story)

- **Integrated** 25+ lane PRs into `speed/q-oct20`, each reviewed against the docs and the owner's intent before merging. Several were sent back: the stage checklist became a single line, findings were restored to 3, red card tint removed, context navigation built, onboarding stages restored.
- **Root cause found** for the "blue Q": test pages and evidence rendered without the default `black_gold` preset. Recorded as plan §0.
- **Q Story:**
  - the story is saved verbatim;
  - the 56-beat plan, with emotional map, word-clock cues and a claim mapping;
  - S1–S6 lanes are running;
  - the owner storyboard artifact is published.
- **Credentials:** the Supabase/Railway tokens supplied today work. Keep them as environment secrets; do not revoke them.
- **Nothing deployed.** Owner OK is required for build/int-rc and deploy.

## 2026-10-21 (night) — Claude, Q Story S2 storyboard (`qstory/storyboard`, PR into `speed/q-oct20`)

- **Built:** dev-only `/dev/q-story` (gated like `/dev/instant-nav`; classified in `apps/q-api/test/route-capability-parity.test.ts`; parity matrix regenerated). It replays the plan's beat table on a fixed clock with karaoke captions over the real dev-harness pages (fixtures only), with word-anchored cues, highlight ring, story-mode scrim, photo montage, chips (✕ → ✓ payoff) and Q's presence following the light.
- **Evidence:** `docs/ai-handoff/evidence/q-story/STORYBOARD.md`, 72 key-frame PNGs under `storyboard/` (17 moments × desktop/phone × light/dark = 68, plus 4 reduced-motion), and two full-length captioned MP4 films (desktop dark, phone light).
- **Checks:**
  - verbatim line table = `Q_STORY_VERBATIM.txt` (158 lines, 796 words);
  - route parity test 11/11;
  - eslint and tsc clean on the new files;
  - prettier check.
- **No app code changed.** No provider calls apart from a Pexels search through `packages/q-daily`'s port; the photos are not committed.
- **Flags for the owner** (in STORYBOARD.md): product first appears at 4:28 of 7:55; GateQ score/rank gap (§8.3); the shipped nav differs from the plan's list; a Q Card component exists; story-mode scrim vs ADR 0017.

## Q Story S6: the Q Card — 22 October 2026 (Claude, branch `qstory/qcard`, PR into `speed/q-oct20`)

Evidence stage: **code + local checks only**. Not merged, not deployed. No migration.

- **Richer card, per-section and permission-true:** new card fields, each with a structured `detail` (contract `CardDetailSchema`):
  - `tractionMetrics`;
  - `currentRaise`;
  - `investabilitySummary`;
  - `relationshipSummary`;
  - `team`;
  - `documentsOnRequest`.
- **Same scope system as before:** each field is off until the owner picks an audience. The keys pass the existing `card_field_scopes_valid` check, so there is no schema change.
- **Members-only sections:** the server refuses `public_external` for `investabilitySummary`, `team` and `documentsOnRequest` (`NETWORK_ONLY_CARD_FIELDS`).
- **Per-row scope:** claims and data room levels are filtered against each scope. A public numbers section never carries a members-only claim.
- **Never on a card:** burn, cash, runway and forecasts.
- **Composition:** `apps/api/src/main.ts` `findCompanySections` composes:
  - evidence claims;
  - the active capital objective;
  - the InvestIQ store;
  - `createPostgresCompanyPipelineCounts` (new, network);
  - the team projection;
  - the data room.
- **Investor team:** `createPostgresInvestorTeamRead` (new, investors).
- **Web:**
  - `features/q-card/card-sections.tsx` and a dossier layout in `public-card-view.tsx`;
  - owner controls with hints, and no "everyone" option on members-only sections;
  - black_gold OG image;
  - fixture harness `/dev/q-card-identity` (development-only).
- **Story anchors:** `[data-card-section="story|numbers|raise|intelligence|relationships|team|documents"]` (sent to S1).
- **Evidence:** screenshots and design notes are in `docs/ai-handoff/evidence/q-story/qcard/`.
- **Checks:**
  - packages build;
  - root tsc and the web/api tsc: exit 0;
  - vitest: public-identity, q-card web tests, network, parity — 27 files, all passed;
  - eslint and prettier on changed files: clean.
- **Open:**
  - A PERSON subject type (per-person card) needs a migration plus self-ownership authorization. It is proposed, not built.
  - The amount committed in the raise is not shown.
  - The anonymous read is not cached yet.

## Q Story S6 follow-up: the person Q Card — 22 October 2026 (Claude, `qstory/qcard`; owner-requested, merged with the polish)

The owner asked for the per-person card to be built. Evidence stage: **code + local checks only**.

**Needs a migration:** `20261229090000_person_q_card.sql`.

- It is additive: it widens the two subject-type checks, makes `organisation_id` nullable only for PERSON, and requires a PERSON row's claimer/creator to be the person.
- pgTAP test: `rls/521_person_q_card.test.sql`. It was **not run locally** (no Docker); the CI database job runs it.
- The coordinator applies it.

What changed:

- **Authorization:** a person manages only their own card, the same rule as `profile-images` PERSON. No new capability. Q's `handle.claim` and the app-action card claim/update are narrowed to organisation subjects.
- **New server-side reads:**
  - `createPostgresPersonCardRead` (security/postgres);
  - `createPostgresCompanyAffiliationRead` (companies);
  - `createPostgresInvestorAffiliationRead` (investors);
  - `personStandings` (verification): the person's own founder-identity claim only.
- **Focus:** a person's "what they're looking for" is built only from their organisation's own card at the same audience.
- **The organisation-verified claim** on a person card is shown only when the affiliation is visible.
- **Web:**
  - a profile section, "Your personal Q Card";
  - public rendering, Person JSON-LD, vCard N/ORG/TITLE;
  - search handles person cards;
  - one i18n string added.
- **Checks:**
  - root, web, api, q-api and workers tsc: all pass;
  - vitest: public-identity, app-actions, network, verification, investors, companies, q-api handle-claim and parity, and the web q-card, search, profile and i18n tests — 72 files, all passed after the catalogue fix;
  - eslint and prettier on changed files: clean.

## Q Card polish and public-read cache — 22 October 2026 (Claude, `qstory/qcard-polish`)

Evidence stage: **code + local checks only**.

- **Coordinator review items:**
  - (a) and (b): one right-aligned "Members only" marker. It sits on every section heading and at the "Additional information" heading, never under a value.
  - (c): Q's-reading caption raised to body-small secondary.
- **Cache:** the anonymous `/@handle` read is cached for 30 seconds and tagged `q-card-public` / `q-card:<handle>`. A signed-in read is never cached.
  - `updateTag` runs on a card save and on a handle claim.
  - `connection()` replaces `force-dynamic`, which forced no-store.
  - Test: `apps/web/test/q-card-public-cache.test.ts`.

## 2026-10-22 — Claude, lane 8: Q reads attached documents (`speed/q-uploads`, PR into `speed/q-oct20`)

- **Fixed:** Send is now live on a finished attachment alone, and held while one uploads. Drag-and-drop and several files work. A WorkingLine shows "Reading <file>".
- **Built:** one attachments store for the Q page and the dock.
  - Ids ride `screen.attachedDocumentIds` on the turn and its follow-ups; "New chat" clears them.
  - The new tool `read_attached_document` reads each one as the asker through Evidence (`document.view`).
  - It waits up to 12 s for the pipeline's pages. A short document is read whole; a long one by its opening plus pages matched by FTS.
  - It finds earlier uploads by name.
  - The model-gateway prefetch puts the pages into the prompt as USER_CLAIM / DOCUMENT_SUPPORTED facts, cited by page.
- **No migration.** Nothing is persisted beyond the existing document.
- **Lane 4:** the `index.ts` edit is an isolated commit; lane 4 was told before it was made.
- **Evidence:** `docs/ai-handoff/evidence/q-uploads/`.
- **Not done:**
  - onboarding was left on its own working upload path;
  - no OCR for images (they say plainly that they can't be read);
  - no full-stack or live run.
    \=======

## 22 October 2026, 03:20 UTC — Claude coordinator (speed + Q Story, night)

Evidence stage: **code + local checks; CI running on #267; not deployed** (Railway still in a major outage).

- **`speed/q-oct20` at d5ec13f7c** has these merged:
  - lane 1's CI fix and the `build/int-rc` merges (#310);
  - Q Card #305, with the person card (migration `20261229090000_person_q_card`, pgTAP 521; **not applied**) and the polish;
  - lane 4's parallel extras #306 (`CQ_Q_PARALLEL_EXTRAS=off` switches it off; the owner accepted the cost);
  - lane 8 uploads #308 (Send live on an attachment alone; `read_attached_document`);
  - the Q Story engine #299 with the voice render;
  - S3's spoken bank matcher #311.
- **Q is not given Settings › Activity by name.** The `build/int-rc` owner's privacy stance ("Q reads no one's activity") wins; my contract addition is reverted.
- **Owner decisions:**
  - Story voice: **Lily** (`pFZP5JQG7iQjIQuC4Bku`, eleven_v4_turbo). Voice spend about $1.62 of the $3 cap.
  - The "Do you have any questions?" ending belongs to the live Q Pitch only, not the video.
- **Master video:** the Lily master is at `qstory/engine` b74361536 (`docs/ai-handoff/evidence/q-story/master/`). The coordinator's frame review found:
  - a blank opening with no Q;
  - the player controls visible;
  - small, low-contrast subtitles;
  - undersized artifacts;
  - an empty Investability IQ box;
  - stray shapes on "Weeks · months · years".

  S1 is re-recording. The "Internal rehearsal" stamp stays until the owner approves AUDIENCE.

- **CI on #267** (run 39714828957):
  - typecheck and format/lint: green;
  - build: failed in corepack's pnpm install;
  - pgTAP: failed;
  - lane 1 is on both.
- **Open for the owner:**
  - Lily as Q's voice everywhere (story answers are already scoped to Lily);
  - S3 tier 2 (embedding precompute blocked by the session permission check; a $0.001 call) or an in-browser model;
  - AUDIENCE approval for the video;
  - rotate the Railway and Supabase tokens.

## 2026-10-22 — Claude, S1 Q Story engine (`qstory/engine`, draft PR #299 into `speed/q-oct20`)

Evidence stage: **code + local production-build checks; nothing deployed.**

- **Master video (Lily, eleven_v4_turbo):** `docs/ai-handoff/evidence/q-story/master/q-story-master-1080p.mp4` (1920×1080, 30 fps, 6:43) and `q-story-master-720p.mp4` (9.3 MB), with `audit.json` and 2 s frame sheets.
  - Audit hits went from 554 to 28, and all 28 are GateQ's own strict-gate copy ("Others see why and can't send").
  - Fallback cues 13 → 0, dev badge 0, CLS 0.0001.
  - Recorded with `scripts/q-pitch/master-story.mjs --pitches <dir>`. The clips come from `scripts/q-pitch/fetch-pitch-clips.mjs` (Pexels, never committed).
- **Harness:**
  - Discover renders in the app shell, with every rule checked.
  - Beat 41 opens the GateQ review dossier application, so it has a transcript and a brief.
  - The montage screens are retaken from the prod build.
- **Live story only:**
  - After the last beat and 2.5 s of quiet, Q asks "Do you have any questions?" (S5's Lily clip, `closing.*`) and listens: the person's own Q line opens with that question when one isn't open already.
  - "Hey Q, pitch yourself" (`classifyStoryTrigger` STORY), typed or said on any page with Q Pitch on, opens the story and starts it.
  - In-story spoken answers use the narrator's voice. This is an additive optional `presenter: "STORY"` on `CreateQSpeechRequestSchema`, mapped in q-api to `STORY_VOICE_ID`. Q's global voice is unchanged.
- **Checks:** root tsc clean; web and q-api tsc clean; vitest story/q-pitch 260/260, q-api speech + contracts 543/543; eslint and prettier clean on changed files. Browser check of the ending: card and clip at +2.5 s.
- **Not done:** the live-line listening can't run locally (no providers). The owner still has to approve the story ledger, so the story stays INTERNAL_REHEARSAL.

## Demonstration companies seed — 22 October 2026 (Claude S6, `seed/demo-companies`)

Evidence stage: **code + local database tests**. Not applied to hosted; the production run is an owner-approved step at deploy time (`docs/seed/demo-companies/README.md`).

- **Owner answers (22 Oct):**
  - David's surname is Nwankwo (confirmed).
  - Capital Q is in Lagos, NG; website `https://capital-qweb-production.up.railway.app/`.
  - KUUZA AI: fill gaps only.
  - A visible "Demonstration data" label everywhere.
  - Songscribe is real and its owners agreed. It is an AI songwriting assistant founded by Excel Chukwu and Zino Mario.
- **Migration** `20261229100000_company_demonstration_data` (additive column). The coordinator applies it.
- **Local database without Docker:** all migrations apply from empty. pgTAP 520 24/24, 521 11/11, 580 14/14.
- **Checks:**
  - seed tests 9/9;
  - vitest 85 files, 1,032 tests;
  - root, web, api, q-api and workers tsc: clean;
  - eslint and prettier: clean.
- **Scores (local):**
  - Capital Q and Songscribe: InvestIQ 50, Investable, Low confidence.
  - Unicorn: insufficient evidence for both.
  - KUUZA AI: not listed.
- **Open:**
  - Zino's photo.
  - Account emails for the person cards.
  - Real verification, deck and backgrounds to move scores.
  - Investor Discover needs verification.

## Capital Q team and data room seed — 22 October 2026 (Claude S6, `seed/capital-q-team-docs`, stacked on `seed/team-photo-card`)

Evidence stage: **code + local database tests**. Not applied to hosted; the production run is owner-approved at deploy (`docs/seed/demo-companies/README.md`, steps 5–8).

- **Team:** memberships seeded directly (`organisation_member`), with **no invitations**, for David Nwankwo (Founder & CEO), Captain Zino Mario (Co-founder), Daniel Oyeniyi and Adeyemi Odunyugbo (Engineering). Background lines are roles only.
- **Data room:** S7's manifest is consumed, and only the pitch deck (PUBLIC, investors may download) and the financial model (ON_REQUEST) are uploaded, through the real document path (`evidence.document.version_created`). Legal summaries and the cap table are not uploaded.
- **Deck reading:** on hosted, the real pipeline and the gateway deck reader produce it. Locally, a clearly marked fixture (`local-deck-reading.fixture.json`), refused with `--hosted`. `--confirm-deck` is a later, separate run.
- **Scores (local, fixture reading):** Capital Q InvestIQ 50 Investable → 76 Strong, Low confidence; 4/8 areas, 15/46 criteria. Unicorn: still insufficient evidence. Verification is unfaked.
- **Checks:** seed tests 12/12; vitest 23 files, 255 tests; root, web and api tsc clean; eslint and prettier clean on changed files.
- **Owner steps:** the pitch video at `/pitch/new` ("Everyone on Capital Q"); account emails for Zino, Daniel and Adeyemi; Zino's headshot; the beat #49 relationships decision.

## Capital Q data room: all six documents — 22 October 2026 (Claude S6, `seed/capital-q-team-docs`)

- The owner superseded "business docs only" with "upload everything", confirmed directly to S6. `--documents` uploads all six manifest documents. Only the deck is PUBLIC; the rest are ON_REQUEST and watermarked illustrative.
- The pitch video stays an owner step at `/pitch/new`. The seed checks its sha256 and prints the step.
- Capital Q's contribution-margin statement is reworded to match the documents: revenue less cost of revenue and variable onboarding and support.
- Re-score (local): unchanged at 76 Strong, Low confidence, 4/8 areas, 15/46 criteria. InvestIQ reads no data-room document except the deck, so governance, legal and diligence stay at 0.
- Checks: seed tests 12/12.

## 22 October 2026, 15:55 UTC — Claude coordinator (Q Story editions, Capital Q seed)

Evidence stage: **merged into `speed/q-oct20` (1c2751ec3) and local gates passed. CI on #267 for this head has not been confirmed. NOT deployed** (Railway still in a major outage).

- **Q Story editions:** FULL, INVESTOR and FOUNDER, each a verbatim cut of Lily's audio.
  - Triggers: "pitch to an investor / founder / everyone"; the Q Pitch page has a three-way picker.
  - Beat-34 title card: "Capital Q / Home of Private Capital".
  - Capital Q's own Q Card: David Nwankwo's photo, the "Strong" reading, and a story-only "Investor conversations: 12" (the owner chose this; never written to the database).
  - The owner approved all three for AUDIENCE; the approvals are recorded per version, and the stamp is gone through the gate.
  - Masters, under `docs/ai-handoff/evidence/q-story/master/`, sent to the owner:
    - INVESTOR 3:58.8, at 25c6141b0;
    - FOUNDER 4:26.8, at 7ea60dded;
    - FULL 6:44.7, at 1ebe3ce07.
  - New audit checks: clutter behind over-page visuals; out-of-frame or subtitle-band intrusion.
- **Capital Q seed:**
  - #319, #322 and #324 for the companies and team; #325 for all six documents; #323 by S7 for the documents themselves.
  - Every document is watermarked as a demonstration document; the legal ones are summaries only.
  - The pitch video is the INVESTOR master.
  - Local InvestIQ: 76 STRONG once the deck is confirmed. Governance, legal and diligence stay at 0 by design: those areas read only confirmed facts and verification.
  - The hosted seed run is a deploy-time step that needs the owner's OK.
- **Migrations to apply before the code:** 20261228214500, 20261229090000 and 20261229100000. 20261228210000 is already applied.
- **Open for the owner:**
  - Zino's headshot;
  - account emails for Zino, Daniel and Adeyemi;
  - David uploads the pitch video at /pitch/new after deploy;
  - the voice hybrid decision, or fix the Speech Engine id;
  - rotate the Railway and Supabase tokens.

## 2026-10-23 — Production seed run (Claude worker S9b, branch `seed/production-run`, PR #333)

- **Hosted writes, owner "go" in-session:**
  - 3 team accounts: `zino.mario@`, `daniel.oyeniyi@`, `adeyemi.odunyugbo@fictional.capitalq.local`. Confirmed; no email sent.
  - **Capital Q** (`ee75a7d8…`, organisation `f95c3469…`) corrected in place: 11 self-reported claims, taxonomy, the raise, Q Card, `capital-q-hq`, demonstration label.
  - **Team:** David is `founder.capitalq@fictional.capitalq.local`. David, Zino, Daniel and Adeyemi are members, with titles and names. David and Zino have photos and the cards `@david-nwankwo` and `@zino-mario`.
  - **Documents:** all six; deck PUBLIC, the other five ON_REQUEST. Deck reading `23364fd4…` confirmed.
  - **KUUZA AI:** gaps filled.
  - **SongScribe AI:** gaps filled only, with the 4 figures that fit its product.
  - **Pitch video:** trimmed to 179 s (the product max is 180 s; the original is 3:59). Uploaded through `/pitch/new` as David: asset `104d9721…` READY, NETWORK.
- **Live verified:**
  - one Capital Q;
  - Team 4 with photos; both person cards 200;
  - documents at their levels;
  - InvestIQ 75/100;
  - "2 videos" on the profile; Stream playback request 200.
- **Open:**
  - **Q and the new claims:** Q answers from the Capital Q profile but says it has no authorised record of revenue, customers or raise. The new claims don't reach it yet: projection lag or a retrieval gap, not diagnosed.
  - **Explore:** Capital Q was not in the first 25 cards for `investor.equator-line` (a Series A fund).
  - **`seed.mjs` profile names:** the script sets no names; they were set by hand this run.
  - **Tokens:** rotate the Supabase token.
- **Evidence:** `docs/seed/demo-companies/PRODUCTION-RUN.md` and `evidence-2026-10-23/`.

## 2026-10-23 — Q reads company figures; seed sets names (Claude worker S9b, branch `seed/q-claims`)

- **Diagnosis (read-only, production):**
  - Q never read `evidence.claims`. `get_company` returns only the profile.
  - Q's knowledge and chunk reads are scoped to the viewer's tenant, and all 65 investor organisations sit in other tenants.
  - The seeded claims were correct: `network_visible`, `PUBLIC`, `SELF_REPORTED`, `CURRENT`. This was a retrieval gap, not data or lag.
- **Fix:** `read_company_figures` (`company.figures.read` v1, `packages/q-tools/src/tools/company-figures.ts`).
  - **Admission:** exactly `get_company`'s.
  - **Reads:** only claims at `network_visible` or `public_external`, in the company's own tenant. A bound company admitted by another disclosure reason gets `public_external` only.
  - **Filtering:** every claim must be no more sensitive than the grant. Rows are filtered again in the tool, whatever the port returns.
  - **Output:** truth class and evidence status are separate fields. NONE means unknown, never zero.
  - **Wiring:** the port is composed in `apps/q-api/src/main.ts`, reading through `createPostgresClaimQueryPort`, the same read the public card uses.
  - **Context Firewall:** unchanged.
- **Seed:** `seed.mjs` sets profile names, and a missing headline, from the fixture.
- **Checks:**
  - q-tools: 1808/1808, including 7 new tests. Mutating out the filter fails 3 of them.
  - Seed local tests: 12/12.
  - Root tsc: exit 0. q-api tsc: exit 0.
  - eslint and prettier: clean on the changed files.
- **Not yet:** deployed and verified live (Q answering about Capital Q with its figures).

## 2026-10-23 21:20–23:45 UTC — Claude Code, owner-account QA (session_01PN5eKvDzKV5Qp1pvqP9jMB)

- Browser QA on production as the owner's investor account (approved by the owner in-session), plus two new accounts made through `/auth/sign-up` (founder "Kiln Payroll", investor "Harbourline Ventures"; both fictional companies). No outward action approved or sent (checked in `network.relationship_events`).
- Findings QO-01…QO-46 with evidence: `docs/ai-handoff/evidence/qa-owner/FINDINGS.md` on `qa/owner-accounts`. Reported to the coordinator (session_01SxtUYQjYXwv8hH5D5RGfsK) three times.
- PRs into `speed/q-oct20`:
  - #382: attention in plain words, one held draft per person;
  - #385: logos kept whole and transparent.
  - Both have gates green; neither is merged or deployed.
- Not testable from the cloud sandbox: live voice and rehearsals. WebRTC ICE never connects through the HTTPS-only proxy.
- Worst open items: QO-23 (deck not read: filename keyword classifier), QO-10/QO-40 (no save-to-Work), QO-27/28/29 (investor mandate saved wrong; feed blocked), QO-05/33/36 (entity resolution), QO-09 (LEGO picture).
