# Baseline ledger — 12 November 2026 (integration lead, session_01Wncmn73d4XJWmh1N9ECao7)

Directive: `Capital Q Master Product-Completion … Directive` (owner, 11 Nov). Statuses are literal: `NOT_FOUND`, `CODE_OBSERVED`, `IMPLEMENTED`, `LOCAL_TESTED`, `CI_GREEN`, `DEPLOYED`, `LIVE_VERIFIED`, `BLOCKED`. Unknown is written as unknown.

## Refs and deployments (read 12 Nov)

| Ref / service                                                                     | SHA                                | Note                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `fix/resume-asking-cv9ru3` (integration; mirror `claude/confident-keller-v0ug6h`) | `31661e3b1` → `e18a781f0`          | authoritative integration lane; no other session in flight (all idle)  |
| `recovery/2026-09-12-8y2j4w` (CI)                                                 | `600cca432` → `e18a781f0`          |                                                                        |
| `recovery/2026-09-12` (Railway deploy)                                            | `600cca432`                        |                                                                        |
| `build/int-rc`                                                                    | `d25c0843c` (4 Nov)                | stale; do not merge from it                                            |
| `main`                                                                            | `b539180c7` (8 Sep)                | historically stale                                                     |
| web                                                                               | `600cca432`                        | Railway SUCCESS 10 Nov 05:54 UTC                                       |
| api, q-api, workers                                                               | `74d33a828`                        | Railway SUCCESS 10 Nov 05:09 UTC                                       |
| Parked, not deployed                                                              | `park/split-pitch-ask` `0f94ddd92` | owner said stop (10 Nov); joins a pitch ask split over two transcripts |

## Blockers

- ~~BLOCKED: hosted database reads and migrations~~ **resolved 12 Nov 04:0x UTC**: the owner supplied a new `SUPABASE_ACCESS_TOKEN` (environment settings updated; the lead keeps a copy outside Git). Hosted migrations 292/292, none missing. Original note: `SUPABASE_ACCESS_TOKEN` now returns `401 Invalid access token` (the 11 Oct handoff already asked for rotation). `hosted-read.mjs` and `hosted-migrate-https.mjs` fail; the REST key cannot read the `onboarding` schema (406, not exposed). Canonical row checks, migration sync and the ADR 0065 runtime-role measurement wait for a new token (owner: rotate it in the environment secrets).
- **BLOCKED: live voice testing from the cloud sandbox** (no UDP for WebRTC). Voice receipts come from the owner's sessions and server logs only. Railway keeps the last 5,000 log lines per deployment, so older sessions' logs age out.

## Capabilities (first pass, onboarding first)

| Capability                                                                              | Owner module                                             | Status                                                                                 | Evidence                                                                                                 | Next                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Typed + form onboarding, investor, fresh account                                        | onboarding / q-api voice                                 | LIVE_VERIFIED on q-api `811202101` (9 Nov 21:45 UTC)                                   | onboarding-e2e investor ALL PASS (HANDOFF-LOG 9 Nov)                                                     | re-run on the next q-api SHA                                    |
| Spoken yes to a read-back (figures, lists, websites)                                    | `apps/q-api/src/voice/held-accept.ts`                    | DEPLOYED `d9dc487e3`+; owner's 21:00 run took all three cheques                        | logs 9 Nov 21:00:44/54, 21:01:36                                                                         | DB check blocked                                                |
| **Capital Q's steer reaches a duplex voice call (D86)**                                 | `apps/web/src/features/voice/provider/duplex-session.ts` | **was NOT working**: duplex client had no `brief`; fix `e18a781f0` LOCAL_TESTED, in CI | failing-first `voice-duplex-brief-1112.test.tsx`; owner 10 Nov sectors/models/customer types asked again | deploy; owner voice re-run                                      |
| Voice survives Q opening a page                                                         | `q-conversation.tsx`                                     | DEPLOYED web `600cca432`; not voice-tested live                                        | CI 42763378115                                                                                           | owner voice check                                               |
| Mandate category read as Q's reading ("Enterprise Software") held, re-held each reading | `onboarding-port.ts` (category hold)                     | CODE_OBSERVED; whether the 10 Nov yes was taken is unknown (logs aged out, DB blocked) | transcript 10 Nov 08:51–08:54 UTC                                                                        | a port-level test of hold → read-back → yes for a category list |
| Q re-introduces itself after a replaced line                                            | voice opening                                            | CODE_OBSERVED (10 Nov 08:52 "Hey! … I'm Q" after replace)                              | transcript                                                                                               | investigate                                                     |
| Chat attachments persisted per turn; DOCX read                                          | q-runtime / evidence                                     | LIVE_VERIFIED `e107d7040` (9 Nov 18:25 UTC)                                            | STATE.md                                                                                                 | —                                                               |
| Q Pitch: spoken/typed ask after other words; Start plays                                | `packages/q-pitch` trigger, `atlas.ts`                   | LIVE_VERIFIED typed `74d33a828` (10 Nov 05:15 UTC)                                     | HANDOFF-LOG 10 Nov                                                                                       | split-transcript ask parked                                     |
| Metrics audit P0-1..7, 9 and P1-7 (7 Nov)                                               | readiness / discovery / scores                           | IMPLEMENTED per merges (batches 3–6); **not replayed on today's head**                 | ACTIVE-TASKS lines 190–235                                                                               | Lane D: replay each P0/P1 with tests on the current head        |
| ADR 0065 runtime DB role bypassing RLS                                                  | security                                                 | unknown today                                                                          | blocked by token                                                                                         | measure roles after token rotation                              |
| Fresh founder → investor full V1 journey (Priority 0)                                   | all                                                      | not certified on current SHAs                                                          | —                                                                                                        | Lane H, after the onboarding slice                              |

## Measured 12 Nov after the token was replaced

- **ADR 0065 (runtime DB role) is still open.** `pg_stat_activity` on production: 11 of the services' connections arrive through Supavisor as `postgres` (`rolbypassrls = true`). **Correction (security lane, 12 Nov): no server code runs `SET ROLE` at all** (the `team.ts` hit is a column update), and nothing sets `request.jwt.claims`. So RLS policies do not constrain server traffic today; tenant isolation for server SQL rests on application code (explicit access contexts, firewall tests). This is not "RLS-protected server traffic". **Decision proposal for the owner** (no change made): (A) keep as is, document the residual risk and add cross-tenant negative tests per repository; (B) a least-privilege runtime role (`NOBYPASSRLS`) with `SET LOCAL ROLE` plus `request.jwt.claims` per transaction, repository by repository behind a flag, with rollback; (C) the full migration of every repository to the new role at once. Recommended: B, starting with the sensitive tables (onboarding, relationships, documents), after the V1 journey is certified.

## Metrics audit replay on `53271540e` (7 Nov audit, P0/P1)

