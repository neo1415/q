# Capital Q — Current shared engineering state

## Cross-model source checkpoint — 2026-10-11 19:06 UTC

Complete new directives are preserved under `session-directives/` and linked in DECISIONS.md. The initial additive `INVESTIQ-RECONCILIATION.md` supplies stable chapter-qualified IDs and legacy mappings; it is not an exhaustive reconciliation or approved numerical methodology. Demo corrections `ad470389` are committed/pushed but held off the active exact CI gate (`38164882385`, `e271242e`, pgTAP passed, quality Test running). Live dock card rendering and named-company after-change acceptance remain pending.

## Live demo rehearsal: comparison and dock-card gaps — 2026-10-11 18:52 UTC

- **DEPLOYED:** all four services SUCCESS at `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66`; exact quality/pgTAP CI `38162345315` SUCCESS, manual e2e SKIPPED. No additional migration; hosted/local 201/201. Rollback points include the prior exact green `c950e29b` and `efcf49ab`.
- **LIVE VERIFIED API:** top ten now produces ten distinct authorized company cards (previous actual result: one). Scores 10, 10, 8.5, then seven 6s; first 20 answer characters 4,350 ms, terminal 4,442 ms in this one cold observation. Top three produces three distinct company cards, scores 10/10/8.5, first text 1,836 ms, terminal 1,906 ms. These are mandate fit, not InvestIQ quality scores. No load/p95 or first-audio claim.
- **LIVE VERIFIED selected-company API:** company explanation/fit question and traction-risk-gap follow-up each returned correct company references/findings, no public sources. First text 4,284 / 3,641 ms; terminal 20,329 / 19,792 ms. This is existing authorized profile evidence, not access to private founder interview responses.
- **FAILED live comparison:** explicitly comparing two prior named cards after those prose follow-ups produced ten companies. Existing fit sweep lost the explicit subset because its latest answer had no cards and selected the candidate pool.
- **FAILED live browser presentation:** Discover Ask Q returned three canonical card blocks, but no card elements rendered. `QAnswer` drops ANSWER_CARDS because it assumes a separate Q stage; the dock has no stage and its Board also omits these blocks. API completion is not visible product capability.
- **IMPLEMENTED / LOCAL TESTED fixes:** exact named comparison targets resolve from bounded durable prior cards (ambiguous names omitted), then existing `fit_profile` reauthorizes those IDs; no `fit_top_candidates` expansion. Dock opts into the existing static card renderer; full Q stage retains existing ownership. Original comparison and dock-render regressions fail. Corrected 96 gateway tests and 36 web tests pass; 52 package builds, q-api/web types and changed lint/format pass. Final combined root types pass. These fixes await commit/push and exact CI; neither is deployed.
- **COMMITTED / CI RUNNING:** named-company evidence binding plus previously held spending/gap packets at `e271242e6833d07820c32a8e679f3403ba1ca560`, integrated and pushed; exact CI `38164882385` pgTAP SUCCESS, quality running. Preserve that gate; do not deploy current work HEAD without exact required checks.
- **Next:** commit the combined comparison/dock fix after final types, hold it off the active CI branch until that gate completes, verify and deploy exact green revisions, then rerun actual browser card-to-profile journey and offscreen named-company SSE before/after. Historical 8.8 and first audio remain unverified. Continue source reconciliation/proposed FDN methodology without changing approved production math.

## Investor demo: named-company attribution — 2026-10-11 18:38 UTC

