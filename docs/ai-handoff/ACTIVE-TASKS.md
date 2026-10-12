# Active tasks — authoritative cross-model board

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

## Named-subject continuation — 2026-10-11 16:17 UTC

- Candidate `efcf49ab` CI `38154358888` is pgTAP GREEN / quality running; no migration or release yet.
- Separate named-other propagation correction is LOCAL TESTED: the actual answer seam no longer drops the reader flag and removes lookup tools for unrelated prepared context. Original regression fails, corrected 181 tests pass, 36 builds/root/q-api types/lint pass. Voice speculation remains governed by the final reading. This is a proven seam defect, not proof that every live targeting failure is resolved.

## Routing/readiness release correction — 2026-10-11 16:07 UTC

- CI `38150727138` at `4d26e9e6` is **RED quality tests / GREEN pgTAP**. Six local navigation regressions are corrected by checking mandate intent before scope inspection; final 183 focused routing tests pass. Do not deploy the red revision or apply the migration yet.
- Existing conversational document revision route is **IMPLEMENTED / LOCAL TESTED**, not live verified. Canonical READY reads now also require an actual immutable version row; 52 package builds, 207 focused tests, root/q-api typechecks and changed lint/format pass.
- Actual viewer/PDF baseline is verified; autonomous workforce READY/render and real conversational version increment are still required after release. Deterministic initial preparation remains an initial connection, not intelligent autonomous research/writing/design/critique.
- Actual browser Discover-to-Q works with the genuine founder card in focus (correct company subjects/reference, declared facts and explicit gaps). An off-screen named-company question still used the wrong on-screen company. Investigate turn subject binding and existing canonical network tools; never widen founder-private evidence access to solve it.

## Next measured product correction — 2026-10-11

- **IMPLEMENTED / LOCAL TESTED:** bounded candidate sweep for explicit counts without place filters, after real top-three Q returned one while the canonical API returned three. Rich top-ten output exceeded the existing tool bound. Original regression fails; corrected 36 fit/card/tool tests passed, final fixture lint correction 10 tests passed, model-gateway dependency build and root/q-api typechecks passed. Release separately after the current document packet gate.
- **LIVE VERIFIED baseline:** 42 authorized feed profiles contain repeated values but no 8.8. Actual founder company is in that investor feed and its network preview returns 200. Discover browser Ask Q opens and accepts a server action; new-answer timing needs a history-safe check.
- **OPEN product defects:** named company/mandate question remained investor-scoped and took 23.8 s; private one-page request produced a READY Q_REPORT and ran public research, taking 44.5 s. Neither is complete acceptance. Autonomous typed ONE_PAGER job and conversational revision await gated deployment.
- **VOICE BLOCKED transport:** real cohort-account session opened (201) but VM WebRTC failed; ended 204. No first audio measured.

## Current continuation — 2026-10-11

- **DEPLOYED:** first packet `ab962576`, all four Railway services SUCCESS. Live mandate sampling exposed a core-entity/identity-organisation guard mismatch; corrected with distinct-ID regression. No live speedup claim until correction is released and measured.
- **IMPLEMENTED / local validation:** existing workforce DOCUMENTS connection for approved OWN_COMPANY PREPARE. One canonical artifact/enqueue per job step, fresh authority, real READY completion, cancellation checks, and zero additional paid generation. Migration `20261222150000` is not applied hosted. CI `38149586379` at `dd8f9353` failed pgTAP; the invalid browser-SELECT assertion was corrected to require permission denial. Repeat exact-commit quality + pgTAP before release. Details: [WORKFORCE-DOCUMENTS.md](WORKFORCE-DOCUMENTS.md).
- FDN numeric methodology remains blocked on approved, versioned criteria/contextual weights. The score-lineage audit is complete; no proprietary formula, historical score or source of truth was invented.
- End-to-end voice audio and complete founder/investor acceptance remain open. Kathryn's GPT-Live availability check is cohort-excluded; no cohort, budget or voice flag was changed.

> One owner per branch or worktree. Update the status words (CODE OBSERVED · IMPLEMENTED · MERGED · LOCAL TESTED · CI GREEN · DEPLOYED · LIVE VERIFIED · BLOCKED) with evidence.
> Snapshot 2026-10-11, HEAD `b021d53b`. **Every workstream below is MERGED, CI GREEN and DEPLOYED on `b021d53b`; none has uncommitted changes.** The "Live" line says exactly what was proven on production.

## Codex active continuation — 2026-10-11

- **IMPLEMENTED / LOCAL TESTED:** existing chart alignment/missing-data fix; existing authorized relationship TIMELINE adapter; workforce claim startup and lease-wait fix; guarded own-mandate routing before both classifiers. Work is on `codex/preserve-optimize` from `e40b1d0f`.
- **CODE OBSERVED / LOCAL TESTED:** repeated 8.8 fixture is explainable by mandate fit. Locked InvestIQ Core Seven/contextual methodology is not the legacy readiness diagnostic; see SCORE-LINEAGE. Hosted score provenance is still unverified.
- **In progress:** exact-commit CI and deployment. Founder Home/Documents/Relationships and generated-deck viewer passed baseline browser checks; full journeys remain open. Previous workstream live evidence below is historical.
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