All 9 P0s are RESOLVED or settled by owner decision (P0-8 by D76/D78; a PADL #046 amendment is still not recorded). Of the 18 P1s, 10 are RESOLVED. The rest:

| ID            | Status                                            | Note                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-14         | **fixed `84eca3ae4`** (integration, not deployed) | a deck or raise that failed to load is no signal, never a Gap; failing-first test                                                                                                                                                                                                                    |
| P1-8          | **fixed `222634e4f`** (integration, not deployed) | rerank never crosses the declared geography tier; failing-first test                                                                                                                                                                                                                                 |
| P1-15         | NOT_RESOLVED, **decision proposal**               | a deck section the model judged at standard counts as EVIDENCED with a DOCUMENT ref (`readiness/src/domain/signals.ts:207-213`). Changing it alters readiness grading semantics: owner to choose (a) STATED until a confirmed extraction, or (b) keep EVIDENCED, labelled "Q's reading of your deck" |
| P1-16         | NOT_RESOLVED                                      | Blueprint step takes truth class and evidence status from different lines; `verifiedLine` has no ref                                                                                                                                                                                                 |
| P1-9          | NOT_RESOLVED                                      | Q's top-N comparator lacks v5's geography tier and the Investability tie-break (`fit/service.ts:632-638`)                                                                                                                                                                                            |
| P1-11         | PARTIAL                                           | Unicorn renormalises over scored pillars (gated stricter now)                                                                                                                                                                                                                                        |
| P1-10         | PARTIAL                                           | P8 still scores investor support (an interest signal)                                                                                                                                                                                                                                                |
| P1-3          | NOT_RESOLVED                                      | fit-order versions read current configs live; slates record only `fit-order.v5`                                                                                                                                                                                                                      |
| P1-5          | PARTIAL                                           | grading version is in the basis hash, not in `INVESTABILITY_METHOD_VERSION` (changing it re-runs the sweep)                                                                                                                                                                                          |
| P0-9 leftover | —                                                 | unused "never counted against you" string in `i18n/catalog/sweep.ts:78`                                                                                                                                                                                                                              |

Tests run by the replay: 13 files, 130 tests, 0 failed.

## Integrated slice 1 — deployed 12 Nov 05:09 Lagos (04:09 UTC)

- **DEPLOYED:** web and q-api `53271540e` (CI 43150091213 green); api and workers unchanged on `74d33a828`. Rollback: web `600cca432`, q-api `74d33a828`.
- **LIVE_VERIFIED (typed + form only):** onboarding-e2e on the deployed SHAs, fresh fictional accounts `e2e-fou-202611120548-xyo8` and `e2e-inv-202611120548-q62o` (`@fictional.capitalq.local`): founder and investor **ALL PASS** J1–J6 (one introduction; dense line answers 5–6 topics; ramble said back, saved only after the yes; required refusal re-asked with its reason; chat → voice-text turn without re-greeting; continue later and resume on the same question; the form reopens on the same step; finish lands on /verification). Canonical rows: two onboarding sessions COMPLETED, investor 44 responses, founder 39.
- **Voice: PENDING.** The steer fix and the no-re-introduction fix are deployed but not proven: no sustained live voice session has run on these SHAs (the sandbox has no UDP). Needed: one owner voice onboarding showing steer received, read-back confirmed, saved, and resumed after a reconnect.

## CI and performance (read-only analysis, 12 Nov)

- `quality` needed only static/typecheck/test/build; **pgTAP and integration were not gating** (run 42667454783 failed pgTAP, quality still passed). Fixed in `a029a2f3d` (CI_GREEN pending). GitHub has **no branch protection or rulesets** on either recovery branch; Railway "Wait for CI" is the only gate.
- Wall time p50 about 13.9 min (12 sharded runs). Critical path: lint (p50 12.0 min, 12 sequential eslint batches) and the slowest test shard (p50 12.5). The 55-task package build runs cold about 8 times per run (no Turbo cache). Proposed, not done: persist the Turbo cache; split lint into 2–3 parallel jobs; trial 4–5 test shards. Estimated 8–10 min wall.
- Latency: first useful text and first audio are **unmeasured** on the current SHAs; the newest timings are from 31 Oct, and first audio has never been measured.

## Security lane (branch `sec/tenant-isolation-tests` `cfe311599`, not yet integrated)

- Adds two pgTAP suites (165 + 43 assertions; **never run**: no Docker here, CI will run them), one vitest file (12/12 pass locally: Q subject resolvers refuse a foreign-tenant row even when a repository loses its tenant filter), and `docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md` (PROPOSED: ~186 files / ~1,400 SQL call sites; six flag-gated reversible phases; six items for owner approval).
- **Owner findings:** (1) `core.founder_person_facts` and `core.founder_background_entries` stay readable by their owner after the owner's membership is revoked (the policy checks only the user). A tightening migration is possible but changes access semantics; decision requested. (2) some tables grant `service_role` (e.g. `q_runtime.conversation_states`) though the RLS fixture says it holds none.
- Not yet covered: onboarding.utterances, other server-only onboarding/evidence/network/q_runtime tables (catalogue-level guard only), revoked-member cases for q_runtime.instruction_grants/steps.

## Integrated slice 2 — deployed 12 Nov 07:21 Lagos (06:13 UTC)

- **DEPLOYED:** all four services on `a029a2f3d` (CI 43164614960 green, the first run where `quality` also gated pgTAP and integration). Rollback: web/q-api `53271540e`, api/workers `74d33a828`.
- Metrics P1-14, P1-8, P1-9: DEPLOYED. Live smoke as investor.savanna-seed: Discover loads; "What are my top 3 matches right now?" moved to /investors/top and answered "Ranked by fit with your mandate, the top three…" with the 9.1 breakdown, no page errors. The specific tier/tie orderings are test-covered, not live-exercised (no live pair stages that case).
- Security tests merged (`0333c4401`) and in CI: the two new pgTAP suites run for the first time there.
- **Priority 0 journey:** the 05:48 UTC founder's company is `organisation_private` (onboarding ends at /verification; the visibility choice is a separate step), so no investor can find it yet. Lane H (worktree branch `qa/v1-journey`) is building and running the full fictional founder → investor certification on production.

## Security tests on CI (12 Nov 06:47 UTC)

- `5bdca3689`, CI run 43170047380: **database (pgTAP) green**, including both new suites (`999_tenant_isolation_server_only_probe` 165, `999_tenant_isolation_person_scoped_policies` 43). The first run (43167966525) failed and the new gate held: `q_runtime` revokes all from browser roles, so `person_standing` reads now assert 42501 (stricter than the test assumed). Test-only; nothing to deploy.
- Status: tenant-isolation negative coverage CI_GREEN for the tables listed above. The server-SQL-as-`postgres` exposure is unchanged (the plan in `RLS-RUNTIME-ROLE-PLAN.md` is PROPOSED, awaiting owner approval).

## Priority 0 journey — Lane H certification on production (12 Nov, all services `a029a2f3d`)

Script `scripts/handoff/live/v1-journey-e2e.mjs` (merged `f3248f25f`; CQ_E2E_GO=1, fictional accounts only, the product's own UI and /v1 API under each person's session). Final run 692 s: **26 PASS, 6 FAIL, 4 NOTE**. Receipts and 1440/390 screenshots: the lead's scratchpad `v1journey/final/` (not in Git: they contain fictional account data).

| Step                                                            | Status        | Evidence                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh founder onboarding (form) and "Make visible to investors" | LIVE_VERIFIED | company `321ad3b3…` network_visible; 390 no overflow                                                                                                                        |
| Fresh investor onboarding (form), mandate ACTIVE                | LIVE_VERIFIED | mandate `ce1e622d…`                                                                                                                                                         |
| New company appears in investor Discover                        | **FAIL (D1)** | 18 polls / 442 s; slate of 84 items without it                                                                                                                              |
| Company profile opens; Q answers about it                       | LIVE_VERIFIED | run `65a8f74a…`; findings labelled USER_CLAIM/SELF_REPORTED (one UNKNOWN that understates)                                                                                  |
| Save / Compare the new company                                  | **FAIL (D2)** | Save 404; compare renders only the other company; Save of a verified company works                                                                                          |
| Express Interest (server-confirmed), retries idempotent         | LIVE_VERIFIED | interest `b2d15909…`; same key twice + new key → deduplicated, one interest                                                                                                 |
| Founder sees interest; accepts; nothing private leaks           | LIVE_VERIFIED | no Q question, Save, cheques, fit or compared company shown to the founder                                                                                                  |
| Canonical rows                                                  | LIVE_VERIFIED | one company; one relationship for the pair (CONNECTED, projected_sequence 3 = last_event 3); events discovered → interest_expressed → connection_accepted; one interest row |

**Owner decisions (D1, D2):**

- **D1 (P0 for the V1 journey):** a new founder never reaches Discover, Save or Compare until a Capital Q person manually verifies identity and organisation (`packages/companies/src/domain/marketplace-readiness.ts:106-119`; eligibility `policy.ts:472-477`; candidate SQL `postgres-discovery-repository.ts:363`). Production has no automatic verification (synthetic auto-verify is staging only). Options: (a) an operations SLA for manual verification; (b) admit unverified companies to Discover labelled "unverified", verification still required for later steps; (c) keep as is and say so in onboarding. The gate is an existing product rule, so changing it is the owner's call.
- **D2 (P1):** Express Interest checks only network visibility (`packages/network/src/application/express-interest.ts:205-212`); Save and Compare need marketplace ELIGIBLE (`interactions/service.ts:165-187, 218`) and answer 404 ("does not exist"). Proposed: align the rule after D1, and in any case return a clear "not yet verified" problem rather than a 404.
- D3 (downgraded): evidence references are stripped from every browser/history response by design (Context Firewall, `q-runtime/src/contracts/index.ts:258-275`), so "0 evidenceRefs" in the browser is expected. Minor: a finding quoting the profile was labelled UNKNOWN/NO_EVIDENCE.
- D4 (P2, not fixed): making the company visible does not re-run readiness; the stored state stays `not_assessed` (`set-company-visibility.ts:150-156`).

## Owner review 12 Nov — the six failed journey checks, each accounted for

PADL #57/#58 (locked): required verification and Marketplace Readiness precede investor discovery and fundraising participation. So checks 1, 2, 4, 5 and 6 expected the wrong thing for an unverified company; the defect was the opposite (Express Interest succeeded).

| #   | Check (Lane H run 692 s)                             | Correct behaviour                                                                                                      | Root cause                                                                                                                                                                                                                                                                       | Status                                                                                                                |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | new company in the investor's Discover slate         | absent until verified and marketplace-ready                                                                            | readiness gate (`postgres-discovery-repository.ts:363`)                                                                                                                                                                                                                          | correct; release test must use a **verified fictional fixture** (next)                                                |
| 2   | Discover card for it                                 | absent until ready                                                                                                     | same                                                                                                                                                                                                                                                                             | same                                                                                                                  |
| 3   | Q's answer is source-backed                          | each material assertion carries the right truth class and evidence status; VERIFIED only from a verified supplied fact | evidence ids are stripped from browser/history by design (Firewall); **gap found**: a model finding's VERIFIED is kept whenever its free-text `basis` is non-empty (`model-gateway/src/q/result-blocks.ts:446-450`), with no check against the supplied facts' own truth classes | **open (D3)**: grounding fix next slice                                                                               |
| 4   | Save it                                              | refused, same answer as absent (anti-enumeration)                                                                      | `interactions/service.ts:165-218`                                                                                                                                                                                                                                                | correct; test needs verified fixture                                                                                  |
| 5   | Saved lists it                                       | not saved                                                                                                              | follows 4                                                                                                                                                                                                                                                                        | correct                                                                                                               |
| 6   | Compare with another                                 | not comparable until ready                                                                                             | same gate                                                                                                                                                                                                                                                                        | correct                                                                                                               |
| —   | Express Interest succeeded on the unverified company | **refused** like an absent company                                                                                     | `express-interest.ts` checked network visibility only                                                                                                                                                                                                                            | **fixed `11995ff10`** (LOCAL_TESTED, in CI): `isMarketplaceReady` in api and q-api; same InterestCompanyNotFoundError |

- P1-15 per owner direction: deck-section evidence lines are now USER_CLAIM / DOCUMENT_SUPPORTED with "Q's reading of your deck, not independently verified" (`9105544de`, `25bc601cb`).
- D1 (verification pathway): per PADL the gate stays. Next: analyse and complete the operational verification workflow (authorised review, activation, founder-visible status); release tests use verified fictional fixtures.

## Verification pathway audit and integrity fixes (12 Nov)

- Built end to end in code (read-only audit): KYB submission → admin queue (`identity.platform_admins`; `verification.decide` needs step-up) → append-only HUMAN decision, audit, outbox `verification.claim.decided` → worker readiness reconcile → slate refresh on `marketplace_readiness_changed` → founder-visible KybView. Production's only admin is the owner (platform_owner). Not yet proven live: delivery of `verification.claim.decided` to the workers.
- **Fixed `41879f125` (integration, not deployed):** (1) four eyes: an operator cannot decide a claim they requested (`SELF_DECISION`, 403); integration test. (2) The founder ID upload is hidden: it went up as an ordinary CORPORATE organisation document while the page promised "seen only by the person at Capital Q who checks it". Production had 0 ID documents.
- Remaining slices: private identity-document path (S3, migration + RLS tests), "request more information" (S2), close the KYB submission inside the decision transaction, a synthetic-operator guard (S4) before any automated fictional reviewer. Release tests get a VERIFIED fictional company only through the real path: fictional founder submits, an authorised admin approves in /admin/verification with the basis "fictional release-test account; no real-world check".

## Application-path tenant isolation (merged `e924be4b6`, 12 Nov)

- 5 suites, 12 tests, run as `postgres` through the real services (network, mandates, evidence, onboarding, q-runtime): a foreign tenant's real id gets exactly the answer of a random id, nothing is written. Ran green locally on a fresh Postgres 16 with every migration (`scripts/local-pg/setup.sh`, port 54339); CI will run them in the integration job.
- **Owner decisions** (`docs/ai-handoff/PERSON-VS-ORG-DATA.md`): (1) onboarding sessions are person-owned: a founder who left a company can still read and answer that company's onboarding session; recommended: company-bound sessions require current membership. (2) Q conversations opened in an organisation context do not re-check membership. (3) `founder_background_entries` document links can point at the old company's document after the founder moves. (4) minor: some reads look up before checking permission, so a stale former member sees forbidden vs not found.

## Integrated slice 3 — deployed 12 Nov 10:00 Lagos (08:51 UTC)

- **DEPLOYED:** all four services on `19e149590` (CI 43183881835 green, pgTAP and integration gating). Rollback `a029a2f3d`.
- **LIVE_VERIFIED (D2 alignment):** as investor.savanna-seed, `GET /v1/network/companies/:id/interest` → the unverified Lane H company `321ad3b3…` **404** RESOURCE_NOT_FOUND, byte-for-byte the same problem as a random id (anti-enumeration holds); a marketplace-ready company with an existing interest (`b439cd80…`) **200** with its interest. No new interest was created by the check. The write path (express-interest) shares the same `authorise()`; covered by the unit test.
- P1-15 labels: DEPLOYED (unit-tested; no live founder readiness view exercised).
- Batch 4 (`3e78448d0` and its parents: four-eyes verification, hidden ID upload, app-path isolation suites) sent to CI.

## Integrated slice 4 — deployed 12 Nov 10:28 Lagos (09:18 UTC)

- **DEPLOYED:** all four services on `2f8227fe9` (CI 43187826194 green; the integration job ran the 5 app-path tenant-isolation suites and the four-eyes integration test for the first time: **CI_GREEN**). Rollback `19e149590`.
- **LIVE_VERIFIED:** /verification as the fictional founder `v1-fdr-202611120653-uifk` shows "Who is asking" (name, role) with no ID document field (`[data-verify-file="person"]` count 0). Four-eyes: CI_GREEN only (no live admin decision exercised).
- **D3 grounding** (`c4c4ae1bc`, findings never outrank the supplied facts they cite) is in CI. Scope: Q conversation answers (live and final findings); workforce/research findings are not yet covered.

## Execution control (owner, 12 Nov)

- One integration lead (this session) owns shared contracts, merge order, release gates and production verification. At most one additional implementation agent on a bounded, non-overlapping slice; short read-only research/review agents allowed. One significant change set per release batch.
- Intelligence programme started: a bounded read-only audit of Q intelligence, memory, conversation, web research and rich answers for the journey "an investor asks Q to investigate a company → authorised internal + public research with grounded citations → natural follow-ups". Output: the highest-impact observed failure and the smallest vertical slice; then implement it. Second slice: sourced images/media/interactive results through the existing presentation blocks.
- Not blocked by the RLS migration or the founder-verification decision.

## Intelligence slice 1 — finding citations (12 Nov)

- D3 **LIVE_VERIFIED** on `c4c4ae1bc` (10:54 Lagos): "What does MedTrail do, and which source says so?" as investor.savanna-seed → findings USER_CLAIM/SELF_REPORTED, text names the self-reported profile; no VERIFIED overclaim.
- Slice 1 **DEPLOYED** `ba4063266` (11:55 Lagos, CI 43199882693 green) and **LIVE_VERIFIED** at the data level: the same question stored 4 findings, each with `citations` — the canonical profile (USER_CLAIM/SELF_REPORTED) and, for the traction figure, "The company's pitch deck, as Q read it (founder's claims)", asOf "September 2026". Each finding's standing equals its cited facts'.
- Two defects found in that live run, fixed in the follow-up (in CI): the deck cited twice (with and without its date) → one line per source and standing, keeping the date; the web cut dates to 10 characters ("September ") → ISO dates show the day, other dates as given.
- Not yet covered: public-web pages from research tools are PUBLIC_SOURCE blocks, not labelled facts, so a finding from a web search does not yet cite its page (next: bind research results as citable facts; Sources to list only cited pages — owner/lead decision).

## Slice 1b — public pages as citations (12 Nov 12:59 Lagos)

- **DEPLOYED** `fd63e1b84` (CI 43210919711). Live: "What does the public web say about Paystack recently? Which sources?" → research read 4 pages (TechCabal, LinkedIn, Hellopeter, Trustpilot); the answer names each with dates; findings labelled UNKNOWN (LinkedIn as SELF_REPORTED, the company's own page) — decision 87 holds (retrieved ≠ verified, nothing suppressed).
- **Gap seen live:** the findings carried no `citations`: the model's basis names sites in words ("TechCabal", "LinkedIn"), while the matcher took only S-numbers, full links or exact domains. Fix committed (`HEAD`, LOCAL_TESTED, not yet CI): a site named by its bare domain or its name as a whole word, among pages this run read only.
- **CI budget:** GitHub Actions at 2,701 / 3,000 free minutes (resets 1 Dec); a full run costs ~70 runner-minutes. The owner is setting a small capped Actions budget; until then no further CI runs. Each future run batches several slices; the Turbo cache is to be added in the next batch.

## Release via the local gate (decision 88) and slice 2 (12 Nov, 14:00–15:40 Lagos)

- **Gate:** `scripts/ci-local.sh` runs every ci.yml job in a clean checkout of the commit, on Node 24, one gate per machine (lock), the database and integration jobs on CI's own local Supabase stack (Docker). A full PASS writes a receipt for the full SHA. `scripts/deploy-promote.sh` is the only push to production: receipt for that exact SHA, on the integration branch, fast-forward only; `.githooks/pre-push` refuses a production push without the receipt.
- Gate fixes on the way: the root lint ran out of heap scanning agent worktrees under `.claude/` (now ignored); the stub Postgres had no pgmq or Auth, so `bcd5d81e5` failed integration (23 outbox + 2 auth tests) on infrastructure, not code.
- **Receipt:** `ci-local PASS sha=5ba018530 at=2026-11-12T14:34:33Z took=2873s` (static 667 s, typecheck 201 s, build 104 s, test 1525 s, database 55 s, integration 321 s).
- **DEPLOYED** `5ba018530` by `deploy-promote.sh` (15:35 Lagos); rollback point `fd63e1b84`. Contains: site-name citation match (slice 1b), the public-record timeline (slice 2a) and its page links (2b, additive optional `url` on TIMELINE events).
- **LIVE_VERIFIED** `5ba018530` (all four services SUCCESS except workers still building at the check; web, api, q-api live), 15:50 Lagos, investor.savanna-seed: "What does the public web say about Paystack recently? Which sources?" → 25.8 s; "Public record: Paystack" timeline with 4 events oldest first (TechCabal 14 Nov 2025, Hellopeter 7 Sep 2026, LinkedIn 5 Nov 2026, Trustpilot 9 Nov 2026), each linking its page in a new tab and marked "Public web: <domain> · not verified"; Sources · 4; every finding now carries "Source: Public web: <domain> — <title> · Not verified · <date>" (the site-name match works: the 1b gap is closed).
- Caveat for the next slice: page dates are the search provider's dates. For a news article that is when it was published; for a profile or review page (LinkedIn, Trustpilot) it is when the page was last updated, not an event. Next: label such pages "updated" rather than placing them as events, or leave them off the timeline.

## Paystack public-research turn, measured by stage (production logs, run of 14:47:57 UTC on `5ba018530`)

The browser check reported ~26 s, but that figure includes its own 12 s "page unchanged" wait. Server time from run accepted to answer produced: **12.6 s**.

| Stage                               | From → to (s after accept) | Took        | Notes                                                                                                                                           |
| ----------------------------------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Run setup, firewall, records        | 0 → 1.1                    | 1.1 s       |                                                                                                                                                 |
| Turn reading (FAST_CLASSIFICATION)  | ~1.0 → 5.3                 | readMs 4519 | OpenAI first choice timed out three times (2 s hedge); the hedge on Claude Sonnet served it in 2.3 s at **$0.065**, ~50× the usual reading cost |
| Web search                          | 5.6 → 6.7                  | 1.1 s       | **Tavily 432 and Serper 402 — both out of credit or limited**, 15-min cool-off; Brave answered (10 hits)                                        |
| Page reading                        | 6.7 → 7.7                  | 0.8 s       | direct extract, 3 pages read, 4 retained                                                                                                        |
| Answer (2 model calls, overlapping) | 7.7 → 12.6                 | ~4.9 s      | NORMAL_DIALOGUE, $0.008 together; 52 k prompt characters                                                                                        |
| Memory learning (after the answer)  | → 14.9                     | 2.0 s       | off the critical path                                                                                                                           |

- **Time to first useful output:** a progress line at ~5.2 s after the stream opened (firstTextMs 5172); the answer itself arrives at ~12.6 s, essentially all at once (7 deltas). The answer is not streamed sentence by sentence on this path.
- **Biggest single delay:** turn reading (4.5 s), caused by the first-choice model timing out, then a costly hedge.
- **Owner items:** Tavily and Serper credits need topping up or the keys checking (Brave carried the search). The turn-reading fallback to Claude Sonnet costs about $0.065 per research turn whenever the first-choice model is slow.

## Investigation milestone — audit and first slice (12 Nov, 16:00–16:45 Lagos)

- **Audit (read-only):** of the five capabilities, the largest gap was that a follow-up lost the earlier research. Others: no claim extraction in an ordinary turn; no deterministic company-claim vs public-page conflict check in chat (`q-research/domain/cross-check.ts` exists, used only by the workforce deep-research job); `lifecycleStatus` and `contradicts` never set on chat findings.
- **Root cause found under it (production data):** all 4,678 rows of `q_runtime.conversation_tool_results` held JSON strings. postgres.js serialises a pre-stringified `${text}::jsonb` again (proved against Postgres 16, prepared and unprepared). Effects: a follow-up's record of earlier tool results was 240 characters of escaped JSON; `conversations.core_state` never saved (none in production); `awaiting_action` was never found. Fixed in `b220961d2` (jsonbParam writes, decodeJsonbString reads, plus a guard test over every `::jsonb` parameter in apps/ and packages/).
- **Slice (`ed3ff3298`):** the follow-up keeps the investigation's pages — earlier research pages (last 3 turns, own stored results) go to the model in a bounded fenced note, are citable (S101…), and a follow-up naming no one new (or the same subject) does not start a fresh web search; "latest / any news / re-check" still search. LOCAL_TESTED: model-gateway 1,911/1,911, new tests, tsc, lint. Not yet gated or deployed.
- **In parallel (agent, own worktree):** the PDF of a research answer carries its sources and dated record (existing contracts only).

## Timeline dates — address-backed only (12 Nov, 17:12 Lagos)

- **Receipt:** `ci-local PASS sha=555555d6e at=2026-11-12T16:05:25Z took=2956s` (all six steps). **DEPLOYED** by `deploy-promote.sh`; rollback point `5ba018530`.
- **LIVE_VERIFIED** (same Paystack question, investor.savanna-seed): TechCabal (address `/2025/11/14/`) shows plainly; Hellopeter, LinkedIn and Trustpilot read "Date as the search listed it · Public web: <domain> · not verified"; links open in a new tab; Sources · 4.
- **Known limitation seen:** this run's two findings (Paystack's own Capital Q profile; a gap) carried no citations: a finding gets one only when the model names its source by label, link or site. The profile finding should cite the profile; to look at with the conflict-detection slice, not separately.

## Investigation batch deployed (12 Nov, 18:40 Lagos)

- **Receipt:** `ci-local PASS sha=945138faf at=2026-11-12T17:39:28Z took=2885s` (all six steps; the earlier run on `c02d562a9` failed static on ledger formatting and typecheck on a test fixture, fixed in `945138faf`). **DEPLOYED** by `deploy-promote.sh`; rollback point `555555d6e`; all four services SUCCESS.
- Contains: conversation memory stored as JSON values (root cause), earlier research carried into follow-ups, sourced PDF, figure conflicts shown unreconciled.
- **LIVE_VERIFIED, two turns** (investor.savanna-seed, conversation `aabdff7a`): turn 1 — four findings, each citing its page ("Public web: techcabal.com — …", linkedin.com, trustpilot.com), all UNKNOWN; timeline as before. Turn 2, "What are the biggest risks for an investor here?" — analysis carrying turn 1's governance issue and customer-count claim, six "not established" gaps (revenue/margin, retention, uptime, licensing, the investigation's outcome, profitability); answer in 9.1 s server time.
- **Defect seen live, fixed (LOCAL_TESTED, next batch):** the follow-up still started an early web search (served from the 10-minute read cache in ~3 ms, so no cost this time): the reader read "here" as Paystack, and the rule matched only the question's own words. The rule now also accepts the reader's resolved subject when it is the one already researched.
- **Imprecision noted:** a finding naming a site ("TechCabal") cites every page of that site the turn read (two here). Acceptable for now; exact-page citation would need the model to cite S-labels.