- **COMMITTED / PUSHED:** canonical document-gap packet `0ea65ec4`; spending fail-closed guard `78a5dde9`. Both remain off the deployment branch until their exact gates pass. Document expansion is paused for the October 12 investor demo.
- **CI GREEN / RELEASE IN PROGRESS:** top-ten and fit coverage revision `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66`, CI `38162345315`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to the deployment branch. Four-service readiness and actual top-ten output are not yet verified.
- **IMPLEMENTED / LOCAL TESTED:** findings and COMPANY_REFERENCE for explicitly named-company questions use a single exact canonical name from a schema-valid successful READ_ONLY company profile result. Screen focus, denied/malformed/search-only reads and duplicate names cannot supply the target. Ambiguous or unread targets remain unattributed. Final reader guidance reaches the answer even when screen reads warmed before classification. Existing lookup tools and permissions remain authoritative; no private onboarding disclosure added.
- Original full-seam regression fails in both warm and cold cases. Corrected 61 tests across four gateway files and 52 package builds pass. Root/q-api types and changed lint/format pass; after fixture typing cleanup, both full-seam cases pass again. This fix is not yet gated or live. Live named-company SSE baseline: first 20 answer characters 10,395 / 6,454 / 4,389 ms; terminal 33,164 / 16,619 / 12,148 ms. All three have incorrect company references. No after-change improvement claimed.
- **Next:** commit/push and gate the named-company packet; verify the current four-service release and genuine top-three/top-ten cards; rehearse company questions, follow-ups and comparisons with first-answer SSE timing. The historical real-record 8.8 and first audio remain unresolved. Proposed InvestIQ quantitative methodology is authorized design work, not approved production math.

> Shared by Claude Code and Codex. Update at the start and end of every substantial session.
> Evidence words: CODE OBSERVED · IMPLEMENTED · MERGED · LOCAL TESTED · CI GREEN · DEPLOYED · LIVE VERIFIED · BLOCKED.
> A recorded SHA is a snapshot; re-check Git and Railway before trusting it.

## Canonical gaps correction and investor-demo priority — 2026-10-11 18:28 UTC

- **LIVE VERIFIED:** the same workforce ONE_PAGER now has READY version 2, version 1 preserved, a rendered dialog and a valid changed one-page A4 PDF. All three original findings and nine canonical gaps remain identical. The viewer displays all nine gaps in its existing dedicated section. The earlier sections-array-only check was too narrow: a gap section already exists, rendered from `content.gaps`, with the old label “What isn't on record yet”. Do not introduce a duplicate gap source to fix that check.
- **IMPLEMENTED / LOCAL TESTED:** viewer and PDF consistently label that existing section “Evidence gaps”; the existing writer receives the canonical gap list as read-only input within its existing 40,000-character bound. No new artifact field, registry, prompt version or paid stage. Original gap-context regression fails; final 63 writer/viewer/export tests pass. 52 package builds, root/web types, changed lint/format pass; final fixture rerun passes 6/6. This packet is work-branch only.
- New founder directives make the October 12 investor demo the immediate priority. Stop expanding documents as the primary task after committing this packet. Prioritize wrong-company evidence attribution, named-company speed, existing top-three/top-ten cards, follow-ups and comparisons, and a repeatable authenticated live rehearsal. Preserve exact CI/release gates and rollback revisions. First audio remains unverified and is not a prerequisite for the text demo.
- The new InvestIQ addendum authorizes a serious implementation-ready proposed quantitative methodology and additive source reconciliation. It does not approve new production scoring semantics or label them official FDN methodology. Investigate repeated actual 6.0 and 3.5 values as well as the unresolved historical 8.8; preserve Core Seven, readiness, confidence and investor-match separation.

