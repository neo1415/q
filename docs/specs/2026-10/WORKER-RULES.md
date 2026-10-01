# Worker rules (2026-10 build, binding for every worker)

1. Read first: CLAUDE.md; docs/handoff/HANDOVER.md (whole); last 80 lines of docs/handoff/research/ledger.md; your area's existing code (use `graphify query "<q>" --budget 1500` from /home/user/q before opening files).
2. Step 1 of every packet: research (web search allowed) + write your spec to `docs/specs/2026-10/<area>.md`: goals from the founder's words, research findings with sources, UX flows, data model, contracts, Q tools + capability registry entries, authority/approval class per action, Context Firewall and privacy rules, failure/edge cases, loading/empty/error states, light+dark, phone+desktop, tests and live checks. Commit it before building.
3. Build what the spec says, completely and wired end to end. Never ship a button, icon or state that is not built, tested and wired.
4. Architecture: no word lists/regex over user words (ADR 0011/0016); models only through the Q Model Gateway; typed Zod tools with authorize steps; Prepare→Approve→Execute for consequential actions unless an existing ADR grants scoped delegation (ADR 0028 errands); Context Firewall before retrieval; founder-private never leaks; RLS on every new table + pgTAP positive/cross-tenant/revoked tests; migrations additive; new ADR when amending architecture (next free number: check docs/adr).
5. Migration version prefix assigned to you (use only these): HARDEN 202611100, REHEARSE 202611110, AUTO 202611120, DOCS 202611130, DAILY 202611140, ADMIN 202611150 (e.g. 20261111000000_…).
6. Shared hot files (packages/q-tools/src/capabilities.ts, contracts index, q-api main.ts): keep your additions in a clearly marked block `// <AREA> block` to ease merges.
7. Tests: targeted vitest + `pnpm --filter` typecheck + root `npx tsc --noEmit -p tsconfig.json` + eslint on changed files + pgTAP for your migrations against local Supabase (127.0.0.1:54322; never stop/reset it; `pnpm exec supabase migration up --local`). Never weaken a test. Provider keys in tests = `disabled-locally-000000000000`.
8. Live checks (only after the lead deploys your commits): fictional accounts @fictional.capitalq.local; the founder's own accounts end with gmail.com (passwords only from the founder in chat). Provider credits are the founder's: sparing. One browser at a time across all workers: run Playwright with run_in_background and read results from the DB.
9. Commits: small, message ends with
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01HGrtY6oiZywU8NaACVcPL8
   Never push, merge or rebase; the lead cherry-picks your branch. Kill every process you start. No sleep-polling. Tail/grep output.
10. Design: ADR 0017 + docs/design/ux-direction-2026-09.md + docs/design/ux-writing-guide.md; minimal, institutional, tokens only (--cq-*), a little less gradient than now; beautiful loading/empty/error states; WCAG 2.2 AA; 44px targets; reduced motion.
11. Report to the lead (≤50 lines) at the end of each milestone: commits, checks with exact results, lead-owned files, migrations, what needs live verification.