## Q planning and plan execution — log-driven audit (12 Nov, 19:50–21:20 Lagos)

Production `945138faf`; fictional investor `investor.savanna-seed`; marketplace-ready fictional companies.

**Research decision (false negatives), from `q_plans` / `agent_work_queue`:**

- All 15 stored plans ran with `research: NONE`; every PUBLIC section reads `UNAVAILABLE / NOT_OFFERED`. This includes "Run diligence on Ajopot", "Check Ledgerline's unit economics" and "Check Silo Credit's loan book quality". No plan has ever read a public source.
- Causes:
  - The reader's `research` defaults to NONE: its examples never set it, and the schema defaults it.
  - A yes to Q's offer is NONE by construction.
  - The research hook researched `Public context: <topics>`, where the topics are the investor's mandate keywords, never the plan's question.
  - The 25 s situation race would end deep research (68 s observed) before its first round.
- Fixed in `afbcd6df3` (LOCAL_TESTED, gating):
  - Code adds MARKET when the ask turns on the outside world; own-record work stays NONE.
  - The ask leads the research.
  - Plan research gets 90 s.
  - An unreachable public web records a failed section.

**Live reproduction 1** — "Prepare an investment plan for Ledgerline: how do its unit economics compare…":

- Refused before approval (`NO_NAMED_COMPANY`, twice; 11.6 s) and nothing was planned.
- Cause: `matchCounterpart` found "Ledgerline" beside ten "Ledgerline XXXX (fictional)" companies created by this morning's live sign-up journeys, and called it ambiguous.
- Fixed in `8ad903701`: an exact name wins; identical duplicates stay ambiguous.

