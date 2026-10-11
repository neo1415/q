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
