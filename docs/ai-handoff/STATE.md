# Capital Q — Current shared engineering state

## LATEST STATUS — Codex takeover / PR #14 two failures corrected locally — 2026-10-12 06:20 UTC

- Owner: Codex, branch `codex/takeover-release-pr14`, based on PR #14 head `3a0aea343b8a16cb1dd47c494f4b4e0907cf1d52`. Claude's branch is preserved; no second platform or competing release. Controlling user takeover document is preserved in [session-directives/2026-10-12-engineering-takeover.txt](session-directives/2026-10-12-engineering-takeover.txt).
- Fresh remote lanes: integrated `9a2e89a3c6bea619f3c48ceffcda080d6d3a01d1`, CI `f829a5d1bf301fa4f595370e368e4810a742868a`, deployed `fdf047457550b8aef23fed3adc710b1e8fe2b113`. All four Railway services SUCCESS at deployed SHA; rollback that verified release until the new gate/rollout passes. No migration in this slice.
- PR #14 exact failed run `38208967641`: two failures reproduced locally (19 passed). Preserve new Cheque compatibility wording, 8,000-character document findings, attributed round terms, disclosure boundaries and superseded-run CI behavior.
- LOCAL TESTED correction: stale wording assertion updated; compact comparison fallback repeats only code-derived scores, retaining unknown bands and the unknown-not-negative rule. Complete typed profiles, reasons, bands, confidence, ordering and source/raise data are unchanged. Tool max 32,000 and regression headroom target 31,000 remain unchanged; the ten-profile test now passes and still deep-compares every profile and refuses truly oversized results. No scoring change or original research truncation.
- Gates: 52 package builds PASS; 79 tests across natural conversation, fit tools, discovery fit, document jobs and workforce documents PASS; root, q-api and web types PASS; changed eslint/prettier PASS. New exact CI and live workforce chain acceptance remain pending; do not call the memo fixed live yet.
- NEXT: push the focused PR #14 correction, require exact quality + database green, merge/promote through established lanes, verify all four Railway service revisions, then use `workforce-acceptance.mjs --approve` with existing fictional accounts and verify persisted READY memo, real critique/revision, diligence card PENDING and rendered deliverables. Approve only the exact team-job plan; never approve/send the founder-contact card.
- Tavus keys: six supplied keys stored only in private `/workspace/cq-secrets/tavus-keys.json` mode 600, outside Git. Use one entitled account key; no pooling/failover to evade quota. Do not print or commit values. Existing dormant adapter and ADR 0066 are the reuse path; integration not implemented/live verified yet.
- ENVIRONMENT BLOCKER: `tavusapi.com` currently fails at the cloud proxy with HTTP tunnel 403 before reaching provider. Saved network-only configuration draft adds `tavusapi.com` and `docs.tavus.io` while retaining every existing domain; `requires_publish=true`. User must review/save/publish environment settings. Saving does not activate it. Continue independent workforce/release work; no paid video session attempted.

## LATEST STATUS — PR #8 live at `6600e61d`; PR #11 in CI — 2026-10-12 04:50 UTC

All four Railway services report SUCCESS at `6600e61d`, which is PR #8. Lanes:

- `build/int-rc` `368c0e10`
- CI lane `d9d19eb1`
- deploy lane `6600e61d`

Rollback point: `f23583ad`.

Workforce acceptance: planning works, Research is DONE, the memo step FAILS. See ACTIVE-TASKS. PR #11 carries the logging needed to root-cause it, plus the Tensorgate fit and profile work.

No migrations.

## LATEST STATUS — PR #5 deployed; team-job routing in PR #8 — 2026-10-12 03:40 UTC

**DEPLOYED (service level):** PR #5 merged through GitHub's merge operation. The release lane carries it:

- `build/int-rc` = `450c67ce`
- CI lane = `e3654b53`
- deploy lane `recovery/2026-09-12` = `f23583ad`

All three have tree `2e155c68`. Railway reports all four services SUCCESS at `f23583ad`. Rollback point: `e1266dd8`.

**LIVE REHEARSAL on `f23583ad` (fictional investor Savanna Seed, `investor-demo-rehearsal.mjs`): PASS.** Timings are measured to the first rendered characters ("first text") and to completion ("done").

| Phase                     | Result                                | First text | Done      |
| ------------------------- | ------------------------------------- | ---------- | --------- |
| Top three                 | 3 cards                               | 3,342 ms   | —         |
| Selected-company question | 6 findings, COMPANY_REFERENCE correct | 2,891 ms   | 15,993 ms |
| Risks follow-up           | 10 findings                           | —          | 22,570 ms |
| Comparison                | 2 cards                               | 2,410 ms   | —         |