**Live reproduction 2** — "Prepare an investment plan for Ajopot…": a team job, 226 s from request to filed.

- Research: 68 s; 17 Brave searches.
- Document: 157 s; three draft-and-critique cycles (38.5 + 8.5, 42 + 8.5, 46 + 9.7 s). It filed failing review: 31 issues found, 9 open. Model spend $0.033.
- The research ran unanchored: "ajopot market size growth", `entityResolution: NOT_APPLICABLE`.
  - It kept namesakes and noise as sources: Ajovy, AJO, Ajaokuta, an adoption agency, modelling agencies, Cajeput oil.
  - Cause: only a DILIGENCE-profile analysis bound its company to the research step.
- Fixed in `e31d896bd`: any named-company analysis binds it.

**Presentation:**

- The delivery message carries an ARTIFACT_REFERENCE (READY) and the work card, with no open-intent.
- The modal viewer opens only on an explicit open (Q's OPEN_RECORD_PAGE or the person's ask).
- To be confirmed in a browser after deploy (`deliver.cjs` watches for any dialog or overlay until delivery).

**Owner items (not changed unilaterally):**

- Visibility of not-assessed sign-ups:
  - 49 "… (fictional)" companies are `network_visible` and not assessed, and investor name search and resolution can reach them. An investor gets a 404 on their profile (D2).
  - Should investor-side search and name resolution exclude companies that are not marketplace-ready, consistent with PADL #57/#58?
- Provider credits:
  - Tavily and Serper are still out of credit; Brave carries all research.

## Planning batch deployed; certification run 1 (12 Nov, 21:00–21:40 Lagos)

