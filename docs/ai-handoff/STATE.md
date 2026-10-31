# Capital Q — Current shared engineering state

## DEPLOYED 656719a90 — 31 October 2026, 17:11 UTC (Claude coordinator)

- **All four services** on `656719a90` (`recovery/2026-09-12`, `build/int-rc`); CI green (run 1722). Integration branch `fix/resume-asking`. Hosted migrations 268/268 (latest `20261231210000` investor onboarding v3, "Not sure yet").
- **Live-verified on this deploy (fresh fictional accounts):** investor geography/exclusions saved in full and merged on later additions; founder onboarding MVP 1–6 (paraphrase→confirm→save, skips, read-back), typed reply median ~3.6 s; "IC memo on X" runs the researched job with stages (~3.5 min); founder one-pager stays quick; Discover captions clear of the name at 390/360; AI presenter label shown; in-region pitches first when geography is strong.
- **Known open (not fixed at handoff):** see HANDOFF-LOG 2026-10-31 evening. Two worker branches were in flight: `fix/onb-8` (sector "industrial automation" dropped — TAXONOMY_CHOICE named 0; B2B "recurring revenue" → Consumer Subscription; traction missing from founder read-back; "skip the rest" completes at ~26 s) and `fix/memo-10` (research plan output truncated → degraded research with no competitors; set-aside namesake pages listed under "sources this document cites"; a risk line with a removed name; one-pager first text 6.8 s). Neither is merged or deployed unless a later entry says so.

## DEPLOYED 68ab54317 — 31 October 2026, 03:45 UTC (Claude coordinator, owner's standing permission)

- **All four services** pushed on `68ab54317` (`recovery/2026-09-12`, `build/int-rc`); CI green (run 1710). Integration branch `fix/resume-asking`.
- **Hosted migrations 267/267**: `20261231180000` geography ISO countries (270 nodes, v5), `20261231190000` founder onboarding v8 (country from the geography taxonomy), `20261231201000` run-event visible stages widened (planning stages).
- **MVP bar:** `docs/ai-handoff/MVP-DEFINITION.md` (owner 2026-10-30). Live acceptance on 4bcfa584b and re-checks on 91b19d615 recorded in HANDOFF-LOG; final re-check on 68ab54317 in progress.
- **Active prompts of note:** PLAN_WRITE v5, PLAN_REVIEW v8, TURN_READER v74, onboarding transcript reader v9 (stated vs inferred), typed reply v4.
- **Owner decisions kept:** an unfinished setup lands on Home, which offers it back (2026-10-16); cities are not collected (2026-10-30).
- **Open owner question:** a "Not sure yet" option for investor "actively investing" (required step); until then "I don't know" is stored as that text.

## DEPLOYED 891425cbe — 30 October 2026, 06:15 UTC (Claude coordinator, overnight clean-up, owner's standing permission)

- **Railway:** api, q-api, web, workers SUCCESS at `891425cbe` (`build/int-rc` = `recovery/2026-09-12` = `fix/resume-asking`). CI 41009711911 green. No migrations overnight (hosted 264).
- **Overnight deploys (all CI green):** `ed9be6cc4` → `d64b9da7a` → `4d71bcf74` (q-api needed one redeploy: first start failed with no logs) → `e442748a3` → `841f413d8` → `891425cbe`.
- **Live-verified on production overnight (fictional accounts):**
  - Deep research end to end: Nigeria B2B payments report saved and opens, 16/16 citations resolve, sector scope, 26 searches, 6 primary sources, no `agent_work_queue` constraint error (the results-cap bug).
  - Founder 12-month financial model .xlsx: Model/Assumptions/Sources, own figures, projections labelled ESTIMATE.
  - "What should I do today?" answered in about 11 s, no plan job.
  - "Take me to my mandate" in about 1.8 s; IC memo uses the declared mandate.
  - "Update my investors" goes to the single connected investor and stops at approval; the new approval card is last on screen.
  - Onboarding: tap-to-finish, Eindhoven→NL, traction blanks, finish → /verification → profile (owner direction 2026-10-02), read-back built from the record.
- **Research acceptance gate:** cases A, B, C, E and F recorded and committed (all checks pass, replay green in CI). D (Lagos) and G (Kenya) are not committed: D's planner was truncated (fixed since) and G drifts on replay (needs a capture-enabled record). Recording is PAUSED: Serper 402 (credits), Tavily 432, ScrapingBee 401; only Brave works.
- **Systemic fixes:**
  - empty prompt fields have one table (`packages/q-core/src/prompts/empty-cases.ts`), and a test fails on a new empty-case rule without an entry;
  - output ceilings sized from production usage; a cut-off answer is retried with 2× room;
  - onboarding session writes go through one chain (`apps/q-api/src/voice/session-writes.ts`, with a no-bypass test);
  - readers see option labels with opaque ids;
  - swallowed onboarding errors are now logged.
- **Open:**
  - plans reach 92/92, not 99 (fix lane `fix/plan-99`);
  - the onboarding recheck on 891425cbe is in progress;
  - profile answer editor writes are outside the session chain;
  - no Food/Water/Utilities taxonomy entries;
  - "the supplied evidence" is replaced in code, pending a recorded ANALYSIS_WRITE change;
  - ANALYSIS_WRITE first draft still renders the review as "(not provided)" (recorded prompt).
- **Owner decisions parked (owner 2026-10-30: "for now, I don't care"):** a revenue question for pilot-stage founders (needs a migration); offering deck burn/cash back in onboarding.
- **Test accounts created overnight:** about 10 `@maxxspace.com` (mail.tm) fictional accounts from the onboarding sweeps, plus `founder.resume-1029@fictional.capitalq.local`.

## DEPLOYED ee1f98792 — 29 October 2026, 20:40 UTC (Claude coordinator, owner's standing permission)

