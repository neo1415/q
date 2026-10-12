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