- **Receipt:** `ci-local PASS sha=afbcd6df3 at=2026-11-12T19:57:53Z took=2683s` (all six steps). **DEPLOYED** by `deploy-promote.sh`; rollback point `945138faf`; all four services SUCCESS.
- **Certification run 1** (investor, "Prepare an investment plan for Ledgerline: how do its unit economics compare…", Chat view, watched to delivery):
  - **Pass:** Ledgerline resolved and the job started (fixes `8ad903701`).
  - **Timings:** 196 s in all — research 63 s (anchored query: "ledgerline founders team africa payments"), document 132 s (3 drafts; filed with 10 open points; $0.029).
  - **Content:** well labelled (company record, self-reported; estimates), and it states plainly that public research gave no comparable unit economics.
  - **Defect 1 — presentation:** 12 s after delivery, the Document dialog covered the conversation, unasked. `deliverWork` opened the viewer whenever a job settled on the Q page (owner 2026-10-28). Fixed in `596bd01da`: typed chat delivers the inline card only; voice and the immersive Q view keep the open-in-place.
  - **Defect 2 — namesakes as evidence:** the analysis's Sources cited "GitHub - Syed-99/ledgerline" (a billing engine) and "Ledgerline Software (McKinsey) | PrepLounge". Deep research never checks pages against the subject (`entityResolution: NOT_APPLICABLE` on all 18 lanes). Fixed in `262e75106`: drop pages that name the company but place it only in other countries, or are someone else's repository of that name; market pages are untouched.
- **In the gate:** `262e75106` (both fixes). Next: deploy; rerun the same certification (expect no dialog, no namesake sources); a q_plans plan ask that needs research (expect a PUBLIC section READ); the founder side on their own records.

## Certification run 2 — deployed `3743dc48b` (12 Nov, 22:10–22:35 Lagos)

- **Receipt:** `ci-local PASS sha=3743dc48b at=2026-11-12T21:10:23Z took=2786s` (all six steps). **DEPLOYED** by `deploy-promote.sh`; rollback point `afbcd6df3`; all four services SUCCESS.
- **Gate-lock defect found and fixed (`3743dc48b`):** a Docker daemon started by a gate inherited the machine lock and held it, so the next gate was refused. Fixed; the lock was free after the following gate.
- **Investor, Ledgerline investment plan, Chat:** **LIVE_VERIFIED.**
  - Delivered at 21:23:05 as the inline card; no dialog or overlay in 330 s.
  - Its sources are relevant African B2B payments and fintech pages; no namesakes.
  - The analysis keeps self-reported figures labelled, notes that subscription revenue isn't comparable with transaction-fee peers, and labels Q's inference.
- **Founder, Clinicrest:** "Make me a 90-day plan to benchmark our pricing against competitors…". **LIVE_VERIFIED.**
  - The first plan in production with public research: research MARKET; PUBLIC section READ with 12 facts.
    - Topics: Nigerian digital health, competitor consultation fees, EMR comparisons, regulation, market size. One fact is off-topic (IrokoTV).
    - Context Firewall: 12 of 13 searches were minimised.
  - Drafted in 161 s, no redraft, first-review score 97, OFFERED.
  - **Execute:** running at +6 s with "0 of 7".
    - Two Q steps stayed PROPOSED, awaiting their own approval.
    - The founder's two steps went to the board.
    - Q's two running steps finished in parallel at 78 s and 120 s.
    - No dialog.
- **Remaining limitation:**
  - The analysis document's Sources section still says "published <date>" for a search-listed date. Fix in the next batch.

## Consolidated directive (13 Nov, from 00:30 Lagos) — first slices

The directive is recorded in `directives/2026-11-13-consolidated-execution-gateq-capability.md`; the live status is in `ACCEPTANCE-MATRIX-2026-11-13.md`.

- **Continuation:** `trig_01Lw52gWWexsrrMf7kbrPnPc` re-enabled, hourly at :31 UTC (the platform minimum is one hour), with a prompt rewritten for the local gate and receipt-checked deploys.
- **Audits (read-only agents):**
  - GateQ (Part B): Back/Forward missing; branding absent; `frame-ancestors *`; in-process throttle; Q's rules drafting only opened the page.
  - Capabilities and action surfaces (Part C): an unconditional next-step offer and a 2k-character "BE PROACTIVE" note; the SCHEDULE prep-brief link was inert; "Edit with Q" and "Try again" sent fixed text; prose offers are unrecorded.
- **Slices (LOCAL_TESTED, gating):**
  - `cca69db1a`: A3, one marketplace universe for search, names and slates.
  - `418e2d203`: search-listed dates are not called "published".
  - `0e69109e4`: C4, the schedule card opens its call's relationship.
  - `aa4d9634a`: C4, edit and retry name their document.
  - `f47010e5e`: C1, no offer or proactive guidance on remarks, record lookups, plain facts or progress checks.
  - `029198f0d`: B3, GateQ Back/Forward.
  - `bbc5ab17a`: A6, gate unit tests use every core. Measured: imports took 2,124 s against 435 s of tests over 2 workers.
  - `412eec74e`: B2, the rules editor starts from the investor's own mandate.
- **A5 reproduced live:** Ajopot's Raise cell is blank while the cheque-fit row quotes the deck's raise. Cause and fix are in the matrix; an implementation agent is working on the deck-claim source in its own worktree.
- **A3 measured:** 445 network-visible, marketplace-ready companies; the curated demo set is active.

## Directive batch deployed — `e57f6025f` (13 Nov, 03:00 Lagos)

- **Gate:** `ci-local PASS sha=e57f6025f at=2026-11-13T02:00:39Z took=2370s` (static 706 s, typecheck 157 s, build 101 s, test 1007 s, database 58 s, integration 341 s). The first gate, on `f4ce1a011`, failed on lint, a fake reader's type and missing Arabic strings, all mine; `e57f6025f` fixes them.
- **Deploy:** `scripts/deploy-promote.sh e57f6025f`; rollback point `3743dc48b`. All four Railway services SUCCESS.
- **Live checks** (`investor.savanna-seed`, fictional):
  - a search finds Ledgerline once and ignores a LinkedIn namesake;
  - a record lookup ("Clinicrest is at the seed stage and is based in Ibadan, Nigeria.") carries no offer;
  - an advice answer ends with one offer ("Want to rehearse it? I'll play Clinicrest.").
- **A5, Ajopot's blank Raise, explained:**
  - The deck's "The ask" (NGN 1,200,000,000) is founder-confirmed on a PUBLIC deck, and `deckMoneyFrom` parses it.
  - The raise reader still withholds it, because the founder shared the raise with one relationship and revoked it three times on 3 Oct. That makes the raise HIDDEN, and the policy's step 3 ("a raise the founder hid stays hidden") applies.
  - This is the locked privacy rule, so nothing was changed. Whether a revocation should also hide a deck the founder confirmed for investors is an owner question.

## Batch deployed — `81aa5cf3e` (13 Nov, 05:05 Lagos)

- **Gate:** the run on `257dd6459` was lost to a container restart. Its leftover checkout then stopped the retry; the gate now clears a stale tree under its lock (`81aa5cf3e`).
  - Receipt: `ci-local PASS sha=81aa5cf3e at=2026-11-13T03:54:22Z took=2621s` (static 855 s, typecheck 99 s, build 4 s, test 1179 s, database 99 s, integration 385 s).
- **Deploy:** `scripts/deploy-promote.sh 81aa5cf3e`, rollback point `e57f6025f`. All four Railway services SUCCESS.
- **Contents:** no catalog top ten under a comparison (`b40678d93`); Traction from the reader's deck when nothing else states it (`eeb36277d`); the inline embed frame sandboxed (`cb360f30f`); B8 duplicate application refused (`257dd6459`).
- **Live** (`investor.savanna-seed`, "Compare Ajopot, Ledgerline and Clinicrest side by side …", 34 s):
  - Ajopot's Traction reads "Registered users: 52,000; Circles: 3,900; Monthly active users: 4,200, September 2025 (company-stated, from their deck)".
  - No ranked list is appended.
  - The Raise cell stays blank (hidden-raise rule).
- **New findings:**
  1. The prose says Ajopot's deck "mentions NGN 1.2bn, but does not identify it as the raise", although the deck's "The ask" says "Amount sought". This is authorised deck content, not a leak, but it is wrong and inconsistent with the blank cell (owner question in the matrix, A5).
  2. The answer repeats the whole on-screen table as a markdown table after "The full comparison is on screen".
- **B7:** a synthetic site on another origin framed a fictional gateway (inline and launcher), desktop and 390 px. The host could not read the frame and held no Capital Q cookie.

## Batch deployed — `61b94f9d6` (13 Nov, 07:15 Lagos)

- **Gate:**
  - The first run, on `4832d4d15`, failed: the web typecheck and build broke because an eslint autofix had removed a cast in my new test. Fixed in `61b94f9d6`.
  - Receipt: `ci-local PASS sha=61b94f9d6 at=2026-11-13T05:59:53Z took=2824s` (static 793 s, typecheck 158 s, build 110 s, test 1252 s, database 70 s, integration 441 s).
- **Deploy:** `scripts/deploy-promote.sh 61b94f9d6`, rollback point `81aa5cf3e`. All four Railway services SUCCESS.
- **Live checks (fictional only; nothing submitted):**
  - **GateQ at phone width** (iPhone 13 profile, Lagos Forge Fund, fictional):
    - The currency select is 112 px wide.
    - With the amount in USD, the form says "Lagos Forge Fund (fictional) sets its round and cheque sizes in NGN. Give the amount in that currency so they can be checked." and offers "Use NGN".
    - After "Use NGN" and NGN 400,000,000, "Continue to interview" reaches "Your details".
    - Browser Back returns to the questions with the answers kept; Forward returns to "Your details".
    - No horizontal overflow and no page errors.
  - **Comparison** (`investor.savanna-seed`): the answer has no markdown table (1,912 characters, down from about 3,000), and Ajopot's Traction still comes from its deck.

