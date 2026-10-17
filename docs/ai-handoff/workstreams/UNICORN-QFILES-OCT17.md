# Workstream A — Unicorn Potential and Home Q files

Branch: `codex/unicorn-qfiles-oct17`, created from clean integration `995b716a0756c757ec2535b9536602cc80b44aab` on 17 October 2026. Dedicated ownership: scoring, score UI, Unicorn-specific Q readers and Home Q file intelligence. Claude owns CRM/navigation/GateQ/Work/general investor journeys; do not change them here.

Priority: finish and live-verify Unicorn Potential first; then Home Q private file intelligence; public-web research only after both. Current status: IMPLEMENTING, not deployed. No production merge or migrations applied. Coordinate release with integration owner; do not deploy over overlapping work.

Owner methodology is preserved verbatim at `docs/product-sources/unicorn-potential/research-methodology-v1-2026-10-17.md`. Only that attachment was available initially; the separate developer brief has been requested, without blocking independent implementation. PADL #46 prohibits unvalidated forecasts: this is a separate present-evidence growth-characteristics indicator, never a calibrated probability. Investability, Suitability and default fit-order.v2 remain unchanged.

Reuse map: `packages/readiness/src/investability/{inputs,observe,assess,postgres,service}.ts`, canonical eligible profile/claims/deck sources; existing billing entitlement resolution; `apps/q-api/src/composition/fit.ts` and `http/fit.ts`; `packages/contracts/src/http/company-scores.ts`; `apps/web/src/features/scores/{company-scores,use-company-scores}.tsx`; existing workers investability composition/deck source and paced sweeps. No new scoring platform, canonical company or Q runtime.

Shared contract addition: `packages/contracts/src/http/unicorn-potential.ts`, exported via http/index.ts. Separate typed DTO: twelve pillars/two criteria each, evidence references and truth/evidence/lifecycle/scope axes, coverage/confidence, gated overall score, append-revision momentum and explicit caveat. No change to existing Q core contracts or CompanyScores yet. Root owns shared contracts, persistence, API/authorization and integration; isolated engine worker owns only new readiness pure engine files/tests in its worktree.

Setup: Node24.19.0. Frozen pnpm11.25 install verified lockfile/supply-chain policies (857entries) and installed706packages. Initial default data path /home/agent was unavailable; successful supported local override:

```bash
PNPM_HOME=/workspace/.pnpm XDG_DATA_HOME=/workspace/.local/share COREPACK_HOME=/workspace/.corepack corepack pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store
```

No lockfile/dependency changes or TLS bypass. Build package dist before targeted tests/types. No live credentials/private session artifacts recovered from previous machine; inspect existing bindings before requesting account action. GitHub Git/API read access verified; production service revisions not re-certified in this fresh environment. STATE's older release notes are historical, not a fresh live read.

Next: complete deterministic engine and source lineage; append-only premium-gated storage/API; third CompanyScores disclosure and Q reader; explicit Discover filter; complete protected tests and authorized browser proof. Backfill must be bounded/paced, never score on feed render. Do not start Home file/public-web work until first milestone live-verified. Exact commits/tests/migrations/CI/browser proof will be appended here each cycle.

## Implementation checkpoint — 17 October

Engine integrated as41e09e03d/ad11d1e09/109340c3c/e932e0d00:24 explicit criteria, provisional12-pillar arithmetic,20testsPASS; strict measurement periods prevent assertedAt from freshening undated growth. Root53package buildsPASS; first integrated contracts/engine/cache group30testsPASS. UI worker6e06f48c4 locally11tests and320/390/1440CSS browserPASS, not production proof. Persistence56e27f847 integrated but source-eligibility rechecks, actual PostgreSQL and sweep fairness follow-up in progress; migration20261228200000 is UNAPPLIED. No release/CI/live certification yet.

The second developer brief was supplied in the user's reply and read: same12taxonomy, optionalalert/shortlist/briefing, source versions and normalized cohort context. No calibrated outcome claim. New CompanyScoresDto field `unicornPotential?` is optional and must be absent without both current premium entitlement and company visibility. Reader reauthorizes each request. Removed completed company-id-only browser caching and detached in-flight batches before I/O;2 regressions prove remount and new reader don't reuse older authorized results while same-tick batching remains.

## Continuation: recovered and integrated implementation,17October