The earlier on-screen defect is fixed live. The runner's Q-control race fix (it now waits for either control) is in PR #8.

**Workforce acceptance (live, `f23583ad`): NOT YET PASS.**

- Run 1: the goal became an "Accept Ledgerfold's connection request" card through the hand-over shortcut. Fixed in `7c0315b6` (deployed). The stray approval `09dde253-…` was rejected.
- Run 2: Q produced one in-run brief (5 public sources) and no `q.workforce.job.start` card.

PR [neo1415/q#8](https://github.com/neo1415/q/pull/8) (`c174746e`, LOCAL TESTED, CI running) routes three or more kinds of asked work to `propose_q_job` and says the plan back. Local checks: 4,430 tests pass; root and q-api tsc 0; lint and format clean.

**Next:** PR #8 green → merge → lane PRs → deploy → `node scripts/handoff/live/workforce-acceptance.mjs`, then `--approve` → verify memo v1 → critique → revised v2 → diligence card left pending → then Tavus (ADR 0066 Proposed; adapter dormant in PR #8; one key only; no Gulf voice in the Tavus catalogue).

## LATEST STATUS — PR #2 deployed; workforce slice in PR #5 — 2026-10-12 00:30 UTC

**DEPLOYED (service level):** PR #2 merged through GitHub's merge operation (direct pushes to release branches are refused in Claude sessions; merges via the GitHub integration work). `build/int-rc` = `668ee838`, CI lane `recovery/2026-09-12-8y2j4w` = `a4c254c6`, deploy lane `recovery/2026-09-12` = `e1266dd8`; all three trees identical to the CI-tested `f7ff0fdc` (tree `54d168aa`). CI: PR #2 run 38180652493, PR #4 runs 38182707886/38182711449, CI-lane push run 38182733437 — quality and pgTAP SUCCESS. Railway: all four services SUCCESS at `e1266dd8` (workers `f2d068e7`, api `46d38485`, q-api `9282d3f2`, web `df1360ae`). Rollback: `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`.

**LIVE REHEARSAL on `e1266dd8` (fictional investor Savanna Seed): FAILED at phase 3, root-caused and fixed in PR #5.** Discover 200; top-three 3 cards / 3 Open controls (first text 3,820 ms, done 4,002 ms); correct Ledgerfold profile. The selected-company question returned a canned card line plus OPEN_RECORD_PAGE for the page already on screen (`PROFILE_REFERENCE_MISMATCH`): the TURN_READER marked it as an open; three FAST_CLASSIFICATION calls, no answer generation. Fix `70f1be86`: when the referenced record is the company page on screen and the person asked a question, code declines the navigation and the answer path responds; regression fails before, passes after. Not caused by PR #2 (no routing change). Rerun the rehearsal after PR #5 deploys.

**PR [neo1415/q#5](https://github.com/neo1415/q/pull/5) → `build/int-rc` (LOCAL TESTED, CI running):**

- `744a82bd` runner: independent steps concurrent, outward steps serialized in plan order; executor errors reported (`onStepError` → q-api log); lead DONE only when every step is DONE.
- `32dd5891` investor memo on the NAMED_COMPANY (bound by code from `goalSubjects`, never a model id) + SUBSTANCE_CRITIQUE second specialist that revises once into a new version when material; JOB_PLAN v4.
- `70f1be86` the on-screen question routing fix above.
- `03b1f8c8` DILIGENCE executor: DILIGENCE_QUESTIONS drafts ≤5 founder questions from the memo's gaps + critique; files `app.diligence.questions.send` as the investor's approval card (run version `q-workforce-card-v1`), or keeps them with the job when not connected. Stored as AD_HOC (no migration).
- Local: 5,433 tests pass (orchestrator/tools/core/specialists/contracts/q-api) + web suites earlier; root tsc 0; lint/prettier clean.

**Not yet proven live:** the mandatory autonomous workforce acceptance ("research… memo… critique… revise… diligence questions") has not been run in production; it needs PR #5 deployed. The two-sided question write test (`two-sided-questions.mjs`) remains unrun (production writes were refused by the session's permission classifier earlier; reading is fine).

**Tavus (read-only audit only):** six keys valid; each sees 100 stock replicas, 0 custom replicas, 0 active conversations; key #1 has one custom persona (separate account from at least some others). Account identity/quota sharing is not exposed by the API — owner must confirm entitlements before any failover; use one key until then. Keys stored outside the repo (`/root/.cq-tavus-keys`).

**Next:** PR #5 CI green → merge (GitHub) → CI lane PR → deploy-lane PR → four-service SUCCESS → rerun `investor-demo-rehearsal.mjs` → run the workforce acceptance through Q as the fictional investor and record artifacts, critique version, card → then Tavus rehearsal implementation (180 s hard cap, server-side end).

## LATEST STATUS — Claude Code product-clarity slice on top of the demo baseline — 2026-10-11 22:45 UTC

**The deployed investor-demo baseline is unchanged: all four Railway services SUCCESS at `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6` (re-inspected 22:00 UTC via the Railway API; deployment IDs as below). Rollback point = that SHA (tag push is refused by the git proxy; the SHA lives on `build/int-rc`, both `recovery/*` lanes and `codex/preserve-optimize`).**

- New work: branch **`claude/capital-q-completion-mhzsiq`** (based on `build/int-rc` @ `11174c4d`), pushed. **LOCAL TESTED, NOT INTEGRATED, NOT DEPLOYED.** Pushing to `build/int-rc` / `recovery/*` and live writes on production (even fictional accounts) were refused by the session's permission classifier; the owner must allow them or merge the PR. CI runs on the PR (`pull_request` trigger).
- Local gates on the branch head: 52 package builds; root `tsc` exit 0; web `tsc` exit 0; vitest `apps/web packages/q-core packages/q-specialists` **386 files / 3,707 tests pass**; prettier + eslint clean on every changed file.
- What changed (all presentation/prompt; no schema, no migration, no scoring change):
  1. **Company profile raise** — a pitch figure plus unshared round details no longer reads as a contradiction ("$4M · From their pitch" above "Raise on Capital Q · Not shared with you"). The fold explains both halves in plain words; labels are "Said in their pitch" / "Declared by the company" on card and profile; row renamed "Round details". Owner sees what investors see. Tests: `company-raise-surfaces.test.tsx`.
  2. **Deck** — Q's 12-section coverage grid is a native `<details>`, collapsed: "N of 12 sections identified · View coverage". Section analysis and carousel stay open. Test: `company-material.test.tsx`.
  3. **Q's view** — `FIT_Q_VIEW` v2 (v1 deprecated, same schema/inputs/firewall, lock pinned): strongest alignment first, one decisive qualification, unknowns as concrete next questions by impact, no generic praise. The profile panel now shows the qualification and unknowns (previously dropped) and "Go deeper with Q" (full assessment / risks and gaps / top open question) through the existing company-bound Q conversation. Deterministic fit unchanged. Tests: `fit-ui.test.tsx`, q-core prompts lock.
  4. **Questions to investigate** (was "Assumptions to test") — states the three paths per claim: ask Q to check the evidence (one Q question, nothing sent), tick to ask the founder (existing approve-then-send), request a document (diligence area when in diligence; data room only when it lists on-request documents; otherwise no link). Test: `investor-promises-render.test.tsx`.
  5. **Deal strip** — LIVE-OBSERVED defect fixed: Savanna Seed × Ajopot is in Diligence with no recorded meeting, so Met read "not reached". Passed-but-unrecorded stages are now "Not recorded" (passed); a guide line says the next stage, what establishes it and who acts, honest that soft commits aren't binding, signing happens outside Capital Q and Capital Q never moves money. Test: `deal-stage-strip.test.ts`.
  6. **Data room copy** — "Request the rest" → "Request all on-request documents"; its sheet says it reaches nothing unlisted; empty room says nothing shared ≠ nothing exists.
- **Live READ-ONLY evidence (fictional accounts, production API):** Savanna Seed's relationships listed; Ajopot (IN_DILIGENCE) founder inbox shows an earlier diligence document request with requester name + firm, SHARED; investor diligence shows it FULFILLED with the document; deal view reports `current: DILIGENCE`, `MET.reachedAt: null` (the defect above), `nextSteps: [SOFT_COMMIT, PASS]`. Founder notifications include "Document requested: …". Runner: `scripts/handoff/live/two-sided-readback.mjs`.
- **NOT RUN (blocked by permission):** `scripts/handoff/live/two-sided-questions.mjs` — the write half of the question loop (send → founder inbox → answer → investor sees it, retry, three negative cases).

**Next executable steps:** (1) owner merges/approves the PR or grants push to `build/int-rc` + `recovery/2026-09-12-8y2j4w`; require CI quality + pgTAP green on the exact SHA; (2) deploy by pushing that SHA to `recovery/2026-09-12`, confirm four services SUCCESS, rerun `investor-demo-rehearsal.mjs` unmodified; (3) with permission, run `two-sided-questions.mjs ledgerfold` and `… ajopot` and record PASS/FAIL; (4) continue: known-company lookup latency (unchanged next task from Codex), cold Documents → Open race, agent matrix re-audit, landing promises matrix.

Run the live runners from the repo root after `pnpm exec turbo run build --filter=./packages/*`:
`CQ_PUBLIC_JSON=<file with NEXT_PUBLIC_SUPABASE_URL/KEY> CQ_SEED_ACCOUNT_PASSWORD=… NODE_USE_ENV_PROXY=1 node scripts/handoff/live/two-sided-readback.mjs ajopot`

## LATEST STATUS — cold investor demo accepted / lossless continuation — 2026-10-11 21:28 UTC

**Capital Q is an existing substantial application. The October 12 text investor-demo browser rehearsal now passes on the real deployed application. Continue from this release; do not rebuild its workforce or replace production scoring.**

### Exact code, CI and deployment

- Latest integrated application commit: **`06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6`**, pushed on **`build/int-rc`**, CI lane **`recovery/2026-09-12-8y2j4w`** and deployment lane **`recovery/2026-09-12`**. Working branch **`codex/preserve-optimize`**; latest pushed rehearsal/handoff commit before this checkpoint **`79e19056bd4165f984127b066921996a0fab17a0`**. Subsequent documentation/rehearsal commits do not replace the exact gated application revision.
- Exact CI **[`38173610861`](https://github.com/neo1415/q/actions/runs/38173610861)**: quality (format, lint, root typecheck, full tests and build) **SUCCESS**; database/pgTAP **SUCCESS**; manual e2e **SKIPPED**. Manual browser evidence below is separate from that skipped job. Local release gates passed: 52 package builds, final 82 targeted tests, root/web/q-api types, changed lint/format.
- Fresh Railway inspection: **all four services SUCCESS at `06872c7c`**, with exact deployment receipts:

| Railway service      | Deployed commit                            | Deployment ID                          | Status  |
| -------------------- | ------------------------------------------ | -------------------------------------- | ------- |
| `@capital-q/web`     | `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6` | `10753a26-0475-4c44-8715-c8706f5216ed` | SUCCESS |
| `@capital-q/api`     | `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6` | `7f2feeed-d71b-4ca7-a7d3-8bc5c9490828` | SUCCESS |
| `@capital-q/q-api`   | `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6` | `ea6dae51-0f3d-4830-8a1a-b953eac168aa` | SUCCESS |
| `@capital-q/workers` | `06872c7c7a4d0e6c3e6fa3b848e0b5a298181ce6` | `deceab1c-0bf4-4530-8372-8ceef0e01cb6` | SUCCESS |

- No new migration: hosted/local **201/201**. Immediate previous all-four-success rollback: **`9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`**, CI **`38169532816`** quality + pgTAP SUCCESS, manual e2e SKIPPED. Earlier exact green rollbacks: `ad4703895d9736ab0c321324888697f59c5c1e5f` (CI `38166655996`) and `e271242e6833d07820c32a8e679f3403ba1ca560` (CI `38164882385`). `main` is stale; do not reset from it.

### LIVE VERIFIED product acceptance and limits

- **Full tracked cold browser rehearsal PASS:** Discover HTTP 200 → immediate Ask Q attempt → three distinct canonical company cards, three rendered cards and Open controls → correct selected-company route and name → explanation → evidence/risk follow-up → exactly the two requested canonical comparison companies and two rendered cards → named authorized founder company evidence → its actual profile and follow-up. All six internal Q turns completed. Selected explanation had six positive findings and one correct company reference; risk follow-up had ten findings and one correct reference. The known founder question had three findings/one reference, follow-up four findings/one reference. Positive findings bind to the exact expected company; named founder evidence contains no PUBLIC_SOURCE substitution.
- **Cold Discover blocker corrected and observed:** before first click, the SSR Ask Q button was disabled and had no bound React handler; Playwright's first click waited for actual enablement, opened Q and completed the request. The second fresh Discover entry in the same rehearsal also began disabled/unbound and worked. No sleep, warm-only readiness bypass or second-click workaround was added. This is one complete browser rehearsal, not a reliability/load percentile.
- **Selected-company defect corrected and observed:** `9261cdc4` previously explained the company with four unbound findings and no COMPANY_REFERENCE (`PROFILE_REFERENCE_MISMATCH`). The `06872c7c` fallback binds deictic single-company questions only to the exact screen subject after a fresh schema-valid authorized profile read, retaining explicit-name precedence and ambiguity refusal. Explanation and follow-up now pass. The earlier selected-company routing correction also remains live: analysis returns zero candidate cards, not an unrelated ten-company sweep.
- The known founder is a genuine previously authorized company record. Investor-visible declared profile evidence is not access to its private onboarding interviews. The rehearsal proves that authorized founder profile-to-Q journey, not complete private founder-interview disclosure or every onboarding workflow.
- Existing document workforce evidence remains valid: real persisted READY v1 and conversational READY v2, canonical findings/gaps preserved, viewer and changed valid one-page A4 PDF. PREPARING/version zero was observed while DOCUMENTS remained RUNNING; DONE followed a real version row. A fresh 24-test completion/adapter regression pass reconfirms the canonical READY-pointer guard. This is not proof of broad intelligent research/writing/design/critique or durable aggregate paid-job budgeting.

### Latest measurements and remaining defects

| Actual browser phase on `06872c7c`       | First 20 rendered answer characters (ms) | First rendered card (ms) | Client completion (ms) |
| ---------------------------------------- | ---------------------------------------- | ------------------------ | ---------------------- |
| Top three                                | 3,212                                    | 3,565                    | 3,641                  |
| Selected-company explanation             | 3,656                                    | none                     | 16,327                 |
| Selected-company risk/evidence follow-up | 6,927                                    | none                     | 18,949                 |
| Exact two-company comparison             | 3,550                                    | 3,550                    | 3,820                  |
| Known founder question                   | 7,606                                    | none                     | 15,462                 |
| Known founder profile follow-up          | 3,654                                    | none                     | 10,489                 |

- Previous warm selected-company browser baseline on `9261cdc4`: first 20 characters **8,341 ms**, completion **18,978 ms**, attribution failed. Its scoped model usage had two lookup-selection calls **1,798 + 2,036 = 3,834 ms**. Latest selected explanation usage instead has classification **675 ms**, one final generation **13,593 ms**, and post-answer extraction **2,448 ms**, finishing 2,647 ms after the answer. **No lookup-selection rounds in that latest run.** This exposes intermittent unnecessary planning, not a proven causal or repeatable latency improvement from the binding-only patch.
- Known-card baseline still outstanding: first 20 characters **8,661 ms**, completion **20,189 ms**, six bound findings/one reference. Two lookup-selection rounds **1,946 + 1,846 = 3,792 ms**, final generation 12,394 ms. Prepared screen/company facts already exist; inspect unnecessary named-other lookup guidance and reuse the existing fresh authorized tool read before inventing caching or a new service.
- Earlier own-mandate measured improvement stands: three-sample median first text **2,098 → 892 ms**, completion **2,163 → 941 ms**. All text timings are a literal 20-character threshold, not semantically validated first useful content, p95 or load measurement. First audio remains **UNVERIFIED/BLOCKED in this cloud environment** by Deepgram proxy/tunnel failure; successful session creation is not audio proof.
- **Remaining live defect:** cold Documents → immediate Open once failed to show its viewer; a four-second diagnostic retry succeeded and displayed nine canonical gaps. Reproduce by navigating to Documents and immediately pressing the existing artifact's Open without waiting for client readiness; require a real viewer/version, without readiness sleeps. A hydration cause is plausible but not confirmed for this control. Do not label the warm retry a fix.
- **Historical real 8.8 unresolved:** current authorized 42-company fit baseline has no 8.8; repeated 6.0/3.5 are explained by the existing canonical mandate-fit calculation. October 8 source history reports top-three → “rank them” → ten companies with tied 8.8, but this is not a fresh actor/run-bound real reproduction. Canonical fit is distinct from official FDN Business Quality.
- **PROPOSED ONLY:** offline InvestIQ v0.2, ten synthetic scenarios + ten invariants pass. No production import, real calibration or approved official weights. Source reconciliation remains additive to original Locked PADL/Product Specification; prototype precision is not institutional certainty.

### Exact continuation, reproduction and protected work

**Next engineering task:** measure and eliminate unnecessary model-based company lookup selection for an already-known canonical company, through the existing tool/plan/firewall. Record actual actor/run-scoped before/after provider rounds, first visible text and terminal time, including repeated selected-profile and named-offscreen cases. Preserve explicit-name/ambiguous/denied-read handling, exact comparison and private-interview boundaries. The current prompt's unconditional `aboutNamedOther` instruction at `packages/model-gateway/src/q/index.ts` asks for search/get even for a deictic selected-company question; a latest run avoided it, so do not claim universal overhead. An unambiguous canonical ID from existing durable answer cards can be a lookup hint only; obtain a fresh authorized schema-valid profile and verify its name. No optimization is implemented yet. Cold document readiness is the next independently reproduced product defect.

Portable full browser rehearsal (actual command used successfully):

```bash
cd /workspace/q
CQ_DEMO_SESSION_FILE=/workspace/cq-secrets/investor-session.json \
CQ_DEMO_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key \
CQ_DEMO_CHROMIUM_PATH=/usr/bin/chromium \
CQ_DEMO_FOUNDER_RECORD_FILE=/workspace/cq-secrets/founder-company.json \
NODE_USE_ENV_PROXY=1 node scripts/handoff/live/investor-demo-rehearsal.mjs
```

The tracked runner is the portable reproduction source. It creates internal Q turns for an existing authorized account, with no account creation or outward messages. Refresh/sign in through the existing-account methods in START-HERE; secret session files are not Git artifacts. Latest private receipts/screenshots: `/tmp/cq-investor-demo-8kF6hc`; count/timing-only log `/tmp/cq-demo-readiness-live.log`; actor/run-scoped selected-company usage `/tmp/cq-selected-company-model-latency-after.log`. These temporary files may disappear with the environment; the non-private results and exact runner are committed here. Never commit customer receipts, sessions, signed URLs, credentials or screenshots.

- Five project worktrees inspected. Historical unfinished document bridge is committed/pushed as **`codex/wip-workforce-documents-preserved-2026-10-11` / `35c23d7a7e4b84d191e6535154db2dda46dafcaa`**. **UNVERIFIED WIP / DO NOT DEPLOY OR MERGE WHOLESALE:** historical `findForWorkforce` is incorrectly placed inside `toArtifact` and lacks the later real-version rejection. The integration branch already has corrected implementations; preserve this branch for archaeology only.
- Other important histories pushed: `codex/workforce-documents` / `74f4b6ce9b33658c46493a739c3567a60d50b43e`; `codex/workforce-documents-executor` / `621614a3ceeeba5d5e0b31433e37cff3d32c0a16`; `codex/preserved-score-audit-2026-10-11` / `cce99544988af127e6d0d13c39fdcd605fc841e6`. Detached workforce audit `ab96257644d21e7e27fbb72fd54a9946e23fa00c` is an integrated ancestor. Old branches are historical, not additional platforms or competing sources of truth. No pending application-code edits at this checkpoint.
- **Blocking environment/account actions:** no account action is needed for the text demo while existing authorized refresh remains available. For cloud voice verification, review/save/publish the saved environment configuration draft that preserves existing domains and adds `agent.deepgram.com`/`api.deepgram.com`; saving the draft did not activate it. Recheck credential-free transport before another paid voice attempt. Local Supabase startup remains blocked by Docker/vfs disk constraints; direct Postgres unavailable; required pgTAP passes in CI. Rotate chat-exposed credentials before continued production use, as already recorded by credential name in START-HERE.
- **Must NOT rebuild/change:** GPT-Live, voice/navigation, Q cards, documents, relationships, onboarding, research, LangGraph workforce, canonical score sources or Locked PADL originals. Reuse existing services/tools/presentation/versioning. No second agent platform, duplicate business services, fabricated showcase evidence, speculative rewrite, RLS weakening, test/gate weakening, private interview disclosure or proposed score replacement. Do not deploy preserved unverified WIP.

## Cold Discover control and selected-company evidence binding — 2026-10-11 20:44 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`; exact CI `38169532816` quality and pgTAP SUCCESS, manual e2e SKIPPED. No new migration (201/201).
- **LIVE REPRODUCED:** a fresh Discover load exposes its Ask Q button before React binds it. Immediate click starts no Q run and opens no panel; after hydration, the second click opens one real Q sheet and the visible Ask Q textarea. Private authorized browser diagnostics contain counts/readiness only in console and create no Q runs. Discover's button now stays disabled through server rendering/hydration until its handler is attached; the SSR/hydration regression passes. Cold production verification awaits the next exact release.
- **LIVE REPRODUCED additional binding defect:** a warm-only rehearsal on `9261cdc4` renders three real cards, opens the correct profile, and now answers the selected-company question without a candidate sweep. Terminal 18,978 ms; first 20 rendered answer characters 8,341 ms. Four findings had no company subjects and no COMPANY_REFERENCE, so acceptance correctly FAILED. The reader's “other” flag can apply to an investor's selected counterparty. The correction preserves explicit-name attribution and ambiguity handling, and permits a deictic single-company fallback only to the exact selected screen subject after a successful schema-valid authorized profile read. The answer-seam regressions cover warm/cold and both flag values; existing named-company checks remain green.
- **LOCAL TESTED:** all 52 package builds pass; 65 web surface/global-Q checks pass; final combined SSR/hydration, answer-seam, authorized-card-binding and fit-sweep run passes 82 tests across four files. Root, web and q-api type checks, changed-file eslint, prettier and script syntax checks pass. These local gates permit commit/integration; exact CI and release verification are still required. The complete investor journey, exact two-company browser comparison and optional known-founder phase remain unverified; no full demo PASS claim.
- The offline proposed methodology v0.2 and optional known-founder rehearsal extension remain separate from production InvestIQ. Ten synthetic scenarios and ten invariants pass; historical real 8.8 is unresolved. First audio is blocked by this cloud browser's Deepgram proxy/tunnel failure. Broader intelligent workforce capability and durable aggregate job budgeting remain unfinished; the narrower real READY document/revision/export evidence stands.
- **Next:** finish local gates, commit/push/integrate, require exact CI quality + pgTAP, deploy that exact SHA, confirm all four services SUCCESS, then run the unmodified cold browser rehearsal through all required phases. Fix actual failures without weakening assertions. Continue measured lookup overhead work afterward.

## Exact demo release and continued evidence checks — 2026-10-11 20:24 UTC

- **CI GREEN / RELEASE IN PROGRESS:** `9261cdc4cdcb6c9f7829fe50fb7d3c197907848a`, exact CI `38169532816`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to the deployment branch. API/workers SUCCESS; web/q-api still building at this checkpoint. No new migration; 201/201. Do not call the selected-company fix live verified yet.
- Reusable browser rehearsal has an optional previously authorized `CQ_DEMO_FOUNDER_RECORD_FILE` phase: return to Discover, ask about that named existing founder company, require positive correctly bound findings/references without public-source substitution, open its authorized profile and check the follow-up. The earlier three mandate-ranked records do not by themselves prove genuine founder evidence. This additional phase is syntax/lint/format checked but awaits actual execution; no new account or outward action.
- **LIVE MEASURED additional latency baseline:** asking about a company already named in the conversation returned six correctly bound findings and one correct reference, zero public sources; first 20 answer characters 8,661 ms, terminal 20,189 ms. Actor/run-scoped usage shows two short model lookup-selection rounds, 1,946+1,846 ms, before 12,394 ms final generation. Next hypothesis is a fresh authorized profile read from an unambiguous canonical ID in durable conversation cards, avoiding model-planned lookup; it is not implemented or claimed faster.
- **BLOCKED voice measurement in this cloud browser:** credential-free Deepgram WebSocket probes fail immediately (13/19 ms); browser error diagnostics identify proxy/tunnel failure. Credential-free HTTPS probes also fail for agent/api.deepgram.com. No voice broker, settings or audio were sent by these probes. This explains the execution-environment transport limit, not a verified production voice defect. First audio remains unverified; no additional paid voice attempt.
- **LOCAL TESTED / PROPOSED ONLY:** offline methodology experiment 0.2 retains the same arithmetic but isolates assessment snapshot identity from investor-view metadata. New invariant fails against 0.1 because fit-only metadata changed the input hash; fixed experiment hashes only method/context/as-of/observations. Ten synthetic scenarios and ten invariants pass; old version/results preserved. Original FSR §16 D/E explicitly leaves exact match/InvestIQ math unresolved; PADL #142 generally calls for qualitative user-facing confidence. Internal uncalibrated percentages are not product certainty claims. No production math integration or calibration completed.
- **Next:** exact four-service readiness, then full authenticated browser journey with the known founder phase; fix any actual failure and update shared evidence. Preserve current release gate and private receipts. Historical real 8.8 and the cold document-open readiness race remain unresolved.

## Actual browser rehearsal and focused-company fix — 2026-10-11 19:44 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `ad4703895d9736ab0c321324888697f59c5c1e5f`; exact CI `38166655996` quality + pgTAP SUCCESS, manual e2e SKIPPED. No new migration; hosted/local 201/201. Rollback remains exact green `e271242e` / `5f3a0c8c`.
- **LIVE VERIFIED presentation:** reusable authenticated browser rehearsal reaches Discover HTTP 200, receives three distinct canonical company cards, renders three card elements and Open controls, and opens the correct company profile with its name visible. Actual top-three terminal time 3,480 ms; no prose text on that card-only answer. First card timing was not captured in this initial run.
- **FAILED actual company analysis:** “What does this company actually do and why does it fit my mandate? Use its Capital Q records.” returned ten candidate cards and no company reference, terminal 2,344 ms. The selected company was in the run subjects and the conversation persisted across Open. This is fit-sweep routing, not missing page context. Follow-up and comparison stages were not reached; do not claim complete demo PASS.
- **IMPLEMENTED / LOCAL TESTED correction:** explicit single-company questions bypass candidate sweeps, including a FIT reading that arrives after warm reads. Existing authorized company analysis/tools remain in place. Original exact-word regression fails; full seam fails in both warm/cold cases when the fixture offers both canonical fit tools. Corrected 100 tests across six gateway files pass; two additional set-request preservation cases pass in the final 26-test fit-sweep rerun. 52 package builds, q-api types and lint/format pass. Root types exposed missing full scope fields in the new fixture; corrected fixture uses schema-parsed mandate scope; final 30-test full-seam rerun and complete root typecheck pass. Exact CI/live acceptance still pending.
- Work-branch commits include the explicitly PROPOSED offline methodology experiment `cb456be5` and source/latency checkpoint `6aec2061`; these have no production integration. Ten synthetic scenarios and nine invariants pass, not institutional calibration or real 8.8 provenance.
- **Next:** finish final fixture/types checks; commit, integrate and gate the focused-company correction; deploy only that exact green SHA; rerun the actual browser journey through evidence follow-up and exact two-company comparison. Preserve private receipts outside checkout. Continue measured latency work against the two short model tool-selection rounds, not post-answer extraction. Historical real 8.8 and first audio remain unresolved.

## Demo release gate and methodology prototype — 2026-10-11 19:31 UTC

- **CI GREEN / RELEASE IN PROGRESS:** `ad4703895d9736ab0c321324888697f59c5c1e5f`, exact CI `38166655996`: quality and pgTAP SUCCESS, manual e2e SKIPPED. Exact SHA pushed to `recovery/2026-09-12`; four-service readiness and live browser card/comparison acceptance still pending. Previously verified deployed SHA is `e271242e`.
- **LOCAL TESTED, PROPOSED ONLY:** `INVESTIQ-METHODOLOGY-PROPOSED.md` and the isolated `scripts/handoff/live/investiq-proposed-evaluation.mjs` provide Core Seven subcriteria/anchors, context profiles, evidence/conflict/freshness handling, independent confidence, deterministic arithmetic, uncertainty and sensitivity, version lineage, calibration and approval requirements. Ten synthetic scenarios plus nine invariant checks pass; syntax/lint/format pass. No provider/DB/application imports or production integration.
- Evidence-withholding check failed in the first experimental formula: missing one known weakness still allowed a raised final score under the 80% gate. Corrected numeric finalization requires complete applicable Business Quality criterion coverage and retains wide missing-evidence bounds. Synthetic arithmetic is not calibration or real 8.8 provenance. Full source reconciliation and official methodology approval remain incomplete.
- Reusable browser demo runner now records first rendered current-answer text reaching 20 characters, in addition to terminal duration and positive evidence bindings. That is a visible-text threshold, not verified first useful semantic content or first audio.
- **Next:** finish exact four-service readiness, execute the actual browser journey, fix failures and record evidence before saying the demo works. No broad document expansion or production score rewrite.

## Live named-company verification — 2026-10-11 19:23 UTC

- **DEPLOYED:** all four Railway services SUCCESS at `e271242e6833d07820c32a8e679f3403ba1ca560`; exact CI `38164882385` quality and pgTAP SUCCESS, manual e2e SKIPPED. No new migration; hosted/local 201/201.
- **LIVE VERIFIED attribution:** three isolated authenticated questions naming an offscreen founder company now each return one correct COMPANY_REFERENCE and three findings whose company subjects all match the requested record. All mention the requested company; no PUBLIC_SOURCE substitution. Authorized declared profile evidence is not private interview disclosure.
- **No latency improvement claim:** first 20 answer characters after: 10,340 / 7,929 / 7,803 ms (median 7,929), versus before 10,395 / 6,454 / 4,389 (median 6,454). Terminal after: 19,597 / 16,969 / 15,607 ms (median 16,969), versus before 33,164 / 16,619 / 12,148 (median 16,619). Threshold timing is not a semantic first-useful-text metric, load percentile or audio measurement.
- **Document verification:** immediate post-arrival Open click failed to produce the viewer within 20 seconds. Retrying with a four-second page readiness pause opens the same existing artifact and renders one body plus all nine canonical gaps under “Evidence gaps.” This suggests a readiness race; it is not a fixed cold-open defect. Earlier PREPARING/version-zero versus real READY/version-row completion evidence remains valid.
- **COMMITTED / CI RUNNING:** dock cards and exact comparison subset `ad4703895d9736ab0c321324888697f59c5c1e5f`, exact CI `38166655996`: pgTAP SUCCESS, quality Test running. Neither is deployed or live verified yet. Preserve this gate.
- **LOCAL TESTED rehearsal runner:** `scripts/handoff/live/investor-demo-rehearsal.mjs` performs the real Discover → three visible canonical cards → Open correct profile → Q explanation → traction/risks/gaps → exactly two visible comparison cards journey. It checks current question/run completion and positive company references; private receipts/screenshots remain in a fresh protected temporary directory. Syntax/lint/format pass; actual execution awaits the dock release.
- **Next:** finish exact CI, deploy only its green SHA, verify all four services, run the actual browser rehearsal and fix any failure. Historical real-record 8.8, first audio, exhaustive source reconciliation and the full PROPOSED quantitative methodology remain incomplete.

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