## Demo activation (A3), applied 13 Nov 08:00–08:15 Lagos

- **Tool:** `scripts/seed/demo-activate.mjs` (`ee0d09a42`, `763a21e5e`).
  - A checked-in manifest of 436 fictional demo companies; at run time it refuses any company that is not fictional by construction.
  - Dry run by default; idempotent. The real demonstration companies are excluded.
  - Missing stages come from the seed world's own bands, recorded as `stageSource` in the manifest. They are chosen by demo activation, not stated by anyone.
- **Applied** with `scripts/seed/demo-activate-founder-session.cjs`:
  - Each fictional founder signed in with the seed password and acted through their own session (company PATCH, then readiness assess).
  - No service-role key was used: reading it from Railway into this session was refused by the session's permission classifier, and no workaround was attempted.
- **Result:** 13 companies are now `marketplace_ready`, with stage `pre_seed` or `seed` from the world bands: Tillra, Basketova Systems, Forgeora Hub, Gridari, Learnra, Ledgerent, Ledgerly Technologies, Millova Hub, Payslipari, Pulseisk Technologies, Rideix Technologies, Tapent Co and Tillum Technologies. A re-plan leaves 3 of 436 with work.
- **Remaining (need an account the session can't use):**
  - **MoneyHash and ekko:** their only members are the owner's gmail `+cq-` aliases, so the seed password doesn't apply. They need the stage set as that founder, or `--apply` with the service key.
  - **LedgerBridge:** its founder needs the `synthetic` app_metadata marker. That is an admin API write; once marked, the workers' sweep decides its PENDING claims.
- **Root cause fixed:** the live e2e scripts now create users with the synthetic marker (`synthetic-account.mjs`) and refuse non-fictional emails.
- **Gate timing note:** the gate on `6ad638a1b` ran static in 974 s against 793 s before. The browser runs overlapped it and the prettier cache was cold, so this is not a fair measurement.

## Batch deployed — `6ad638a1b` (13 Nov, 09:45 Lagos)

- **Gate:**
  - The run on `4517feada` failed only on the schema guards (130, 450): the new throttle table was not classified. Fixed in `6ad638a1b`.
  - Receipt: `ci-local PASS sha=6ad638a1b at=2026-11-13T08:30:37Z took=3145s` (static 974 s, typecheck 132 s, build 3 s, test 1518 s, database 74 s, integration 444 s).
  - This was the first run with fail-fast and the prettier cache. Static and test were slowed by demo-activation browser runs and an agent alongside, so the timings are not a fair measurement.
- **Migration:** `20261231500000_gateq_guest_throttle_buckets` applied with `hosted-migrate-https.mjs` before the deploy. Hosted head is `20261231500000`; RLS is on and anon has no select.
- **Deploy:** `scripts/deploy-promote.sh 6ad638a1b`, rollback point `61b94f9d6`. All four Railway services SUCCESS.
- **Live:**
  - **C3:** as `investor.savanna-seed`, the call prep for Clinicrest ends with "Want to rehearse it? I'll play Clinicrest." and carries a `NAVIGATION_OFFER` to `COMPANY_REHEARSAL`. "yes" answers "Opening a rehearsal with Clinicrest." and moves to `/rehearsals/company/6b2f9851…` (move 3.1 s). No page errors.
    - Oddity seen in the same turn: a separate "Overview is ready to open." profile offer was stored before the prep answer.
  - **B8:** `gateq.guest_throttle_buckets` went from 0 to 2 rows after a guest walk on Lagos Forge Fund (fictional), so charges are shared in Postgres. The walk still reached "Your details".

## Batch deployed — `0a6f0e298` (13 Nov, 11:05 Lagos); live checks pending

- **Gate:** the first optimised run (two lanes, prebuild, ESLint concurrency 2), with the same steps and an exact-commit receipt: `ci-local PASS sha=0a6f0e298 at=2026-11-13T10:04:25Z took=2307s` (baseline 2,824 s).
  - An earlier run on `881a50c9e` failed only on the root lint batch: my `.cjs` script was outside the typed-lint config. Fixed in `0a6f0e298`.
- **Deploy:** `scripts/deploy-promote.sh 0a6f0e298`, rollback point `6ad638a1b`. All four Railway services SUCCESS. No migrations.
- **Contents:**
  - A4 synthetic reviewer guard and certification test (`635c548d2`). The integration test runs in every gate and passed here.
  - A8 charts drawn by code (`881a50c9e`).
  - The demo-activation tools (`ee0d09a42`, `763a21e5e`, `0a6f0e298`).
- **Live verification blocked from the sandbox (10:16 UTC on):**
  - The egress gateway answers 403 to CONNECT for `capital-qweb-production.up.railway.app`, `capital-qapi-production.up.railway.app` and even `www.google.com`.
  - The environment tools (`get_environment`, `read_documentation`) fail with "a credential for this connector could not be obtained".
  - Not routed around. The A8 chart check ("Chart monthly revenue for Capital Q, KUUZA AI and SongScribe AI side by side") and an A4 smoke check are to be re-run once egress works.
- **A8 demo figures seed:** `scripts/seed/demo-figures.mjs`, local branch `a8-demo-figures` (`69e058841`, `5725dd900`, `967669f5f`).
  - The dry run plans 32 fictional companies, 111 metrics and 363 claims, attributed to the SYSTEM audit actor.
  - Readers now show the latest point per metric.
  - **Held before `--apply`:** the readiness and investability readers count every network-visible current claim, so monthly history could inflate evidence. They must group by claim key first.
- **Egress restored by 10:31 UTC. Live check of `0a6f0e298`, A8:**
  - Asked as `investor.savanna-seed`: "Chart monthly revenue for Capital Q, KUUZA AI and SongScribe AI side by side."
  - The answer carries a code-built CHART (BAR, USD a month): SongScribe AI 3,200 and Capital Q 4,800, both as of 2026-09-30, USER_CLAIM / SELF_REPORTED, sourced "Company-stated on Capital Q, as each claim gives it; not verified by Capital Q".
  - KUUZA AI is said to be "Not established"; nothing is invented. 28 s, no page errors.
- **A4:** certified by `apps/api/test/synthetic-reviewer.integration.test.ts` in the integration step of `0a6f0e298`'s gate (PASS). No production surface by design: no synthetic reviewer is provisioned there.

## Release `c58d71d9c` and the demo figures seed (13 Nov, 12:00 Lagos)

- **Gate:** `ci-local PASS sha=c58d71d9c at=2026-11-13T10:54:01Z took=1951s` (static 665 s, typecheck 101 s, build 2 s (apps cached), test 1,182 s, database 62 s, integration 438 s).
- **Deploy:** `scripts/deploy-promote.sh c58d71d9c`, rollback point `0a6f0e298`. All four services SUCCESS.
- **Seed applied** (`scripts/seed/demo-figures.mjs --apply`, owner-approved 13 Nov):
  - 32 fictional companies, 363 company-stated figure claims (USER_CLAIM / SELF_REPORTED, CURRENT, network_visible). Each statement says "(Demonstration data, self-reported by the company.)".
  - Audit rows are `capital_q_system`, with no person. A re-plan finds nothing left (idempotent).
  - Ledgerline was the canary: 16 claims, e.g. MRR NGN 31.7m (June) to NGN 38.0m (September 2026).
- **Live chart check exposed a defect:**
  - "Chart Ledgerline's monthly recurring revenue over the last few months" drew no chart. Q answered from the profile text and searched the public web.
  - Cause: the name candidate was "Chart Ledgerline", because "chart" was not among the words that are never a company's name. The exact-name search failed, so no figures were read.
  - Fixed in `1d267d200`: the chart verbs are not names, and a chart ask (not a comparison) now reads its named companies' figures through the executor. Test-proven: the new test fails without the fix. Gating now.
- **`1d267d200` deployed** (gate `ci-local PASS sha=1d267d200 at=2026-11-13T11:49:40Z took=2014s`; rollback point `c58d71d9c`; four services SUCCESS).
- **Live:** "Chart Ledgerline's monthly recurring revenue over the last few months" now draws a code-built LINE chart: NGN 31,722,470 (June) → 38,000,000 (September 2026), 4 dated points, labelled company-stated and not verified.
- **Defect (next):** the prose contradicts the chart. It says "from ₦19.6m in October 2025" and "the record doesn't provide each month's value".
  - Likely sources: an older growth claim's start, and the figures tool's "Earlier reading… not the latest figure" labels.
  - The analyst is not told what the code drew. Fix: give the answer the chart's own points as an authorised fact (as the comparison's fact statement does), so the words describe the series on screen.
- **`c455c03d2` deployed.**
  - Gate: `ci-local PASS sha=c455c03d2 at=2026-11-13T13:02:48Z took=2143s`. The earlier run on `4375d1155` failed only because the kernel killed a lint worker for memory (concurrent checks); no lint error was reported.
  - Rollback point `1d267d200`; four services SUCCESS.
  - Contents: the chart fact (`4375d1155`) and C10 comparison by reading (`c455c03d2`).