## Live viewer release and workforce spending guard — 2026-10-11 18:15 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `c950e29b1be47d9d319311a151b59249fd70ff26`. Exact CI `38160313579`: quality and pgTAP SUCCESS; manual e2e SKIPPED. No additional migration; hosted/local remain 201/201.
- **LIVE VERIFIED partial document revision:** the same workforce ONE_PAGER in its original conversation now returns a READY same-artifact receipt, real current version 2 and history [2, 1]. Original findings and gaps remain identical. Client completion 18,295 ms is a functional observation, not an isolated latency benchmark. Requested Evidence gaps section is absent: full instruction acceptance remains FAILED. Existing writer only accepts bodies for existing headings and does not render the gap list into its model input. Structural/evidence-aware revision is the next writing correction.
- **LIVE VERIFIED unresolved targeting defect:** actual Discover Ask Q request named the genuine founder while its card was offscreen. Fresh run COMPLETED and mentioned the company, but its COMPANY_REFERENCE and all company findings still bind the other on-screen company. Five PUBLIC_SOURCE blocks do not establish founder-onboarding evidence. The flag propagation fix is deployed, but this journey remains FAILED; investigate canonical authorized reads and answer-subject projection without exposing private onboarding responses.
- **IMPLEMENTED / LOCAL TESTED spending guard:** unavailable or malformed monthly ledger data no longer counts as zero spend. New proposals are not planned; already-approved queued work is HELD with an accurate spending-check explanation. Explicit unlimited configuration and healthy/exhausted allowances retain their behavior. This is a start guard, not durable aggregate job-budget enforcement.
- Spending guard: old code fails four regression checks; corrected 40 tests across five workforce files pass. 52 package builds, root/q-api types, changed lint/format and diff checks pass. It is held on the work branch, not deployed.
- Separate top-ten candidate `5f3a0c8c725dc89dba22d4d0ee42f0a9ced18e66` is integrated; exact CI `38162345315` pgTAP SUCCESS, quality running. Do not replace this active gate or deploy work HEAD. Actual top-ten acceptance follows its own exact green release.

## Bounded top-ten continuation — 2026-10-11 17:54 UTC

- Viewer/fit/named-subject candidate `c950e29b1be47d9d319311a151b59249fd70ff26`, CI `38160313579`: pgTAP SUCCESS, format/lint/typecheck passed, full tests running. It supersedes intermediate `14ed87c1` run `38159120931` (quality CANCELLED, not failed; pgTAP passed). Deployed services remain SUCCESS at `efcf49ab`. Do not deploy work HEAD without its exact gates.
- **LIVE VERIFIED:** released top-three request now returns three real cards (10, 10, 8.5), versus one before. A separate top-ten request still returns one. No live tool-failure trace is claimed.
- **IMPLEMENTED / LOCAL TESTED next packet:** top-candidate tool preserves every canonical profile/parameter, order and disclosed raise. If repeating all reasons in prose exceeds the existing envelope, reuse the same canonical formatter in summary mode. Captured authorized ten-profile envelope falls 33,377→28,203 chars under unchanged 32,000 limit, with all typed data equal. Usual smaller results retain their full text. If typed data itself exceeds the limit, the executor still refuses it.
- Validation: 52 package builds; final 82 fit/domain/tool/card tests across five files and q-api types/lint/format pass; root typecheck passed; final complete-service fixture rerun passed 6/6. Initial synthetic fixture was itself too large even without duplicated prose; corrected fixture explicitly proves typed data fits, reproduces the old full-text RESULT_TOO_LARGE and preserves the oversized-data refusal. Fixture return union/async lint issues corrected before final checks. Actual projection measurement uses privately captured authorized data, not a new live tool execution.
- Hold this separate packet off integration/CI while the viewer-context release gate finishes. After exact green/deployment, retry the same workforce one-pager revision and off-screen company targeting; then gate/release the bounded ten-profile packet and repeat the actual top-ten request.

## Live document/latency release and viewer-context correction — 2026-10-11 17:35 UTC

