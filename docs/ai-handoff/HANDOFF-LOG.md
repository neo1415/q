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