- **Live:** the Ledgerline chart's words now describe the drawn series: "₦31.72m in June 2026 to ₦33.69m in July, ₦35.78m in August, and ₦38.0m in September… about ₦6.28m, or 19.8%… self-reported". One CHART block.
  - It also cites an older October 2025 growth start (₦19.6m) and says honestly that the months in between are not given.

## C10 batch deployed — `5af6c8ad3` (13 Nov, 15:10 Lagos)

- **Gate:** `ci-local PASS sha=5af6c8ad3 at=2026-11-13T13:58:43Z took=2101s`. Rollback point `c455c03d2`; four services SUCCESS.
- **Contents:**
  - TURN_READER v82 typed chart intent; the chart path no longer reads words (`5af6c8ad3`).
  - Re-render by the reading (`e36f156fb`).
  - Comparison by the reading (deployed earlier).
- **Live** (`investor.savanna-seed`, one conversation):
  1. "How has Ledgerline's monthly recurring revenue moved since June? Let me see it visually." The word "chart" is never said. Answer: a 4-point Ledgerline MRR chart, and words that match it ("₦31.72m in June to ₦38.0m in September 2026… about 19.8%").
  2. "Now do the same for Silo Credit." The follow-up is understood and the metric kept. Silo Credit, a lender, has no MRR claim, so Q says MRR "isn't available on record". No other metric is substituted and no chart is drawn.
  3. "What stage is Ledgerline at?" Answer: "Ledgerline is at the seed stage… isn't verified." No chart.
- **Noise seen (audit item 2, navigation):** each turn also stored an unasked move or offer: "I've opened Overview.", "Overview is ready to open.", "Relationship is ready to open." The pane moved to Ledgerline's profile on the chart ask.

## Release gate under 25 minutes — `a43968b40` (13 Nov, 16:03 Lagos)

- **Receipt:** `ci-local PASS sha=a43968b40 at=2026-11-13T15:03:09Z took=1320s` (22.0 min, against the 47-min baseline).
  - Steps: prebuild 2, static 768, typecheck 92, build 2 (apps cached), test 456, database 71 and integration 495 (both overlapped).
- **Gate changes made 13 Nov, measured; every check still runs:**
  - fail-fast;
  - prettier content cache;
  - one package prebuild;
  - two lanes;
  - ESLint concurrency 2;
  - hybrid test isolation, two Vitest projects (`a43968b40`):
    - the node side (1,520 files) without isolation, stable in two shuffled orders;
    - web plus 2 stateful files isolated;
    - same 2,033 files.
- **Rejected, with reasons:**
  - the ESLint cache: type-aware rules make it stale;
  - ESLint concurrency 4: ran out of memory;
  - the Vitest threads pool: timing tests flaked and there was no clean gain.
- No deploy: this commit changes only the test configuration and docs. Production stays on `5af6c8ad3`.

## Navigation v84 deployed — `12baf142c` (13 Nov, 17:25 Lagos)

- **Gate:** `ci-local PASS sha=12baf142c at=2026-11-13T16:23:23Z took=1343s` (22.4 min). Rollback point `5af6c8ad3`; four services SUCCESS.
- **Contents:**
  - TURN_READER v84 navigation intent (GO / CONTEXT / OFFER_ONLY / NONE), with CONTEXT going through the existing decider and its guards, plus SAME_SUBJECT and BACK_AND_FORTH holds.
  - GO moves at once (`12baf142c`).
  - Module-mocking tests isolated, with a guard (`0863278cb`).
  - The eval key name (`583eccbca`).
- **Live journey** (`investor.savanna-seed`, /work, one conversation):
  1. "Who should I follow up with this week?" — **stayed on /work** (miss). The reader read THEIR_OWN_RECORDS; the decider decided STAY with no guard.
  2. "Can I see Clinicrest's data room?" → `/company/6b2f…?tab=dataroom`, 3.6 s.
  3. "And what's their team like?" → `?tab=team`, 3.9 s (deep link, same record).
  4. "What does ARR mean?" — stayed.
  5. The Ledgerline MRR chart question — stayed (chart inline, no Overview).
  6. "Don't move the page, just tell me what stage Ledgerline is at." — stayed.
  7. "Take me to my pipeline." → `/relationships?view=pipeline`, **0.8 s**.
- **Not yet accepted.** The CONTEXT pipeline case misses because CONTEXT cannot overcome a decider STAY, and the reading's mode is not logged. A follow-up is with the navigation agent.
- **Owner-acceptance gaps still open:**
  - no pinned-workspace state in the screen contract;
  - the live evals wait for `CQ_EVAL_ANTHROPIC_API_KEY`.

## Navigation v85 live-verified — `f3589102d` (13 Nov, 18:25 Lagos)

- **Gate:** `ci-local PASS sha=f3589102d at=2026-11-13T17:17:32Z took=1346s`. Rollback point `12baf142c`; four services SUCCESS.
- **Contents:**
  - TURN_READER v85: pipeline work read as CONTEXT with destination CRM_PIPELINE.
  - A CONTEXT reading with a destination places a move when the decider stayed unguarded; same guards and holds.
  - Navigation fields logged.
- **Live journey** (`investor.savanna-seed`, /work), all 7 pass:

  | #   | Turn                                     | Result                         | Time   |
  | --- | ---------------------------------------- | ------------------------------ | ------ |
  | 1   | "Who should I follow up with this week?" | `/relationships?view=pipeline` | 6.7 s  |
  | 2   | "Can I see Clinicrest's data room?"      | `?tab=dataroom`                | 4.1 s  |
  | 3   | "And what's their team like?"            | `?tab=team`                    | 4.9 s  |
  | 4   | "What does ARR mean?"                    | stayed                         | —      |
  | 5   | Ledgerline MRR chart question            | stayed (chart inline)          | —      |
  | 6   | "Don't move the page…"                   | stayed                         | —      |
  | 7   | "Take me to my pipeline."                | moved                          | 0.86 s |

- **Open:**
  1. Contextual moves take 4–7 s, because the CONTEXT placement waits for the decider's verdict. Owner asked for "very fast": act on a CONTEXT reading with a resolved destination as soon as the reading lands, unless the decider has guarded.
  2. The voice/immersive path is not exercisable from the sandbox (no UDP).
  3. Pinned workspace is in progress.

## Pinned workspace deployed — `b1bfae8e7` (13 Nov, 19:15 Lagos)

- **Gate:** `ci-local PASS sha=b1bfae8e7 at=2026-11-13T18:09:06Z took=1451s`. Rollback point `f3589102d`; four services SUCCESS.
- **Contents:**
  - Pinned workspace: an optional `workspace.pinned` on the screen manifest and `NAVIGATION_OFFER.unpin`, session-scoped in sessionStorage; a PINNED hold last in the gate.
  - Fast CONTEXT placement.
- **Live** (`investor.savanna-seed`, /work):
  - Pin → "Workspace pinned" indicator.
  - "And what's their team like?" while pinned → stayed.
  - "Take me to my pipeline." while pinned → stayed, with one "Unpin and open" offer.
  - Clicking it → unpinned and at `/relationships?view=pipeline`.
  - Pin, then reload → still pinned.
- **Regression found:** "Can I see Clinicrest's data room?" landed on `/company/6b2f…` without `?tab=dataroom` (it was `?tab=dataroom` at 4.1 s on v85), in 6.2 s. The fast CONTEXT placement uses the reading's coarser destination, and the decider's deep link cannot move a second time. A fix is with the agent: refine within the same record; fast-place only destinations that are already complete.
- **A8 media** (`bbb1d7d36` with lint fix `19330f169`): COMPANY_MEDIA block, TURN_READER v86 `companyMedia`. Gating now.

## A8 media and deep-link fix deployed — `a37e844d5` (13 Nov, 20:40 Lagos)

- **Gate:** `ci-local PASS sha=a37e844d5 at=2026-11-13T19:39:30Z took=1436s`. Two earlier gates on this batch failed and were fixed: `5230a2b86` (switch exhaustiveness for `COMPANY_MEDIA`) and `c46a16e10` (Arabic for three media-block strings). Rollback point `b1bfae8e7`; four services SUCCESS.
- **Contents:**
  - COMPANY_MEDIA block, TURN_READER v86.
  - Fast CONTEXT limited to complete screens, with refinement inside the same record (`5230a2b86`).
  - Arabic for the media-block strings.
- **Live** (`investor.savanna-seed`, /work, `steps-media.json`):

  | #   | Turn                                                                 | Result                                                       |
  | --- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
  | 1   | "Can I see Clinicrest's data room?"                                  | **FAIL**: `/company/6b2f…` with no `?tab=dataroom` (6.2 s)   |
  | 2   | "Could I watch how Clinicrest presents itself? Play me their pitch." | COMPANY_MEDIA with the pitch player, Clinicrest only; stayed |
  | 3   | "Tell me about Ledgerline."                                          | COMPANY_MEDIA with Ledgerline's own picture; no player       |
  | 4   | "What does ARR mean?"                                                | no new media; stayed                                         |

  No page errors.