- **DEPLOYED:** all four Railway services SUCCESS at exact green `efcf49ab8c8f90fbb8494075acd9fd605bd63546`; CI `38154358888` quality + pgTAP SUCCESS, manual e2e SKIPPED. Migration `20261222150000` applied; local/hosted 201/201.
- **LIVE VERIFIED:** existing private report revises in the same conversation from version 1 to 2, same artifact, actual READY content and Evidence gaps section. Released Documents page still opens and renders.
- **LIVE VERIFIED initial workforce connection:** existing proposal/approval flow produced exactly one DOCUMENTS/OWN_COMPANY/PREPARE/ONE_PAGER step, only documents.own.prepare, approved budget $0.50. Actual observation: agent RUNNING while artifact PREPARING/version 0/no row; DONE only with READY/version 1/actual row. Authenticated detail/render pass; canonical PDF 200/application-pdf/valid header, one A4 page. Content: two sections, three USER_CLAIM findings, nine explicit gaps, audit passed. This is not final intelligent autonomous research/writing/design/critique.
- **FAILED conversational workforce revision:** same conversation and viewer reference returned no revision receipt; version stays 1. Scoped hosted run confirms screen stored only route, dropping artifactId/version. New regressions fail twice on old runtime. **IMPLEMENTED / LOCAL TESTED:** preserve artifact/viewer hints through run creation and firewall without adding subjects/grants; document page only retained with authorized document. All 52 builds, 189 screen/firewall/routing/tool tests, q-api types and changed lint/format pass; root typecheck passed. Exact-commit CI/live retry still required.
- **LIVE MEASURED mandate first text:** before ab962576 2,742/2,098/1,895 ms; after efcf49ab 2,447/840/892 ms. Median 2,098→892 ms (57.5%); only three runs each, no p95 claim. All actual answers COMPLETED; no FAST_CLASSIFICATION usage after. Structured-extraction ledger rows remain and were recorded 2,954/1,852/1,603 ms after run completion; no claim that all model work disappeared.
- Fit/named-other packet `14ed87c1` pushed to integration/CI; `38159120931` pgTAP SUCCESS, quality tests running. Its separate 29 preservation/prompt tests also passed locally. Not deployed. Off-screen targeting remains open.
- One bounded actual Talk-with-Q retry used a synthetic spoken WAV after ten seconds of silence. Provider/duplex requests succeeded but no PCM/playing event arrived; first audio remains unverified. Existing renewal/reconnect bounds are present; repeated session opens alone do not prove an unbounded retry defect. No additional paid voice attempt without new evidence.

## Codex fit evidence and gated release — 2026-10-11 17:20 UTC

- Exact candidate `efcf49ab8c8f90fbb8494075acd9fd605bd63546` is **CI GREEN**: run `38154358888` quality and pgTAP SUCCESS; manual e2e SKIPPED. Additive migration `20261222150000` applied through the existing transactional HTTPS migration runner; hosted/local now 201/201. Exact candidate pushed to deployment branch; Railway builds in progress, not yet DEPLOYED. Newer work is held off deployment.
- **IMPLEMENTED / LOCAL TESTED:** canonical fit cards preserve MISMATCH as “Does not match”, distinct from UNKNOWN, and use the shared nine-measure contract limit. The real 42-profile audit showed 39 coverage errors caused by dropped MISMATCH evidence, not the eight-measure cap: all actual profiles had six applicable measures. The separate cap defect is covered by ninth-known/ninth-unknown regressions. After correction: 42 scored profiles, zero coverage errors, zero changed canonical scores. Ranking and InvestIQ methodology are unchanged.
- Final package build 52/52; card/renderer tests 45/45 and contract tests 3/3; root/web/q-api typechecks and changed lint/format pass. Raw authorized profiles and receipts remain private.
- Additional scoped investor history: 14 stored result-block messages, one numeric card score (10), no 8.8. This does not reproduce the historical reported incident. Actual UI Talk-with-Q opened provider sessions but no observed PCM/playing event; no first-audio success or root-cause claim. Do not repeat paid voice attempts without a new hypothesis.
- Next: verify four service revisions; run actual SSE mandate comparison without overwriting baselines; execute approved private typed document job through real READY/render and conversation revision. Initial evidence-only preparation remains a connection, not the final intelligent research/writing/design/critique product.

## Codex named-subject handoff preservation — 2026-10-11 16:17 UTC

