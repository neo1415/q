---
name: vitest-worker-start-timeout
description: "pnpm test can report \"Failed to start forks worker\" for jsdom component files; it is vitest's hard-coded 60s START_TIMEOUT under machine load, not a test defect"
metadata: 
  node_type: memory
  type: project
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-20T20:48:44.103Z
---

When `pnpm test` reports passing tests plus N "Unhandled Errors" of the form
`[vitest-pool]: Failed to start forks worker for <file>` / `Timeout waiting
for worker to respond`, those files **never ran** — they did not fail.

**Why:** `START_TIMEOUT = 6e4` is a hard-coded constant in
`node_modules/.pnpm/vitest@*/node_modules/vitest/dist/chunks/cli-api.*.js`.
There is no config option for it. Forking a jsdom worker on a saturated
Windows machine can exceed 60s, and it is always the `.tsx` component files
(`packages/ui/*`, `apps/web/*`) because they are the heaviest to start.

**How to apply:** do not treat it as a test failure and do not weaken
anything. Run the named files directly — they pass in seconds — then rerun
the gate once on an idle machine and report both runs. Observed 2026-09-20:
first run 292s with 4 such errors, second run 144s fully green, no code
changed. The real lever is capping `poolOptions.forks.maxForks` in the root
`vitest.config.ts`, which is owned by `CQ-TEST-FLAKE-001`. Related:
[[lint-heap-and-gates]].
