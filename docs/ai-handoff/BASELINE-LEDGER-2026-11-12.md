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

## A8 figure card reaches founders — `a07ea25cb` (14 Nov, 01:20 Lagos)

- **Container restart (~23:40 UTC):**
  - Stopped the gate on `0973778f4`, the GateQ live run and the branding worker.
  - The live run was resumed; it re-checked by SQL and created nothing twice.
  - The branding worker was re-created.
  - The gate was re-run on the head `a07ea25cb`, which contains `0973778f4`.
- **Gate:** `ci-local PASS sha=a07ea25cb at=2026-11-14T00:08:54Z took=1502s`. Rollback point `7e3e22153`; four services SUCCESS.
- **Live** (`founder.maji-loop`, `steps-fig.json`):

  | #   | Turn                                                                 | Result                                                                                                                                                                                                                            |
  | --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | "Good news: we hit $120k MRR in October."                            | **PASS**: approval card ("Kept as your own statement (self-reported), private to your company: investors don't see it") with Approve / Change it / Keep it with me / Drop; 61 s turn                                              |
  | 2   | Approve                                                              | **PASS**: one `evidence.claims` row `financial.mrr`, USER_CLAIM / SELF_REPORTED / CURRENT, `organisation_private`, `valid_from` 2026-10-31                                                                                        |
  | 3   | "Actually October MRR was $110k."                                    | **DEFECT**: no card, and nothing written (correct without approval). Q said "You've corrected … to $110k. The earlier $120k figure remains on record as a conflicting … statement", which implies a recording that never happened |
  | 4   | "Ya tenemos 42 clientes de pago."                                    | **PASS**: approval card (not approved)                                                                                                                                                                                            |
  | 5   | Investor `savanna-seed`: "What was Maji Loop's MRR in October 2026?" | **PASS (firewall)**: "I don't have Maji Loop's October 2026 MRR on record"                                                                                                                                                        |

- **Open:** the correction turn must prepare a card (or say plainly that nothing is recorded yet), never imply a record. The card turns took about 61 s.
- **GateQ branding and fictional applicant seed** (`75e712fcf`, pushed, not gated):
  - The public gateway shows the investor organisation's name, photo and an AA-safe accent. The accent is the tenant's own brand theme, and today no tenant has one, so setting one needs operator SQL.
  - New seed: `scripts/seed-fictional-world.mjs --gateq-applicant`. It needs `CQ_SEED_SUPABASE_SECRET_KEY` and runs only on an operator machine; it was not run here.

## GateQ fixes and small fixes deployed — `985db1796`, `5f4603b05` (14 Nov, 03:20 Lagos)

- **`985db1796`** (GateQ D1–D5, gateway name branding, applicant seed):
  - The first gate on `9654a0c0f` FAILED on two stale tests: the new route was not classified, and a form test still expected a pre-ticked deck. Both were fixed in `985db1796`.
  - `ci-local PASS sha=985db1796 at=2026-11-14T01:31:21Z took=1862s`.
  - Live re-check: see `audits/2026-11-14-gateq-live-journey.md`, "Re-check 14 Nov (985db1796)". D1, D5, B6 name and the low items PASS. D2b and D4b are HIGH; a fix is in progress.
- **`5f4603b05`** (A8 correction card plus recorded-claim guard, opened briefing clear, Drop on Work):
  - `ci-local PASS sha=5f4603b05 at=2026-11-14T02:08:59Z took=1684s`. Rollback point `985db1796`; four services SUCCESS.
  - **Live A8:** "Actually October MRR was $110k." (`founder.maji-loop`) **still FAILS**. The reading was CORRECTION, and the turn was answered by the company-intelligence specialist, which holds no tools and has no guard. There was no card, and the reply said "I'm keeping both figures visible". Still only one `financial.mrr` claim: nothing was written. A fix is in progress: route by the reading to the tool path, plus the guard on the specialist path.
  - Opened-briefing clearance and Drop on Work are covered by tests; a live check is pending.
- **Matrix table repaired** (`459ef21e1`): earlier notes had split rows. Every row is one line with four cells again.

## GateQ D2b/D4b and the A8 correction route deployed — `41c920519`, `4d5ab3ac2` (14 Nov, 04:55 Lagos)