- Release candidate `efcf49ab8c8f90fbb8494075acd9fd605bd63546` is pushed to integration/CI. Run `38154358888`: **pgTAP SUCCESS**, quality in progress. The preceding candidate's six navigation failures were corrected, and final focused 207 tests plus 13 artifact rerun, 52 builds, root/q-api typechecks, lint/format passed. Migration not applied; deployed services freshly verified `ab962576`.
- Separate **IMPLEMENTED / LOCAL TESTED** correction preserves the turn reader's `aboutNamedOther` flag through QAnswerRequest into both existing conversational path decisions. They formerly hardcoded false and could remove lookup tools in favor of unrelated prepared context. A real answer-seam regression fails with zero offered tools on the old code, passes on the correction; 181 tests across five answer/voice-routing files, 36 dependency builds, root/q-api typechecks and changed lint pass. Voice speculation is cancelled when the final named-subject reading differs. No new resolver, subject grant or service was introduced.
- This does **not** establish that the live off-screen company defect is fully fixed: a specialist misclassification may precede this seam. Scoped Railway filters for those actual runs returned no logs, so no reader-flag trace is claimed. Correct focused-founder Discover evidence remains verified; first audio and off-screen targeting remain open.

## Codex product-routing and readiness correction — 2026-10-11 16:07 UTC

- **CI RED:** exact `4d26e9e6` run `38150727138` passed format/lint/typecheck and pgTAP, but quality tests failed. Local broad diagnosis reproduced six navigation failures: the mandate guard inspected its scope before checking whether the utterance was a mandate recall. The utterance check now runs first; all 14 named-record navigation and 25 mandate tests pass. No security binding or fixture was weakened.
- **IMPLEMENTED / LOCAL TESTED:** explicit conversational edits of an existing document now reach the existing canonical revision tools instead of an OPEN_RECORD_PAGE shortcut. Research and outward/multiple-action requests retain their normal path. Final focused routing set passed 183 tests; package builds (52), root/q-api typechecks, changed lint/format passed for the routing correction.
- **IMPLEMENTED:** canonical artifact reads and workforce resume now reject READY when its actual immutable version row is absent; a positive cached version number alone is insufficient. Final 207 tests across six files, 52 package builds, root/q-api typechecks and changed lint/format passed; final artifact fixture rerun passed 13/13. Existing PREPARING polling, cancellation-before-completion and version-zero rejection remain intact.
- **LIVE VERIFIED baseline:** private report version 1 renders in the existing viewer; canonical PDF export returns 200, application/pdf, with a valid PDF header. Its conversational revision still produced no version 2 on deployed `ab962576`.
- **FAILED live journey acceptance:** new browser SSE run on Discover mentions the requested founder company but binds findings/reference to a different on-screen card. The actual founder onboarding is COMPLETED with 23 responses and no pending question; the company is visible in the investor's authorized feed and six shared non-null profile fields agree with the network preview. These facts prove source availability, not correct Q interrogation. No private onboarding answers or identifiers are committed.
- **LIVE VERIFIED focused founder path:** moving 29 cards through the actual Discover feed reached the authorized founder card. A new browser SSE run COMPLETED with that company subject/reference and all company findings correctly bound; two USER_CLAIM/SELF_REPORTED findings and two UNKNOWN findings were preserved. This does not prove access to all private onboarding responses. Off-screen named-company targeting remains defective.
- Document migration remains **NOT APPLIED HOSTED**. All services remain at `ab962576`; latest corrections require exact-commit quality + pgTAP before migration/deployment. First useful text improvements, first audio, actual historical 8.8 reproduction and intelligent autonomous document/revision acceptance remain open.

## Codex measured product continuation — 2026-10-11 15:40 UTC