- **Root cause of #1** (q-api logs): the reading this time was TOOL_REQUEST with GO and a COMPANY reference, so `openReferenced` opened the record at once and never carried a tab. On v85 the same words had been read as CONTEXT, so the decision placed the tab. The words-based tab parser does not read "Can I see …", and widening it would be keyword routing.
- **Fix in progress:** TURN_READER v87 `navigation.tab`, the record tab read by meaning. `openReferenced` applies it, with the words parser only when there is no reading.
- **Seen:** on turn 2, Q offered "Open Company profile" while that profile was already open (cosmetic; queued).

## TURN_READER v87 (record tab) deployed — `550ecdd5c` (13 Nov, 21:35 Lagos)

- **Gate:** `ci-local PASS sha=550ecdd5c at=2026-11-13T20:34:04Z took=1295s`. Rollback point `a37e844d5`; four services SUCCESS.
- **Live** (`investor.savanna-seed`, /work, `steps-media.json`; q-api logs now show `navigationTab`):

  | #   | Turn                                                                 | Result                                                                                                                                                                                                                                            |
  | --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | "Can I see Clinicrest's data room?"                                  | **PASS**: `/company/6b2f…?tab=dataroom` (6.7 s); reading GO, tab `dataroom`. Q also prepared an "ask for everything on request" card, which waits for approval and was not sent.                                                                  |
  | 2   | "Could I watch how Clinicrest presents itself? Play me their pitch." | **REGRESSION**: reading GO, tab `deck`, `companyMedia.pitch`. `openReferenced` opened COMPANY_PITCH (`/discover?tab=yours&company=…`); no inline player. Fix with the agent: a pitch ask plays inline, and any placement uses the `elevator` tab. |
  | 3   | "Tell me about Ledgerline."                                          | moved to Ledgerline `?tab=overview` (CONTEXT, 6.0 s), with Ledgerline's own picture                                                                                                                                                               |
  | 4   | "What does ARR mean?"                                                | stayed; no new media                                                                                                                                                                                                                              |

- **In progress:** an agent is reconciling record-tab navigation across the paths. The plan has five edits: the decision overlay; tab-chosen pages; deck by reading; follow-ups on the record in play; and investor and relationship records added to the remembered screen. It also carries the pitch fix above.

## Record-tab navigation deployed — `d96c63ee1` (13 Nov, 22:20 Lagos)

- **Gate:** `ci-local PASS sha=d96c63ee1 at=2026-11-13T21:16:33Z took=1195s`. Rollback point `550ecdd5c`; four services SUCCESS.
- **Contents:**
  - The decision overlays the reading's tab (`readingTabPlace`).
  - Pages are chosen from the tab (`pagesForTab`).
  - Deck by reading.
  - A tab with no record named (`readTabAnswer`, outside the Workspace).
  - The INVESTOR page is in follow-up memory.
  - A pitch ask plays inline.
- **Live** (`investor.savanna-seed`, Workspace, `steps-rt.json` and `steps-rtpin.json`):

  | #   | Turn                                                            | Result                                                                                                              |
  | --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | 1   | "Tell me about Clinicrest." (from /work)                        | answered, stayed                                                                                                    |
  | 2   | "Can I see their data room?" (indirect, cross-turn)             | **PASS** `?tab=dataroom` (5.1 s)                                                                                    |
  | 3   | "Does their data room have audited accounts?"                   | **PASS**: answered, stayed                                                                                          |
  | 4   | "…Play me their pitch."                                         | **FAIL**: inline player shown, but the decision moved to `?tab=deck` and the prose claimed the pitch would not open |
  | 5   | "Show me my messages with Clinicrest."                          | **PASS**: thread (1.1 s)                                                                                            |
  | 6   | "Tell me about Ledgerline." (pane on Clinicrest messages)       | **GAP**: CONTEXT tab overview, decision STAY; picture shown                                                         |
  | 7   | "And what's their team like?"                                   | **GAP**: CONTEXT tab team, SPLIT_VOTE STAY; answered about Ledgerline's team                                        |
  | 8   | "Can I see their data room?" (after Ledgerline turns)           | **FAIL (wrong referent)**: opened Clinicrest's data room, the record in the pane, not the subject discussed         |
  | 9   | "Can I see Ledger's data room?"                                 | Ledgerline `?tab=dataroom` (only one match visible to this account)                                                 |
  | 10  | "Can I see Orbitwell Robotics's data room?"                     | **PASS**: nothing opened, "No company on record matches"                                                            |
  | P   | Pinned: "Open Clinicrest." → Pin → "Can I see their data room?" | **PASS**: stayed, one "Unpin and open"; clicking it → `?tab=dataroom`                                               |

- **Final bounded batch with an agent:**
  1. A pitch ask places on `elevator`, never `deck`, with honest prose.
  2. A contextual record not in the pane is placed with its tab, for one authorised record only.
  3. "their" binds to the conversation's subject over the pane's record.

  The re-certification replay follows. After it, the parallel lanes move off navigation: A8 claim extraction and C3 durable offers are already running.

## Navigation certified; A8 figure claims and C3 offers deployed — `3293f344e` (13 Nov, 23:40 Lagos)

- **Gate:** `ci-local PASS sha=3293f344e at=2026-11-13T22:17:52Z took=1353s`. Rollback point `d96c63ee1`; four services SUCCESS.
- **Contents:**
  - **Navigation:** the pitch goes to the elevator tab; the conversation's record is placed on the reading's tab; "their" binds to the current record.
  - **A8:** `company.figure.record` approval card, `2bddb4f33`.
  - **C3:** recorded answer offers, `c57d24b9c`.
- **Navigation live replay** (`investor.savanna-seed`, Workspace, `steps-rt.json`). **CERTIFIED: 11/11.**

  | #   | Turn                                                      | Result                                                                                                                           |
  | --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | "Tell me about Clinicrest." (from /work)                  | contextual move to Clinicrest `?tab=overview` (7.9 s)                                                                            |
  | 2   | "Can I see their data room?"                              | `?tab=dataroom` (4.4 s)                                                                                                          |
  | 3   | "Does their data room have audited accounts?"             | answered, stayed                                                                                                                 |
  | 4   | "…Play me their pitch."                                   | inline pitch player; stayed (no deck move); no failure claim. A redundant "Open Company profile" offer is still shown (cosmetic) |
  | 5   | "Show me my messages with Clinicrest."                    | thread (1.6 s)                                                                                                                   |
  | 6   | "Tell me about Ledgerline." (pane on Clinicrest messages) | contextual move to Ledgerline profile (4.6 s), with its picture                                                                  |
  | 7   | "And what's their team like?"                             | Ledgerline `?tab=team` (4.9 s)                                                                                                   |
  | 8   | Pin, then "Can I see their data room?"                    | stayed; "Your workspace is pinned…" with one "Unpin and open"                                                                    |
  | 9   | "Unpin and open"                                          | **Ledgerline** `?tab=dataroom`: the conversation's record, not the earlier Clinicrest                                            |
  | 10  | "Can I see Ledger's data room?"                           | already there; answered (locked until interest is accepted)                                                                      |
  | 11  | "Can I see Orbitwell Robotics's data room?"               | nothing opened; "couldn't locate … a company record"                                                                             |

- **C3 live** (`steps-off.json`, `steps-off2.json`):
  - Page offer "Would you like to open it?" → "sí, ábrela" → opened. **PASS**
  - Call-prep rehearsal offer → "go for it" → rehearsal lobby for Watchly. **PASS**
  - "not now" → nothing prepared or changed. **PASS**
  - A prose offer recorded from the analyst model ("q answer closed with an offer") was **not observed**: the model made no offer in three analyst turns. **UNPROVEN live**
- **A8 live** (`founder.maji-loop`, `steps-fig.json`): "Good news: we hit $120k MRR in October." **FAIL.**
  - Reading ANSWER; path DEEP_ANALYSIS with 124 tools; the model did not call `propose_company_figure`. Q replied "I don't yet have that recorded as an approved company figure" and showed no card.
  - Nothing was written, so no stray data. Sent to an agent: make the tool reachable and chosen on a founder's own-company statement, by reading, with no keyword routing.
- **Journey fixes** (`7e3e22153`):
  - D1: INTEREST_ACCEPTED notice, with migration `20261231510000`. It only adds a kind, and all 27 production kinds were checked kept. The migrator does not flag DROP CONSTRAINT.
  - D2: no duplicate interest card.
  - D3: an honest waiting line.
  - D4: the briefing stays clear of actions.
  - D5: refresh after a send.
  - D8: touch targets.
  - Gating now. The migration is applied after the gate's database step passes and before the deploy.

## Journey fixes deployed — `7e3e22153` (14 Nov, 00:10 Lagos)

- **Disk incident (22:38 UTC):**
  - The sandbox disk reached 0 MB free, which broke the first gate run on `7e3e22153`.
  - Freed by removing 15 merged, clean agent worktrees (their branches are kept) and stale `/tmp/ci-local/*/tree` checkouts (receipts kept): 0 → 14 GB free.
  - The broken gate was stopped and re-run clean.
- **Gate:** `ci-local PASS sha=7e3e22153 at=2026-11-13T23:07:03Z took=1323s`, database (pgTAP) included.
- **Migration:**
  - `20261231510000_interest_accepted_notices` applied to hosted with `hosted-migrate-https.mjs --apply`. Hosted now has 294 migrations, none missing.
  - Before applying, the production constraint's 27 kinds were compared with the new list: identical, plus INTEREST_ACCEPTED. After applying it holds 28.
  - Applied before the deploy.
- **Deploy:** rollback point `3293f344e`.