- **Railway:** api, q-api, web, workers SUCCESS at `ee1f98792` (`build/int-rc` = `recovery/2026-09-12`). CI run 40941548864 green. No migration in this deploy (hosted 264).
- **In this deploy (since db3abc52f):** typed onboarding resumes on the question it asked (ONBOARDING_TYPED_REPLY v3); two-step verification (TOTP, Settings → Security, /auth/two-step; api/q-api refuse an aal1 token of a user with a verified factor, in `packages/security` session liveness); resend for unconfirmed email; Home keeps Talk to Q above the composer; deep research on the situation dossier + RESEARCH_BRIEF v1 (egress from the brief's public terms); a shared (TOGETHER) plan step waits on the person's board item (WAITING_YOU) instead of Done; a plan's approval card shows as soon as Execute prepares it.
- **Live verified on ee1f98792 (fictional `founder.resume-1029`):** two-step on → API `/v1/me` aal1 401, aal2 200 → fresh password sign-in goes to /auth/two-step, /home redirects there until the code → off again. Resume: reopened setup asked the open question. Evidence: scratchpad `twostep/`, `resume/`.
- **Hosted auth config (2026-10-29):** `mailer_autoconfirm=false` (email verification ON, live-tested: sign-up → check-email → unconfirmed sign-in says confirm + resend → Brevo email in ~2 s → link lands on /welcome signed in); `password_min_length=8`; leaked-password protection on; MFA enrolled/removed notification emails on. Sender is still the Gmail address via Brevo (rewritten to brevosend.com): move to the owner's domain with SPF/DKIM/DMARC once bought; turn off Brevo click tracking for auth emails.
- **Integrated, in CI, not deployed:** `dfb93de82` on `recovery/2026-09-12-8y2j4w` — deep research case-A fixes (RESEARCH_BRIEF v2, ANALYSIS_WRITE v6, RESEARCH_FACTS v4: facts only from pages read, one primary-source re-read, every query carries the market's place, planner sees only public selected facts, Capital Q records never cited [S n] (clause-level), MANDATE facts to the job plan) and the recorder keeping an abandoned read as TIMEOUT. Case A recorded live at 18/18 code checks; replay is not yet deterministic (time-dependent paths) — lane `fix/research-replay` in progress; no fixtures committed.
- **Test accounts left on production:** two throwaway `@maxxspace.com` accounts (mail delivery tests) and `founder.resume-1029@fictional.capitalq.local`.

## DEPLOYED 29759dfe0 — 29 October 2026, 07:59 UTC (Claude coordinator, owner's standing permission)

- **Railway:** api, q-api, web, workers SUCCESS at `29759dfe0` (`speed/q-oct20` = `build/int-rc` = both `recovery/*`). CI run 40833861267 green (build, typecheck, format+lint, test, pgTAP, quality).
- **Hosted migrations:** `20261231150000_q_plans` applied 2026-10-29 03:58 UTC; hosted 262/262.
- **In this deploy (since f87847eac):** planning (situation dossier, plan job, two reviews, Execute/board/reminders, team thread) with the live-run fixes (board keys UUID, PLAN v2 schemas tolerant of overlong lists, EVIDENCE_SYNTHESIS with reasoning, reader v71 routing); local figure extraction for highly confidential financial documents; Excel/xlsx fixes; typed onboarding fixes (sectors, cheque history, Finish, read-back); stress fixes (held-back documents named, investor chat reads a shared deck on the company page in any language, relationship history, named-company fit line); a settled onboarding answer changes only on words said after it; `read_my_record` carries held-back documents; highly confidential stated figures never reach a plan.
- **Search providers (probed 2026-10-29 07:50):** Brave OK; q-api `SERP_API_KEY` is a serper.dev key with credit; workers `SERP_API_KEY` is a different serper.dev key with no credit; `RESERP_API` is refused by serper.dev and SerpApi and is not read by code; Tavily 432 (credit); ScrapingBee 401. Owner asked to fix the variables (see HANDOFF-LOG).
- **Live verification of 29759dfe0:** running (planning re-run, F03, investor plan, CFO, S02-F, onboarding role). Evidence: scratchpad `live-run/plan-2`.

## DEPLOYED 77068698d — 22 October 2026, 22:21 UTC (Claude coordinator, owner's go)

- **Railway:** all four services are SUCCESS at `77068698d` (`speed/q-oct20` = `build/int-rc` = both `recovery/*`). CI was green on the same tree before the int-rc visibility fix merge; that fix was checked locally with web tsc, eslint and its tests.
- **Hosted migrations applied:** 20261228214500, 20261229090000 and 20261229100000; hosted is now at 252/252.
- **Live checks:**
  - sign-in 200; api and q-api /health/ready 200;
  - protected pages 307 to sign-in; /dev pages 404; story media served with immutable caching;
  - smoke 8/8 (founder.maji-loop);
  - Q Pitch page shows the Everyone/Investors/Founders picker;
  - "pitch to an investor" typed in Q starts the investor edition (live);
  - attachment-only Send enabled, and Q answers from the document (live).
- **Incident:** from 17:37 to about 22:35 UTC every model call failed. OpenAI returned AUTHENTICATION (the key on Railway was revoked) and Gemini returned PERMANENT. The cool-down marked both providers failing, so Q answered "Q isn't available". OpenAI is succeeding again since 22:35; Gemini was still PERMANENT at 22:24, unverified since.
- **Not done:**
  - the hosted Capital Q seed (needs SUPABASE_SECRET_KEY);
  - David's /pitch/new upload;
  - Zino's headshot and the team's emails;
  - the Q Pitch page intro still says "internal rehearsal until the owner approves" (stale copy).

## speed/q-oct20 ready to deploy — 22 October 2026, 07:52 UTC (Claude coordinator)

- **CI fully green** at `0be7ce681`, run 39740513923 on #267 (build, typecheck, format+lint, test, pgTAP including 521 person_q_card and 984, quality).
- **Not deployed:** Railway is still in a platform outage. Deploying needs the owner's explicit OK.
- **Migrations to apply before the code:** `20261228214500_onboarding_interview_readings` and `20261229090000_person_q_card`. `20261228210000` is already applied.
- **Contents:**
  - the speed lanes 1–8;
  - the Q Story engine, with the Lily voice, the live ending, "pitch yourself" from anywhere, and the tier 1 + tier 2 spoken Q&A matcher (vectors committed);
  - the Q Card redesign and the person card;
  - uploads (Send works on an attachment alone; Q reads the document);
  - parallel answer extras (`CQ_Q_PARALLEL_EXTRAS=off` switches them off).
- **Master video:** `qstory/engine` c21127229, `docs/ai-handoff/evidence/q-story/master/`, sent to the owner. It carries the "Internal rehearsal" stamp until the owner approves AUDIENCE.

## Speed / quality / Q Story integration — 21 October 2026, 21:05 UTC (Claude coordinator)

**Integration branch:** `speed/q-oct20`, which is NOT build/int-rc. It merged build/int-rc at 13b170a3. Draft PR #267 into build/int-rc is used for Linux CI.

- **Last fully green CI:** 75b6b4cf. Newer heads are running; GitGuardian false positive incident 38820384, which the owner is leaving alone.
- **Nothing is deployed:** production is still `93c336aeb` on all four Railway services. Railway's platform build outage started 07:24 UTC today; builds are returning in stages.
- **Owner OK is required** before merging into build/int-rc or deploying.

**Merged into speed/q-oct20 (each reviewed, built and tested locally):**

- arrival round 1;
- onboarding #275 + #285;
- artifacts #277/#283/#288/#290 (single working line, document progress, CLS 0, neutral cards, progressive findings);
- turn latency #282/#287 and rounds 6–7 (first words: one-company 1.2 s; web search, known company, 7.8 → 1.2 s; the per-person, per-scope "what Q knows" read cache);
- voices/meetings #274/#293 (ElevenLabs key under both names; the face starts when a person joins);
- meeting face #280/#295 (greeting, MEETING_HOST_TURN v6, camera mode behind config);
- instant navigation #286/#292 (code-first context resolution, modal on every page);
- Q Story: the story verbatim (`docs/specs/q-pitch/story/`), plan `docs/specs/q-pitch/Q-STORY-PLAN-2026-10-21.md`, investor Q&A #294/#296 (94 entries), presence figures #297.

**Binding owner directions today:**

- Q IS GOLD (black_gold preset; the blue base tokens are the alternative preset);
- what Q knows, Q knows;
- time to first word matters, not total length;
- never cut important work for speed;
- the story words are verbatim.

**Credentials:** the Supabase management token and Railway workspace token supplied 21 Oct work. They belong in the environment secrets. **Do not revoke them.** Reading production secret values from Railway is refused by the sandbox, so provider keys must be environment secrets.

**Open on the owner:**

- Gemini returns 402 in this environment; check billing. Lane 4 is adding a provider cool-down regardless.
- Meeting: the Google Workspace "Capital Q" account (tomorrow), `CQ_MEETING_FACE_ID` (Darius `r4ba1277e4fb`, or `rccbeedfc684` on Phoenix-4.5), and raising the face length in both places together.
- 16 investor-Q&A facts (`docs/specs/q-pitch/story/INVESTOR-QA.md`).

## Chosen designs, black-and-gold, organisation roles — 22 October 2026, 06:05 UTC (Claude)

- **Release:** de5728338 is green in CI39709842207 (tests, build, typecheck, lint, pgTAP). **DEPLOYED on 2026-10-22 at 17:20 UTC:** all four Railway services are SUCCESS at de5728338. Railway resumed builds around 17:03 UTC.
- **Live checks:**
  - `/auth/sign-in` returns 200, and api and q-api `/health/ready` return 200.
  - The brand accent is #8a6a12 / #c9a227.
  - `.cq-explore-tile` has border-radius 0.
  - `/settings/activity` returns 307 to sign-in when signed out.
  - `/dev/*-review` pages return 404.
  - `/v1/me/capabilities` returns 401 without auth.
  - Signed-in role checks are still to do: they need demo-account credentials.
- **Fallback host:** prepared on branch `deploy/fly` (Fly.io for api, q-api and workers; Vercel or Fly for web). The Fly account needs a card. Vercel Hobby hit its 5,000 uploads/day limit. The `capital-q-web` Vercel project exists with its env vars set.
- **Railway:** a platform outage (since 2026-10-21) pauses every build. API deploys answer "Deploys have been paused due to an upstream issue", and GitHub auto-deploy does not fire.
  - Live is still 93c336aeb on all four services.
  - The token in the environment and the one pasted on 2026-10-20 are dead.
  - A replacement token is held outside the repo.
- **Migration:** 20261228210000_organisation_activity_capability is applied to hosted (249/249). It is additive: one capability, granted to organisation_admin only.
- **Contents:**
  - The 30 founder-chosen pages: Work, discovery, GateQ and account.
  - Explore video cards square.
  - Prototype option tones removed, so everything uses the black_gold brand preset.
  - Tasks failure state fixed; rehearsal score out of 10.
  - The organisation activity feed and member summary (`/v1/organisation/*`, `/v1/me/capabilities`).
  - Owner, admin and member screens: `/settings/activity`, `/settings/team/[userId]`, the role card, and capability gating.
  - Review pages under `/dev/*-review`, which 404 in production.
- **Founder decisions** (DECISIONS 37–38):
  - Admins never see members' private Q content.
  - The brand is black and gold.
- **Next:** deploy de5728338 as soon as Railway resumes builds, then do live verification (sign-in, the new pages, roles).

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

## Latest acceptance / ownership checkpoint — 18October06:29WAT

**CanonicalAPIrepair is ClaudePR231, NOT our230/232 (withdrawn).** BothpatchesremoveoppositeActorContextimports; blindlymergingbothdeletesALLimportswithouttextconflict. Keep231sole-runtimepath. Rootalternative0aca/9e1ispushedforrecoveryonly; after231integrates, reconcileapps/api/src/main.ts tocanonicalupstreambeforeanynewsourcePR. Own230/232CI runs39100482101/39100544196/39100549036 canceled becausewithdrawn, notbecausegateswerewaived. Directcoordinationcomment231#issuecomment-6246095819 recordsownership.

Unicorncodeisrunningonallfourservices butSHAsnotuniform: web/workers4ef8daecSUCCESS; APIhealthy cfd51ef6 (4efAPIbuildFAILED), q-apihealthy cfd with4efbuilding atlastread. ProtectedUnicornsource/integration/candidateallPASS. Canonical231CI pending. All43auditedexisting-org ACCESSgrants are nowAPPLIED andverified; no paidusage/subscriptionchanges. Schema248applied. Actualworkerbackfill394assessed/0scored/394insufficient,292partial,max33.5% at05:28:48UTC; continueuntilall461.

ActualAPIchecks: premiuminvestor200 persistedINSUFFICIENT/coverage0.335/12pillars; no-mandateinvestor200samepermittedcompanyassessment; nonpremium404withoutpayload; founder directinvestorroute404asintended (ownassessmentthroughGateQ). Secondarycompany200/INSUFFICIENT/coverage0. Existingfounderapplication200andselectedownerapplicationpresent. Authenticatedbrowserharnessisrunning inexplicitinsufficient-evidencemode withQenabled; notyetcertified. FinaluniformSHA/allchecks andrealbrowser/securityscreenshotsstillpending.

## Latest combined-release blocker — 18October06:24WAT

Another engineer promoted PR229 as4ef8daeccbb6f6874cd52f8f2743b6fe7d457ac4 during227rollout. It containscfdUnicorn unchanged plus226/228GateQ/onboarding. Its API build FAILED: TS2300 duplicateActorContext imports atmain.ts2/241, caused bytextualmergeof217/226. ActiveAPI/q-api/workers reachedhealthy cfd51ef6; web still914atlastread while4efbuildsqueue. Do NOTclaimuniform4efdeployment orCIgreen:229candidate39100138762build/typesFAIL; source/integration/candidateUnicorn gates allPASS, oldproductionpush39100042323CANCELED bynew4efrun39100142562.

Runtimefix **0aca7b1470487c41839dc2e4d13dfb6d45d23224** removesonlytheduplicateleadingtypeimport, preservingtheconsolidatedsecurityimport andallnewbehavior. Latestintegration4e131c25d merged into dedicatedsourcebranch; privateBuildlog confirmedexactfailure. Coordination/ownership posted on229 (issuecomments6246050837,6246064155). Awaitnewprotectedrepairgates; donotrollback/overwriteotherengineerwork. Schema248remainsapplied;43ACCESSgrantsstillunapplied; backfill/browseracceptancenotcomplete. Next: gate/releaseone-lineAPIrepair, verifyfinalfourrunningrevisions, grant43 andfinishactualUnicornjourneys.

## Latest Unicorn rollout — 18 October,06:17WAT

PR227 merged normally as **cfd51ef60191e560a4726fa08695712fa62972f9**, after source39098259746, integration39098720633 and candidate39098756517 allpassed everyprotectedgate. Candidateacba and productioncfd have identicaltrees. Source217 prematureintegration was quarantined until allchecks passed; no prematureproductionpromotion. ProductionpushCI39100042323 is running. Both reviewed migrations28200000/28201500 are APPLIED, hosted248/none missing.

AllfourRailway have newcfd rollout entries: workers3900b0db-47c1-4fda-8da6-b3196557c3cd, API ddd84b38-4ac5-4082-8233-78b1a1eee67a, q-api3760c9be-1ec6-42c0-9d86-288343ad06ff BUILDING; web114e027c-512b-452d-8f73-d468f205c0b1 QUEUED atlastread. Do NOT callthese running yet. Prioractiveweb914ae664a; backendthreec36b99bb. Rollbackproduction914ae664a21c53acf4af8ed63abc88d672f72489; retainadditiveschema/history.

43scopedACCESSgrants remainUNAPPLIED. NextverifyallfouractiveSUCCESS cfd, applyauditedgrants, allowexistingpacedworkerbackfill (2minstartupdelay), queryactualassessmentcounts, runcorrectedrealbrowserharness+source/entitlementwithdrawalchecks andinspectdesktop/mobile/screenshots/Qanswers. All461frozeninputs remaininsufficient;342partialcoverage,max33.5%; no numericpositiveproductioncertification. NewGateQ226/610915b3d staysunreleased inintegration, outside227. Operator/helper/docsupdates are pushed on `codex/unicorn-qfiles-oct17` after217; runtimecandidate staysfixed.

## Latest release HOLD — 18 October, 05:56 WAT

- PR217 integrated as **acba6869895001c0cada2817a574f5fa6159beb5** on `build/int-rc`. GitHub merged immediately when auto-merge was requested even though source tests/lint were pending. This was premature; **do not promote production until all source/integration/candidate gates pass**. Never use auto-merge here as a substitute for explicitly reading completed gates.
- Source485d96643 CI39098259746: database/build/typecheck PASS; tests/lint/quality pending at checkpoint. Exact integration acba CI39098720633 on `build/rec-unicorn-oct18`; recovery CI branch was divergent and preserved without force-push. Draft production PR227 (`codex/unicorn-production-oct18@acba`), CI39098756517, is HOLD. No deployment/migration/grant performed by this workstream.
- Active production: web SUCCESS **914ae664a21c53acf4af8ed63abc88d672f72489**; API/q-api/workers SUCCESS **c36b99bb57a31c6946eef85bac0a11122132fae3**. Their newer914 deployment entries are SKIPPED, not running revisions.
- Migration28190000 latest applied; Unicorn28200000 and28201500 UNAPPLIED.43feature-specific ACCESS grants prepared/unapplied. Backfill/Unicorn live journeys pending.119targeted tests, root/allfourapp types and53package builds PASS locally; full protected database PASS.
- Authenticated production baseline: investor company profile200, twoexisting score blocks,7.615s to scored region. No Unicorn visible, as expected. Browser trust uses the repository verified installed-proxy CA pin. CLI rehearsal incorrectly used `/companies`; actual canonical route is `/company/:id`; helper-only correction c8ee0269e is pushed on sourcebranch after217 and is not in releasecandidate. Seven proof tests PASS; use corrected local helper for acceptance.
- Full461snapshot:0scored/461insufficient,342with partial evidence,max33.5%; do not certify numeric score/sort with fixtures. Exact next: finish all three gate runs, mark227ready only after PASS, apply both migrations before code, merge normalprotected release, verify allfourRailway, scopedgrants/pacedbackfill, actual investor/founder/no-mandate/free/Q/Discover/withdrawal browser checks and screenshots. Home files/publicweb paused.

## Latest Unicorn release checkpoint — 18 October, 05:45 WAT

PR217 is OPEN. Prior27c7a17b6 is CI GREEN39075445136; latest narrative/provenance/retraction repairs and integration reconciliation require new exact-head gates. Source branch `codex/unicorn-qfiles-oct17`; latest integrated upstream8693a41ac preserved. Production allfourRailway SUCCESS c36b99bb57a31c6946eef85bac0a11122132fae3. Unicorn is not deployed;28200000/28201500 migrations UNAPPLIED,43scoped grants NOT applied. Frozen461audit:0scored,461insufficient;342have legitimate pillar coverage afterrepair (baseline1), max33.5%, no fabricated scores. See [current workstream](workstreams/UNICORN-QFILES-OCT17.md#resumed-release-checkpoint--18-october-0545-wat) for exact checks, recovery and release sequence. Home files/public web paused.

## Unicorn release continuation — 17 October, 22:29 UTC (latest observed state)

PR217 is still OPEN and Unicorn is not deployed. Continue `codex/unicorn-qfiles-oct17`; latest recovered remote17ea9a33 had CI39072870845 database/types/build/lint PASS, test/quality FAIL on two missing locale labels. Repairs preserve the existing implementation and scoring gates; see [workstream evidence](workstreams/UNICORN-QFILES-OCT17.md#release-repair-checkpoint--17-october-2229-utc). New protected exact-head CI is mandatory before integration/release.

Fresh Railway: allfour services SUCCESS `a70e66a8b82b8df00ca663e9baeeee3f3686959e`. Latest hosted migration20261228190000; Unicorn28200000 and fix-forward28201500 UNAPPLIED.43existing-org feature-specific grants planned, none applied. Full461company before/after audit and actual Unicorn production browser acceptance pending. Do not label this live or start Home file/public-web work. Preserve current Claude Q/Home/GateQ/Q Pitch changes; no wholesale old WIP merges.

## 17 October 2026 — Claude lead (latest; supersedes older sections where they differ)

Production at 07:43 UTC:

| Service      | Commit                                    |
| ------------ | ----------------------------------------- |
| web          | `c3044b70` (AR)                           |
| q-api        | `7161cedb` (AQ)                           |
| api, workers | `a5008502` (AN) or later; unchanged since |

Hosted migrations: 245, none missing; no migrations shipped on 17 October.

| Release | What shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AK      | Hotfix: the founder Capital, Readiness and Action plan pages crashed (server component called client functions); a server/client boundary guard test was added. Live-verified for Harbourline and Ledgerfold.                                                                                                                                                                                                                                                               |
| AL      | Onboarding: "400 mille" scale words, investor first-answer categories, voice `?section=` focus, French read-back.                                                                                                                                                                                                                                                                                                                                                           |
| AM      | Onboarding batch latency (per-request memo, one mandate read), no first-turn 422, receipt-guard fix.                                                                                                                                                                                                                                                                                                                                                                        |
| AN      | Q Pitch v6, both tracks: investor 22 steps, founder 17 steps, and the `/q-pitch/capital-q` 14-section board. The `Q_PITCH` destination, turn-reader v53, typed and spoken step commands with no model call, the Q&A bank, and Discover muted in pitch mode. Onboarding: the no-inference choice guard, the UNTRANSLATED translation guard with a self-healing cache, and a pre-organisation taxonomy read (reference data only, a negative test proves no org-scoped rows). |
| AO      | One mandate update per onboarding batch (savepoint replay on refusal; integration suite 40/40 on local Supabase), read-back labels, and the first Q Pitch trigger fix.                                                                                                                                                                                                                                                                                                      |
| AP      | Onboarding sectors always save, with digits for scale words. Q Pitch: the trigger acts when the request is filed as a question, section lighting on sub-page moves, and the founder board cut to one line per section.                                                                                                                                                                                                                                                      |
| AQ      | The tour starts after Q's client navigation to `?qpitch`. Onboarding: covered steps are not "unsaved", identical re-records write nothing, and Arabic duals.                                                                                                                                                                                                                                                                                                                |
| AR      | A trigger-started tour opens a fresh Home conversation, and each tour move carries its own turn id.                                                                                                                                                                                                                                                                                                                                                                         |

**Q Pitch v6 is PRODUCTION_LIVE_VERIFIED.** See `docs/specs/q-pitch/CERTIFICATION_MANIFEST.md`.

| Track               | Started by      | Steps | Sections lit   |
| ------------------- | --------------- | ----- | -------------- |
| Investor (Savanna)  | French trigger  | 22/22 | 47, none unlit |
| Founder (Babatunde) | English trigger | 17/17 | 51, none unlit |

On both tracks:

- the four step commands work;
- Discover is muted at every check;
- bank answers are instant, with zero Q runs.

Not covered by that certification:

- voice: every run was captions only;
- the Q-to-Q step is a prepared exchange, not a live Tavus session;
- narration is English only.

**Onboarding (English), live on AQ:**

- founder: p50 3.2 s, max 4.2 s, one model round per turn, 17/17 facts saved;
- investor: a 13-fact first answer saves 13/13; the turn takes about 12.6 s and can take two rounds when the model omits a free-text title.

**Language work is paused by the owner** (17 Oct: "as long as english is good").

- `claude/ob1-oct16@061f6426` (Intl-derived currency names and scale words, and the own-words repetition guard) is finished but **held, not released**: it also changes the English currency and scale paths.
- Unfinished Hindi/Swahili work is pushed to `claude/ob1-lang-wip` (one failing test).

Known, not fixed: company and investor photo routes answer a uniform 404 for "no photo", by design. The browser logs it as a console error on CRM and Capital pages. Running `vitest.integration.config.ts` in full shows about 30 failures outside onboarding; CI doesn't run that config, and they have not been triaged.

## 16 October 2026 — Claude lead

All four Railway services are on releases through **AI** (`7059dc30` deploying at 23:08 UTC; AH `4c968c15` on q-api, AG `bb1dc914` on web/api/workers). Hosted migrations: **245 applied, none missing** (latest `20261228183300`). Releases today, all CI-green and deployed:

| Release | What shipped                                                                                                                                                                                                                                               | Migrations                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| T, U    | Design consistency, Q Pitch fixes, planner router v51, stranded approvals                                                                                                                                                                                  | `20261227213000`                                     |
| V       | Q Pitch scene-6 screen-company-first, guide v2 tooling                                                                                                                                                                                                     | —                                                    |
| W       | Tavus for all accounts by default, persona tile labels, billing from provider request; sign-up role choice, workspace chooser, crossover fix, reserved-domain email suppression, investor fund-deck types                                                  | `20261227221500`, `20261228120700`, `20261228121200` |
| X       | Calm login greeting, Instagram Explore with one muted preview player, conversational onboarding (coverage model, held saves, document gating, research anchoring), form parity, Continue later + reminders, preference-learning consent, approval by words | `20261227232000`, `20261227232500`, `20261228133000` |
| Y       | Explore single grant, double-escaped newline decoding, Capital Q synthetic attestation revoked                                                                                                                                                             | `20261228141700`                                     |
| Z       | Onboarding acceptance fixes, approval follow-ups, fund-deck reading (docx), Q Pitch scene 16                                                                                                                                                               | —                                                    |
| AA      | Arabic across the app, RTL, `set_q_language`, Arabic voice/Tavus/GateQ/emails, turn-reader v52, onboarding latency, team facts                                                                                                                             | `20261228101500`                                     |
| AB, AC  | Onboarding live fixes, turn-reader resilience (malformed tool dropped, one correction retry), Lagos/time-zone continuation, fund-deck lists                                                                                                                | —                                                    |
| AD      | Collapsible Needs you, Arabic live fixes, customer-type aliases                                                                                                                                                                                            | `20261228160000`                                     |
| AE      | Any-language setting: Intl registry (183 languages), Settings picker, UI_TRANSLATION cache (USD 2/day cap), translateLines, capability-driven voice/video                                                                                                  | `20261228150500` (applied after code)                |
| AF      | 14-section Overview + Diligence tab, pitch-section readings, Investability/Suitability scores (InvestIQ v2, ADR 0074/0075), founder definition v6, always-save onboarding, any-language code answers                                                       | `20261228171500`, `20261228180500`, `20261228183300` |
| AG      | Hotfix: founder form on v6 (generic step fallback), Overview scroll loop, data-room open state, slate refresh on new scores, Tell Q / `?ask=`                                                                                                              | —                                                    |
| AH      | Onboarding latency (code reply after clean rounds, cached translations), replies in the person's language (typed + voice)                                                                                                                                  | —                                                    |
| AI      | Onboarding save fixes: stated geography/sectors commit, unbacked claims removed, currency beside figures, field-own clauses, resume kept once                                                                                                              | —                                                    |

Live-verified today: Explore, greeting, approvals by words, Tavus for fresh accounts, Arabic and French/Spanish/Swahili language switching, scores on every surface (461/461 companies scored, Discover order follows fit-order.v2), Overview/Diligence/navigation, scroll and data-room fixes, Q Pitch 16/17 scenes. Onboarding: English p50 3.8 s / max 4.8 s on AH; full save acceptance re-run pending on AI.

Owner-only checks outstanding: reconnect Google (owner account shows "Google disconnected"); Q Pitch scene 15 microphone test. Rotate `CQ_SEED_ACCOUNT_PASSWORD` (exposed in chat). Fictional test accounts created today carry `cq_seed` markers (ob2-acceptance, onb-acceptance, arabic-live, lang-live, tavus-fresh) and can be removed by marker.

## Four-lane round — 15 October 2026, 07:10 WAT (Claude lead)

Three releases on 15 October are live and checked against Railway: all four services are on `242460c1`.

| Release | Merged PRs               | Migrations applied to hosted                        |
| ------- | ------------------------ | --------------------------------------------------- |
| A       | #107 → #109 (`04a322ae`) | none                                                |
| B       | #108 → #110 (`c747d651`) | `20261223120000`–`20261223160000`, `20261226200000` |
| C       | #111 → #112 (`242460c1`) | `20261226210000` (hosted 218 = local 218)           |

What each release delivered:

- **CRM (lane C):**
  - Results and Relationships are one **CRM** nav item, titled Investment Hub or Fundraising Hub; `/crm` is an alias.
  - Server-backed saved views.
  - A per-side read model for the pipeline (`network.relationship_party_states`).
  - A time-in-stage strip and the GateQ applications list on each record.
  - The background texture.
  - LIVE VERIFIED: `/relationships`, `/results` and `/crm` for both roles at 1440 and 390.
  - Not done: the read-model backfill script needs direct Postgres, which the sandbox lacks. The API lazily refreshes up to 200 rows per read instead.
- **GateQ (lane G):**
  - PR #98 rebased, plus a cap on the facts a dossier answer may cite.
  - The "Needs clarification" wording.
  - A coverage panel.
  - Guest Evidence custody (PR #97):
    - investors are shown only files with a CLEAN malware scan;
    - a 5 GiB storage cap per gateway;
    - disclosure lineage, which is UNKNOWN and fail-closed when it cannot be established.
  - A fix so the dossier summary is offered for INVESTOR, COUNTERPARTY and GENERAL turns. The production acceptance failed before this fix; the re-run after release C is pending.
  - Tablet lobby LIVE VERIFIED. Video is not offered because q-api has `CQ_TAVUS_TEST_MODE=true`.
- **Q speed (lane S):** baseline `docs/ai-handoff/perf/BASELINE-2026-10-15.md`. Live re-measure:
  - company facts answered by code: 9.4–9.8 s → 1.4–1.9 s;
  - fit ranking and navigation: 0 model calls, with unchanged latency.
  - The S3a re-search fix and S5 refresh-ahead shipped in release C; their measurement is pending.
- **Q Pitch (lane P):**
  - Runtime change record, a 5–7 minute premiere script, the host overlay, gating so only audience voice commands control the tour, and a stale-receipt fix.
  - `CQ_Q_PITCH_TOUR=1` is set on web.
  - Browser-certified: GateQ inbox and the relationship hub.
  - Demo company decision: Option A (private, knowledge pack only).
- **InvestIQ (lane M):**
  - `investiq/v1` runs in shadow mode in `packages/readiness/src/investiq/`, with no consumers. Status: OWNER_DELEGATED_PENDING_CALIBRATION.
  - Documents: `docs/product-sources/investiq/{RECONCILIATION,RESEARCH,CALIBRATION}.md` and ADR 0068 (Proposed).

Open:

- **Batch D (#113):**
  - the GateQ native video interview, flag-gated on api (`CQ_GATEQ_VIDEO_*`), with migration `20261226100000`;
  - the `?item=` deep-link fix;
  - lane S's snapshot round-trip cut, still being merged against the release C read model.
- **Paid Tavus test:** waits for the owner's credit top-up at 09:00 WAT. Seeded accounts for `CQ_TAVUS_PAID_USER_IDS`: Tensorgate's Daniel Park and Laura Bennett (internal ids are in the lane G report; they are not secrets).

## H2 production acceptance — 14 October 2026, 22:33 WAT

This section supersedes older assertions below. Owner override: finish H2 first; preserve failing sibling98/97 and original WIPs.

- PR99 exactefd2b4d9d4b6447a1108067ca4e09fc9521237f1 passed all protected CI38617987342 and merged normally to production **48c6f1e77f15db063c32535423756d017627791e**. Integrationc189985022691362114723bff4ea850f1e29ca10 includes96. Last read: web/API/workers SUCCESS48c6; q-api BUILDING48c6. Production CI38639947138 running; no migration. Rollbackdcb2b107e5d6eba914dd1eb90e34e0245ff8538d lacks H2.
- Deployment IDs: workersfeabbef9-d174-491f-a495-71302c19daf7; API5f1b7e4c-df76-4dbd-a54b-d7bcb80edc79; q-api aa4ef23e-8941-4e08-ad54-033f63746355; web4805358b-685d-487e-a3d1-d7fe05897eb8. No all-four completion claim yet.
- Prior dcb2 CI38611971301 failure annotation pinpoints media.test.ts:368: randomrequestId contained4018 and tripped entire-payload401 ban, although publicstatus503/provider-unavailable was correct. Narrow test repair excludes only opaque requestId; provideridentity/status/code assertions remain.39 affected tests PASS after currentcontracts/networkdist rebuild. Initial local15failures were stale Network error exports, not release defects. Repair and browserdriver are in PR101/dea78870, protected CI pending.
- Actual founderdesktop H2 PASS: canonical2relationships; table/board, pagination, same-scope2-ID selection, exact selected/native CSV, filteredCSV, search/sort/statefilter, saved-view reload/delete, preview/detail/back and no horizontal overflow. Unauthorized org403, stale filter400, foreign selection404. Private `/tmp/cq-hub-h2-live-XG3ovR/outcomes.json`. Founder mobile then encountered a harness strict-selector issue caused by Next's hidden streamed copy, not confirmed product duplication; driver now waits for the visible root. Earlier native-option harness wait corrected to attached state while retaining real reload/selection assertions. Remaining roles/devices/Q controls still pending; no full H2 completion claim.
- Existing authorized investor has9canonicalrecords; no account/relationship creation or seeded fake CRM rows. Script `scripts/handoff/live/relationship-hub-h2-acceptance.mjs`, optionalCQ_HUB_VERIFY_Q=1 creates bounded internal navigation turns, requires actual DONE receipts and completed owned runs; privatefixtures/CSV/screenshots outsideGit.
- Interrupted source preserved as **codex/q-gateq-selected-dossier / ef515bc6**, **codex/hub-h2-canonical-repair-oct14 / 2fc703cc**, both pushed unverifiedWIP. These differ from laterPR98/96; do not merge duplicates wholesale. PR98exact8027487a is OPEN/failing testquality38619760987; Evidence97exactb76a386b separate. No failing sibling merged intoH2.
- Limitations: device-only personal views, no synchronized cloud/team views; bounded1000-row source scan; no H3/H4/PDF/XLSX/fullCRM/voice completion. Multi-organization positive actor not available in currentfixtures; actual invalid-org and foreign-selection rejections are proved. Next: finish allfourRailway and remaining role/device/Q acceptance, then losslessClaudeMax takeover, then98/97 work as capacity permits. Currentcontinuation source is PR101 `codex/hub-h2-production-acceptance-oct14`.

## Verified continuation — 14 October 2026, 19:43 WAT

- Production is **dcb2b107e5d6eba914dd1eb90e34e0245ff8538d**, PR94 merged normally after exact CI38608939221 passed. All four Railway services SUCCESS on this revision; prior72d revisions drained. No migration.
- Fresh native signed-in Maji Loop founder confirmed contact, completed structured form, answered interview, reloaded, explicitly submitted and reached receipt. Investor exact frozen brief retains business model, dated38/96-kiosk traction and150-kiosk use of funds as applicant claims/SELF_REPORTED; revenue UNKNOWN. Exact current submission has3 transcript turns and zero documents. Other investor gateway and dossier reads both404. Opening4116ms; answer7811ms (individual samples, not p50/p95). Transcript browser harness failed on an obsolete exact Q phrase; this is not substantive investor-Q acceptance.
- Selected-dossier Q source repair is implemented on `codex/gateq-investor-q-context`, not deployed or browser-certified: versioned bounded READ payload separate from600-character acknowledgement, exact application/reference/date/schema binding, canonical server authorization, selected source facts independent of overview budget. Dependency build33/33 PASS; selected Q tools28/28 PASS; model-gateway/app-actions13/13 PASS. Changed lint/format gates running/recorded separately. Strict browser driver now verifies refreshed actor and current-run rendered answer. Existing unavailable-content Q defect remains production until release and actual substantive acceptance.
- Hub PR96 exact75cf166c CI38615008776 all protected checks PASS; not yet released or native H2 certified. Server views d7c5ebd7 are separate WIP with migration24120000/pgTAP932 unapplied. Guest Evidence PR97 is separate gated foundation; SQL test/query alias correction in progress, selected-only lineage projection unwired, migrations2312–2315 unapplied. Excluded-document derived facts and Q turns must remain confidential before exposure.
- Preserve prior checkpoints below. Q Pitch untouched. No Tavus room/minutes started.

## Latest continuation checkpoint — 14 October 2026, 17:55 WAT

- Latest integrated branch `build/int-rc`: **80f5cd2551a9aa6061126cfc32653eecf0624a59**. Handoff PR91 passed protected CI **38597949683** and merged normally. Latest handoff branch is `codex/oct14-final-continuity-checkpoint`, PR93; this commit supersedes its earlier checkpoint471ae5cd. Historical entries below retain their original dates and are not current deployment authority.
- **Description fix DEPLOYED, browser acceptance pending:** PR90 candidate **fb882ffa83b86ca191c6bb6d8b6449f651aff1f7**, protected CI **38596902328 PASS**, promoted to `recovery/2026-09-12` **72d626cdebbb2a177734db0a4125bd7b81cd4e9b**. Direct Railway read at16:54UTC confirmed all four services **SUCCESS** on72d: workers `17536021-c250-4c05-ad05-4a132695e813`; API `c99c546f-4496-4190-b738-0f99a3d8dddc`; q-api `66a6fba4-bec4-43d8-ba99-eef98fc9ba3f`; web `de74c6cf-e556-43ac-a1b6-24b4c7c1067e`. No migration. Rollback **71c5d4a58c314eca7981c08265b2e29015bc2b7b** retains GateQ qualification and Hub H1. No fresh description browser proof or historical dossier rewrite claimed.
- **Claim capture IMPLEMENTED / LOCAL TESTED / NOT RELEASED:** PR92, `codex/gateq-claim-capture-oct14`, **08cacfd4861e8212b7a06f2f12e66c08cec4a76f**, clean and pushed. Prompt v2 restricted dimensions to known facts/next six questions. Captured-prompt baseline regression failed1/23. Immutable v3 uses the existing canonical recordable dimension inventory, independently of question priority; typed validation, provenance, retries, frozen submission and historical v1/v2 hashes remain. Local53 package builds, root/API/package types,149 tests across11 files, latest40 focused tests, changed lint/format PASS. Exact CI **38601112916**: typecheck/build/database PASS; format-lint/test still running at16:54UTC; manual e2e SKIPPED. No migration/provider calls or live claim-adherence proof.
- **Investor Q confirmed remaining defect / exact next engineering task:** selected submitted dossier is visible in UI, but Q reports unavailable content (~23.5s reported). No interrupted nine-file repair recovered; clean local `codex/gateq-dossier-q-repair-oct14` is only base1b72e44d, **no implementation**. Frontend already emits selected application focus. Repair `packages/model-gateway/src/q/manifest-fact.ts`: GATEQ_APPLICATION currently hydrates only `read_my(kind=gateq)` inbox metadata. Existing `gateq.inbox.summarise` composes12k source findings, whereas generated AppToolOutputSchema.says caps600. Separate authorized source reading from short action receipt, bind exact submitted application/version, and test foreign actor, pre-submit, stale selection, multiple applications and large findings before actual substantive Q proof. Do not blindly raise every receipt limit or create another Q runtime.
- Confirmed journeys and timing remain the evidence indexed below: production71c founder form/interview/explicit Submit/exact investor dossier/transcript and foreign-investor404; H1 both roles/desktop/mobile/typed Q. Existing operator production samples: navigation push62/7ms, settled heading5.529/3.912s; earlier local samples2/3ms and1.540/2.305s. No new p50/p95, first-audio, Tavus audiovisual, investor-Q or full CRM acceptance claim. Full investor rehearsal reproduction is below; retain failed and incomplete rehearsals.
- Safe WIPs pushed: cloud views **b4a2a68e553b11f8c366aa5d45289f2e542817b2** (50/52 tests PASS; two fixture failures/root types FAIL; migration241100 unapplied); product inventory **aed12b0c232201f262f080fea2897c1adbc5685f** (untested). Canonical H2 **2d9dfa1e** and guest expiry **553316c5** remain starting points. Research86/88 remain CI-green but unreleased and must reconcile newer production before promotion. Do not rebuild CRM, adopt rejected prototype75 CSS, duplicate services, rewrite locked scoring or merge historical guest migrations wholesale.
- Environment: local Next development process was stopped; only its generated514MB cache was removed after ENOSPC. Source, receipts and credentials retained; local browser rehearsals require restarting local web. No new account/environment action established; existing authorized fixtures must be revalidated, and external operator private receipts may not exist here. No credentials/session/private test artifacts committed. Latest full worktree inspection and source preservation are recorded in HANDOFF-LOG.

## Latest lossless checkpoint — 14 October 2026, 17:23 WAT

This checkpoint supersedes dated status claims below. [Latest owner continuation](session-directives/2026-10-14-gateq-hub-continuation.txt) and [consolidated takeover](session-directives/2026-10-14-1500WAT-gateq-hub-takeover.md) govern task priorities, subordinate to locked PADL/Product Specification/Final System Review. Functional Hub is approved with existing UI; rejected prototype75 CSS must not enter production.

### Released, integrated and gated

- Production `recovery/2026-09-12`: **71c5d4a58c314eca7981c08265b2e29015bc2b7b**, allfourRailwaySUCCESS directly refreshed this session. API **14fabee5-bfd9-428a-898e-02d68ad9d25a**; q-api **f558643c-50de-4f5b-8045-8467375aca81**; workers **e8f0f8d5-07be-4038-a37c-f09b5d2959aa**; web **853b7ebb-5814-4322-b19d-fd2165ec5a67**. ProductionCI38556079265 PASS. GateQ83/84 and Hub81/85 included; no new migration applied this session. Rollback71c5 remains available for subsequent releases; earlier37b5414e lacks the qualification repair/Hub.
- Integration `build/int-rc`: **1b72e44dc2dd701dd2800231784f8cefee96de69**. PR89 source **ac6cd481e738a97352eb81c7b197e423fd35c926**, exactCI38572329768 allprotectedPASS, merged. Phrase-based applicant description preserved in frozen brief; inbox preview bounded280. Not deployed.
- Separate PR90 production candidate, `codex/gateq-description-release-takeover-oct14`: **fb882ffa83b86ca191c6bb6d8b6449f651aff1f7**, CI **38596902328 pending**. Source89 alreadygreen; candidate must independently pass quality+database before normal promotion. No migration, scoring change or historical rewrite.
- Earlier GateQ83 exactCI38539226759, release84 exactCI38552751739, reconciledHub81 exactCI38552582766 and release85 exactCI38554347785 allPASS. Manualbrowser job skipped; separate real acceptance below.
- Research source86/6aae43781e910cb959976ac956de596743e968fc CI38554902165 PASS; release88/c8374d6b4b2d3821aa21f592897f5ca79d2813bf CI38555784901 PASS, bothOPEN/unreleased. Secondary priority. Reconcile with89 before promotion to avoid losing its changes. Old acceptance87/4a02425d CI38555416557 PASS, OPEN; new handoff preserves its browser driver without overwriting newer production evidence.

### Product evidence and defects

- Existing engineering handoff/operator evidence reports **production** founder confirmedcontact→four-stepform→adaptiveinterview→reload→explicitSubmit→exactinvestordossier/expandedtranscript PASS on71c5; otherinvestor404 forforeigngateway/dossier. Preserve this completed text slice. This resumed session independently refreshed deployment SHAs; it did not rerun these paid model turns or claim independent recovery of private operator receipts. Zeroattacheddocuments; guestOTP/Evidence/Qdossier analysis not certified.
- Existing handoff reports production H1 investor/founder desktop1440×960/mobile390×844 PASS and typedQ DONEreceipts. Production individual timings: finalwords→push62/7ms, heading5.529/3.912s. Root earlier local real-API H1 fourcases alsoPASS: push2/3ms, heading1.540/2.305s. Private evidence `/tmp/cq-hub-acceptance-N1b5dQ` may exist here; production operator receipts may be in another environment. No p50/p95, firstaudio, fullCRM or Tavus audiovisual certification.
- **Immediate investor-Q defect:** submitted dossier visible inUI but Q claims contentunavailable (~23.5s reported). All accessible worktrees inspected: no interrupted nine-file investor-Q repair found. Existing UI already publishes GATEQ_APPLICATION focus/section/dialog; inspect backend screen read rather than blindly rebuilding UI. Code observed: `gateq.inbox.summarise` composes full `submittedReading()` (12k finding budget plus other context), but generated AppToolOutput.says is capped600. Selectedscreen read must retrieve exact authorized submitted application, not only inbox list. Root has not implemented/validated this repair yet.
- **Claimcapture defect:** next-question dimensions restrict otherwise validrecordable traction/use-of-funds. Decouple factcapture from questionselection, keep canonicalshape/provenance/retries/history/immutableSubmit; test actual frozenclaims. Not fixed.
- GuestEvidence remainsunreleased; do not equateupload withdisclosure, knowledgewithcurrentactorpermissions, orGateQ withinterest/relationship.

### Protected work, branches and limitations

- Canonical nextH2 startingpoint **codex/hub-h2-pipeline / 2d9dfa1ef8687bc4827a70a8070c30f35a1bb97e**, fetchedverified. Substantial27-pathWIP, unverified/unreleased; serverpipeline/filter/cursor/export plus per-device localStorageviews, notcloud/teamviews. Reconcilecurrentint carefully; no secondH2 rewrite.
- Additional recoverable cloudview extension **codex/hub-h2-scoped-views / b4a2a68e** pushed, explicitlyWIP;18files/1339additions. Newunappliedmigration **20261224110000_network_relationship_views.sql** and14plannedpgTAP checks.53packagebuildsPASS;52targetedtests ran50PASS/2FAIL and roottypesFAIL from undefined `RELATIONSHIP_ID` in newAPItests (actual fixture constantRELATIONSHIP). No protectedCI/pgTAP/browser/release. Sourcequery conservativelymarks200-row previsibilitybound aspossiblypartial; do notclaimglobalexhaustiveness/fullH2. Reuse selectedsafecloudpreferences atop canonicalpipeline afterreview; do notwholesalemerge overlappingqueries/UIs orapplymigrationwithoutgates.
- Guest **codex/gateq-guest-upload-expiry / 553316c5136a8e6e624b33a4a9af42dffe9f7762**, fetchedverified; earlier **codex/gateq-guest-evidence-recovery / b35813def71c4bf5293580e4243d64c989c11dca**, historicalclaude5858eb1d/integration05e7ab62.231200/231300/231400 proposals require canonicalinventory/security/fix-forward reconciliation; not applied here.
- **codex/q-product-capabilities-oct14 / aed12b0c** pushedWIP,9files/229additions. Governedpublic-safe5-rowinventorytool withhistorical/currentstatusseparation, existingon-demandcatalogue, sanitizedq-apiSHA. No build/types/lint/test/CI/live certification. Snapshotstale afternewproductionacceptance; secondary, donotpublishunverifiedstatus or treateligibilityasLIVE. No secrets/privateaccounts/receipts indata.
- NativeGateQ driver **codex/gateq-pr83-acceptance-oct14 / 22ec4e7cf8173954e5fdcbf6a72ef486a1e1bcb3**, clean/pushedcheckpoint. Read-only companyactor/gateway preflight1.759sPASS; independent68tests plus26canonicalstagepreservationtestsPASS. This driver itself not fullsubmitverified here. Avoid duplicatepaidapplications whencompletedoperatorproofcanberecovered.
- HistoricalfourGateQ WIPbranches remainpushed/unverified/superseded; sourceSTATE earliersections listexactSHA. Allaccessibleworktrees reinspected; only generated untrackednode_modules indesigncheckout isexcludedfromGit. No credentials/session/privateartifacts committed. Agents paused forpreservation; do not assume anactiveworker ownsunfinished repairs.

### Exact next tasks and reproduction

1. Finish PR90 protected gates, normallypromote, readactualRailwayrevisions, verifydescriptioninexactsubmittedbrief/inbox. Never certifyfromsourceCIalone.
2. Implement narrow selected-dossier screenread + typedlargefinding Q reader repair usingexistingapp-actions/GateQauthority. Prove wronginvestor/wrongapp/pre-submit/stalefocus/multipleapp/longfinding cases, then genuineinvestorQ substantive sourcedanswer/context. Existingcomponentpaths: `apps/web/src/features/gateq/page/inbox-view.tsx`; `packages/app-actions/src/actions/gateq-inbox.ts`; `gateq-submitted-reading.ts`; `packages/q-tools/src/tools/app-actions.ts` (says600); owning screenreadcomposition. No secondQruntime.
3. Claimcapture then guestEvidence endtoend; canonicalH2pipeline recovery next, cloudviewWIPselectivelyafterward. Research88/productinventory secondary; QPitch/scoring/voice/workforcepreserved.

Production Hub rehearsal (privateauthorizedsessions mustbe present/refreshed androlesverified; no credentials inGit):

```bash
CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt \
NODE_OPTIONS=--import=./scripts/handoff/live/browser-proxy-pin.mjs \
CQ_HUB_WEB_URL=https://capital-qweb-production.up.railway.app \
CQ_HUB_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key \
CQ_HUB_INVESTOR_SESSION_FILE=/workspace/cq-secrets/investor-session.json \
CQ_HUB_FOUNDER_SESSION_FILE=/workspace/cq-secrets/trial-session-0.json \
CQ_HUB_VERIFY_Q=1 NODE_USE_ENV_PROXY=1 \
node scripts/handoff/live/relationship-hub-acceptance.mjs
```

FullDiscover rehearsal remains `scripts/handoff/live/investor-demo-rehearsal.mjs` using CQ_DEMO_SESSION_FILE/CQ_DEMO_PUBLIC_KEY_FILE/CQ_DEMO_FOUNDER_RECORD_FILE andverifiedper-runproxyhelper. GateQ actualnative driver ison22ec4e7c branch; read itsheader/arguments beforeusing `--submit` (creates paidinternaltestapplication). Verifyactualownership: trial0 COMPANY; trial1 FIRM; workforce FIRMownsfictionalgateway; investor-session ownsnone. Filenamesneverproveidentity. Missingexternaloperatorfixtures require legitimateauthorizedread/recovery, not inventedfinancialclaims or seedbypass.

No current environment/accountaction confirmedblocking implementation. Private external testfixtures/unfinishedINVQfiles may beinaccessible; do not claim recovered withoutactualread. PersistentNSSCA import was rejected earlier; process-local verifiedknownCA pin isavailable, no globalTLSdisable. No newTavusminutes spent. No prototypeCSS, competingCRMdatabase, genericQmemorysource, inventedscoring, undeployedWIPorunauthorizeddisclosure.

## October 14 — deployed acceptance and full GateQ / Hub continuation

- **Fresh production verified:** `71c5d4a58c314eca7981c08265b2e29015bc2b7b`; protected CI38556079265 SUCCESS. All four Railway services SUCCESS on this revision; previous revisions drained. GateQ canonical qualification-shape repair (PR83/84) and Hub H1 (PR81/85) are released. Historical checkpoints below are preserved, not current release authority.
- **Hub H1 LIVE VERIFIED:** authenticated fictional investor and founder, desktop1440×960 and mobile390×844, actual production UI. Role-aware headings/GateQ controls, Relationships/Overview tabs, Work return, no horizontal overflow PASS. Desktop typed Q generated successful navigation receipts to the existing overview; final-words-to-push62/7ms, settled heading5529/3912ms (single samples, not p50/p95). No voice certification, full CRM claim or Tavus room. Private browser evidence stays outside Git.
- **GateQ remains immediate priority:** native confirmed-account founder form → contextual Q interview → reload recovery → explicit reviewed Submit → exact-reference investor brief and expanded frozen three-turn transcript PASS on production71c. Separate existing fictional investor received404 for both foreign gateway and exact submitted dossier. All recorded facts remain applicant claims/self-reported; zero attached documents. No guest email OTP, uploaded documents, investor Q or p50/p95 certification claimed. Prior pre-repair session/history preserved; no historical fact rewrite or seed bypass. Guest Evidence is not released or evidence-complete.
- **Parallel ownership:** root owns native GateQ acceptance, intake/Q/disclosure/investor composition and integration. `hub_foundation` owns bounded H2 server-authorized list/filter/cursor/export, scoped personal saved views/columns, existing table/board and Q controls. `guest_evidence_recovery` owns actual signed-provider expiry/fencing, canonical Evidence storage/contracts/tests and draft migrations only. No duplicate CRM or Q engine; Q Pitch untouched.
- **Preservation:** unrelated older contact source/tests committed and pushed as `codex/wip-product-contact-preserved-oct14` at5049a718; not a merge target. No recoverable H2 branch or dirty Hub work found; continuing H2 from merged H1. PR86/87/88 preserved; research secondary.

## October 14 verified Q release and product continuation

- **Owner authority:** [continuation handoff](session-directives/2026-10-14-account-continuation.txt) and [functional Hub approval](session-directives/2026-10-14-relationship-hub-functional-authorisation.txt). Functional Relationship Hub work using the existing Capital Q design is approved; PR75 prototype remains unapproved. Q Pitch is untouched.
- **DEPLOYED / BROWSER VERIFIED:** Q attribution PR80 source `d710035c`, CI38531702123 PASS, merge `f8063330`; release PR82 source `46a1caee`, CI38534322301 PASS, production `37b5414e0cf7cfe09b21ab91544c391605f193a7`. All four Railway services SUCCESS on37b5414e and previous revisions drained. No migration. Real fictional investor browser: three canonical cards, selected-company profile/findings, correctly bound risks follow-up and two-company rendered comparison PASS. Separate known-founder profile/document stage was not run because its fixture file was unavailable. No return-to-Discover reproduced after selecting the company in this run; original cause remains unconfirmed.
- **Performance limits:** first20answercharacters3.743/4.712/9.318/9.034s; completion3.996/13.710/22.569/25.668s for top-three/profile/risks/comparison. These are individual browser samples, not first-useful-text or p50/p95/audio certification. Next: measure model/bridge/tool stages, remove proven overhead while preserving evidence.
- **GateQ real defect discovered:** confirmed account contact and four native form steps pass. Opening and one substantive answer persist as exactlyQ/PERSON/Q; model durations3.151/4.933s. Browser opening readiness24.168s; attempted immediate finish timed out, recovery requires further native proof. Interview replaced canonicalCODE seed withTEXT seed: summary still saysseed while qualification correctly reportsNEEDS_INFORMATION because its projector requiresCODE. Submission/dossier acceptance is therefore blocked, not complete.
- **IMPLEMENTED / LOCAL TESTED repair:** isolated `codex/gateq-typed-qualification-facts-oct14`, source `7d1e57a4`. Canonical qualification value shapes enforced at write validation; old paid checkpoints retain their reply while rejecting wrong-shaped proposals with counts. New immutable GateQ promptv2, originalv1 retained/deprecated with unchanged hash; no new model round, scoring change or migration.35dependency builds and144 tests/11files PASS; final root/static gates still finishing. Protected CI/release/fresh browser acceptance required. Existing historical fact rows are not rewritten.
- **Hub H1:** PR81 source `7919c215` includes role-aware overview/records, existing Results/Relationships/GateQ/Capital/Work reuse and deterministic Q aliases. Initial full CI caught seven missing generated server control registrations; catalog/matrix corrected,100affected tests and static gates pass. ExactCI38536343143 running; not deployed. Local authenticated browser acceptance underway. Filter-scoped exports/saved views/connected history remain later slices.
- **Guest Evidence preserved:** `codex/gateq-guest-evidence-recovery` at `b35813de`, current-source reconciliation of5858eb1d foundations.88tests,42API dependency builds, Evidence types and all changed lint/format PASS. Conservative signed-ticket and deletion-debt byte reservations; no new paid provider. Not release-ready: explicit reviewed-version submission, Q grounding, investor sources/downloads, frontend and retention still missing; provider authorization expiry must be tracked before retention can safely finish. Proposed231200/231300 migrations not applied or pgTAP/CI verified. Older WIP05e7ab62 remains preserved, not a merge target.

## Latest verified checkpoint — 2026-10-14 07:35 UTC

- **Integrated:** `build/int-rc` at `f35bddfcc81eef547faead4c064179981f37d081`. PR74 remains preserved; its republishing fix is separate from fact supersession. Supersession PR76 source `9c6c2607`, CI38520775540 PASS; release PR77 candidate `75deba0d`, CI38521203727 PASS. Opening PR78 source `d4c3f89b`, CI38524475537 PASS; release PR79 candidate `d00942a2`, CI38524638454 PASS. All runs include protected quality/database gates; manual browser e2e skipped.
- **Production:** `62bd144af47e20212d3cfe8827a09e7d28132e0f`, all four Railway services SUCCESS: API `c72798f2-72a7-41d7-813b-d493a7669d4f`; q-api `74a4127c-759e-4fc1-baf6-496695bb0374`; workers `37c6603b-e9f1-44f1-9d99-d2ee8c345503`; web `1cfddf07-0ba8-4d72-b003-b2c46c838a3e`. Previous fact-fix release `23a65ce3` is a rollback point, but retains the separate cold-opening defect. Hosted migration241000 applied,211 recorded/none pending.
- **Fresh live founder proof:** cold first opening3.558s, replay299ms, first country correction3.160s, completed answer retry589ms deduplicated, second country correction3.817s, saved transcript302ms. Exactly2 PERSON/3 Q turns, no duplicates. Earlier original correction reproduced HTTP500 then passed1.509s; hosted history14/current5, four interview-source rows, all applicant-provided, zero invalid successor links, current countryNG. No submission/dossier end-to-end claim.
- **PostgreSQL proof:**22 actual pgTAP assertions; compiled repository concurrent claims/retries, repeated corrections, rollback, MVCC visibility and submission-shaped application-lock snapshot all PASS. Full canonical database CI also PASS. No self-reference workaround, relaxed unique index, authorization weakening or competing storage.
- **Design complete for review:** PR75, `codex/relationship-design-review` at `aac14fd06a50ab7fdea826b874585fb65be27e05`, exact CI38523459354 PASS.76 screenshots and four Chromium-playable/ffmpeg-decoded MP4s; desktop/mobile axe zero automated violations, keyboard controls checked. Serve that checkout on4321 and open `design/relationship-hub/review/index.html`. All records synthetic and Q interactions scripted. No production CRM until owner approves designs; no full WCAG certification claim.
- **Remaining real product defect:** investor browser rehearsal fails `FOLLOW_UP_REFERENCE_MISMATCH`. Discover top3 first20characters2.506s/firstcard2.593s/completed3.312s; selected-company question first20characters3.901s/completed12.305s; risks follow-up7.731s/17.062s. Follow-up findings lose structured subjects despite selected run context. Saved screen route is DISCOVER with selectedCompanyId. Profile URL briefly matched but later correctCompanyPath=false: navigation cause remains unconfirmed. Comparison/known-founder stages were not reached. These thresholds are not voice or p50/p95 evidence.
- **Pending Q fix:** isolated `codex/q-discover-followup-fix-oct14`, code commits `8412bef3` and `5be2e476`; original audited source branch `codex/q-followup-reference-audit` at `34ec2c24618614ecd275dcb97b5136e423b030b1`. Allows selected-target reuse/projection on DISCOVER using existing fresh authorized profile checks, explicit names and comparative exclusions. Preserves previous COMPANY attribution alongside wide reads.62 targeted tests/package static checks PASS; protected CI/live acceptance still required. Not deployed.
- **Exact next task:** protected CI for Q follow-up patch, normal integration/release promotion, then rerun full investor browser rehearsal and instrument settled route history if navigation mismatch persists. Never weaken acceptance to declare completion. Preserve Q fast navigation, existing intelligence/memory/context firewall/Work; do not rebuild GateQ, Relationship Hub prototype, Q brain or workforce, change approved scoring, or implement CRM without approval.
- **Environment:** no blocking account action for GateQ. Persistent Chromium proxy-CA import was rejected by automatic approval review because it expands trust. Optional per-run known-CA SPKI pin below succeeded with strict harness HTTPS settings and no persistent trust change. Private sessions/evidence stay outside Git. No Tavus minutes used or audiovisual completion claimed this checkpoint.

Full investor browser reproduction (existing authorized private fixtures; refresh session if expired):

```bash
CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt \
NODE_OPTIONS=--import=./scripts/handoff/live/browser-proxy-pin.mjs \
CQ_DEMO_SESSION_FILE=/workspace/cq-secrets/investor-session.json \
CQ_DEMO_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key \
CQ_DEMO_FOUNDER_RECORD_FILE=/workspace/cq-secrets/founder-company.json \
CQ_DEMO_CHROMIUM_PATH=/usr/bin/chromium NODE_USE_ENV_PROXY=1 \
node scripts/handoff/live/investor-demo-rehearsal.mjs
```

PostgreSQL reproduction: `pnpm exec supabase test db supabase/tests/database/rls/923_gateq_fact_supersession.test.sql`; compiled-repository concurrency driver and disposable bootstrap live under `supabase/tests/database/rls/support/`. Full protected CI is authoritative for the complete RLS suite.

Preserved unfinished historical branches (unverified, do not apply conflicting old migrations): backend `codex/wip-gateq-backend-preserved-oct14`/a1116f3e; evidence `codex/wip-gateq-evidence-preserved-oct14`/19914537; frontend `codex/wip-gateq-frontend-preserved-oct14`/30f0ff93; intelligence `codex/wip-gateq-intelligence-preserved-oct14`/73f299ad. Tavus recovery remains `codex/wip-tavus-recovery-preserved-oct13`/ed667b46. All pushed; these are not release candidates.

## Latest live checkpoint — 2026-10-14 06:50 UTC

- PR76 merged at integration `f584f0bb`; source CI38520775540 fully green. Production PR77 exact candidate75deba0d passed **CI38521203727 completely** and merged at **23a65ce3d174eb2c4f39bd0f3fcb3a50c47911aa**. All four Railway services now SUCCESS at23a65ce3: API f62f7b38-fb97-42fd-ab05-2b9d1cc3101b; q-api b648ee86-0f56-447a-8efd-44493782fed7; workers776cfa25-5692-480b-9768-3ef2b2e92b84; web f4c27b76-b205-4b50-a0f7-237ec834c625. Hosted241000 migration applied/read back,211 recorded/nonepending. PR74 preserved; no CRM deployment.
- **Original fact-supersession defect LIVE VERIFIED:** same actual authorized founder application correction changed from HTTP500 to success (1.509s). Real first interview answer3.971s; second answer correcting existing country3.783s. Completed answer retry646ms deduplicated; exactly two PERSON turns. Applicant-facing country changed KE→NG as stated. Authorized hosted history/provenance readback follows this check; no fake READY/dossier or submission claim.
- **Separate cold-opening defect found:** first interview-open returned500 after saving its Q transcript. API logs show23514/application_sessions_last_turn_id_check: historical durable key `opening` has7characters, legacy slot requires8–128. Reopen resumed saved Q in606–663ms, allowing the real answer tests above. Do not call the entire cold founder journey complete yet.
- **Opening repair IMPLEMENTED / LOCAL TESTED**, branch `codex/gateq-opening-cache-fix-oct14`: keep historical durable `opening` key and pending-claim compatibility; skip redundant legacy session write for durable openings. Transcript-free composition uses valid `gateq-opening` key and caches/replays once. No migration/CHECK weakening. 121 targeted tests and22 actual PostgreSQL assertions PASS; package types/changed-source lint PASS. Root/API/web gates and exact protected CI precede release; no opening-fix deployment yet.
- Design PR75 now `aac14fd0` on `codex/relationship-design-review`: scoped prototype globals and ESM audit harness fixes pass changed-source plus complete outside-app/package lint batch, formatting, repeated axe and four-video playback. FullCI pending. All76screens/fourMP4s remain synthetic/scripted and review-only; no production CRM implementation until owner design approval.
- Next task: gated opening-fix release, then a FRESH authorized application cold opening and real answer/retry. Preserve previous23a65ce3 fact-fix release and exact rollback10c81bda baseline. Keep source/CI/deployment/browser/API evidence distinct. Follow the committed PostgreSQL reproduction commands below; private live fixtures never belong in Git.

## Latest checkpoint — 2026-10-14 06:32 UTC

- **Integrated:** PR #76 merged to `build/int-rc` at `f584f0bb2965bd2f85a33b93b35b67dbd10fb729`. Exact source `9c6c2607b88b00e251968f7edf39c1da19eee84c`, CI **38520775540 fully PASS**, including quality, full canonical pgTAP and the real-repository concurrent-correction step. Manual browser e2e was skipped. PR #74 remains preserved at merge `96d26b95`; its republishing fix is a separate defect.
- **Release pending:** PR #77, branch `codex/release-gateq-supersession-oct14`, exact candidate `75deba0db0d1a9160bf03e8f539d72ce945536fb`. CI **38521203727**: build, types, format/lint, database and security PASS; test/quality pending. Do not promote until these pass. Candidate retains the two existing production-only files; no historical WIP or CRM implementation included.
- **Hosted migration APPLIED:** `20261224100000_gateq_fact_supersession.sql`; 211 migrations recorded, none pending. Readback confirms successor FK DEFERRABLE INITIALLY IMMEDIATE, valid no-self CHECK and deferred same-application/tenant/dimension validator. Preflight found zero invalid existing links. The current-fact partial unique index and paired CHECK remain strict.
- **Railway baseline:** all four services SUCCESS at `10c81bdaaa189630aea8a5dffbfe5f831e4815ec`. API `27499ee1-9653-49fa-9386-f59b7f66a904`; q-api `cc6f2c81-7837-4156-9527-581684d2bd08`; web `986480a9-1c47-4789-b063-d63d05eb98de`; workers `045d44da-ff36-4900-8bb1-ec06d4f81f74`. Repair code is not deployed yet. This revision is the rollback baseline; old correction behavior is known broken.
- **Actual live defect reproduced:** authorized test founder, fictional investor gateway, account-confirmed contact. First form facts saved in 808 ms; correcting existing dimensions returned HTTP 500 in 428 ms. Hosted readback retained five original current/history rows and IN_PROGRESS status, proving rollback. No mail, submission or investor decision. Private session/application fixtures remain outside Git under `/workspace/cq-secrets/`; never commit them.
- **Local proof:** 53 package builds, root/API/web TypeScript, 182 GateQ tests and 67 API tests PASS. PostgreSQL17.11: 20 pgTAP assertions PASS. Production repositories passed three rounds of eight concurrent claim requests (one owner each), eight completed retries per round without duplicate facts, exact rollback and a fourth correction proving MVCC visibility/application-lock snapshot serialization. An additional disposable-DB check recovered a checkpointed outcome after the old writer's 23505 and completed the same exchange without losing its two-row history/two-turn transcript. Two initial ad-hoc harness assertions were corrected (DatabaseError.sqlState and required history limit), then reran PASS; no product change was needed.
- **Design review:** PR #75 against `claude/relationship-hub-design`, branch `codex/relationship-design-review`, latest `1d49922a9ee9964493a1dd4d6ef5216f50254ec2`. Existing researched prototype retained. 76 screenshots; four Chromium-playable/ffmpeg-decoded MP4s; desktop/mobile axe zero automated violations and keyboard focus verified. Real mobile role-selector clipping and review-page landmarks fixed. Original prototype/research formatting failure was corrected without semantic/prose changes; latest protected CI pending. All records and Q interactions are synthetic/scripted. **Do not implement production CRM before owner design approval.** Open `design/relationship-hub/review/index.html` after serving that checkout on port4321.
- **Next exact task:** finish PR77 gates, promote normally, verify Railway revisions and rerun the saved live correction plus two real interview answers/retry. Check actual current/history/source-turn provenance; do not certify success from HTTP200 alone. Then synchronize this checkpoint with live timings and deployment evidence.
- **Reproduce PostgreSQL:** `pnpm exec supabase test db supabase/tests/database/rls/923_gateq_fact_supersession.test.sql`. Real-repository concurrency reproduction is the protected database step in `.github/workflows/ci.yml`, using the strictly disposable `cq_gateq_supersession_test` database and committed support bootstrap/driver. Local full-Supabase startup hit ECR403 and alternate-image storage exhaustion; full canonical CI passed instead. No provider call is made by these database tests.
- **Preserve:** Q fast navigation, intelligence, memory, context firewall, Q Work, existing workforce and Tavus. No new brain/service/platform, scoring rewrite or Q Pitch edits. Old four GateQ WIP branches below are recovery only, explicitly UNVERIFIED/SUPERSEDED; never apply their old migrations or cherry-pick wholesale. No blocking user/account action identified for this release.

## October 14 — fact-supersession repair and Relationship Hub review

- Validation checkpoint: all53 package builds; root/API/web TypeScript;182 GateQ domain/application tests and67 API tests PASS. Actual PostgreSQL17.11:20pgTAP assertions PASS. Root independently reran compiled production repositories: three rounds8parallelclaims→oneowner each;8completedretries→no duplicatefacts; rollback exacthistory unchanged. Fourth correction proved MVCC readers retain previousfact untilcommit and submission-style application lock waits then snapshots correctedfact. Reproduction scripts committed under `supabase/tests/database/rls/support/gateq-supersession-*`; bootstrap is strictly disposable localDB, thin ancestor scaffolding, notfullRLS.
- Initial exact-head CI38519705651 on08821767: build/typecheck/fullcanonicalpgTAP PASS; tests/static stillrunning at checkpoint. New reproducible concurrent proof is now wired into protected database job; finalhead must rerun allgates. Hosted read-only migrationpreflight:0self-links/0invalidsuccessors. CanonicallocalSupabase blocked ECR403 thenDockerimage layer storage; protectedfullSupabaseCI succeeded, no environmentfailures countedPASS.
- Protected oldwork: `codex/wip-gateq-backend-preserved-oct14` a1116f3e512c5195c1bc330429c18d8125830b91; `codex/wip-gateq-evidence-preserved-oct14`19914537d492f56fec61e22b65f60fa5ebd32e8d; frontend30f0ff93429c2b30e156cda20ce5eb29e7e0fa35 on `codex/wip-gateq-frontend-preserved-oct14`; intelligence73f299ad221e2c137064d27052a49226a753d99c on `codex/wip-gateq-intelligence-preserved-oct14`. Allclean/pushed, explicitlyUNVERIFIED/SUPERSEDED; doNOTapply old231100/231200migrations or wholesalecherrypick.

- Integrated PR #74 at `96d26b957d0824e267487ee6fc3e4a6972df3116` on `build/int-rc`; exact head `5ec42dabb1f73808d80bd14b797732d0db2973c9`, protected CI `38516516121` PASS (manual e2e skipped). Its republishing 500 fix is separate from the second-answer fact-supersession defect.
- Railway readback: all four services SUCCESS at production `10c81bdaaa189630aea8a5dffbfe5f831e4815ec`. This repair is NOT deployed. API deployment `27499ee1-9653-49fa-9386-f59b7f66a904`; q-api `cc6f2c81-7837-4156-9527-581684d2bd08`; web `986480a9-1c47-4789-b063-d63d05eb98de`; workers `045d44da-ff36-4900-8bb1-ec06d4f81f74`.
- Repair branch `codex/gateq-supersession-fix-oct14`: retire old current fact before inserting actual successor UUID under the canonical application lock; defer only successor FK, retain immediate current-fact unique index/paired CHECK, reject self/scope links. New migration `20261224100000`. Recovered older repair concept from uncommitted backend work; did not merge its stale migrations. IMPLEMENTED, database validation pending; no release claim.
- PostgreSQL proof pending: new 923 pgTAP tests cover original 23505, repeated corrections, retained provenance/history/turns, rollback and invalid lineage. Canonical local setup initially blocked by ECR 403; alternate ghcr registry image download is progressing. No false test PASS.
- Design-only PR #75: `codex/relationship-design-review` at `444070cd1d55a518055e70b8d22db9d011152da3`, based on existing `9a0ce187`. 76 desktop/mobile light/dark screenshots, four MP4 walkthroughs; Chromium playback/ffmpeg decode passed. Real mobile role clipping fixed. Review `design/relationship-hub/review/index.html`. All data synthetic/Q interactions scripted. No production CRM implementation; user design approval required.
- Exact next task: prove supersession against actual PostgreSQL, including durable concurrent retries/rollback; affected application gates and exact protected CI before migration/release. Preserve Q intelligence, memory, context firewall, Work and fast navigation; no duplicate brain/platform or Q Pitch edits.

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

## 2026-10-13 22:00 UTC — GateQ text journey DEPLOYED (Claude); live acceptance pending

- **Production `recovery/2026-09-12` = `20cb347e`**, merged from release PR #70. The tree equals int-rc 47d87665, plus two production-only files.
  - It carries GateQ #66 (backend), #68 (web) and #69 (Q opens the interview), the speed-close docs and the Q Pitch blueprint docs.
- **Release CI:** run 38470826379 passed every job (build, typecheck, format/lint, test, pgTAP, quality).
- **Deploy evidence:**
  - The web homepage ETag changed at 21:54:36 UTC, so the new build is serving.
  - api `/health/ready` reports database OK; q-api `/health/live` is OK.
  - Per-service Railway status was NOT read: no working Railway API access in this session.
- **Migrations:** hosted 208, none pending; `20261223090000` was applied earlier.
- **Integration `build/int-rc` = `86106e43`.** It also carries Q Pitch foundations (#67, package-only, not wired into any app).
- **Not yet live-verified:** the GateQ founder-to-investor journey.
  - Run `scripts/handoff/live/gateq-acceptance.mjs`. It needs `CQ_SB_URL`/`CQ_SB_PUBLISHABLE` and a valid `SUPABASE_ACCESS_TOKEN`; the current token returns 401.
  - `GATEQ_CONTACT_REQUIRED_FROM` stays unset.

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

## 2026-10-13 09:22 UTC — findings release accepted; human Tavus pilot preparing

- Production `592b32ff348521246de41fd25b744f75876a3af5` (PR51), all four services SUCCESS with prior deployments drained. Exact source `ae111c50` CI38371772202 required quality and pgTAP SUCCESS; source/merge trees identical. Immutable COMPANY_ANALYST v25 restores generic findings guidance alongside specialist companyFindings; strict contracts unchanged.
- Authenticated investor browser journey PASS: three exact ranking cards, selected-company reference, seven native profile findings, six native risk findings, and comparison of the correct two companies. Private receipt `/tmp/cq-investor-demo-1Tc4Lv`. Profile first20 rendered characters 5571ms/total26112ms; risks4586/18920; comparison8244/34002. These are individual text observations, not p50/p95 or first useful text/audio.
- User is ready and confirms signed in as existing Tensorgate founder. Single-account <=180-second paid Tavus pilot is now authorized. Only CQ_TAVUS_TEST_MODE changed to false; q-api configuration deployment must become SUCCESS and the previous deployment drain before allocation. Video rows0 at09:22UTC. No room allocated yet; no human AV/reconnect/interruption/deadline/review acceptance claim.
- Pilot admission READY at09:26:16UTC: configuration deployment9e1aa2f0 SUCCESS, exactly one active q-api deployment and previous instance drained; testMode=false, one matching canonical profile/key and one configured replica. Fresh founder catalogue true/PartnerSteve/180; unadmitted investor false. User received authenticated eligible Savanna lobby and instructions to Join once; root monitors read-only. Paid room still unallocated at09:26:17UTC. Do not restore configuration or deploy while a room is physically live.
- Product-first acceptance addendum preserved in `session-directives/2026-10-13-product-first-acceptance-addendum.md`. Complete the single human pilot first, then eligible-counterpart coverage and enforceable broader spend/concurrency safeguards. Existing connected memory is implemented, not universally proven; Hermes and representative p50/p95 remain ongoing. No broad paid admission or new budget authorized.

## CURRENT TAKEOVER CHECKPOINT — 2026-10-13 — Codex release owner

This checkpoint supersedes older release/network claims below; historical entries are retained.

- Network policy is active. Verified HTTPS GitHub, Railway, Supabase management and Tavus catalogue access without restarting or discarding work. Cloud onboarding configuration is saved; pinned pnpm and Playwright install with verification preserved. Local Supabase Docker/vfs exceeds this VM storage; use CI pgTAP and hosted HTTPS, not repeated image pulls.
- **DEPLOYED:** PR #42 independently merged to production as `f3fe55201d4c1de831cdb49e410a234f408224ff`. Exact source CI `38345644115` and production push CI `38348439138` SUCCESS. All four Railway services directly verified SUCCESS at that revision (workers `04b36085`, api `9611287c`, q-api `18b62508`, web `72b4e53f`). Previous verified rollback: `1165b92e3869832aedb4b54c63e5bf4cbd00bfd6`. No migration required for PR #42.
- **MERGED / CI GREEN:** PR #43 voice head `3e49bac316f7e86067b06b3ea4fa8844053ea5f9`, exact CI `38348847332`, integration merge `9da9f0577df432c6549a77b52176dcb054aa2cdc`. Shutdown speech is metered through confirmed provider closure and final durable accounting; claims retained on uncertainty. 81 targeted tests and local gates PASS. Voice-only production PR #46 head `c18be404c6e86e7f747cb5a8887ec72d21e9e814` passed 52 builds/179 tests/all three types/static and exact CI `38352448737`. Production merge `cda9b767c1d8ef549d0b1e07caa7f09653322a36` and push CI `38353585621` SUCCESS; all four services directly verified SUCCESS (workers `9f819911`, api `c3617eeb`, q-api `0f5ad885`, web `3ea45c85`), old q-api drained. Merge/source trees equal. One configured replica in one region confirmed; runtime inventory is not inferred from deployment count. Bounded live API probe returned 201 with observer-ready admission and held claim; server end 204 released claim with 0 consumed seconds. Cloud browser WebRTC remained connecting/no datachannel events, so real speech/silence/physical cutoff are BLOCKED, not verified. No usage reset/manual claim release or replacement session.
- **APPLIED:** reviewed voice migration `20261222170000_q_voice_live_trial_claim.sql`, explicitly named and authorized by the owner's takeover directive. The conservative DELETE screen matched only the new release-function body, not executed migration data deletion; version-specific approval recorded here. Hosted read confirms RLS on, zero policies, authenticated SELECT/claim EXECUTE false, service claim EXECUTE true. Original Tavus `20261222175000` already applied; encrypted join `20261222180000` applied after exact PR44/48 quality + pgTAP gates passed. Hosted migration ledger now contains 205 versions.
- **MERGED / CI GREEN / APPLIED:** Tavus PR #44 head `0cb31c02f7e0b6ebc9bf48b17ab27521d700e963` exact CI `38359007324` SUCCESS, merged integration. Production PR #48 head `c3c6e70549a22435316540cb11669e2890e67a2b` exact CI `38359532207` SUCCESS, merged production `912e594c23bf4079df5f912c3f4af1ec2ae5dcff`; All four Railway services verified SUCCESS at this exact revision; old deployments drained (workers `d784ad87`, api `92a6fdf1`, q-api `c5f88a3a`, web `5ca6dae1`). Fresh configuration receipt confirms test mode, one key matching selected account, one exact pilot profile, stable cipher key and bridge origin. Live founder catalogue available/partner-steve/180 seconds and unadmitted investor catalogue unavailable/no enabled interviewers both PASS. Read-only readiness checker PASS; founder Rehearsals page HTTP200/visible PASS (`/tmp/cq-investor-demo-ktYF5i`). No room allocated, AV NOT_RUN. Includes compensation, same-replica serialization, refresh/pending room recovery, both-mode fresh actor admission and confirmed termination before final review. Local 148 focused tests and all types/static pass; production composition 382 unique tests pass. CI exposed route-capability inventory and typed navigation drift; both corrected, no tests weakened. Migration 180000 applied before promotion. Test mode, one canonical pilot profile, one selected provider account and one configured q-api replica retained. No rooms allocated. Broader distributed/crash-safe idempotency/spend-ledger limitations remain.
- **LOCAL TESTED / PUSHED:** PR #45 memory head `1e5f16b850ee722c91d0536c86ba776eb2ec4204`, 655 focused/q-core tests and local gates PASS; exact CI `38350806455` SUCCESS and integration merge `0a80ad761ca9a4ed8791ad20338e452b3122c887`. Production PR #47 head `fb8da07ac5359314d468000f8f32960167067ac7` passed 52 builds/144 focused tests/six harness tests/all three types/static and exact CI `38353703017`; merged production `08018ea3ae51e6bdcf58a9fff5c42c5196610b2e`, all four Railway services directly verified SUCCESS at `08018ea3`; old q-api drained. New immutable TURN_READER v50/TURN_SKIM v5 preserve compound evidence; bounded graph rendering retains later companies/reviewer evidence and omission disclosures. No schema migration or score formula change.
- **LIVE EVIDENCE, NOT FULL ACCEPTANCE:** ordinary existing fictional investor `/v1/me` and Discover HTTP 200. API top-three run completed with three cards. The corrected harness binds full visible settled answers to fresh canonical run/message/text and card identities, preserving exact company/reference/no-leak assertions and TLS verification. Authenticated investor browser journey PASS: top-three, exact selected company Open, selected-company explanation/risks and exact two-company comparison. Current-question visibility is separately measured; false for top-three, true on profile/follow-up/comparison. First 20 characters of rendered text (not semantic first-useful proof): 3.34 / 4.51 / 7.93 / 2.42 s; profile answer total 54.1 s, not a general speed success. Work Open exact verified memo v2 PASS; Tensorgate fit/Q view/stated terms/unknown disclosure PASS. Existing owned workforce deliverables reverified through deployed API: five research sources, READY v2, real critique/material revision, 240615-byte PDF, five PENDING diligence questions, dependencies bound. Known-founder named-question extension not run. Review/diligence query completed in 20.6 s; compound fit query in 2.5 s still omitted memo/reviewer evidence on shipped PR #42. Post-memory compound query recovered stored memo/reviewer risks and explicitly distinguished missing evidence from negative evidence (receipt `/tmp/cq-memory-live-8fK9ji`), 20.9 s total. Mixed review/decision answer omitted two fresh owner-scoped pending approvals; no approval or send performed. These are individual observations, not p95 or paired speed proof.
- **TAVUS PAID ACCEPTANCE PENDING HUMAN:** owner replied "Prepare it; I’ll join later." No paid room allocated. Keep test mode, one canonical pilot profile, one API replica/no restarts during the single at-most-180-second paid test, then restore admission. Human audiovisual quality, provider end, refresh/rejoin and non-provisional persisted review remain live gates. Secrets remain private mode-600 files outside Git and saved setup; use one entitled Tavus key, no key pooling/rotation to evade quota.
- **DEPLOYED / LIVE GAPS RECORDED:** PR #49 corrected source `7da9796fa0f8758992e6df07830cc64d4f0760ea` exact CI `38364499150` SUCCESS; production `23e3971cf52ddd8a8e145ceaa173a1782f764eb2`, push CI `38366361312` SUCCESS, all four Railway SUCCESS/old deployments drained (workers `a7591aa8`, api `fbb9ca14`, q-api `39bfa328`, web `5348b16d`). Source/merge tree identical `348ff12c`. Immutable COMPANY_ANALYST v23/v24 clarify strict shape and read existing owner-scoped pending approvals. First CI exposed one stale v22 bundle assertion; reproduced RED then exact v24 correction/16 affected tests PASS, no weakened guard. Fresh pre-guidance profile sample passed with six native findings, 23.1s total/4.95s first20chars/one dialogue/no refusal (`/tmp/cq-investor-demo-2DSXfQ`). Post-guidance profile took13.0s/3.06s but FAILED full binding because native FINDING blocks were absent; correct company reference remains. No speed success claim. Existing dialogue renderer consumes `findings`, whereas new precise guidance described specialist `companyFindings`; a new immutable v25 clarification is being gated, with an actual renderer regression RED on v24's example. Root source integration copy15paths byte-identical to49 and local52builds/16tests/alltypes/staticPASS; shared checkpoint PR50 exactCI38363254188 passed and merged integration8086ab91.
- **LIVE VERIFIED CURRENT DECISIONS, NOT OUTWARD EXECUTION:** v24 mixed memo/decision query now reports two pending items; scoped gateway logs confirm native `approvals.pending.list` READ_ONLY/SUCCEEDED. Both existing unexpired approval IDs remain unchanged afterward. No approvals, emails or sends. Compound mandate/memo-risk recall still completes with stored-evidence/unknown disclosure; individual observations, not p95. Private receipt `/tmp/cq-memory-live-QYUb1K`. Fresh Tavus configuration/catalogue checks after23e3971c retain the exact single-profile/key/test-mode admission; no room allocated. Founder lobby selector/disclosure PASS (`/tmp/cq-investor-demo-1yxr4V`), Join not clicked.

- Root retains release/shared-document ownership. Separate voice, Tavus and memory worktrees preserve original branches. Existing primary `/workspace/q` checkout is untouched; no competing implementation. No founder-contact approvals, email or outward sends.

## LATEST RELEASE — production 047678e5 (all four SUCCESS) — 2026-10-12 18:25 UTC (Claude, release owner while Codex was out)

- Deployed since 09:28: PRs #19–#22 (retrieval concurrency, relevant memory recall, answer latency, Work documents), #26 (go-ahead re-plan; Codex follow-up lookups + exact-company memory ranking), #27 (Work Open document; list_q_work v2 job review/diligence), #28 (live-voice trial), #30 (plain questions offered read tools only), #32/#33 (founder rehearsal recall). Rollback: 61dbe929, then fb2b6403.
- Migration `20261222160000_q_voice_live_trial_usage` APPLIED to hosted (202/202) after pgTAP; RLS on, 0 policies, no authenticated select.
- q-api `CQ_VOICE_LIVE_TRIAL` = the two trial accounts' PROFILE ids (identity.user_profiles.id, NOT auth.users.id): 801f52ed… (cq-daniel-tensorgate), 4b83f67b… (cq-investor-partech), 300 s each. App user ids are profile ids everywhere; auth ids grant nothing.
- LIVE VERIFIED (fictional accounts): Tensorgate memory recall in a new conversation; "Yes, plan this one anyway." re-plans the original goal (plan card 8.3 s); workforce plan→mandate→research→memo→critique+revision v2 (8 issues); founder.ajopot rehearsal-struggle recall with dated, practice-labelled coaching.
- LIVE DEFECTS OPEN (fix branches in progress): (1) DILIGENCE step fails when the model writes a question >180 chars (DB contract network.diligence_questions 3..180 — keep it; branch `claude/diligence-question-length` adds one bounded rewrite, never truncates); (2) list_q_work v2 called but Q said the questions/reviewer changes were not on record although job 43b7bdb4 persisted both — branch `claude/work-results-fix`.
- Founder-contact card "Send Ledgerfold these 5 questions" (requested 12:41) remains PENDING, never approved or sent. Acceptance runner approves only its own plan card.
- Codex branch `codex/voice-trial-durable-claim` (per-account durable claim + migration 20261222170000) is unmerged; Codex owns voice files.

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

## October 13 independent voice reliability checkpoint

The cumulative active-speech guard is preserved on pushed `codex/oct13-voice-trial-guard` (`5d748085`), based on `6f47fd5d`. See [VOICE-TRIAL-DURABLE-GUARD.md](VOICE-TRIAL-DURABLE-GUARD.md). Existing unfinished source was also backed up as WIP `71518a20` on `codex/voice-trial-audit-takeover`. The continuation restores the strict concurrent-consumption regression, requires bounded confirmed observer readiness before SDP, checks observation again after context reads, and flushes replacement accounting across owned tenant contexts. Package-build and fresh local gates are pending at this checkpoint; no CI-green, migration-applied, deployed or live-verification claim. Migration `20261222170000` remains unapplied. Tavus and independent product release ownership remain with the root engineer.