- Release candidate `4d26e9e6` is on integration/CI. Exact run `38150727138` **pgTAP SUCCESS**; quality passed lint/typecheck and is running tests. Migration remains unapplied until both gates pass. All four services still serve `ab962576`.
- Separate next correction is locally validated: explicit top-three candidate sweep asks three instead of ten unless a place filter needs the wider window. Real top-ten envelope with disclosed raise views exceeds the tool limit; original regression fails, corrected suite passes. 33 dependency builds, 36 targeted tests plus final 10-test fixture rerun, root/q-api typechecks and changed lint/format passed.
- Actual founder company is visible in the current synthetic investor's 42-record feed; own profile and investor network preview both return 200. No 8.8 appears among those real authorized profiles. See SCORE-LINEAGE for the actual histogram; historical 8.8 reproduction remains open.
- Foreground private Q_REPORT reached real READY version 1, but a conversational revision returned an OPEN_RECORD_PAGE DOCUMENT intent and kept version 1. That is a product routing defect, not successful revision. Initial one-page wording also produced a report and ran public research. The final intelligent document product remains unfinished.
- Existing-cohort voice session opened, VM WebRTC failed, session ended. First audio remains unverified. All private test receipts stay outside checkout.

## Codex live verification correction — 2026-10-11 15:17 UTC

- **DEPLOYED:** all four Railway services freshly report SUCCESS at `ab962576`. Authenticated founder Home/Documents/Relationships still render.
- **LIVE VERIFIED defect:** three isolated investor mandate recalls on that revision still incurred FAST_CLASSIFICATION (756 / 756 / 841 ms), with client completion 3,402 / 2,471 / 2,804 ms. No live classifier-removal or speedup claim. The guard confused the core investor entity ID with the identity organisation ID; a scoped hosted lookup confirms they differ.
- **IMPLEMENTED / LOCAL TESTED correction:** real distinct IDs now appear in the regression fixture (the old guard fails three variants). The early lane validates actor/run/tenant and the firewall mandate subject against its own scope filter. 37 mandate/core/sequence tests plus six canonical gateway tests, package dependency build, root typecheck and changed-file lint passed; q-api typecheck passed.
- **CI RED:** document packet `dd8f9353`, run `38149586379`, database job failed after local database startup succeeded. Full log download is blocked at the GitHub log-storage host; that precise host was added to the saved environment draft, which requires publication. Code inspection found an invalid new test: browser SELECT on the server-only artifacts table must raise 42501, not return zero rows. Assertion corrected without changing grants/RLS; next exact-commit CI must prove the fix.
- Document migration remains **NOT APPLIED HOSTED**. Do not release the document packet before both exact-commit gates pass. Its evidence-only initial path is a connection, not the final intelligent document product. Real job/render/revision acceptance remains open.
- One existing fictional voice-test account is in the current GPT-Live cohort and returns availability true. No account/cohort/flag was created or changed; first audio remains unmeasured.

## Codex document continuation — 2026-10-11 08:00 America/Los_Angeles

- First packet `ab96257644d21e7e27fbb72fd54a9946e23fa00c` is **CI GREEN**: exact-commit run `38147234625`, quality and pgTAP. It was pushed to the deployment branch; Railway builds are in progress. Do not claim DEPLOYED until each service reports SUCCESS at this revision.
- Document connection is **IMPLEMENTED / LOCAL TESTED**, not deployed: approved typed OWN_COMPANY preparation reuses the existing composed specialist, fresh actor/firewall, artifact transaction and document worker. Atomic replay binding is migration `20261222150000`, not yet applied hosted.
- Initial document path adds no paid model/image generation because existing usage accounting cannot enforce an aggregate allowance across crashes. Foreground document paid-stage configuration is retained. See [WORKFORCE-DOCUMENTS.md](WORKFORCE-DOCUMENTS.md).
- Package builds passed 52/52; targeted document/workforce tests passed 47/47. Broader regressions caught the missing new JOB_PLAN v3 lock entry; the new version hash was added while v1/v2 hashes remain unchanged. Final 118/118 tests across 14 files, root/q-api typechecks and changed-file lint/format passed. This packet's exact-commit CI remains pending.
- Agent code is integrated in `/workspace/q`; parallel agents hit their account usage limit and stopped. Root continues validation. No agent is editing root files.
- Hosted investor baseline returned real mandate answers in three isolated runs (7,571 / 2,493 / 2,442 ms), each with a classification usage row; one also had extraction. Do not claim a live speedup until the new deployed code is measured.