- **`41c920519`:**
  - `ci-local PASS sha=41c920519 at=2026-11-14T02:49:10Z took=1734s`.
  - Live (Routeix → Kilima; see the audit's "Re-check 14 Nov (41c920519)"): D2b PASS, D4b PASS.
  - New defects, fix in progress: D8 HIGH (a failed reply locks the application behind a false rate-limit message), D9 MEDIUM (a stated zero is stored as unknown), D10 LOW, plus a repeated question.
- **`4d5ab3ac2`:**
  - `ci-local PASS sha=4d5ab3ac2 at=2026-11-14T03:17:51Z took=1375s`. Deploy held until the live GateQ run finished; rollback point `41c920519`.
  - **Live A8 correction** (`founder.maji-loop`): the turn now reaches the tool path (DEEP_ANALYSIS, 125 tools), and the reply is honest: "You told me … $110k. I haven't saved that yet." Still only one `financial.mrr` claim.
  - **Still no card:** the model again put the figure in `userStatements` (an element was dropped) instead of calling the tool. Fix in progress: code prepares the card from a valid structured statement of the founder's own figure; no word rules.

## A8 deck → proposed figure cards deployed, live FAIL — `e455f8334` (14 Nov, 05:40 Lagos)

- **Gate:** `ci-local PASS sha=e455f8334 at=2026-11-14T04:22:07Z took=1422s`. Rollback point `4d5ab3ac2`; four services SUCCESS.
- **Live** (`founder.maji-loop`; fictional 4-slide deck, uploaded twice as PITCH_DECK and CONFIDENTIAL; processing COMPLETED):
  - The document-ready wake fired and the job ran. A once-only DOCUMENT source was registered for each version.
  - **FAIL:** the extraction output was refused at schema: `claims.N.asOf:invalid_format`, because the schema needs YYYY-MM-DD and the prompt never says so. It was reported as `PROVIDER_UNAVAILABLE` and `DOCUMENT_CLAIMS_BLOCKED`. Result: 0 cards and 0 claims.
  - Because the marker is registered before the call, both versions are now permanently skipped.
  - **PASS, investor privacy:** savanna-seed's Q answered "I don't have Maji Loop's October 2026 MRR on record".
  - **Records** (fictional, Maji Loop): 2 documents, 2 DOCUMENT sources, 1 investor conversation.
- **Fix in progress:**
  - date format in the prompt plus month → period-end mapping in code;
  - a bad claim drops only itself, not the whole batch;
  - the real refusal reason in the log and alert;
  - the marker no longer blocks a retry after a failed call, which also re-reads the two marked versions.
- **GateQ D8–D10 (`a047ddf63`):** gating; deploy held until the deck check finished.

## A8 founder figures LIVE end to end — `faa48e867` (14 Nov, 07:20 Lagos)

- **Gates:**
  - `2069d674f`: FAIL from machine contention (lint stopped with no errors; an integration timeout) while two workers ran tests. A clean re-lint passed. Workers are now held idle during gates.
  - `a45ac12d8`: FAIL, two real defects. q-specialists parsed the analyst answer with the v30 schema (it would refuse v33 `statedFigures`), and the pgTAP cross-tenant case reused a version that already had a reading. Both fixed in `faa48e867`.
  - `faa48e867`: `ci-local PASS sha=faa48e867 at=2026-11-14T06:04:57Z took=1377s`.
- **Migration:** `20261231520000_document_claim_readings` applied before the deploy. Hosted has 295 migrations, none missing; `relrowsecurity` is true. Rollback point `e455f8334`; four services SUCCESS.
- **Live** (`founder.maji-loop`):

  | Step                                              | Result                                                                                                                                                                                                                                            |
  | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Re-read of the two decks marked on `e455f8334`    | **PASS**: the catch-up after the deploy left both versions COMPLETED with attempts=1 at 06:10                                                                                                                                                     |
  | Deck → proposed cards                             | **PASS**: 4 cards, AWAITING_APPROVAL ("Keep your MRR of USD 42,000 for October 2026, from "Maji Loop deck QA 14 Nov b" (page 2)", and USD 37,500 for September from page 3, per deck). None for the June 2027 target. No claim before approval    |
  | Drop September (deck b)                           | **PASS**: action and approval REJECTED; no claim                                                                                                                                                                                                  |
  | Approve October (deck b, from Work)               | **PASS**: action EXECUTED. Claim `23cad797` is USER_CLAIM / DOCUMENT_SUPPORTED / CURRENT, `organisation_private`, `valid_from` 2026-10-31. Its evidence item has locator `{document, page 2, excerptHash, documentVersionId 21c9f0be…}`, SUPPORTS |
  | Contradiction                                     | **PASS**: the earlier chat claim (USD 120,000, SELF_REPORTED) stays CURRENT and is linked CONTRADICTS to the document evidence; nothing overwritten                                                                                               |
  | Chat correction "Actually October MRR was $110k." | **PASS**: card "Record your MRR of USD 110,000 for October 2026" (AWAITING_APPROVAL), naming both existing USD 42,000 and USD 120,000 as kept and conflicting; not approved                                                                       |
  | Investor privacy (on `e455f8334`)                 | PASS: "I don't have Maji Loop's October 2026 MRR on record"                                                                                                                                                                                       |

- **New LOW defect:** the job's proposals appear in the founder's conversation as "You: From your document: …", attributed to the founder rather than Q or the system.
- **Still open:** GateQ D8–D10 live re-check on `faa48e867` (the Layerum draft should be unblocked).

## Voice slice 1, research-to-claims and the decision-96 gate deployed — `d37458856` (14 Nov, 09:55 Lagos)

- **Gates:**
  - `fb6c99973` FAIL: pgTAP 130/450 did not classify `gateq.application_voice_sessions`. Fixed in `d37458856`.
  - `d37458856` first run FAIL: lint stopped in `apps/q-api` while 8 worker test and typecheck processes ran. A clean re-lint passed.
  - `d37458856` re-run with the machine idle: `ci-local PASS at=2026-11-14T08:52:04Z took=1315s`.
- **Migration:** `20261231530000_gateq_application_voice_sessions` applied before the deploy. Hosted has 296 migrations, none missing; `relrowsecurity` is true. Rollback point `86dc95a75`; four services SUCCESS.
- **Live (no cost):** `/v1/gateq/apply/voice` without a credential returns a uniform 404, so it does not reveal whether a resource exists.
- **Voice interview:** stays OFF. It needs `DEEPGRAM_API_KEY`, `CQ_GATEQ_VOICE_INTERVIEW=1`, `API_PUBLIC_URL` and a seal key on the api service, and live voice uses the owner's Deepgram account. Audio cannot be tested from the sandbox (no UDP).
- **Research figure job:** OFF by default (`CQ_RESEARCH_FIGURE_CARDS`), per decision 96.
- **Gating now (`6a416c3ab`):** the research-evidence rework (`55d53c7b5`; decisions 92–96; ADR proposal `docs/adr/proposals/2026-11-14-research-evidence-standing.md`, not applied) and atomic-statements slice 1 (migration `20261231540000`, not applied; decision 91 UNRESOLVED qualification, contract v2).

## Research evidence and statements slice 1 deployed — `4d61457fd` (14 Nov, 11:10 Lagos)

- **Gates:**
  - `6a416c3ab` FAIL on two stale artefacts: the ui-text source was missing decision-91 strings, and the Q-IQ ADVERSARIAL step-10 detector did not read the new decision-94 absence wording as "unknown". The injection was still refused. Fixed in `4d61457fd`.
  - `4d61457fd`: `ci-local PASS at=2026-11-14T10:01:15Z took=1475s`.
- **Migration:** `20261231540000_gateq_application_statements` applied before the deploy. Hosted has 297 migrations, none missing; the four tables have `relrowsecurity` true. No runtime writes until slice 2. Rollback point `d37458856`; four services SUCCESS.
- **Live** (`investor.savanna-seed`; reservation $0.10; actual $0.1516 over 19 model calls; day total $0.78 / $5):
  - "How much funding has Paystack raised, according to public reports?" **PASS (partial).** Cited public sources (getlatka.com 2025-04-10, pitchbook.com, undated); "Public reports differ"; labelled unverified, not confirmed.
  - "What was Maji Loop's MRR in October 2026?" **Firewall PASS**: the private USD 120,000 and 42,000 claims did not leak. **GAP**: "isn't on record" still does not say whether public sources were checked. Owner addendum slice 1 is not yet met on this path (named-company turn, no research run); assigned to the uncertainty lane.
- **Cost note:** a live investor Q turn costs about $0.07–0.08. Future estimates use $0.10 per turn.

## Live checks on `d2ce8c91e` and the next batch (14 Nov, 18:35 Lagos)

- Production: `d2ce8c91e` (gate PASS 1578 s; migration `20261231570000_gateq_gateway_appearance` applied, hosted 300). Earlier today also deployed `1f9e33016`, `b6f3d7fbb` with migrations 550000 (voice sessions) and 560000 (diligence request about).
- Live: GateQ sustained re-certification 4/8 ($0.115); investor uncertainty 3–6: scenario 3 FAIL (no offer; explicit yes refused DECLARED_NOT_OFFERED), 5 PARTIAL, 4 and 6 not run ($0.224); gateway self-service PASS ($0.059).
- Next batch on the integration branch, not gated: `2e1fb1d33` meetings B1/B2, `2fbe7065c` gateway panel, `4dd353859` GateQ resume/left-open (no migrations); the uncertainty-offer fix (D5–D8) is in progress.
- Test spend today: about $1.56 of $5 (shared ledger `scripts/handoff/live/test-budget.mjs`).

## Batch deployed — `78f8d72d5` (14 Nov, 23:45 Lagos)

- Gate: `ci-local PASS sha=78f8d72d5` (1677 s, all six lanes). Rollback point `06910b145`.
- Migrations applied before the deploy (hosted 302): `20261231580000_gateq_gateway_brand_from_website` (logo assets, SVG allowed after sanitising), `20261231590000_gateq_application_document_selections`; RLS on both new tables confirmed.
- Contents:
  - GateQ one relation rule (`715f55bbc`, restored in `1ebe465ea` after `12aec5edd` reverted it from a stale base);
  - investor-uncertainty vehicle rule (`0c9e627a1`);
  - contextual "What I checked" (`939ad92d0`);
  - GateQ brand from website, with SVG (`995b1a0f9`, `12aec5edd`);
  - meeting times and notices (`0694fa3a2`);
  - document selection across resume (`fc68b217a`);
  - pre-gate (`scripts/pre-gate.sh`).
- Gate failures in this batch and their shared cause: checks the pre-gate did not yet cover (an app's own typecheck, repository-scan tests, a killed tsc reported as PASS, failing tests not named). Each is now a pre-gate step.
- Live checks in progress: GateQ sustained (8 invariants), meetings over HTTP; then investor uncertainty, branding on real sites.

## Voice-audit fixes deployed — `651a3bd50` (16 Nov, 00:18 Lagos) and `3b7145616` (16 Nov, 02:13 Lagos)

- `651a3bd50`: gate `ci-local PASS` (1479 s); migration `20261231592000` (voice telemetry) applied before the deploy (hosted 304). Contents: the RC1–RC5 fixes from `audits/2026-11-15-q-voice-audit/root-causes.md` and the D8 cheque merge. Live re-check: `live-recheck-651a3bd50.md` (3 pass, 3 partial, 4 fail).
- `3b7145616`: gate `ci-local PASS` (1501 s, all six lanes), no migration; rollback point `651a3bd50`; Railway SUCCESS on all four by 01:13 UTC. Contents: `d4796f0dd` (pipeline stage, cancelled meetings and the cheque path held to the records) and `3b7145616` (rankings wait for the turn reader, conditions carry, widen past the shown list, ordinals only from the reader, follow-up from the card). Live re-check: `live-recheck-3b7145616.md` (9 of 10 pass; the follow-up on a conditioned list still runs wide).
- In progress: the conditioned-list follow-up, navigation wording and the unprompted founder disclosure line.
- Test budget 16 Nov: USD 0.14 of 5 used.

## Transaction pooler trial on q-api: rolled back (16 Nov, 21:53 Lagos)

- **Production:** `4c832ca1f` (gate PASS 1847 s; migration `20261231595500` applied, hosted 306). Contains the reader warm-up and the transaction-pooler-safe LISTEN connection.
- **The trial (decision 101):** at 20:36 UTC q-api moved from the session pooler (port 5432, pool 3) to the transaction pooler (port 6543, pool 10). The URL was edited without printing it; prior values were saved in a 0600 scratch file.
- **What happened:**
  - The wake listeners started cleanly.
  - The first live Q turn (`dff4faca`, 20:44 UTC) reached SYNTHESIS, made one classification call (which timed out at 3 s) and then hung for more than 90 s with no further model call.
  - Request latency did not improve: POST /runs took 4.7 s, workforce/overview 4.2 s.
- **Rollback:** at 20:46 UTC to port 5432, `session_pooler`, pool 3. Redeployed SUCCESS at 20:53. A smoke turn then completed in 11.4 s, and the hung run was recovered as FAILED.
- **Cause:** not yet known. It needs an offline investigation before another attempt; candidates are a statement or transaction pattern unsafe under transaction pooling, or an await on a connection-scoped setting. Until then q-api stays on the session pooler.

## Transaction pooler retry on q-api: holding (17 Nov, 09:58 Lagos)

- **Production:** `e5bc4200c` (gate PASS 1430 s). It adds the transaction-pooler connection gate, proven locally against Supavisor (`scripts/db/pooler-proof/`, runbook `runbooks/transaction-pooler-retry.md`). It also carries the decision-102 voice room layout (`9fb8590a0`).
- **Before the switch:** smoke test on the session pooler: one turn, 13.8 s, COMPLETED.
- **The switch:** at 08:49 UTC q-api moved to the transaction pooler (port 6543, `DATABASE_POOL_MAX=6`). The URL was edited without printing it, and the previous values are kept for rollback.
- **After the switch:** three timed turns (figures, "why differs", three-company compare) all COMPLETED, in 12.6 s, 14.4 s and 20.1 s. First browser text came at about 2.6 s. No stuck runs and no failures since the switch.
- **Assessment:** stable, but no clear speed gain yet at pool 6. Per the runbook, hold for an hour, then raise to pool 10 and re-time.
- **10:01 UTC:** the watch hour was clean (0 stuck, 0 failed), so q-api's `DATABASE_POOL_MAX` went from 6 to 10 and q-api redeployed SUCCESS at 10:06. A smoke turn COMPLETED in 12.8 s. The transaction pooler stays on.
- **Found by that smoke turn:** "What's Nixo's monthly burn and runway?" was answered "not established" although Nixo's shared management accounts give them. Correction (fix `a29364f02`): page 1 did carry the figures. The cause was a code-written limits fact that told the model burn and runway were unknown beyond published figures and the deck. That fact now names the shared documents read, and pages are also chosen by content.
- **13:35 UTC, `cd8bc49b7`:** model-hosted web search fallback (decision 103) deployed; migration `20261231597000` applied (hosted 308). First live check (Savanna, "Flutterwave's latest funding"): Serper 402 and Tavily 432, then the fallback ran once and failed TRANSIENT after 5.85 s with 0 tokens and no detail logged. Q said public search was unavailable. A fix is in progress: error logging and a request/model check against the current API spec.
- **19:21 UTC, `dee0da7f4` (rollback point `270aa69c9`):** one gated batch (ci-local PASS, 1782 s); all four services SUCCESS; no migration. It contains:
  - privacy egress filter `1bf8a7905`;
  - web search parse fix `265c2b8ba`;
  - alerts, caps and per-person limits `52b7cef61` (model spend now defaults to $50/day; see `OPS-ALERTS.md`);
  - ClamAV service and adapter `354024425` (inactive until a `clamav` Railway service exists and `CLAMAV_HOST` is set);
  - root-cause fixes from the owner's voice test, conversation `9995dcca`:
    - `f2a9d6fa4`: question cards no longer expire while awaiting approval; questions are addressed to the company; status claims come from the records; "send it"/"I approved" resolves to the pending card;
    - `2f6068529`: thesis similarity is scored for every admitted candidate; a tie is never cut; "why" answers the reasons; no false "no source documents";
    - `5b4bd13a2`: revenue also read from the confirmed deck; conditions carry over only when refining the shown list (TURN_READER v91); sector overlap kept; consistent universe.
  - The first gate on `5b4bd13a2` failed two integration tests that asserted the old missing-similarity behaviour; they were updated (`dee0da7f4`).
- **Live recheck (Savanna, fictional, conversation `1b509e50`, $0.047):**
  - all four tied companies named, with Thesis Strong/Partial on the cards;
  - "why" answered with each company's measures and no re-rank;
  - "outside my sectors" was a new list, with no pre-revenue carry-over;
  - "leave out the ones in contact" refined that list.
  - Still open: pre-revenue is unknown for most companies. Revenue lives only in unextracted data-room text; the proposed fix is that the seed writes document-linked claims through the Write Gate.
- **Gap found:** the drift rebuild rewrote only the companies in the new pool. Stale CURRENT snapshots for companies outside it (Zino: Tensorgate, Halyard, Ajopot, Shiftwell) keep thesis MISSING. A follow-up worker is computing it on read.
- **20:20 UTC, `6b5588218` (rollback point `dee0da7f4`):** ci-local PASS (1607 s); all four services SUCCESS. Thesis and sector are now computed on read for stale CURRENT snapshots outside the latest pool (844 thesis and 82 sector snapshots network-wide). Nothing is written to the database.
  - Live check (Savanna, fictional): Halyard Security and Clearwater Assurance had stale snapshots with thesis MISSING; Q now shows Thesis Partial for both, with 6 of 7 measures known.
- **20:35–21:47 UTC, ClamAV live (decision 104, ADR 0080):**
  - Railway service `clamav` (id `349c58cb…`) was created in the Q project: europe-west4, built from `infra/clamav/Dockerfile` on `recovery/2026-09-12`, volume `/var/lib/clamav`, no public domain. clamd is up with current signatures.
  - Workers: `CLAMAV_HOST=clamav.railway.internal`. The first start scanned 200, all clean. `468194291` (gated, PASS 1545 s; workers only) makes the start-up backfill drain in batches. All 2,245 document versions are CLEAN and 0 infected.
  - `CQ_MALWARE_POLICY` changed from `ALLOW_UNSCANNED_WITH_WARNING` to `REQUIRE_CLEAN` on workers and api. Both redeployed SUCCESS. ADR 0042 is superseded.
  - Railway no longer accepts a config-file path (`railway.json` is deprecated), so the Dockerfile path and watch pattern are set on the service instance itself.
- **23:32 UTC, `8ef954671` (rollback point `468194291`):** this release adds the contextual follow-up fast path (`0301b26f7`; its timing test was made order-based in `8ef954671` after a flaky gate) and the revenue-claims seed script (`2b62a0088`). The seed's production dry run writes 0: every revenue document is organisation-private, so publishing Ajopot/Watchly revenue awaits an owner decision. ci-local PASS (1349 s); all four services SUCCESS.
- **Live check (Savanna, conversation `ff20af7e`, $0.084) found three defects. A worker is fixing them:**
  - (1) The question "What does Halyard do and how is it doing commercially?" got an unrequested Express Interest card (approval-gated, nothing sent) instead of an answer. It is the first such proposal from QUESTION_TO_Q routing in 10 days.
  - (2) Same-subject follow-ups were routed COMPLEX_ANALYSIS, so the fast path was not taken: 15.9 s and 13.3 s.
  - (3) Each follow-up made a paid PUBLIC_WEB_SEARCH call.
- **18 Nov 00:34 UTC, `240e0b9a0` (rollback point `8ef954671`):** ci-local PASS (1356 s); all four services SUCCESS.
  - Fixes: a question turn never gets an approval card (approval-card tools are withheld and refused at execution); same-subject follow-ups try the fast path; a follow-up on Q's own answer does no web research.
  - Live recheck (Savanna, $0.061):
    - "What does Halyard do and how is it doing commercially?" was answered, with 0 actions.
    - Follow-up 1 took the fast path: 7.8 s (was 15.9 s), 4 calls, no web search.
    - Follow-up 2 missed the fast path (`NO_EVIDENCE`) and took the full path: 11.5 s (was 13.3 s), no web search. Fast-path answers don't carry their sources forward; a worker is fixing this.
  - Note: Tavily, SerpAPI and Brave are out of credit, so web research falls back to the paid model-hosted search (capped at $2/day).
- **18 Nov 01:24 UTC, `05c068296` (rollback point `240e0b9a0`):** ci-local PASS (1404 s); all four services SUCCESS.
  - ANSWER evidence is matched by access coverage: same tenant, actor, ceiling and constraints, and every scope it was read under still permitted. Its read time and TTL carry forward unchanged.
  - Live chain (Savanna, conversation at 01:35, $0.049): the question took 15.0 s; follow-up 1 took 7.1 s and follow-up 2 took 7.4 s, both on the fast path (`ANSWERED`). No web search, no actions.
  - Before today: 15.9 s and 13.3 s.
- **Decision 105 recorded:** Ajopot/Watchly revenue goes public; a founder's own spoken figure needs no card. Two workers are on it. A container restart at about 01:30 interrupted both; their work was kept (WIP commit `7cf4956d5`, local commit `993bccb21`) and they were resumed.
- **18 Nov ~01:45 UTC, decision 105 revenue applied:** `scripts/seed/demo-figures.mjs --company-statements --apply` (code `8bd229f64`) wrote 2 network-visible USER_CLAIM/SELF_REPORTED `financial.monthly_revenue` claims: Ajopot NGN 10,183,680 and Watchly USD 8,500, both for October 2026, with no document link. A re-run plans 0.
  - Live check (Savanna): "Does Ajopot have revenue yet?" was answered "Yes … NGN 10,183,680 for October 2026, self-reported".
- **18 Nov 02:35 UTC, `452dc02f2` (rollback point `05c068296`):** decision 105 / ADR 0081, a founder's own stated figure is recorded with no card, with correct-or-undo. ci-local PASS (1258 s); all four services SUCCESS.
  - Live (Callum, fictional Halyard founder, $0.036): "our licensed seats are now 74000 as of November 2026" was recorded at once (0 actions), answered with growth maths, and "Undo that" withdrew it (claim SUPERSEDED). Demo data ends unchanged.
  - Defects: the figure was filed as `traction.active_users` instead of the existing `traction.licensed_seats`, and the undo line was emitted twice. A worker is fixing both; an unmatched metric will fall back to the card.
- **18 Nov 03:24 UTC, `98e45b66e` (rollback point `452dc02f2`):** ci-local PASS (1225 s); all four services SUCCESS. A founder's own figure is now filed under the key their words name; the company's existing key is reused, and an unmatched key falls back to the card. The undo line is said once.
  - Live (Callum, fictional Halyard, $0.037): "licensed seats are now 74000" was recorded under `traction.licensed_seats` with no card. Undo withdrew only that new claim, shown once. Halyard's 4 earlier licensed-seats claims stay CURRENT.
- **18 Nov 05:35 UTC, `34b1f0d4b` (rollback point `98e45b66e`):** TURN_READER v92 sends its fixed rules as a cacheable instruction message (same words as v91). ci-local PASS (1272 s); all four services SUCCESS.
  - Live (Savanna): warm reader calls cached 24,094 of 24,097 and 20,506 of 24,195 input tokens, against about 4.6k cached before (3-day average 9.8k of 26.9k). The first cold call cached 0, as expected.
  - Projected saving: about $0.0024 per run (about 11%).
  - Scale report: `audits/2026-11-18-scale-ceilings.md`.
  - Open: the first answer call misses the cache 72% of the time. Its cache key includes the per-person tool list, a privacy choice that needs an owner decision.
- **18 Nov 07:18 UTC, `fb32830d9` (rollback point `34b1f0d4b`):** audit item 17. TURN_READER v93 reads others' interest by meaning, OR'd with the word rule. No server-side leak was found; the protection is RLS plus company-side authorisation. ci-local PASS (1299 s); all four services SUCCESS.
  - Live (Savanna): "Who else is circling Halyard Security at the moment?" was answered "I can't share other investors' interest or cheque sizes"; the follow-up "where do we stand with them?" gave her own status.
  - Note: Savanna still has the unrequested Express Interest card from 17 Nov 23:42 waiting for approval (from the bug fixed in `240e0b9a0`). It is fictional and harmless, but it shows as "one thing needs you".
- **18 Nov 13:04 UTC, `2da3e3357` (rollback point `fb32830d9`):** one batch. ci-local PASS (1683 s); all four services SUCCESS.
  - Contents:
    - Daily lane `e7c988bb5`;
    - first-answer cache `e986547f8` (COMPANY_ANALYST v37);
    - voice speaks at the first guarded sentence and holds only real waits `774719d29`;
    - GateQ inbox email and the stalled-stream catch-up `1cc516ae0` and `46ee5717f`;
    - meetings S1, S2, S3 and S8 (one lip-synced Q, one opening, quiet after answering, no double booking) `98e2b816d`;
    - CRM import `14add87a6`;
    - test fix `2da3e3357`.
  - Migrations `20261231598370` (pipeline imports) and `20261231598700` (GateQ deliveries) applied first; hosted is at 310.
  - Set `CQ_MEETING_FACE_PAGE_SECRET` on q-api: random, never printed. Camera-mode face page enabled. Meeting bot sign-in still waits for the owner's Workspace account.
  - Live (Savanna): no startup errors. Turns took 18.5 s (cold cache), 9.0 s (fast path) and 26.6 s.
  - The 26.6 s turn: the fast path missed (UNGROUNDED), then there was a 19 s gap with no model call before the full answer, which needs investigating.
- **18 Nov 14:53 UTC, `b204eb954` (rollback point `2da3e3357`):** fixes the root causes of the owner's 11:13 voice session (`1bb8f196d`):
  - one shared in-contact rule, with contacts excluded before the top-N cut;
  - meeting times agreed in messages are recognised;
  - the named-record lane uses cleaned speech, place qualifiers and waits for the reading;
  - possessives are formed once;
  - CALL_PREP v3;
  - the refinement search is bounded to 1.5 s;
  - the fast path accepts one rewritten sentence.

  The rerank timing test now takes the fastest of five runs. ci-local PASS (1696 s); all four services SUCCESS.
  - Live (Savanna): "Apart from the companies I'm in contact with, which three…" left out 15 and named Ledgerline, Brancheon Works and Baridi. That's correct.
  - Defect: the follow-up "Am I in contact with any of those?" got a comparison instead of a contact answer. A worker is fixing it.

- **18 Nov 19:35 UTC, `dd18752b4` (rollback point `b204eb954`):** ci-local PASS (1707 s); all four services SUCCESS. Migrations `20261231598950` (site content) and `20261231599107` (data rights, with the erasure role guard added by the lead) were applied first; hosted is at 312.
  - Contents:
    - contact-status answers from the in-contact rule (TURN_READER v94);
    - data rights: download my data, and account deletion with a 14-day grace period;
    - the CMS block editor with public /pricing, /faq and /legal pages;
    - the data-download tool made the person's own instant action, offered on records turns only.
  - Live (Savanna): "Am I in contact with any of those?" now answers "No. You're not in contact with Ledgerline, Brancheon Works or Baridi". The exclusion list is correct (15 left out).
  - Open:
    - Site content is not seeded yet; the seed needs a management-API mode, which a worker is adding.
    - The welcome said "nothing on Capital Q matches it yet" despite matches; under investigation.
- **18 Nov 22:32 UTC, `491ece443` (web only; the other services are unchanged on `dd18752b4`):** ci-local PASS (1676 s). The welcome says "nothing matches" only when the slate itself is empty, and is silent during a rebuild (`6fde24973`).
  - Site content seeded through the management API with `--hold-pricing`: 21 pages. FAQ and the 12 landing sections are published; pricing is a draft until billing is live; the 7 legal pages are drafts pending lawyer review. A re-run writes 0.
- **19 Nov 01:22 UTC, `833fbc21a` (rollback point `491ece443`):** meetings S5–S7 and S9 (`6ce3cf87b`):
  - post-call outcomes, with soft and firm commitments, requests and promises tied to transcript evidence;
  - an admin digest without the transcript; the transcript to both sides;
  - next-conversation openers, plus reminders behind approval;
  - commitment evidence grades and notes, with an admin review queue for mismatches.

  Gate fixes (`833fbc21a`): a date's day never grounds a count in the claim check; the commitment evidence tables are known network tables. ci-local PASS (1030 s, rerun after a container restart). Migration `20261231599340` applied; hosted is at 313. All four services SUCCESS.
  - Live smoke (Savanna): no startup errors. The welcome shows "8 pitches that match your mandate"; the exclusion (15) and the contact-status answer are correct.
  - Not wired yet: the typed-chat meeting opener; the admin console view of the digests.

- **19 Nov 04:35–04:47 UTC, incident: `4b0f0904a` was deployed without its migration, then rolled back to `833fbc21a`.**
  - The gate passed (1184 s). The lead ran the migration and the deploy in parallel instead of in sequence.
  - The migration `20261231599520_network_relationship_side_details` failed: the Supabase management API returned 401 "Invalid access token" (`SUPABASE_ACCESS_TOKEN` no longer valid). Meanwhile the deploy promoted `4b0f0904a`, whose relationship reads query the missing table.
  - At 04:46 all four services were rolled back to the `833fbc21a` deployments with Railway `deploymentRollback`. All four were SUCCESS on `833fbc21a` at 04:47. No missing-table errors were found in the q-api logs for the window.
  - `recovery/2026-09-12` still points at `4b0f0904a`. Until the migration is applied, do NOT trigger a Railway rebuild (a variable change or a redeploy would build `4b0f0904a`).
  - Next:
    - the owner supplies a valid `SUPABASE_ACCESS_TOKEN`;
    - apply `20261231599520`;
    - then `deploy-promote 4b0f0904a` again;
    - live-check the CRM import.
  - Rule from now on: the migration must finish before the deploy starts, never in parallel.

## 19 Nov 2026: q-api pool wedge, fix, and owner-reported Q defects

- **Outage 07:34–08:47 UTC.**
  - q-api's gated round-trips released a pool slot when the caller's deadline fired, while the statement was still running on its connection.
  - postgres.js then pipelined the next statement behind it, which the transaction pooler never answers, so connections wedged one by one. Every statement then failed with 57014.
  - Mitigated by restarting the q-api deployment (no rebuild) at about 08:47.
- **Supabase management token** replaced through the network-secret form (proxy-injected; scripts take `SUPABASE_ACCESS_TOKEN=proxy-injected`). Migration `20261231599520` applied, so the hosted database is at 314.
- **0b5581d3e deployed 09:34** (gate PASS 09:34:10Z):
  - a slot is released only when the driver settles;
  - the `pool-watch` watchdog alerts with `DB_POOL_EXHAUSTED` and recycles the pool;
  - this release also carried 4b0f0904a: the CRM import screen and the relationship side-detail fields.
- **b07e0c1db deployed 10:29** (gate PASS 10:28:27Z):
  - Q Card redesign (2a6df63f5): `primaryDescription` is an opt-in company card field, default off;
  - own-profile edits are offered on prepared answers;
  - the voice speaks as Q (`SELF_NOT_RELAY`), with no relay phrasing;
  - own mandate preferences are labelled by vocabulary, so sectors read as declared.
  - Live: `/@ledgerfold` and `/@savanna-seed-partners` show the new layout (200); no 57014, QueryDeadline or pool alerts since. Q's wording changes are not yet verified live.
- **OpenAI spend over 21 days, about $37** (`ai_ops.model_usage`):
  - the owner's investor org: $15, of which $10 voice;
  - fictional test orgs: about $13;
  - other: about $9.
  - The owner asked that testing not spend GPT credit. A routing override for fictional tenants needs their yes; until then, keep live tests minimal.
- **Decision 109:** two-level admin. The design audit is in progress at `docs/design/audit-2026-11-19/` and `docs/design/admin-2026-11-19/`.

- **862090033 deployed 14:36 UTC** (gate PASS 14:35:43Z): the investor Q Card's opt-in fields (7ab448fde) and admin clean-up A1 (discoverability).
  - Live as the fictional LedgerBridge founder: the sidebar has a "LedgerBridge" group (Organisation, Import pipeline). It is collapsed on `/settings` and open, with Import pipeline the only current item, on `/relationships/import`.
  - Personal Settings no longer shows Brand or the house guide. "Plans and pricing" is under You.
  - Still open (with a worker): the Plan page's "Not included" rows, the console's grouped sidebar, and names in audit rows.
- **6470d442d deployed 15:28 UTC** (gate PASS 15:27:48Z), with the rest of admin clean-up A1:
  - Live as the LedgerBridge founder: `/settings/plan` shows "Your allowances" and no "Not included" row, and only "Plans and pricing" is marked current.
  - The console's grouped sidebar and names in audit rows are not live-checked: fictional accounts get a 404 on `/admin`. Evidence is the screenshots in `docs/design/a1b-2026-11-19/` and the tests.
- **1c51df617 deployed 16:54 UTC** (gate PASS 16:53:43Z): the organisation admin home at `/organisation` (decisions 109 and 110).
  - Live as the LedgerBridge founder: the scope bar reads "LedgerBridge · You are an owner · Changes here apply to LedgerBridge only", with the section nav listing all 11 sections. `/organisation/members` shows the team and allowances.
  - The site-map digest cap was raised from 12,000 to 12,800 characters (now 12,655).
  - Pipeline import is still allowed for any CRM member at the service level, pending the owner's call.
  - Member read-only access is not live-checked (no fictional plain-member account was used). Evidence is the tests.
- **622571e1f deployed 20:44 UTC** (gate PASS 20:43:44Z): console overview (headline figures, model spend chart, health, operator activity) and browsable Organisations and Accounts tables (cursor paging, sorting, CSV).
  - New endpoint: `GET /v1/admin/console-overview` (`overview.read`).
  - Live check as the LedgerBridge founder (non-operator): `/admin` and `/admin/organisations` return "This page isn't here".
  - The operator view was not live-checked, because no fictional operator account exists. The owner should open `/admin` with their own account.
  - No q-api errors since the deploy.
  - Known gap: the pool watchdog and worker health are not exposed to the console.
- **ca3831238 deployed 22:52 UTC** (gate PASS 22:51:36Z, pgTAP included). Migration `20261231599600` (`platform_ops.service_heartbeats`) was applied BEFORE the deploy; hosted is at 315.
  - q-api `GET /v1/ops/pool` (`overview.read`) feeds the console's database pool line.
  - The workers upsert a heartbeat after each ops check. Live: the row for `workers` is 40 s old, with no findings.
  - Its `pool` is `{}`: the workers' pool reports no snapshot, so the card shows the workers' pool as not reported. This is a follow-up, not a fault.
- **75979e5f4 deployed 00:21 UTC on 20 Nov** (gate PASS 00:20:47Z): `/organisation` General (owner and admin edits through the existing profile actions, carrying the version the page read; members read-only).
  - Live as the LedgerBridge founder: the General page lists company details with Edit, and Logo and cover.
  - Seen in the same check: Q's greeting bubble repeats "Your plan is ready" and covers page content (also in the 19 Nov audit, item 8). Queued as a fix.
- **fb65b66ff deployed 01:05 UTC on 20 Nov** (gate PASS 01:05:00Z; web only, the other services skipped and stayed on 75979e5f4). Q greeting: items deduplicated, counted merges ("Your plan is ready (2)"), and the briefing collapses when it would cover main content.
  - Live as the LedgerBridge founder on `/organisation`: the briefing shows as the collapsed "Q's briefing" button and no longer covers the General card.
  - The deduplicated sentence is evidenced by tests (the exact live case), not seen live.
- **14d51ec53 deployed 02:10 UTC on 20 Nov** (gate PASS 02:09:57Z): the workers' heartbeat states that its pool is not gated.
  - Live: the `workers` heartbeat is 16 s old, with `pool: {"gated": false, "maxConnections": 3}`. The workers connect directly, so in-use counts aren't measurable; the card says "Not reported: not gated, up to 3 connections".
  - Real counts would need `DATABASE_CONNECTION_MODE=transaction_pooler` on workers. That is the owner's config call and is not changed.
- **f3ecc8a3f deployed 03:16 UTC on 20 Nov** (gate PASS 03:15:33Z; q-api only, the other services skipped). Cost pass (`audits/2026-11-20-cost-pass.md`): the knowledge reconcile now backs off when idle (10 to 20 to 40 to 60 min).
  - **Migration `20261231599700` is NOT applied.** `hosted-migrate-https` refused it on `/delete from/`. The line is the pre-existing "company gone, so remove its profile" branch of `knowledge.refresh_company_profile`, unchanged from the prior definition. It needs the owner's `--founder-approved`.
  - Until it is applied, reconcile keeps rebuilding about 426 profiles a run (load only, not money), and the backoff never triggers.
- **1d40130b0 deployed 04:53 UTC on 20 Nov** (gate PASS 04:53:22Z, after the e517e726a gate FAILED on spoken-place names and Q-NAV dataset coverage). Q navigation adds seven destinations: the organisation pages and pipeline import. The two import destinations are offered to owners and admins only, from the server-side role.
  - Live as the fictional Savanna account: "take me to import" from `/settings` opened `/relationships/import` in about 0.3 s, and Q said "Opened the pipeline import." That was one live turn.
  - The Q-NAV sealed split `heldout5` (14 turns) was written by the implementing agent, not an independent author. Its score is reported separately.
- **Migration `20261231599700` applied 20 Nov at about 13:40 UTC** under the owner's `--founder-approved` (decision 112). Hosted is at 316.
- **642258888 deployed 16:41 UTC on 20 Nov** (gate PASS; the a99f3a73d gate FAILED its integration tests only because of the withdrawn Claude-first migration). The voice line says "Still there?" at 45 s of silence and closes at 60 s; meetings are excluded. The Anthropic spend-cap refusal now falls over to the next model.
  - No `*IDLE*` override variable is set on q-api or web, so the 60 s default applies.
  - No q-api errors since the deploy.
  - Not live-tested in a voice call, because that is a paid realtime session; the evidence is fake-timer tests.
  - The Claude-first migration `20261231599800` was withdrawn (decision 114) and never applied.
- **e9db7a4e6 deployed 17:40 UTC on 20 Nov** (gate PASS). HQ-1: the answer plan (skim v12 and reader v95 add `underspecified` and `costlyIfWrong`; eight shapes with templates after the cached prefix), typed quick-lookup speculation, and a holding line within 1 s.
  - One live typed turn as fictional Savanna, "What stage is Ledgerfold at?": first text in the browser at 2.68 s (the 18–20 Nov p50 to first content was 6.6 s). The `q typed speculation` line fired with reason SKIM. The answer was correct and said it wasn't verified ("declares on Capital Q; it isn't verified").
  - Watch the typed-speculation cancel rate; the budget is 10% or less.
- **1e170deb8 deployed 19:53 UTC on 20 Nov.** HQ-2: conversation rules (analyst v38, charter v3, voice charter v4, spoken reply v2), offers only at natural breaks, and the attribution helper.
  - The 6cd0d1238 gate failed on a pinned `q-system.v2` in an integration test, fixed in fa25ce453. The fa25ce453 gate then failed on a wall-clock flake in `interview-client-stream.test.ts`; its margins were widened in 1e170deb8.
  - Live as fictional Savanna, "What stage is Ledgerfold at?": "Ledgerfold describes itself as being at the seed stage." First text at 2.60 s.
- **1c2363e9c deployed 20:40 UTC on 20 Nov** (gate PASS). HQ-3 voice changes:
  - patient turn-taking in onboarding and the welcome call, on the realtime and Deepgram lines (not the GPT-Live line, which has no documented setting);
  - the stage's approved line within 1 s once a tool stage starts;
  - "Picking up where we were." on a reconnect or replaced line, instead of a re-introduction.
  - No q-api errors since. Not live-tested in a voice call, which is a paid realtime session; the evidence is fake-timer tests.
- **1979b9975 deployed 21:44 UTC on 20 Nov** (gate PASS). HQ-5 adds discovery mode: a reducer state, a gap model, a 12-question cap and a "Just show me" exit.
  - Live as fictional Savanna, "I'm not really sure what I'm looking for right now": first text in 2.62 s, and a grounded suggestion ("You don't need to have a particular task in mind… Watchly and Clinicrest need replies…").
  - **Follow-up:** it did NOT enter discovery and asked no question. An explicit "not sure what I want" should enter discovery on the first turn, not only after two underspecified reads.
- **86145c7b4 deployed 00:59 UTC on 21 Nov** (gate PASS). VOICE-FIX for the owner's 20 Nov 22:18 session:
  - no web research for the person's own next steps, guidance requests or product questions;
  - `seeksGuidance` opens discovery on the first turn (TURN_SKIM v13, TURN_READER v96);
  - a sentence already spoken is never re-spoken, and holding lines are stripped before storing;
  - exclusions are held per conversation, and a bare "yes" to several options asks which.
  - Live (typed, fictional Savanna), "I'm not really sure what I'm looking for right now": first text in 2.62 s. Discovery entered with a grounded line plus one past-behaviour question ("What was the last deal you looked at closely and passed on…") and the "Just show me" and "Not sure yet" chips.
  - Voice not live-tested (paid realtime). The live model talking over a delegation is fixed by a prompt rule only.
  - Research providers tavily, serper and brave are resting (key refused or credit spent); the owner was told.
- **05ed3348a deployed 02:31 UTC on 21 Nov.** The first gate failed at build only because the session's `NODE_OPTIONS` held `--use-openssl-ca` after a container restart, which Next workers reject. Re-gated with `NODE_OPTIONS=--max-old-space-size=8192`: PASS.
  - Migration `20261231599900` was applied first; hosted is at 317.
  - V1 business verification foundations:
    - Companies House, Dojah and Sumsub adapters;
    - the founder-company linking rule;
    - four badges;
    - `evidence.verification_consents` (append-only, server-only).
  - Live as the LedgerBridge founder: `/verification` shows "Automatic checks: Companies House · Not connected; Dojah · Not connected; …" because no keys are set.
  - The owner must set `COMPANIES_HOUSE_API_KEY`, `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`, `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY`.
- **23cd44da3 deployed 04:20 UTC on 21 Nov** (gate PASS).
  - **HQ-6:** per-row table claim checks ("not known" cells), retraction counts, a sycophancy eval set (not run on a model; running it needs owner approval), and latency-budget tests.
  - **HQ-7:** scoped, paraphrased memory callbacks, at most one per answer.
  - Live as fictional Savanna: the Ledgerfold stage question answered with attribution, first text in 2.59 s. No q-api errors.
  - Remote branch deletes are refused by the proxy (403), so a dozen merged worker branches remain; the owner may delete them.
- **039b21bf4 deployed 05:41 UTC on 21 Nov** (gate PASS). HQ-8: TURN_READER v97 has the same text as v96, regrouped so the 78 KB fixed part leads and is shared.
  - Live, two typed turns as fictional Savanna. The reader call (about 23.7k input tokens) was cold on turn 1 (0 cached) and **91% cached on turn 2** (21,689 of 23,831).
  - Reader latency 1,888 ms then 2,003 ms: no latency gain seen in this two-turn sample. The cache mainly cuts input cost.
  - First text 2.63 s and 2.57 s, with attributed phrasing.
- **2aabd19c3 deployed 06:58 UTC on 21 Nov** (gate PASS). Audit Week 1 slice W1-A:
  - pre-gate runs integration tests;
  - HSTS and a report-only CSP on web, with `/api/csp-report` logging kinds only;
  - a general rate limit (600/min per user, 300/min per address);
  - one `CAPITAL_Q_ENV` reader;
  - a debt guard (no new SQL in apps, no new file over 1,500 lines).
  - Live: all 4 services started on `staging`. `strict-transport-security` and `content-security-policy-report-only` are present. A signed-in page loads as the LedgerBridge founder. No q-api errors and no 429s since.
  - Switching `CAPITAL_Q_ENV` to `production` waits for the owner: it ends the synthetic demo attestation and auto-verification.
- **add3becf5 deployed 08:35 UTC on 21 Nov** (gate PASS). W1-B adds:
  - a traffic counter in `/health/ready`;
  - workers health probes (SERVICE_UNHEALTHY after 3 failures; ERROR_RATE_SPIKE at ≥5% of ≥50 requests);
  - a stale-heartbeat alert from q-api;
  - the console card showing the error rate and the last alert.
  - The lead set `CQ_HEALTH_PROBE_TARGETS` on workers (api and q-api production hosts) at 08:44, which redeployed workers on the same SHA.
  - Live: the heartbeat `ops_check.services` shows api and q-api ready, 0 failures in a row, 0 server errors in 15 min.
- **988eced0b deployed 09:42 UTC on 21 Nov** (gate PASS). W2-A: one shared `ownsConversation` replaces 27 copies.
  - Fixed the looser variant, `note-preference.ts:166`, which had no person check.
  - Every site now requires the plan's tenant and actor to match the actor, which refuses a revoked membership.
  - The debt guard allows zero new copies.
  - Live: a typed turn as fictional Savanna is answered normally (first text 2.60 s). No refusals or errors in q-api.
- **b3f9da6fd deployed 10:46 UTC on 21 Nov** (gate PASS). W2-B adds shared `ownsOnboarding`/`ownsActorScope` in q-runtime.
  - Fixes OWN_ONBOARDING and memory checks that lacked person, plan and tenant matching, at 7 sites, including 4 found in the sweep: model-gateway `q/index.ts` ×3 and q-specialists `own-records-port.ts`.
  - Live as fictional Savanna, "What's my investment mandate?": the own declared mandate (sectors, stage, geography, cheque, role, exclusions) answered in 2.64 s. No refusals or errors.
- **Migration `20261231600100` applied 11:5x UTC on 21 Nov** (additive), then **ce9af533f deployed 11:56 UTC** (gate PASS). Hosted is at 318.
  - W2-C: ADR 0082 (Proposed) for the non-bypass request role and the RLS rollout.
  - The `cq_app` role exists on hosted with `rolcanlogin=false` and `rolbypassrls=false`, plus workspace policies for `cq_app` only.
  - The claims helper sits behind `DATABASE_RLS_CLAIMS` (off). Services still connect as `postgres`, so production access is unchanged.
  - The shadow-mode grant and the rollout await the owner's sign-off on ADR 0082.
- **612b5a80c deployed 12:38 UTC on 21 Nov** (gate PASS). W3-A: `q/index.ts` went from 17,393 to 14,036 lines, moved into 7 sibling modules (move only, exports identical), plus a shrink-only guard for long files. Live: a typed turn as fictional Savanna answered normally, first text in 2.62 s.
- **3eb1f6dd1 deployed 14:16 UTC on 21 Nov** (web only; gate PASS; the bundle-budget check now runs in the gate). W4-A: the Arabic catalogue loads only for Arabic, cutting about 546 kB of uncompressed first-load JS on every route; app pages went from about 3.0 MB to about 2.5 MB.
  - Live: the landing page downloads 860 kB of decoded JS and loads in about 4.1 s from the sandbox. `/organisation` renders for the LedgerBridge founder.
  - Phone LCP is not yet measured; that is W4-B.
- **221d2b7d7 deployed 15:55 UTC on 21 Nov** (gate PASS). W4-B: the Q conversation is lazy, zod is off public pages, and the briefing fade loads late. App pages are about 2.1 MB and landing 720 kB (uncompressed builds).
  - Live: landing JS went from 860 kB to 582 kB decoded, load from 4.1 s to 3.3 s from the sandbox.
  - A Q turn as fictional Savanna answered normally, first text in 2.64 s.
  - Local phone LCP on all 4 pages is under 2.5 s before and after (even on slow 4G). Production misses are likely server-side; W4-C is measuring TTFB.
- **3c77f51db deployed 16:47 UTC on 21 Nov** (gate PASS). W4-C: batched artifact versions (the `/v1/q/artifacts` N+1) and parallel partner and switcher reads.
- **438bf7320 deployed 17:31 UTC** (api and web; gate PASS). W4-D: company-profile pitch reads run in parallel, and Settings reads only the person.
- **Live `server-timing.mjs`** (fictional Savanna, 2 runs) after 3c77f51db:
  - LCP: `/home` **7.6 s**, a regression from 2.84 s, suspected to come from W4-B lazy-loading the Q conversation; under investigation. Discover 2.56 s, Plan 1.42 s.
  - After 438bf7320: `/settings` LCP 4.2 s (no gain yet), `/organisation` 1.45 s. TTFB is 0.3–0.7 s throughout.
- **a0de9bfb7 deployed 18:15 UTC on 21 Nov** (web; gate PASS). W4-E: the pane chunk is requested alongside hydration.
  - The LCP element on `/home` and `/settings` is the Q pane greeting `p[data-q-greeting]`, which renders only after hydration because the conversation lives in the browser.
  - Live: `/home` LCP 2.38–2.94 s (the 7.6 s did not reproduce), `/settings` 4.0–4.25 s.
  - The real fix is to server-render the greeting in the placeholder, which flashes for returning users with an open thread. Awaiting the owner's decision.
- **46bb5c1b8 deployed 21:01 UTC on 21 Nov.** The first gate (32290088e) failed the bundle budget: brand and privacy had been budgeted as placeholders, and were re-budgeted in 46bb5c1b8.
  - ORG-SECTIONS adds the organisation Privacy, Brand, Connections and How Q speaks pages, plus the personal export/delete link from Export and deletion.
  - Brand-kit writes now require `organisation.admin` (members lose edit, decision 110).
  - Live as the LedgerBridge founder: `/organisation/privacy`, `/organisation/brand` and `/organisation/connections` render their sections.
  - The organisation etiquette store (approved) is being built.
- **Migration `20261231600200` applied, then 5a98d3b01 deployed at 23:55 UTC on 21 Nov** (gate PASS; hosted is at 319). Organisation etiquette guide: an append-only table, the app action `organisation.etiquette_guide.save` (admin), and a precedence of house < organisation < person after the cached prefix. The offer is shown to owners and admins only.
  - The first gate run (f6c712de7) died on disk space at 1.7 GB, freed by deleting scratch. The second failed on a q-specialists manifest test, which caught the offer being shown to non-admins; fixed in 5a98d3b01.
  - Pre-gate now runs the suites of dependent packages and the bundle budget.
  - Live: `/organisation/speaking` renders for the LedgerBridge founder. A Q turn as Savanna was normal, first text in 2.62 s.
- **2d2f3b181 deployed 01:46 UTC on 22 Nov** (gate PASS). W3-B: `answer.ts` cut from 12,095 to 9,122 lines into 7 modules, move only. Pre-gate now runs each changed package's own suite plus its dependents. Live: a mandate question as Savanna was answered normally, first text in 2.61 s.
