# Active tasks — authoritative cross-model board

## Live board — 29 October 2026, 08:05 UTC (Claude coordinator, session_01Wncmn2hVzNK1rHd5FweHwt)

Production `29759dfe0`. Lanes are Opus subagents in their own worktrees; the coordinator reviews, merges into `speed/q-oct20`, runs CI on `recovery/2026-09-12-8y2j4w`, deploys and live-verifies.

| Work                                                                                                                                                                                                                                                                                                          | Branch                    | State                   | Next                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| Planning live re-run (6 checks)                                                                                                                                                                                                                                                                               | —                         | running on production   | Fix what fails; target two reviews ≥99 (DECISIONS 45)                                         |
| Re-test 4 leftovers: Mizan "Good fit" despite must-match geography (eligibility), Home resume card late, resume opens with read-back, read-back format at 390, Discover prev/next under video, team size re-asked, Telehealth vs Healthcare taxonomy, Excel compare blanks, waiting-card reminder, React #419 | `fix/retest4`             | in progress             | Merge, CI, deploy, live check                                                                 |
| Investigation-grade deep research (DECISIONS 44)                                                                                                                                                                                                                                                              | `feat/deep-research-2`    | in progress             | Offline verification, then at most 2–3 live investigations (DECISIONS 43)                     |
| Search variables on Railway                                                                                                                                                                                                                                                                                   | owner                     | open                    | Workers `SERP_API_KEY` has no credit; `RESERP_API` invalid and unread; `SERPER_API_KEY` unset |
| Reclassify ~1,250 old HIGHLY_CONFIDENTIAL stated figures                                                                                                                                                                                                                                                      | owner decision            | open                    | DECISIONS 46                                                                                  |
| Mobile chat-first layout                                                                                                                                                                                                                                                                                      | `draft/mobile-chat-first` | awaiting owner approval | —                                                                                             |
| Voice onboarding on a real device                                                                                                                                                                                                                                                                             | —                         | open                    | After the onboarding fixes are live                                                           |
| Rotate tokens pasted in chat (Railway, Supabase)                                                                                                                                                                                                                                                              | owner                     | open                    | —                                                                                             |

## Q Story + speed lanes — 21 October 2026, 21:05 UTC (Claude coordinator)

Coordinator session: session_01SxtUYQjYXwv8hH5D5RGfsK. Lanes are cloud sessions; each has its own branch and opens PRs into `speed/q-oct20`.