## Codex continuation — 2026-10-11 07:13 America/Los_Angeles

- Integration baseline freshly fetched: `e40b1d0f` on `build/int-rc` and the CI branch; `main` remains stale.
- Work branch: `codex/preserve-optimize`, `/workspace/q`. Presentation commit `60001d76`; workforce commit `63df8f70`; score audit `5bfd5f3e`; mandate routing `7ed54950`/`ccc93941` follows. No migrations or scoring algorithm changes.
- **IMPLEMENTED / LOCAL TESTED:** category-aligned evidenced charts, run-bound authorized relationship timelines, concurrent startup of the two claimed workforce jobs with all-settled pass coalescing.
- Local baseline: 52/52 package builds; presentation/voice/card regression set 142 tests; workforce 14 tests; fit/ranking/readiness 101 tests. Root and web/q-api typechecks passed. Changed-file lint passed (score-comment checks passed).
- Plain own-mandate recalls now reach the existing authorized code answer before both classifiers. Durable core state is hydrated before skipping active sequences; 43 regression tests passed and the original implementation failed the new recall regression. Latest exact-commit CI is pending.
- **Fresh infrastructure verification:** Railway API reports all four services SUCCESS at `b021d53b`; GitHub CI run `38142662370` succeeded at `e40b1d0f`; hosted migration history matches all 200 local migrations.
- **LIVE VERIFIED baseline only:** q-api health 200 and five authenticated arrival reads 200 (268–1,201 ms). The new code is not deployed yet.
- Network endpoint access now works after the cloud network settings update. Secrets are outside checkout; none recorded here. Local Supabase still has the disk/vfs blocker from onboarding.
- See [REUSE-MAP.md](REUSE-MAP.md), [SCORE-LINEAGE.md](SCORE-LINEAGE.md), [PERFORMANCE-BASELINE.md](PERFORMANCE-BASELINE.md). Production improvements and complete user journeys await exact-commit release validation.

### Historical Claude snapshot (retain its dated evidence)

## Snapshot — 2026-10-11 ~13:30 UTC (Claude Code, final Claude-led session)

### Repository

- Repo: `neo1415/q`. Integration checkout used by the Claude lead: `/home/user/q-int` on local branch `int-rc`.
- HEAD: `b021d53b587ef1583fea57f999905f3bf5331ca8`, "fix(q): a bare ordinal from the Daily lane reaches the Daily answer". The handoff-docs commit sits on top of it; see `HANDOFF-LOG.md`.
- Branch roles:

  | Branch                       | Role                                                              | Head at snapshot |
  | ---------------------------- | ----------------------------------------------------------------- | ---------------- |
  | `build/int-rc`               | integration branch (merge work here first)                        | `b021d53b`       |
  | `recovery/2026-09-12-8y2j4w` | CI branch (push here to run `.github/workflows/ci.yml`)           | `b021d53b`       |
  | `recovery/2026-09-12`        | **deploy branch**; Railway auto-deploys all four services on push | `b021d53b`       |
  | `main`                       | stale (`b539180c`); **do not rebase onto it**                     | —                |
  | `build/agent-autonomy`       | old (Oct 7); already an ancestor of HEAD (merged)                 | `234ba8b3`       |

- Every `build/*` worker branch from this period is merged into HEAD (checked with `git merge-base --is-ancestor`). The list: a-research, b-rehearse-access, c-meeting-host, d-meeting-brain, d1-discover, e-daily, f-cards, g-gold, n2-deck-tabs, r5-rehearse, v2-qatar, r1-fix, r5-run-trips, r3-fix2, w4-fix3, k6-fast, r2-company, k5-instant, k2-fix, w1-fix3, agent-autonomy.
- Worktrees under `/home/user/q-w-*` and `/home/user/q/.claude/worktrees/*` are in the ephemeral cloud container only, all clean and merged. They are disposable and nothing in them is unpushed.
- Working tree at HEAD: clean apart from the handoff docs being committed.