Original foundation32f0f4d7 preserved. Recovered exact UI6e06f48c4 through isolated UIbranch and integrated wide Overview disclosure+compact rail link; UI13tests/builds passed in worker. Integrated source-revocation store/SQL guard and37targeted tests from c27e56f4e; original migration28200000 remainsUNAPPLIED. Integrated explicit premium Discover filter/sort from09625d66e,45backendtests/17buildtargets passed inworker. No default ranking/formula changes or new Qengine.

Root wired existing billing ACCESS feature on each API/Q/Discover read, optional third score into Fit, a no-store explanation endpoint, existing fit_profile Qreader guidance and canonical source math, and safe403 for denied explicitpremiumfilter. Same-tick different authorized score ports now isolated; regression added. Initial worker sweep is a paced bounded500company backfill, subsequent repairs rotate100. NewADR0076 records owner-approved provisional status; no calibrated probability claim.

Production independently read healthy on allfourservices at f4579fb34005377cabf81079388bde38ba7808b4. Hosted latestmigration28190000;28200000 absent. Eligible entitlement inventory contains9existinginvestororganisations from explicitnamedmatches or verifiedreal-email memberships; grants PLANNED, not applied. No email-domain bypass, fake scores or production-wide access.

Root33dependencybuildPASS; integratedallpackagesbuild+combinedtests running. Source/migration CI, fulltypes/lint, grants, migrationapply, rollout, backfill and actualproductiondesktop/mobile/Qacceptance remain mandatory. SeparateClaudePR212 owns GateQ/Qviewnextsteps; no QPitch/demoidentity/tour changes. HomeQfiles and publicresearch NOTSTARTED in continuation.

## Release repair checkpoint — 17 October, 22:33 UTC

Recovered PR217 exact head `17ea9a33b2d3a4ca8755380f59e13cb5a2b76be4`; continue this PR, not old preserved foundations. Protected CI39072870845 passed format/lint, types, build and database, but failed two locale-catalogue assertions (new GateQ labels); repaired without weakening tests. Current source corrections: `af851cb40` locale gate; `b43291ab5` structured canonical evidence; `8f64e1bfc` canonical PERCENTAGE vocabulary; `8bfb91cc3` UUID-safe source authorization and historical reads. Original method weights, 60% coverage and required pillars unchanged. Input rules advance to v2; no cross-version momentum.

Canonical reader now retains structured_value, validity, immutable current revision and founder created_at. Closed typed rules handle measured ARR, paying customers, NRR, margins, market size and explicitly dated growth; unknown, forecast, private, unconfirmed and stale inputs cannot manufacture observations. A full read-only before/after hosted population audit is in progress; no scored-count claim yet.

New immutable fix-forward migration `20261228201500_unicorn_structured_source_guard.sql` distinguishes current snapshots from authorized historical evidence, recognizes canonical UUID revisions without timestamp-cast failures and withholds expired current facts. History retains source-withdrawal controls; momentum uses only the immediately preceding comparable authorized snapshot. Worker reports: 17 focused pgTAP assertions on native PostgreSQL17 PASS, 12 repository tests PASS; thin local parent fixtures are NOT the full Supabase gate. Original migration28200000 and new28201500 remain UNAPPLIED. Full protected database CI is required.

Fresh Railway read at 22:30 UTC: web/API/q-api/workers all SUCCESS on `a70e66a8b82b8df00ca663e9baeeee3f3686959e`. These deployments do NOT contain Unicorn. Latest hosted migration remains20261228190000. The explicit existing-org access plan was reconstructed against current active memberships: **43 existing organisations (34 founder, 9 investor)**, including the three named fictional Atlas/Savanna organisations. Private audited IDs remain outside Git; no grants applied. Apply only feature-specific ACCESS overrides after gates, preserving every existing paid-usage allowance and future signup behavior.

Credentials supplied by owner are available only in protected `/workspace/cq-secrets/` files. Never commit/log their contents, session links or raw hosted evidence. Previous local overlapping WIP is recoverable on `codex/unicorn-local-preserved-oct17@8845b33a9`, `codex/unicorn-store-oct17@827458585`, and `codex/unicorn-ui-oct17@f478bfcf6`; DO NOT merge these wholesale over PR217. Current fixes have dedicated branches and precise cherry-picks.

Next: finish package rebuild and affected/full type gates; push exact source head and pass protected CI; complete real461 audit before migration/release; integrate through normal protected lane, apply migrations, grant scoped access, controlled backfill, allfour deployment verification and authenticated desktop/mobile investor/founder/Q/Discover/denial acceptance. Home files and public web remain paused.