| Lane                | Session                          | Branch                        | Now                                                                                                                                                                                                |
| ------------------- | -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 story engine     | session_016MSJisJMAnRkjdAef3eYoL | qstory/engine (draft PR #299) | Lily master delivered (`docs/ai-handoff/evidence/q-story/master/`, 0 real defects); live ending, "Hey Q, pitch yourself" and story-voice answers in code. Next: final gates, PR body, owner review |
| S2 storyboard video | session_01DZ4GE33wHfkXUHDeuUjdXt | qstory/storyboard             | Re-capture in gold over real pages                                                                                                                                                                 |
| S3 investor Q&A     | session_01JfbXUViBZ3etd1Jhpcgjvi | qstory/qa                     | Retrieval fixes (≥30/32 probes)                                                                                                                                                                    |
| S4 presence figures | session_01Y6psHdTWPBjZmossscKbpP | qstory/presence-figures       | Re-capture evidence in gold                                                                                                                                                                        |
| S5 voice render     | session_01BHC5RMofbNP6pwu5xDohKH | qstory/render                 | ElevenLabs render with timestamps, ≤$3                                                                                                                                                             |
| S6 Q Card           | session_01DX8MTCQesT7f1gyAN5MKnT | qstory/qcard                  | Richer, permission-true, gold redesign                                                                                                                                                             |
| Lane 4 latency      | session_01YWifU5JkN4FbUyx6ZPQFKC | speed/turn-latency-r3         | Provider cool-down for 402/401/403/quota                                                                                                                                                           |
| Lane 7 navigation   | session_015LBWXZvgdqFsZ3GXd2qCir | speed/instant-nav-r1          | Done (#286, #292)                                                                                                                                                                                  |

**Owner-facing storyboard (mock-up):** https://claude.ai/artifact/Nhfw5fcoVqQsAH4NdeNCZM

**Next:** merge the S1–S6 PRs after review (look at frames and video), CI green on #267, the owner's live re-tests, then ask before build/int-rc or deploying.

## Discover A + Q home voice room — 20 October 2026, 06:45 UTC (Claude)

Founder-directed redesign released by pushing `claude/friendly-feynman-q9haun` to `build/int-rc` and `recovery/2026-09-12` (41e31d18d, fast-forward from 692e7cfb1). Contents: Q home voice room (captions, public web source cards, room presence), Discover A desktop stage + dossier (Q's read with coverage bars, Ask Q over the dossier, interest sending/sent + toast, save/pass toasts with Undo and optional pass reason, no-pitch still, end of slate, 1-of-N), Discover A phone (no bottom buttons, swipe right = interest confirm, swipe left = pass, captions toggle), Escape now closes sheets. Dev harness `/dev/discover` (404 in production). No migrations, no contract breaks (pass `reason` optional, UNPASS uses existing path).

CI39379450382 on 41e31d18d: build, types, lint, pgTAP green; test red only on route-capability-parity (new `/dev/discover` unclassified). Fixed forward by classifying it exempt and regenerating `docs/recovery/capability-parity.md`; parity test 11/11 locally. Railway status could NOT be read: the environment `RAILWAY_TOKEN` returns Not Authorized (rotation outstanding). Live web returns 200; deployed revision not yet confirmed per service.

Next: confirm CI on the fix commit and Railway revisions; founder to pick Profile / Data Room / CRM options (prototypes in the session, not in the repo).

## Unicorn completion — 18 October 2026, 13:18 UTC

PR233 was normally integrated and released through protected PR236/72679cbec89d9a2d4ed9b139913587ea4b80455f. The current shared production release is PR243/a026a39a727faab0cf52866965c8900be40b53fb; all four Railway services are SUCCESS at that exact SHA. Root preserved and merged the newer integration e05528768; no Q Pitch changes.

Current focused PR237 (`codex/unicorn-product-completion-oct18`) contains useful unscored/Discover recovery, existing founder evidence links, three priority gaps, and a conservative typed P9.A staffing adapter (inputs.v4). All three dated positive functions are required; preserve individual source lineage; undated, partial, forecast and conflicting sets stay unknown. Weights, grading scale, 60% gate and mandatory pillars unchanged. Actual ten-company API/deck audit confirms four matching canonical sections. See `audits/UNICORN-COVERAGE-2026-10-18.md` for per-pillar sample and exact evidence needs; it is not a newly proven global top-ten ranking.

Fresh live Q exposed an additional root cause: Q emitted the correct EXPAND intent but answered that the assessment was unavailable because the screen prefetch loaded only get_company. The new bounded repair hydrates the visible single-company panel through existing authorized fit_profile before synthesis, including the actual stored summary and all twelve pillars. No new model round, engine or authorization path. This is locally tested, NOT yet deployed or client-DONE-certified. Do not mark Q acceptance complete.

Local validation: 53 package builds; 72 scoring/storage tests, 20 manifest tests, 35 UI tests; isolated actual PostgreSQL numerical test PASS under inputs.v4 (67→65), with explicit thin-parent/auth-port/static-CSS limitations. Root and app types passed before the final manifest patch; final checks/protected PR237 CI and live release acceptance remain required. Numerical receipts now persist under `/workspace/.cq-private/`; old /tmp sessions were lost after runtime replacement. Credentials are never committed.

**External audit blocker:** the previously authorized Supabase Management token now returns401 Invalid access token. A secure binding update was requested; Railway and existing-session auth work. Earlier direct v3 replay:461 assessed,0 scored,342 partial,401 observations,max44.5%; do not call those refreshed global counts. Fresh selected36-company feed:0 scored,28 partial,max29%; separate ten-company sample includes Shiftwell44.5%. Fresh global461 census/v4 replay remains blocked. No methodology change is applied or awaiting approval.

Existing investor, free-negative and provided Kathryn/Spheros founder API reads pass; the existing founder application remains5bc3daac-046f-4401-9418-38b03ed68e80. Temporary fictional Kestrel feature override expired at08:13UTC and currently correctly returns404; no fresh premium no-mandate acceptance is claimed and original43 customer grants are untouched. The earlier selected-context change was restored through its existing memberships; do not grant access to real customers to hide this proof gap.

Next: exact-head protected237 gates, protected promotion, all affected Railway revisions, fresh Q EXPAND/DONE and grounded answer, real desktop/mobile CTA/browser acceptance. Finish global census/replay after secure Management access is restored; never fabricate production numbers or lower gates.

## Unicorn completion continuation — 18 October 2026, 06:46 UTC

PR233 exact source df7874fdcd7fa301d04942da9b89c00e0a9beb5d passed protected CI39102654240 and was merged normally. Integration fba01f927f5c32d0a956cd96b234f099e8d876fb passed CI39104139040. Production release PR236 is OPEN: candidate39104140057 has build/types/lint/pgTAP green, tests pending. Production is still the documented234 baseline; no new deployment or inputs.v3 count is claimed yet.

Follow-up PR237 (`codex/unicorn-product-completion-oct18`) adds meaningful Discover empty score-filter recovery, editable Q missing-evidence drafts, existing founder documents/profile links and progressive disclosure of three priority gaps. No rubric/threshold/permissions/migration changes. 53 package builds, web types and34 focused UI tests passed; updated component11tests passed. Synthetic numerical proof is integrated but its first run stopped before tests on a react-dom dependency boundary; repair and root gates are pending. Source receipt proof now requires exact EXPAND + DONE. Do not call the synthetic proof passed or production numerical scores available.

Current source audit is read-only and in progress; report target `audits/UNICORN-COVERAGE-2026-10-18.md`. Earlier v1.1 adapter on preserved branches is obsolete and must not be applied blindly. Preserve older local branch `codex/unicorn-pre-takeover-preserved-oct18@6d743f209`.

Live actor fixtures privately reconstructed from existing sessions and explicitly provided Kathryn identity. Temporary feature-only access for existing fictional Kestrel no-mandate organisation3cb03c31-761b-49c1-814f-ede0994e0e34 expires2026-10-18T08:13:52.403Z; revoke only this own override after proof (`/tmp/cq-unicorn-nomandate-entitlement.mjs --revoke`). No account/email/subscription or paid-usage change, original43 grants untouched. Private fixtures `/tmp/cq-unicorn-oct18-live-fixtures.json`; no private bodies in Git. Existing safe helper files and sessions are ephemeral, not portable secrets.

Next: finish236candidate gates/release, verify Railway affected services and paced461v3 reassessment; execute exact Q EXPAND/DONE and real desktop/mobile acceptance; finish factual ten-company audit, genuine isolated numerical proof and237protected release. Never manufacture real scores or silently change methodology. No Home Q/web research/Q Pitch scope.

## Latest Unicorn checkpoint — 18 October 2026, 07:04 WAT

Unicorn is deployed from PR227/cfd51ef60191e560a4726fa08695712fa62972f9, with both reviewed migrations applied (248 hosted) and all 43 explicit existing-organisation feature ACCESS grants applied. No paid subscriptions or usage entitlements changed. Completed worker sweep: 461 companies, 0 scored, 461 insufficient, 342 with partial evidence, maximum coverage 33.5% under inputs.v2. This does not certify a positive numeric score.

Latest production release PR234/d5600677d018a5b82cffd5f909121d12c474826a contains canonical API repair231; all protected candidate checks39101756788 PASS. Actual active Railway revisions at06:00UTC: API d5600677 SUCCESS; web/q-api/workers4ef8daeccbb6f6874cd52f8f2743b6fe7d457ac4 SUCCESS (their d560 entries SKIPPED). Do not call those three services d560. Their Unicorn runtime is unchanged. Root reconciled apps/api/main.ts exactly to canonical231; withdrawn230/232 alternatives must not be reapplied.

Actual authenticated browser acceptance completed ten non-Q role/device checks: premium investor desktop/mobile, existing founder GateQ desktop/mobile, no-mandate investor desktop/mobile, free-account hidden-score denial, unscored company, and Discover API/native controls. Discover baseline39, premium filtered/sorted0 because no company legitimately meets scoring requirements. Evidence private `/tmp/cq-unicorn-live-eBbRO5/`; manual readable viewport inspection remains pending. Source withdrawal PASS: six deck references disappeared immediately, NOT_ASSESSED while private, exact original visibility restored. Entitlement revocation PASS: score404/filter403, restored200, no subscriptions changed. Private receipts under `/workspace/cq-secrets/`; do not commit them.

**Real remaining product defect:** Q returns a substantive persisted-assessment explanation but does not open the requested assessment (client receipts empty). Draft PR233 owns bounded guidance to invoke existing operate_screen DISCLOSURE EXPAND before answering and require DONE; not live verified. Its old head7302328d CI39101577665 was still finishing at checkpoint. Source branch `codex/unicorn-qfiles-oct17` now includes dated-metric normalization repair3b9604506 and canonical integration merge7f244cfbd; final source checks and updated233 head pending.

The live profile exposed additional preventable mapping misses. Inputs.v3 adds explicitly dated ARR comparisons, annotated NRR and current cash runway, without changing pillars, grades, weights or 60%/required-pillar gates. Same frozen461-company replay: 0 scored, 342 partial, 401 observed criteria (v2:398), max44.5%, two companies gain coverage, zero replay errors. 46 scoring tests and seven browser-proof tests PASS; 53-package rebuild and changed-file lint PASS after correcting a strict currency type guard. No fabricated score or positive production certification. Home files and public-web work remain paused.

**Next:** complete local build/types/lint; push final233 head and obtain fresh protected gates; coordinate production promotion without overlapping another deploy; verify all four services, paced inputs.v3 reassessment, Q exact-target DONE receipt and readable desktop/mobile screenshots. Full reproduction: `NODE_USE_ENV_PROXY=1 CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt NODE_OPTIONS=--import=/workspace/q/scripts/handoff/live/browser-proxy-pin.mjs CQ_UNICORN_FIXTURES_FILE=/workspace/cq-secrets/unicorn-acceptance-fixtures.json CQ_UNICORN_VERIFY_Q=1 node scripts/handoff/live/unicorn-potential-acceptance.mjs`. Refresh existing private actor sessions with preflight-unicorn-actors.mjs if expired. Do not recreate accounts, lower evidence gates, change production scoring, rebuild CRM/Q Pitch, or apply withdrawn duplicate-import patches. Environment setup draft requires review/save/publish in Environment Settings for future tasks; current tested tooling works.

## 17 October 2026, midday — Q conversation fixes (Claude lead, top priority)

See [`Q-CONVERSATION-FIXES-2026-10-17.md`](Q-CONVERSATION-FIXES-2026-10-17.md) for the full table.

- **Live (release AT, `9a25c149`):**
  - Q's cards match its answer;
  - follow-ups bind to what Q showed;
  - moves between pages are re-sent if lost, and tabs are clicked directly.
- **In CI (batch AU, PR #200):** fetched tool results stored per conversation (migration `20261228190000`), turn reader v55 page controls, and the dialog-state fix.
- **Open:**
  - cards hidden by a stale saved-list view in old conversations (`claude/qfix-room-oct17`);
  - the recall gateway error, and the unrequested page open (`claude/qfix-cards-oct17`).

## 17 October 2026 — open work (Claude lead)

1. **Q Pitch v6:** DONE and production-certified (manifest). Optional follow-ups:
   - a voice-mode run on a real microphone (owner);
   - narration in the viewer's language;
   - a live Q-to-Q session on Capital Q's own founder account, with at most 2 Tavus sessions of 90 s or less.
2. **Onboarding, English:** meets target. The investor first turn (about 12.6 s) is dominated by model time.
3. **Onboarding, other languages:** PAUSED by the owner.
   - Resume from `claude/ob1-oct16@061f6426`, which is held. Re-run English acceptance before releasing it, because it touches the English currency and scale paths.
   - Unfinished work is on `claude/ob1-lang-wip`.
4. **Triage:** the roughly 30 failures in the full integration suite (`pnpm test:integration`) outside onboarding.
5. **Polish:** the photo-route 404 console noise. A uniform 204 or a client-side `hasPhoto` would keep the single "no" without the console error.
6. **Owner only:**
   - reconnect Google;
   - rotate `CQ_SEED_ACCOUNT_PASSWORD`;
   - remove fictional test accounts by their `cq_seed` markers.

## 16 October 2026 — open work (Claude lead)

1. **Onboarding (top priority)** — lane ob1, branch `claude/ob1-oct16`. Goal: every stated fact saved, p50 ≤3.5 s English and <5 s in a chosen language. Next: warm onboarding copy translations on language choice, one fixed lead per language, fix "your what the company does" read-back; live re-run of checks 2–5 plus Arabic and French on AI.
2. **Q Pitch v6** — spec `docs/specs/q-pitch/Q-PITCH-V6-OWNER-DIRECTION.md`. Natural-language trigger, step commands, section highlighting, preloaded zero-latency tour, investor and founder tracks, Q-to-Q GateQ interview and rehearsal (≤2 short Tavus sessions), instant Q&A bank. Branch `claude/qpitch-v6-oct16`.
3. **Guide v3** — PDF + HTML from production, delivered in the conversation; scripts in `scripts/handoff/docs`.
4. **Owner-only** — Google reconnect; Q Pitch scene 15 microphone; rotate seed password.
5. **Not doing** — automatic-interest workforce rule (owner: example only); demo deck regeneration (owner cancelled on cost).

## Mandatory current milestone: H2 production acceptance

PR99 is protectedgreen38617987342 and normally merged48c6f1e7. Founderdesktop realH2 checks PASS including selectedCSV/savedreload/security negatives. Complete investor/founder desktop/mobile and Q controls; verify q-api fourthservice (last BUILDING). Preserve98/97 and originalWIPs; do not mergefailing siblings. Media randomrequestId CI flake repaired with39testsPASS, PR101. STATE top is current authority; olderentries historical.

## Latest continuation priorities

Description90 is deployed72d across four SUCCESS services; fresh description browser proof remains pending. Claim capture PR92/08cacfd4:53 builds, root/API/package types,149 suite tests and40 focused tests PASS; exact CI38601112916 quality still running, database/build/types PASS. No live adherence proof or release. Next primary implementation: exact selected-dossier manifest hydration and full authorized source payload beside the600-character receipt; no investor-Q repair exists yet. Canonical H2 pipeline2d9dfa1e and guest expiry553316c5 follow; cloud-view and product-inventory WIPs are preserved, not release-ready. STATE top supersedes historical task entries below.

## Current priority — October14, 17:23 WAT

P0: protectedrelease90 (description89). P1: exactauthorizedsubmitted-dossier Q context/largefinding contract; interruptedrepairnotfoundlocally. P2: recordvalidtraction/use-of-funds independentofnextquestions, thensecureguestEvidence. P3: existinghub-h2-pipeline2d9dfa1e, notanotherrewrite; cloudviewb4a2a68e isunverifiedadd-onwith2test/typefailures. Research86/88andproductinventoryaed12b0c secondary. Production71c5 allfourSUCCESS, existingtextsubmissionandH1productionproofpreserved. See STATEtopforexactSHAs/reproduction/risks.

## October 14 — deployed acceptance and full GateQ / Hub continuation

- **Fresh production verified:** `71c5d4a58c314eca7981c08265b2e29015bc2b7b`; protected CI38556079265 SUCCESS. All four Railway services SUCCESS on this revision; previous revisions drained. GateQ canonical qualification-shape repair (PR83/84) and Hub H1 (PR81/85) are released. Historical checkpoints below are preserved, not current release authority.
- **Hub H1 LIVE VERIFIED:** authenticated fictional investor and founder, desktop1440×960 and mobile390×844, actual production UI. Role-aware headings/GateQ controls, Relationships/Overview tabs, Work return, no horizontal overflow PASS. Desktop typed Q generated successful navigation receipts to the existing overview; final-words-to-push62/7ms, settled heading5529/3912ms (single samples, not p50/p95). No voice certification, full CRM claim or Tavus room. Private browser evidence stays outside Git.
- **GateQ remains immediate priority:** native confirmed-account founder form → contextual Q interview → reload recovery → explicit reviewed Submit → exact-reference investor brief and expanded frozen three-turn transcript PASS on production71c. Separate existing fictional investor received404 for both foreign gateway and exact submitted dossier. All recorded facts remain applicant claims/self-reported; zero attached documents. No guest email OTP, uploaded documents, investor Q or p50/p95 certification claimed. Prior pre-repair session/history preserved; no historical fact rewrite or seed bypass. Guest Evidence is not released or evidence-complete.
- **Parallel ownership:** root owns native GateQ acceptance, intake/Q/disclosure/investor composition and integration. `hub_foundation` owns bounded H2 server-authorized list/filter/cursor/export, scoped personal saved views/columns, existing table/board and Q controls. `guest_evidence_recovery` owns actual signed-provider expiry/fencing, canonical Evidence storage/contracts/tests and draft migrations only. No duplicate CRM or Q engine; Q Pitch untouched.
- **Preservation:** unrelated older contact source/tests committed and pushed as `codex/wip-product-contact-preserved-oct14` at5049a718; not a merge target. No recoverable H2 branch or dirty Hub work found; continuing H2 from merged H1. PR86/87/88 preserved; research secondary.

## October14 active product ownership

Q attribution is deployed37b5414e and the actual investor cards/profile/risks/comparison journey passes. Close the newly proven GateQ typed-stage corruption through protected release and native submission/dossier acceptance. Functional Hub H1 is approved; finish PR81 exact checks and role-aware browser acceptance. Guest Evidence b35813de is tested foundations, not disclosure-ready. See STATE top for exact source authority, receipts and remaining speed gaps.

## Current execution board — October 14, 07:35 UTC

GateQ supersession and cold-opening repairs are CI-green, deployed at62bd144a, and fresh live verified. Relationship Hub PR75/aac14fd0 is CI-green and ready for design approval only. Immediate engineering task: finish isolated Q DISCOVER follow-up attribution patch protected CI, release normally, rerun full investor browser rehearsal; route settling remains unexplained. See latest STATE checkpoint for exact SHAs, timings, commands and preserved WIPs. No production CRM implementation.

## GateQ exact-head CI correction — 2026-10-14

- Reconciled source checkpoint336cf8c4 pushed in PR72. Local53 package builds PASS;122 domain tests PASS. Combined UI suite67tests ran:65PASS and2 legacy/display mismatches, then corrected actual legacy transcript display and test labels; affected inbox + intake rerun42tests PASS. Founder contact-first/recovery, comparison and dossier source assertions remain intact.
- Protected CI run38504152785 on336cf8c4: build and format/lint PASS; GitGuardian PASS. Database failed solely the strict inventory array's alphabetical order; all new claim/contact pgTAP suites passed. Typecheck failed a duplicate applications.lock property introduced by automatic fixture merge. Both corrected without weakening gates; fresh exact-head CI required. Current local root/API/web gates still completing. No hosted migration or new deployment.

## GateQ reconciliation and release preparation — 2026-10-14

- Integration advanced to f49e8c84 and production to20cb347e while the environment was paused. Railway API metadata now confirms20cb347e/SUCCESS; this is the previously released text journey, not the current repair. Normal merge reconciliation in progress, preserving contact-first form, authoritative Q opening, dossier fact/turn lineage and latency instrumentation. Q Pitch incoming ancestry is preserved without edits or ownership changes.
- LOCAL TESTED:122 tests/10files PASS after reconciling stricter contact and submission behavior. Concurrent openings now use the same durable claim/checkpoint/finalization path as answers, with no invented applicant utterance. Frozen investor Q summaries now include actual interview findings, source references and evidence labels rather than only the old form. Findings context is bounded and omissions disclosed; no extra model call or document-reading claim.
- Dedicated GATEQ_CONTACT_CODE_SECRET generated privately and bound to API only with skipDeploys:true. Readback confirms present; existing Brevo HTTPS sender configured. No secret value in Git/logs, no deployment triggered. Default contact-required boundary remains code-owned, not disabled by missing configuration.
- PR72 opened against build/int-rc; conflicts with newer shared GateQ work are being reconciled before protected CI. Guest uploads/exact document-version disclosure/investor source access and follow-ups remain incomplete. New migrations231000/231100 not CI tested/applied. Latest local frontend53tests passed before reconciliation; repeat combined gates required after source merge. No new live acceptance claimed.

## GateQ shared contact limits and evidence labels — 2026-10-14

- IMPLEMENTED / LOCAL TESTED: transactional server-owned contact issue/verify budgets across application, intake session and keyed destination; resend preserves attempts within the hourly window. Parallel wrong-code attempts stop at five. New application interviews require confirmed contact before any paid model call; resume reuses the saved Q opening. Existing confirmed contacts remain usable.
- Q cannot promote a new applicant claim to document-supported without an existing authorized document-supported fact. Coverage now returns the owner-authorized contact details for review recovery, never verifier fields.
- All52 package builds and102 GateQ tests PASS. Changed-source lint produced no diagnostics; root combined type gate pending. New immutable migration20261223110000 and seven pgTAP assertions plus schema inventory guards are implemented but not CI tested or hosted. Existing Brevo sender configuration checked; dedicated API-only verifier secret still unbound. Not deployed or browser accepted.
- Founder flow and immutable investor dossier UI are pushed on the isolated frontend branch; integrating next. Selected application comparison is in progress there. Guest Evidence integration, immutable source versions, investor Q source access and follow-ups remain incomplete; see GATEQ-V1-CAPABILITIES.md. Q Pitch untouched.

## GateQ durable exchange slice — 2026-10-13

- IMPLEMENTED / LOCAL TESTED, not released: database-owned per-application exchange claim before model spend; exact retry text binding; checkpointed typed model reply reused after final write failure; atomically commits facts, Q transcript and claim completion. Five-minute fenced claim recovery for the same pending key, with a120second bounded interviewer call; completed exchanges replay without another model call. A crash after provider completion but before the reply checkpoint can still require a necessary recovery call; no universal exactly-once provider claim.
- Submission now locks the canonical application while reading/freezing facts, qualification, contact, documents, transcript, coverage and deterministic dossier. In-flight/pending final turn prevents Submit. New immutable migration20261223100000 adds claim/checkpoint constraints and application-row locking guards for facts/documents/contact/transcript;10pgTAP cases added, not yet executed in protected CI or applied hosted. No transaction held across model/email calls.
- All52 package builds PASS (50cache hits); GateQ96tests PASS, including both preserved independent concurrency regressions and2 new finalization/checkpoint regressions. Static/root type gates being completed; early missing-generated-entry/QA port errors are not passes. No deploy, live browser acceptance or paid room. Contact resend/shared attempt limits remain to fix before exposing recovered backend.
- Read/reconciled all20 supplementary GateQ features with locked PADL, Real Product Specification, Final System Review and actual MVP/V1 DOCX. Concise CODE OBSERVED/gaps/defer boundaries in GATEQ-V1-CAPABILITIES.md. One isolated frontend owner is implementing existing form/contact/interview/review and typed API-client wrappers; no Q Pitch changes. Materials sharing remains deferred to explicit Submit to protect disclosure and canonical relationship effects.

## GateQ execution recovery — 2026-10-13

- Active repair branch: `codex/gateq-completion-recovery`, recovered from QA `f03c963c` with Claude backend `0552c4f7` included. Remote production `5ce3d76b` and integration `be2ab28a` verified by GitHub refs; deployed service revisions not rechecked in this slice. Original branches and earlier uncommitted contact work preserved. Q Pitch is outside this assignment.
- IMPLEMENTED / focused LOCAL TESTED: application-bound HMAC contact code verifier; 23 interview/contact tests PASS, including three new verifier cases. Dedicated server-only `GATEQ_CONTACT_CODE_SECRET` (at least 32 bytes) required before deployment; exact setup and rotation behavior in `GATEQ-RECOVERY-CHECKPOINT.md`. No secret generated or deployed.
- REPRODUCED: both existing exchange concurrency regressions FAIL (duplicate model call and interpretation of unstored changed retry text). These assertions remain intact. Resend reset, shared throttling, code-confirmation concurrency and final-turn/submission consistency remain unrepaired.
- Fresh checkout frozen install PASS after offline metadata miss; all52 package builds PASS. Domain/API changed-file lint PASS, changed-file formatting PASS, API typecheck PASS. Broader GateQ suite executed94tests:92PASS and the2 preserved exchange concurrency regressions FAIL. Root typecheck remains in progress. First test attempt executed zero tests because GateQ dist was not ready, then rerun executed 25 (23 PASS / 2 reproduced FAIL). Early package typecheck blocked by not-yet-built model-gateway dist; not a typecheck PASS. No release, migrations, browser acceptance or paid video usage claimed.
- Next: finish package prerequisites and static/type gates for verifier slice; repair durable exchange ownership and atomic finalization, then shared verification abuse budgets; complete existing founder interview/review/inbox and authorized Evidence integration. Measure useful text, source-linked findings/cards/artifacts and resume/submission latency within GateQ.

## 2026-10-13 21:40 UTC — GateQ text journey: integrated, release #70 in CI

- **Evidence stage:** #66, #68 and #69 are MERGED to int-rc (47d87665). The migration is APPLIED. Release PR #70 is in CI. Not deployed, not live-verified.
- **Next actions, in order:**
  1. Merge #70 once green, then confirm Railway web and api SUCCESS on the merge SHA.
  2. Run `node scripts/handoff/live/gateq-acceptance.mjs` with the public sign-in config, and record turn latency in PERFORMANCE-BASELINE.md.
  3. Do a browser pass of `/g/<publicId>` → inbox dossier view on fictional accounts.
  4. Only after a PASS, set `GATEQ_CONTACT_REQUIRED_FROM`.
  5. Add the nonbinding Q synthesis record (reuse existing Q intelligence; cite dossier fact ids).
  6. Implement ADR 0067 guest uploads.
- **Blocked on the owner:** a valid `SUPABASE_ACCESS_TOKEN`, and `CQ_SB_URL` / `CQ_SB_PUBLISHABLE` in this environment.

## 2026-10-13 — Q Pitch lane opened; GateQ lane continues (integration owner: Claude)

- **Read first:** before starting or modifying Q Pitch, demo identities, scripted tours, navigation, narration or showcase features, read `docs/specs/q-pitch/Q_PITCH_MASTER_BLUEPRINT.md`.
- **Shared baseline:** its approved experience design, 12-minute investor script, Feature Atlas, wow moments, interruption rules, performance targets and certification requirements are the baseline for Claude, Codex, subagents and every future agent.
- **No alternatives:** do not invent a different Q Pitch architecture, script, experience or demo account system.
- **Precedence:** the locked PADL and higher-priority Capital Q specifications still take precedence. Flag conflicts; never silently override.
- **Changes:** a material change is a proposed revision for product-owner approval. Approved revisions go in the blueprint's changelog.
- **Status and claims:**
  - Feature status: `docs/specs/q-pitch/IMPLEMENTATION_STATUS.md`. PLANNED is not certified.
  - Every demonstration claim must map to `docs/specs/q-pitch/CERTIFICATION_MANIFEST.md`.
- **Shared handoff:** progress, release evidence, risks and branch ownership stay in `docs/ai-handoff/`.
- **Parallel lanes:** GateQ and Q Pitch run in parallel lanes with one integration owner. No conflicting changes to shared contracts, authorization, Q orchestration or migrations.

- **Assignment ledger:**

  | Lane                          | Owner                         | Branch                                 | Files owned                                                                                                                                                      | Contract version                     |
  | ----------------------------- | ----------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
  | A GateQ text slice (backend)  | Claude worker                 | `claude/gateq-interview-backend`       | `packages/gateq-intake/**`, `apps/api/src/http/gateq-apply.ts`, `packages/contracts/src/http/gateq-intake.ts` and `gateq-inbox.ts`, one additive GateQ migration | gateq-intake contracts (in progress) |
  | A GateQ web                   | next, after backend contracts | TBD                                    | `apps/web/src/features/gateq/**`, `apps/web/app/g/**`                                                                                                            | consumes Lane A backend              |
  | B Q Pitch foundations (P0–P1) | Claude worker                 | `claude/q-pitch-foundations`           | new Q Pitch package/feature files only; read-only audits of identity/memberships                                                                                 | new `q-pitch` contracts v1           |
  | Integration / release         | Claude (this session)         | `build/int-rc` → `recovery/2026-09-12` | migrations, shared Q contracts, CI, releases                                                                                                                     | —                                    |

- **Guest uploads:** ADR `docs/adr/0067-gateq-guest-application-documents.md` (Proposed). This is required for full GateQ acceptance and is implemented after the text slice.

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

## 2026-10-13 13:40 UTC — bounded slice deployed; allocation checkpoint closes wider-funding gate

- DEPLOYED: PR55 f0a89007 exactCI38393620721 SUCCESS/normal integration merge51a09275; PR56 e021d3ad exactCI38393622180 SUCCESS/normal production merge0a7e5f1abc61b9eea9bd9c994939ee026f381926. Source/DB4798files byte-identical. Production pushCI38397302675 SUCCESS. All four Railway services0a7e5f1a SUCCESS/drained: workersa3dd0e09-5ff8-4464-a4a8-db144ff0cb8d; api5072b12f-326b-4ec7-8221-599b59fbfd4b; q-apia955d3b6-4dd7-4721-b209-c0b4e1339cc8; web1f6f9b4b-e822-4e52-a168-ba3bea9d868a.
- Hosted allowance migration20261222185000 applied through approved HTTPS runner after exact quality/pgTAP gates; hosted206/local206 then no pending. Two allocations/account/no renewal, one open/account/two globally, strict180sec reservation. Paid window remains CLOSED/test mode; wider flag not enabled. No second paid room. No Live voice setting changed. Bounded UI/automatic stock selection/company coverage/next-reply closing are source/deployed, not broader human AV acceptance.
- Final CODE OBSERVED spending gap: uncertain remote create could release local slot before remote allocation resolved. Owned source follow-up persists selected account/PAL before paid create, bounds same-account PAL-specific recovery, retains unresolved financial/concurrency reservation independently of canonical voice fallback, never starts another room for recovery. Known live sessions retain confirmed close before final review. New immutable migration20261222190000 adds checkpoint columns/guard; not applied. New8pgTAP cases still CI required. 67 focused adapter/rehearsal testsPASS, root/q-api types and changed lint/formatPASS; packages unchanged from validated52build. Initial four regression failures exposed duplicate free-PAL cleanup and premature collapse of known allocations; root behavior corrected, assertions retained, final67PASS.
- Root and existing product checkout fast-forwarded to integration51a09275/production0a7e5f1a, preserving all prior source/helpers. Existing product branch now owns GateQ contact/interview/dossier work. New contact service source requires name/company/role/email and verified identity/email match without creating membership; not wired/deployed/accepted yet. Full new GateQ directive preserved verbatim in session-directives. No longer GateQ paid usage authorized by rehearsal allowance; start complete text flow/dossier first.

## 2026-10-13 — GateQ text interview/dossier completion directive

New governing task: [full user directive](session-directives/2026-10-13-gateq-adaptive-interview-and-inbox.txt). Complete contact/verified guest ownership → frozen published qualification → adaptive Q interview and evidence → founder review/explicit submission → immutable source-linked dossier in existing inbox → human decision. Reuse gateq/gateq-intake, Evidence, Q/rehearsal/voice modules; no duplicate system or new scoring formula. Start with complete text flow/dossier, then independently authorized voice/video; do not change the 180second rehearsal cap or assume 15–20minute GateQ paid usage funded. Current inspected gaps confirmed: form sends directly; conversation-service supplies empty document proposals/history. Preserve main Q speed/Graph/product work and bounded video release. No implementation or live acceptance claimed for this new scope.

## 2026-10-13 11:42 UTC — bounded video slice locally gated, product checks resumed

- IMPLEMENTED/LOCAL TESTED, not yet DEPLOYED: own canonical investor-company video admitted; all three supported kinds reuse existing rehearsal ownership/entitlement; Q selects enabled stock presentation from authorized persona style, no extra model/personality; original Q stage canvas/footer retained around provider iframe (vendor interior remains). New sparrow-2 turn detector, next-Q-turn wrap-up cue near original deadline, no unsolicited closing support through current iframe/REST path and limitation disclosed. Client drops iframe at deadline even if review save pending; bridge bounds in-flight Q work and suppresses late speech. Same-room recovery/immutable deadline/confirmed-close-before-review retained.
- Server allowance immutable migration20261222185000: two lifetime allocations per canonical profile, across tenants (pilot counts), failed starts count conservatively; one open room/account, two open provider rooms globally, advisory transaction lock across instances; no auto renewal; strict180second reservation constraint. RLS/grants unchanged, no new table or key rotation. Broader funding flag defaultsfalse until protected release/migration. Quota failures preserve same canonical voice fallback with clear reason. Tests916 new10pgTAP assertions still CI required; old914 fixture now179sec to avoid separately evaluated clock_timestamp microsecond overflow under new exact180 bound.
- Local package builds52PASS; focused rehearsal engine53, video50, lobby7, stage5, GateQ error-state3 testsPASS (118 distinct cases). Root final typesPASS; q-api typesPASS; web typesPASS; changed static/format PASS. Final protected quality+pgTAP and exact-head promotion still required. Owned production checkout fast-forwarded to f4c2e603 and same source patch applied, original production directive files preserved; its package build using shared valid cache in progress.
- Browser saved human reviewPASS/nonprovisional/seven exchanges. Existing founder+investor GateQ/Work/docs/relationships surfaces all200/bound/content/no visible errors, not full flows. GateQ unknown-vs-absent source correction and safe parallel settings reads add3regression testsPASS. Main speed/Graph/complete founder-investor/GateQ/locked InvestIQ work remains priority immediately after this bounded release. Model-stage sample p50/p95 recorded in PERFORMANCE-BASELINE, no valid first-audio quantiles yet.

## 2026-10-13 11:18 UTC — human Tavus pilot completed; bounded finish authorized

- Production remains f4c2e603, all four services previously verified SUCCESS/drained; production push CI38384891335 SUCCESS. One human paid Tavus room allocated at10:58:35.640Z, original deadline11:01:35.640Z. Seven Q exchanges/15 canonical turns, TIME_LIMIT, provider confirmed ended, canonical FINISHED and nonprovisional review persisted. End confirmation timestamp11:01:39.328Z is3688ms after deadline; exact physical cutoff instant is not separately proven. No engineer finish POST or second paid room.
- Ordinary resume reads retained identical room/private URL/original deadline. Authenticated saved-review browser PASS/private receipt /tmp/cq-investor-demo-I0Ti3y, correct counterpart/nonprovisional review. Checker originally used heading “review”; actual product heading is “Your rehearsal with”; fixed checker and reran, no product change. Human interruption/reconnect still not explicitly confirmed. User reports vendor UI displacement, narrow emotions, perceived3–5second reply delay, no spoken closing; do not claim those acceptance gates passed.
- Paid pilot window closed after provider end/review: only CQ_TAVUS_TEST_MODE restoredtrue. Same gated code configuration deployment9b1324c8-ac86-49ca-88fe-c568c042646a SUCCESS, exactly one active instance and prior paid configuration drained at11:15Z. Live voice settings untouched.
- New standing authorization: all legitimate accounts, one-time two allocations/six minutes total per account, max180sec each including reconnect. No automatic allowance reset. See session-directives/2026-10-13-close-tavus-product-completion.md. Implement durable account/global concurrency limits before broader paid access; no new paid allocation during source work. Finish only bounded UI/coverage/automatic stock avatar/closing/measurement slice, then immediately prioritize Q speed, intelligence, real founder/investor journeys, GateQ and locked InvestIQ.

## 2026-10-13 10:57 UTC — rehearsal repair deployed and explicit Video lobby browser verified

- Final production PR53 sourcef031c152 exactCI38382841674 required quality/pgTAP and GitGuardian SUCCESS, normal mergef4c2e6035cff54cbd286664fa1adae02853e6f41. Source/merge trees identicalc8e2bef33b15910de6d2d39b5ecb86545e1e5dbd. Role integration PR54 a76275d8 CI38382772779 SUCCESS/merged50b833930a6a76aaaf1569fcc7efe12bdac269f7; core PR52 also green/merged. Root fast-forwarded to integration before this factual checkpoint.
- All four Railway services SUCCESS atf4c2e603, old deployments drained. q-api d4aacb3b-a70b-4ee1-ac53-8ec16941ed36; web e87abf33-2b4b-481c-a6fe-277bb5632f91; api945d81ae-339a-4c5c-aa70-b602f68bb554; workers5ea32d80-2d96-4867-bf7e-58bb6f647c73. App-only watch paths left unchanged api/workers at592b32ff, so root explicitly deployed the exact already-gated revision through normal serviceInstanceDeploy(commitSha), no configuration bypass. PushCI38384891335 still running at this checkpoint.
- Authenticated founder browser on explicit investor lobby `?video=1` PASS: Video already checked, PartnerSteve enabled/checked, disclosure visible, Join enabled after options settle, Join not clicked. Private receipt `/tmp/cq-investor-demo-KFuIeS`. Local screenshot helper initially shadowed node:path join; corrected and rerun to completion, not a product failure or skipped assertion. Fresh ordinary founder catalogue true/Steve/180; unadmitted investor false/zero enabled.
- Fresh q-api configuration receipt10:57UTC: paid mode/testMode=false, exactly one matching canonical pilot profile and first provider account key, stable cipher/bridge origin, one configured replica and old code instances drained. Latest observed video rows0. User confirms available and received verified explicit-Video link; read-only room/provider/canonical-review monitor active. Human face/audio/interruption/reconnect/deadline/review acceptance still PENDING, no allocation by engineer. Do not deploy/restart while the one <=180second paid room is open. Confirm provider physically ended and saved review before restoring test mode/admission.
- Live voice root incompatibility corrected in source/deployment: owned active non-external rehearsals delegate to the existing Q rehearsal-aware handler; external prepared mode preserved; trial meter/claim and provider sensitivity limits unchanged. Client role scope disables ordinary Q greeting/navigation and avoids claiming connection after failure. 180 targeted tests, types/static and protected CI PASS; physical investor-rehearsal Live voice remains human acceptance, not inferred from availability or tests.

## 2026-10-13 10:20 UTC — protected core repair integrated; final rehearsal audio scope gated locally

- Core repair PR52 sourcebcc0b743 exactCI38380132523 required quality/pgTAP SUCCESS, normal merge integration2adf2a0654d3f8be7f91d451b104c87a4d68060b. Production candidate PR53 a4eeed95 exactCI38381207915 also SUCCESS, held for the final client audio scope safeguard. Production remains592b32ff; no new deployment, Tavus allocation or human AV acceptance.
- Final integration review found the common Live audio adapter could add Q's ordinary greeting and use general navigation shortcuts during a rehearsal. Owned rehearsal starts now explicitly disable those shortcuts and speak only Q's supplied counterpart opening. Regular Q voice starts retain their existing behavior. The Q-backed dialogue and durable trial guard remain intact.
- Final root focused run180tests/eight files PASS; production checkout62 UI/recovery/selection tests PASS plus prior125 broker/trial/claim/bootstrap/lobby tests PASS. Final root and web types/lint PASS in both owned checkouts; q-api unchanged since its passed types. All4445 tracked app/package/dependency files compare byte-identical between candidates. Exact final-head protected CI and four-service rollout still required; do not promote the superseded a4eeed95 candidate.
- Read-only provider preflight selectedSteve stock face present/status completed. Private sessions refreshed with exact existing identities. User's failed rehearsal belongs to admitted canonical profile; still zero video rows. No paid room reserved, no allowance reset or alternative paid provider minted. Next: gate final role scope, promote combined candidate, verify admission and explicit video URL in authenticated browser, then coordinate the one <=180second human pilot.

## 2026-10-13 09:44 UTC — human join FAILED; pilot remains unallocated

- User screenshot confirms correct Savanna investor lobby URL, same canonical admitted Tensorgate profile (verified against the actual newly created rehearsal). User says Video/PartnerSteve options were absent. Screenshot is the voice rehearsal, no AI face; human audiovisual acceptance FAILED/NOT DELIVERED. Hosted video rows0: no Tavus provider allocation or successful video pilot.
- Actual q-api logs show repeated live voice refusals reason REHEARSAL. Account GET live/available200/available=true: voice was not globally disabled. Root incompatibility: trial bootstrap issues LIVE-only credentials, while live broker prepares external-person rehearsals only, rejecting investor-organisation rehearsals; alternative paid provider fallback is forbidden by the approved trial guard. Do not bypass its 300-second durable allowance or mint replacement paid credentials.
- Fresh same-profile lobby browser replay3WZRAx shows admitted Video/PartnerSteve without Join; this does not reproduce or invalidate the user's missing controls. Exact transient browser cause remains unproven. Code observation confirms options errors silently hide selector, and Join stays available before admission finishes. Source correction makes loading/failure explicit and retryable, prevents early Join, and allows explicit video-intent URLs to fail closed rather than silently start Voice. Voice room also stops claiming LIVE after its start callback reports an error.
- Pending owned source gates, protected CI/promotion and actual user's browser retry. Video remains restricted to the existing one profile/key/replica/180seconds; no room allocated. Reuse the owned canonical rehearsal when possible, avoid extra paid allocations. Q-backed live voice support for eligible investor/company counterparts remains a required root fix; not solved by clearer errors or typed fallback.

- Owned source follow-up: Q-backed Live rehearsal audio now verifies the same owned ACTIVE canonical rehearsal, delegates dialogue to the existing rehearsal-aware Q turn handler, speaks Q's returned counterpart line exactly, and avoids duplicating canonical transcript turns. Public external-person prepared lines retain their existing mode. The 300-second durable trial guard and provider sensitivity ceiling remain unchanged; no alternative paid credentials. 125 targeted broker/trial/claim/bootstrap/lobby tests PASS, plus preceding61 UI/recovery/voice-selection tests PASS. Package builds52 cached PASS; final root/q-api/web types and static gates pending before protected CI/promotion. Not deployed or human verified.

## 2026-10-13 09:22 UTC — next executable work

1. Findings correction complete through protected release and full authenticated investor browser acceptance on592b32ff. Preserve strict contracts; do not rerun unchanged gates without a reason.
2. PRIORITY NOW: human Tensorgate Tavus pilot. User ready and signed in. Wait configuration-only q-api deployment SUCCESS and old deployment fully drained; fresh admitted/unadmitted catalogue checks; then provide existing eligible investor lobby. Exactly one paid allocation, <=180seconds, no deploy/restart during it. Observe actual AI face/audio/Q replies, interruption, same-room refresh/deadline and persisted review; distinguish unobserved fallback from demonstrated behavior. Confirm provider ended before restoring test mode.
3. After pilot, assess complete founder/investor/workforce journeys, genuine multihop authorized graph memory, and counterpart coverage (investor organisation/external researched person/company). Prepare durable spend/concurrency protection before wider paid access. Preserve Q evidence-grounded persona as intelligence and Tavus as audiovisual transport.
4. Measure representative first useful text/audio/completion p50/p95 with enough valid samples. Existing single samples and cloud voice ICE failure do not establish media acceptance or general performance. Continue measured caching/compression/routing/round reduction/parallelism work.
5. Update shared root checkpoint, commit/push and protected integration PR after concrete pilot facts. Preserve existing branches and all uncommitted work.

## CURRENT PRIORITIES — 2026-10-13 — Codex takeover

1. PR #42 is shipped independently (all four SUCCESS `f3fe5520`, exact CI green). Current-run rendered investor journey, Work exact memo v2 viewer, selected-company continuity and stored workforce deliverables PASS. Keep named-founder extension, actual voice/media and compound post-release evidence as separate checks.
2. PR #43 merged integration at `9da9f057`, migration 170000 applied/security read verified. Voice-only PR #46 is deployed all-four SUCCESS `cda9b767` and old q-api drained. Admission/held claim/server end/final claim release live verified at 0 speech; cloud WebRTC media remained connecting. Actual speech/silence/cutoff needs a working media client, not repeated allocations in the unchanged cloud transport.
3. PR #44 latest exact CI38359007324 and production PR #48 CI38359532207 passed; both merged. Migration180000 applied. Production912e594c all-four SUCCESS/old deployments drained; fresh founder-positive/investor-negative read-only catalogue and readiness checker PASS, founder Rehearsals browser visible. Owner joins later; do not allocate the paid room now. Preserve fixed180s cap, single profile/key/replica and fail-closed fallback. Human AV/refresh/end/nonprovisional review pending.
4. Memory PR #47 production08018ea3 all-four SUCCESS verified. Live compound answer now includes actual stored memo/reviewer risks and distinguishes unknown evidence; mixed current-decision subrequest still omitted two pending owner approvals. No outward sends/approval actions. Private receipt /tmp/cq-memory-live-8fK9ji. Individual samples are not p95.
5. PR49 v23/v24 source7da9796f exactCI38364499150 passed; production23e3971c all-four SUCCESS/drained and pushCI38366361312 passed. Mixed decisions live native pending-approval read succeeded/two existing items unchanged. Post profile binding FAILED (correct company reference, zero native findings); do not accept faster incomplete output. Correct the distinction between conversation findings and specialist companyFindings in new immutable v25, preserve schema/DROP/authority and5300estimated-token test bound, gate exact CI and rerun actual browser. v24's schema-valid example reproduces zero native findings through the real renderer. Root15path integration copy locally gated/pushed; PR50 shared checkpoint merged8086ab91. Final prompt integration/shared checkpoint after live validation.
6. Keep shared checkpoint current after each merge/deployment. Do not retry local Supabase vfs image pulls; CI pgTAP + hosted HTTPS. Network is active; no restart needed. All provider test suites use disabled-local keys.

## ACTIVE WORKSTREAMS — owner directive 2026-10-12 18:40 UTC (product priority correction)

The workforce demo is no longer the whole effort. These four lanes are ACTIVE engineering work, run in parallel, owned by Claude (release owner while Codex is unavailable; Codex owns voice-trial files `apps/q-api/src/voice/**` and `codex/voice-trial-durable-claim`). Each reports: capability users experience now · code implemented · CI · deployed + live-verified · blocked + exact next action.

| Lane                                      | Branch                         | Acceptance (live, as a real user)                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Tavus immersive rehearsal              | `claude/tavus-rehearsal-slice` | Founder launches a rehearsal, picks a stock AI interviewer, holds an interactive video conversation whose replies come from Q's existing rehearsal intelligence (no second brain), session ends cleanly at or before the 180 s Tavus cap (distinct from the 300 s GPT-Live tester trial), falls back to voice when Tavus is unavailable, and a persisted review appears afterward. Then four differentiated personas and planned voices. |
| B. Graph-enhanced long-term memory        | `claude/graph-recall`          | A representative multi-hop question (conversations ↔ companies ↔ evidence ↔ decisions ↔ mandates ↔ documents ↔ completed tasks) that today's recall misses is answered correctly, with sources, dates and truth classes; graph built asynchronously, canonical sources authoritative, every hop authorized; baseline vs after benchmark; corrections, freshness and permission negatives tested.                                         |
| C. Hermes-inspired speed and intelligence | `claude/answer-speed-2`        | Follow-up and memory questions reach first useful text materially faster than today's 12–32 s without losing evidence; per-phase breakdown before/after from production logs; techniques adapted from the actual Hermes codebase (caching, compression, bounded parallel tools, fewer model rounds, skill reuse, adaptive routing).                                                                                                      |
| D. Product experience                     | `claude/product-journeys`      | The investor's unexplained 8.8 is explained from canonical scoring/fit definitions and the UI shows what it measures (formula unchanged); complete founder/investor journeys walked in production with defects fixed (navigation, presentation choice, Work, approvals, comparisons, memory continuity).                                                                                                                                 |

Critical regression lane (bounded): diligence questions >180 chars repaired by one bounded rewrite (`claude/diligence-question-length`); work-history recall of reviewer changes and diligence questions (`claude/work-results-fix`). Founder-contact cards are never approved or sent by automation.

## LATEST RELEASE — PR #23 merged; four-service rollout pending — 2026-10-12 09:28 UTC

GitHub has advanced beyond the older checkpoints below. PRs #19–#22 are merged into `build/int-rc` at `58812685847e99f7435020538ce450da11eb65c3`: concurrent retrieval, relevant cross-conversation recall, measured-path latency changes and canonical Work document integration. PR #23 exact-head CI `38242394741` passed tests/build/types/lint/pgTAP/quality and GitGuardian (manual e2e skipped). Normal merge promoted it to deployment branch as `221ff996ca7c8242a2e8e7c1dce85b92f2b78b23`; current Railway rollout must be verified before any live claim. Immediately previous verified rollback is `5d9837bf50e189ebee12ea84772355e34b08c2db`, all four services SUCCESS: workers `eaf7b46c`, api `e4a2d943`, q-api `0e099f4b`, web `a08c4046`. No migration. PR #18 exact run `38227999773` also passed and merged as `a3a4eb6b`; PR #16 was subsequently merged as `5d9837bf`. Earlier release-hold paragraphs are historical.

Native Work approval visibility and original-conversation diligence fix remain separate local-tested pending changes on `codex/workforce-tavus-integration`; canonical Work documents from its pushed 9fe665f6 are already integrated via PR #20. Do not merge duplicate implementation. Root/q-api/web types, final lint/format and 22 focused tests PASS (plus corrected four-case rerun). Pending code will be committed and integrated against the latest combined base. Full intelligent workforce acceptance remains unverified.

NEXT: verify four-service rollout at 221ff996, then strong `workforce-acceptance.mjs --approve`, leaving all founder-contact cards PENDING. Browser rehearsal failed before launch because `/opt/pw-browsers/chromium` is absent; locate/install the repository-pinned Chromium and repeat. No browser product result or new latency measurement from that failure. Keep actual viewer/context/revision and first-audio checks distinct from API success. Latest full continuation directive: [session-directives/2026-10-12-product-completion.txt](session-directives/2026-10-12-product-completion.txt). Reuse Q/Work/memory/knowledge/rehearsal systems; proposed InvestIQ remains separate from approved scoring. Tavus network draft still requires publish; credentials remain private.

## LATEST CHECKPOINT — release gates and native Work deliverables — 2026-10-12 09:25 UTC

- Latest integration: `build/int-rc` / `55ddf0972d00b91a96b8755a2663b3e73121579b` (PR #17 warm-up fix). Exact CI `38224342952`: quality and pgTAP SUCCESS; manual e2e SKIPPED. Promotion PR #18 / exact run `38227999773`: build, types, lint/format and pgTAP SUCCESS, full tests still running. PR #16 remains HELD until its corrected head passes its own exact checks. CI lane still `d1266802`; never use its separate green push to override the prior failed promotion.
- Fresh Railway read: all four services SUCCESS at `fdf047457550b8aef23fed3adc710b1e8fe2b113`, unchanged rollback. Deployment IDs: workers `05f5c615-eece-44bd-b4b2-c1772482c196`, api `d13be769-2dae-4984-a22e-c781012417d7`, q-api `d51a934a-1d8f-41c5-8a93-c7954aee7018`, web `ed04f852-7370-4dcf-bcfd-2f1ef9366217`. No migration.
- Protected product branch: `codex/workforce-tavus-integration`, based on pushed `9fe665f68da25b98a449607622940e48e24af362` (canonical Work documents plus warm fix). Pending checkpoint adds fresh-authorized native approval views to completed jobs, exact previews and existing human-approval action; Needs you includes actionable native cards. It also files diligence approval runs in the original owned Q conversation, rejecting missing/inaccessible conversation rather than silently creating another. No contact is automatically sent.
- LOCAL TESTED: 52 package builds and 33 focused approval/document/UI tests; final 22 deliverable/diligence/panel tests PASS, plus corrected four-case diligence rerun PASS. Root and final q-api/web types PASS; nullable original conversation is explicitly rejected. Final changed lint and formatting PASS. NOT yet CI GREEN, DEPLOYED or LIVE VERIFIED. Do not describe status-only DONE as complete autonomous intelligence.
- Confirmed product evidence remains historical: real workforce ONE_PAGER READY v1/v2, viewer and PDF; selected-company explanation/follow-up/exact comparison browser rehearsal passed on `f23583ad` (first text 3,342 ms top-three, 2,891 ms selected-company, 2,410 ms comparison). No new latency result yet; first audio remains inconclusive/blocked. Current production memo chain last failed at the 2,000-character finding limit; the 8,000-character fix awaits promotion. Cold Documents/Open failure remains unresolved; repeated 8.8 still lacks a fresh authorized-record reproduction. InvestIQ prototype is PROPOSED only, separate from approved scoring.
- Exact next task: finish PR #18 and corrected PR #16 gates, promote normally, confirm all four Railway revisions, refresh the existing fictional session and run `workforce-acceptance.mjs --approve`. It must prove research sources, actual READY memo/history, independent critique and material revision, PDF and an unexecuted PENDING diligence card. Then CI-gate/integrate Work deliverables and run actual Work viewer plus original-conversation follow-up/revision. No founder-contact approval in automation.
- Full investor browser reproduction: `CQ_DEMO_SESSION_FILE=/workspace/cq-secrets/workforce-session.json CQ_DEMO_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key CQ_DEMO_CHROMIUM_PATH=/opt/pw-browsers/chromium NODE_USE_ENV_PROXY=1 node scripts/handoff/live/investor-demo-rehearsal.mjs`. Refresh expired session with private `workforce-refresh.mjs` first. Optional authorized founder record: `CQ_DEMO_FOUNDER_RECORD_FILE`; omit only for the fictional demo baseline. Protected receipts stay outside Git.
- Unmerged/experimental: this product branch; diagnostic-only `codex/ci-failure-evidence` / `c8424bd3` MUST NOT deploy; historical unverified bridge WIP `35c23d7a` MUST NOT merge wholesale. Other preserved worktrees/branches remain documented below. No replacement Q/workforce/document service, scoring rewrite, authorization weakening or test suppression.
- Blocking environment action: review/save/publish the already saved cloud network draft for Tavus API/docs and blocked GitHub log host. Saving the draft did not activate it. Repo Actions secret-public-key read is also 403; never put keys into workflow inputs. Tavus keys remain private mode-600 files, one entitled key only. No paid video/session or avatar-success claim.

## LATEST RELEASE HOLD — exact CI error reproduced and fixed locally — 2026-10-12 08:27 UTC

- Integrated PR #14: `69e6644a1961a86bf0b6e5c5e9afd0fd461fb667`; its corrected source `d493e7db` passed CI `38214769523`. CI-lane PR #15 passed `38216327222`, merged as `d1266802c5644bb6a342807e664654d5b2456476`; that branch's push run `38217786515` also passed. Code trees match. Production remains all-four-success `fdf047457550b8aef23fed3adc710b1e8fe2b113`, unchanged rollback baseline; no migration.
- Deployment PR #16 is HELD because run `38217979145` failed despite 12,933 passing tests / 1 skipped: **one uncaught ReferenceError: window is not defined**, `apps/web/src/features/q/wire.ts:70`, after `q-chat-reply.test.tsx` teardown. This is a real delayed warm-up lifecycle defect, not either original PR #14 assertion. Do not merge based on the other green run or suppress unhandled errors.
- Own fix branch `codex/q-warm-lifecycle-fix`: warm-up retains the browser that scheduled it rather than looking up a disappearing/replaced global. The 500 ms delay, idle behavior, fail-closed schemas and explicit-load fast path are preserved. Both new lifecycle regressions fail against the original code; corrected 15 tests across lifecycle, real wire schemas and Q chat reply PASS. Root/web types, eslint/prettier PASS. Existing package dist was rebuilt successfully (52/52). CI now uses both the default and native github-actions Vitest reporters; same tests/assertions, useful failure annotations without relying on blocked log downloads. New exact CI/deployment still required.
- Failed CI evidence recovered via a bounded native GitHub read-only diagnostic because cloud proxy blocks `results-receiver.actions.githubusercontent.com`. Private local excerpt `/tmp/cq-pr16-complete-failure-evidence.txt`; successful evidence job `114719857372` in run `38221882811`. Diagnostic-only branch `codex/ci-failure-evidence` / `c8424bd30cfe1de8a54c4b8f321ab43641e86742` is NOT for promotion/deployment. Its extra normal jobs were canceled after evidence extraction; diagnostic cancellation is not a release check. The exploratory local full run was stopped after the exact regression was reproduced; no local full-pass claim.
- Protected independent product branch `codex/workforce-tavus-integration` / `0d6c91a7c12b9e4a9025e89a7fbcc8a030df17d2`: real READY document links/viewer in Work, strengthened real workforce acceptance, existing fictional-session option and Tavus 180-second provider-boundary guard. Local package builds, targeted tests and root/q-api/web types/lint/format pass; NOT CI GREEN, DEPLOYED or LIVE VERIFIED. Additional pending diligence-card Work projection and original-conversation continuation still require implementation/verification. Do not mark full agent legion accepted from status-only DONE.
- NEXT: commit/push and CI-gate the warm lifecycle correction, integrate/promote it using normal protected lanes, replace the held deployment promotion with the corrected head, confirm all four services and run actual workforce memo/critique/revision/PDF/pending-card acceptance. Keep no outward-send approvals in the acceptance automation. Then complete native Work approval visibility and browser deliverables/context checks, and continue measured latency/Tavus integration.
- Tavus keys remain in private `/workspace/cq-secrets/tavus-keys.json` (600), never Git; use one entitled account key, no quota-bypassing rotation. Live Tavus is transport BLOCKED. Saved network draft preserves existing domains and includes Tavus docs/API plus GitHub's results receiver; user review/save/publish still required, not performed by a draft save. No paid video session or video-success claim. Do not rebuild Q, the workforce, documents, voice or production scoring.

## LATEST RELEASE HOLD / product continuation — 2026-10-12 07:46 UTC

- PR #14 MERGED after exact `d493e7db` CI `38214769523` quality + pgTAP SUCCESS; integration merge `69e6644a1961a86bf0b6e5c5e9afd0fd461fb667`. PR #15 also passed exact CI `38216327222`, merged to CI lane as `d1266802c5644bb6a342807e664654d5b2456476`. All three trees equal `a2ffb0f00d6648e2bdb4be8ce7a4c6a2a128f6b3`.
- Deployment promotion PR #16 is ON HOLD. Its exact head `d1266802` has CI-lane push run `38217786515` quality/pgTAP SUCCESS, but PR run `38217979145` Test FAILURE and quality FAILURE. Do not merge/deploy or treat the separate green run as acceptance. Investigate the actual failure; no retry-until-green or weakened checks.
- Production remains all-four-success `fdf047457550b8aef23fed3adc710b1e8fe2b113`, the current rollback baseline. No migrations. Full live memo acceptance still awaits release.
- CI log fetches fail at cloud proxy host `results-receiver.actions.githubusercontent.com`; available GitHub annotations only report exit 1. Saved network draft adds that exact host, preserving existing Tavus/Deepgram/domains; still requires user review/save/publish. Next alternative: one bounded read-only GitHub Actions diagnostic on a separate non-deployment branch, recover failing-test excerpt through GitHub annotations, fix/reproduce/gate normally.
- Independent branch `codex/workforce-tavus-integration`: Work previously had no artifact references and hides completed step logs. IMPLEMENTED canonical document projection from owner-scoped durable results, fresh actor resolution, existing artifact service and real matching READY version, deduplicated preparation/review artifacts. Existing lazy ArtifactViewer opens documents from completed jobs and retains its Q edit path; Open stays SSR-disabled until hydration. Revoked/unreadable/PREPARING/broken-pointer results cannot be offered as completed documents; their absence is visible rather than silently dropped. No duplicate document service, extra model call, schema migration or raw memo body in the Work DTO.
- LOCAL TESTED: 52 package builds; 51 targeted server/Work/document/cap tests PASS; corrected branded fixture final 19-test rerun PASS and strengthened cross-tenant 16-test rerun PASS. Root/q-api/web typechecks PASS; changed eslint/format PASS. Four new deliverable regressions fail against the original read implementation and pass afterward. Existing run-log suite emits a React suspended-resource warning; it does not fail. New Work projection is NOT CI GREEN, DEPLOYED or LIVE VERIFIED.
- Still required for full workforce product acceptance: persisted memo/critic/revision/PDF/card checks, real Work Open/viewer, original-conversation follow-up and appropriate revision. Additional CODE OBSERVED Work gap: diligence cards are filed in the canonical Approval Engine but are not outward-draft records; existing Work needsYou reads drafts only, so add a fresh-authorized projection of those native cards and retain human approval. Do not automatically approve/send them.
- Tavus: supplied keys remain only in private file, one account key. Duration cap tests pass, but UI/bridge/lifecycle/avatar acceptance is unfinished; provider API remains cloud-transport BLOCKED and current PAL-vs-persona contract must be verified. Continue useful product work while blocked; no claim that the dormant adapter is a working video rehearsal.

## Current takeover checkpoint — 2026-10-12 07:10 UTC

- PR #14 updated to `d493e7db1f43bf73de12906e659db1c7e5e70a70`, preserved on `codex/takeover-release-pr14`. Exact CI `38214769523`: format/lint, types, build and pgTAP SUCCESS; full tests running. Production remains all-four-success `fdf047457550b8aef23fed3adc710b1e8fe2b113`. Do not deploy before exact quality + database pass.
- Independent continuation branch `codex/workforce-tavus-integration` carries a stronger actual acceptance runner: requires tenant/owner/run-bound persisted queue results, real sources, named-company READY memo/current version/history, real independent critique, material revision, dependency ordering, a valid rendered PDF and a PENDING unexecuted founder diligence card. Status-only DONE is no longer acceptance. Raw receipts stay in mode-700 temporary directories with mode-600 files, outside Git.
- Acceptance sign-in supports an existing `CQ_SESSION_FILE`, checked against Supabase's authenticated user endpoint for the exact expected fictional account; password sign-in remains available. Positive existing-account sign-in and wrong-account refusal are LIVE VERIFIED; no new account, email or role change. Existing-account refresh helper and the session are private under `/workspace/cq-secrets`; don't commit them.
- Reproduction after deployment: `CQ_PUBLIC_JSON=/workspace/cq-secrets/public-config.json CQ_SESSION_FILE=/workspace/cq-secrets/workforce-session.json CQ_SUPABASE_MANAGEMENT_TOKEN_FILE=/workspace/cq-secrets/supabase.token NODE_USE_ENV_PROXY=1 node scripts/handoff/live/workforce-acceptance.mjs --approve`. It approves only its own exact team-job plan. Diligence cards remain pending; no outward messages are authorized by this runner.
- Tavus adapter now rejects non-integer, zero/negative or >180-second sessions before any provider request. Nine adapter tests PASS; q-api types and changed eslint/format PASS. No video UI/bridge/lifecycle integration or live avatar acceptance claim. Provider API is cloud-proxy BLOCKED; saved network draft still requires publishing. The public provider-owned persona reference on GitHub uses `/v2/personas`/`persona_id`/`default_replica_id` (January snapshot), while the dormant adapter uses `/v2/pals`/`pal_id`/`face_id`; verify current provider contract when HTTPS access works rather than blindly guessing or retrying paid requests.
- Next: finish PR #14 CI/merge/promote/verify exact Railway release, then the strengthened workforce runner and real-browser deliverable/continued-conversation checks. If Tavus transport remains blocked, continue independent measured live product improvements; never claim test-mode or a static adapter is a working video rehearsal.

## LATEST STATUS — Codex takeover / PR #14 two failures corrected locally — 2026-10-12 06:20 UTC

- Owner: Codex, branch `codex/takeover-release-pr14`, based on PR #14 head `3a0aea343b8a16cb1dd47c494f4b4e0907cf1d52`. Claude's branch is preserved; no second platform or competing release. Controlling user takeover document is preserved in [session-directives/2026-10-12-engineering-takeover.txt](session-directives/2026-10-12-engineering-takeover.txt).
- Fresh remote lanes: integrated `9a2e89a3c6bea619f3c48ceffcda080d6d3a01d1`, CI `f829a5d1bf301fa4f595370e368e4810a742868a`, deployed `fdf047457550b8aef23fed3adc710b1e8fe2b113`. All four Railway services SUCCESS at deployed SHA; rollback that verified release until the new gate/rollout passes. No migration in this slice.
- PR #14 exact failed run `38208967641`: two failures reproduced locally (19 passed). Preserve new Cheque compatibility wording, 8,000-character document findings, attributed round terms, disclosure boundaries and superseded-run CI behavior.
- LOCAL TESTED correction: stale wording assertion updated; compact comparison fallback repeats only code-derived scores, retaining unknown bands and the unknown-not-negative rule. Complete typed profiles, reasons, bands, confidence, ordering and source/raise data are unchanged. Tool max 32,000 and regression headroom target 31,000 remain unchanged; the ten-profile test now passes and still deep-compares every profile and refuses truly oversized results. No scoring change or original research truncation.
- Gates: 52 package builds PASS; 79 tests across natural conversation, fit tools, discovery fit, document jobs and workforce documents PASS; root, q-api and web types PASS; changed eslint/prettier PASS. New exact CI and live workforce chain acceptance remain pending; do not call the memo fixed live yet.
- NEXT: push the focused PR #14 correction, require exact quality + database green, merge/promote through established lanes, verify all four Railway service revisions, then use `workforce-acceptance.mjs --approve` with existing fictional accounts and verify persisted READY memo, real critique/revision, diligence card PENDING and rendered deliverables. Approve only the exact team-job plan; never approve/send the founder-contact card.
- Tavus keys: six supplied keys stored only in private `/workspace/cq-secrets/tavus-keys.json` mode 600, outside Git. Use one entitled account key; no pooling/failover to evade quota. Do not print or commit values. Existing dormant adapter and ADR 0066 are the reuse path; integration not implemented/live verified yet.
- ENVIRONMENT BLOCKER: `tavusapi.com` currently fails at the cloud proxy with HTTP tunnel 403 before reaching provider. Saved network-only configuration draft adds `tavusapi.com` and `docs.tavus.io` while retaining every existing domain; `requires_publish=true`. User must review/save/publish environment settings. Saving does not activate it. Continue independent workforce/release work; no paid video session attempted.

## LATEST STATUS — PR #8 live; workforce memo step failing; fit evidence in PR #11 — 2026-10-12 04:50 UTC

**Deployed (service level).** PR #8 is merged. It moved through the lanes as follows:

- `build/int-rc` `368c0e10`
- CI lane via PR #9: `d9d19eb1`
- deploy lane via PR #10: `6600e61d`

All four Railway services report SUCCESS at `6600e61d`. Rollback point: `f23583ad`.

PR #8 contents:

- TURN_READER v49 `teamJob`, which reads delegation from meaning;
- honest messages when planning fails;
- CI quality checks run as parallel jobs behind one `quality` gate (about 16.5 min, down from about 29).

**Workforce acceptance (live, `6600e61d`): FAIL at the memo step.**

- Planning:
  - First Q text came after 10.1 s.
  - The plan card holds four steps: Research → Documents memo → Reviewer critique and revision → Diligence card.
  - The card was approved.
- Research: DONE in 23.7 s, with 5 public sources.
- Documents (named-company MEMO): FAILED in 1.3 s with "The document could not be prepared."
  - No artifact row was written (checked by read-only SQL).
  - No log was written, because both failure paths were silent. They now log in PR #11.
- Reviewer and Diligence: SKIPPED, because they depend on the memo.
- The run was `5f89cc59`, job `226d21f4`.

**Next for this:** release PR #11 → rerun `CQ_WORKFORCE_RUN=<new run> workforce-acceptance.mjs --approve` → read the `workforce document preparation threw` / `was not prepared` log → fix the root cause → rerun until it PASSes.

Suspects:

- the artifact `authorise` subject or plan check;
- `DocumentJobInputSchema` / `QArtifactContentSchema` parse of a named-company MEMO;
- `jobs.enqueue`.

**PR [neo1415/q#11](https://github.com/neo1415/q/pull/11) (LOCAL TESTED: 9,051 tests; root/q-api/web tsc 0; lint and format clean):**

- Fit stated round context:
  - pitch raise plus the deck's confirmed "The ask", attributed and flagged `stated`, never scored;
  - the pinned digest is unchanged.
- Lead requirement stays unknown, and the sentence says so.
- Shared `deckAskTerms` helper.
- FIT_Q_VIEW v3: reads the stated facts and asks only open questions.
- Progressive disclosure on the fit panel, Q's view, the raise fold and Questions to investigate.
- Workforce: failure logging, a card summary that ends on a word, a short Q lead-in.
- `profile-capture.mjs`: a read-only profile capture as the fictional investor.

**Live "before" evidence (Tensorgate as Savanna Seed):**

- The fit read "Cheque size: Unknown" and "Round: Unknown" (reasons "Round size not shared." and "Round terms not shared.").
- Q's unknowns asked for the round size and terms.
- The deck's confirmed THE_ASK states $4m, a post-money SAFE, a $30m cap and a $100k minimum cheque, with committed investors absent.

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

## October 13 independent voice reliability checkpoint

The cumulative active-speech guard is preserved on pushed `codex/oct13-voice-trial-guard` (`5d748085`), based on `6f47fd5d`. See [VOICE-TRIAL-DURABLE-GUARD.md](VOICE-TRIAL-DURABLE-GUARD.md). Existing unfinished source was also backed up as WIP `71518a20` on `codex/voice-trial-audit-takeover`. The continuation restores the strict concurrent-consumption regression, requires bounded confirmed observer readiness before SDP, checks observation again after context reads, and flushes replacement accounting across owned tenant contexts. Package-build and fresh local gates are pending at this checkpoint; no CI-green, migration-applied, deployed or live-verification claim. Migration `20261222170000` remains unapplied. Tavus and independent product release ownership remain with the root engineer.

## October 14 active takeover

GateQ second-answer supersession repair: `codex/gateq-supersession-fix-oct14`; real PostgreSQL and concurrent retry proof pending. PR74 merged separately at96d26b95, protected CI38516516121 PASS. Relationship Hub design review PR75 pushed444070cd, screenshots/videos verified; no production CRM authorization. See STATE top for exact deploy baseline.

## October14 release checkpoint

GateQ correction source merged f584f0bb with exact CI38520775540 fully green. Hosted fix-forward migration241000 applied/read back;211 recorded, none pending. Release77 at75deba0d waits only test/quality; no deployment yet. Saved authorized founder application reproduced real500 and retains original5facts. Next: gated promotion, service revision readback, live two-answer correction/retry and provenance/history check. Design75 latest1d49922a: four playable videos/76screens/a11y checks pass, formatting repaired; fullCI pending. No production CRM approval.

## October14 cold-opening blocker

Original fact correction is deployed23a65ce3 across four SUCCESS services and real first/second interview corrections/retry passed. Newly found cold opening500 is separate: seven-character historical opening key written to8–128-character legacy session slot after transcript commit. Source repair on codex/gateq-opening-cache-fix-oct14 preserves durable key and valid legacy fallback;121 tests/22pgTAP pass. ExactCI/release/fresh cold live acceptance pending. Design75 latestaac14fd0 fixes scoped lint and audit harness; fullCI pending, no production CRM.

### Unicorn release continuation — 17 October, 22:29 UTC

PR217 / `codex/unicorn-qfiles-oct17`: locale failure repaired; canonical structured-input repair and UUID/current-vs-historical source guard implemented. Full hosted461 audit, package/root/app gates, exact-head protected CI, normal integration/production gates, unapplied28200000+28201500,43scoped ACCESS grants, paced backfill and actual investor/founder desktop/mobile/Q/Discover/denial acceptance remain. No release claim; Home Q files/public web paused. See workstreams/UNICORN-QFILES-OCT17.md.

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