### Deployment (Railway) — DEPLOYED, revision checked through the Railway API

| Service                  | Serving commit | Since (UTC)      | Notes                                                  |
| ------------------------ | -------------- | ---------------- | ------------------------------------------------------ |
| web (Next.js 16)         | `b021d53b`     | 2026-10-11 12:22 | europe-west4; calls api/q-api over the private network |
| api (Fastify)            | `b021d53b`     | 2026-10-11 12:22 |                                                        |
| q-api (Q runtime, voice) | `b021d53b`     | 2026-10-11 12:22 |                                                        |
| workers                  | `b021d53b`     | 2026-10-11 12:22 |                                                        |

- Public URLs:
  - web: `https://capital-qweb-production.up.railway.app`
  - api: `https://capital-qapi-production.up.railway.app`
  - q-api: `https://capital-qq-api-production.up.railway.app`
- Railway project `9e615d28-7db0-406e-a415-c5118a275427`, environment `f7e5768d-56e6-4ee3-be29-c38172b3114c`. These are identifiers, not secrets.
- The web service uses `CQ_API_INTERNAL_URL` and `CQ_Q_API_INTERNAL_URL` for private networking. **Vercel is NOT used** (CLAUDE.md and ADR 0001 text that says otherwise is superseded).
- The Railway service health logs for q-api, api and workers on this revision showed no warn or error lines at the time of the snapshot.

### Database (hosted Supabase, eu-central-1)

- Migrations: **200 local = 200 hosted; none missing; none extra**, checked with `scripts/handoff/hosted-migrate-https.mjs`.
- Newest migrations, all applied:
  - `20261222110000` qatar_five_source_status_and_enrichment
  - `20261222120000` demo_rehearsal_access
  - `20261222130000` communication_meeting_time_proposals
  - `20261222140000` communication_meeting_events

### CI

- CI run #307 on `b021d53b`: **success** (quality: format, lint, typecheck, test, build; pgTAP database job). The e2e job is manual and was not run.
- One earlier red run (`16428c22`) was a GitHub runner port clash while Docker was starting, not a test failure.

### Active agents / leases at handoff

- No Claude coding worker is editing any branch.
- Three read-only documentation workers produced drafts for this handoff and wrote nothing to the repo.
- **Nothing is racing Codex.** Codex owns all branches from the next commit on.

### Live verification evidence (2026-10-11, production, `b021d53b` or its parent build)

See `ACTIVE-TASKS.md` for each workstream. Summary:

- LIVE VERIFIED:
  - Qatar Five identity and follow-ups (0 model calls).
  - The 24×5=120 founder rehearsal page matrix.
  - Clear/restore cards in a browser.
  - Scheduling PROPOSED→INVESTOR_REVIEW→COUNTERPROPOSED→DECLINED, with founder self-confirm refused (403).
  - Q Daily gist / "the other one" / open exact story (API).
  - Public gold pages in light/dark/system.
  - Voice navigation resolver p50 0 ms / p95 2 ms server-side.
- NOT live verified:
  - Real meetings (one-party, two-party).
  - Spoken rehearsal sessions and first-audio latency.
  - Investor-accept → CONFIRMED booking.
  - Quiet-day welcome in a browser (no truly quiet onboarded demo account exists).
  - Gold VERIFIED badge on a real verified account.
  - Live GPT-Live voice navigation in a browser session.

### Known environment facts for the next operator

- The cloud sandbox reaches the internet only over HTTPS through a proxy (`NODE_USE_ENV_PROXY=1` for Node fetch). Direct Postgres (5432/6543) from the sandbox times out; use the Supabase management API scripts.
- The session-environment value of `SUPABASE_ACCESS_TOKEN` became invalid on 2026-10-11. A replacement token was supplied out of band and must live only in a secret store. See `START-HERE.md` → Credentials (names only).
