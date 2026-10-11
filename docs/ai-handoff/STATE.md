# Capital Q — Current shared engineering state

> Shared by Claude Code and Codex. Update at the start and end of every substantial session.
> Evidence words: CODE OBSERVED · IMPLEMENTED · MERGED · LOCAL TESTED · CI GREEN · DEPLOYED · LIVE VERIFIED · BLOCKED.
> A recorded SHA is a snapshot; re-check Git and Railway before trusting it.

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
