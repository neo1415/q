---
name: lint-heap-and-gates
description: eslint over the whole Capital Q repo needs ~8 GB Node heap and must run alone; run root gates sequentially with the demo stack stopped
metadata: 
  node_type: memory
  type: project
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-18T10:03:28.703Z
---

On this 16 GB machine `pnpm lint` (typed eslint over the monorepo) dies with exit 134 (V8 heap out of memory) when run alongside typecheck, tests or the integration suite, and once even alone under the default heap. `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`, run with nothing else in flight, passes.

**Why:** the root gates are memory-bound, not slow; a vitest fork-worker start timeout and an SSE timing test (`apps/q-api/test/q-events.test.ts`) also flake only under concurrent load.

**How to apply:** stop the demo stack (`pnpm demo:stop`), run typecheck → test → lint → build one at a time, restart with `pnpm demo:detached` at the end. The full `pnpm test:integration` on the shared local DB has ~9 unrelated failing files (stale prompt/catalogue expectations and unscoped row counts over dev data); run the packet's own integration files to prove a packet. Related: [[claude-app-process-tree-kills-servers]], [[format-check-graphify-out]].

An agent worktree under `.claude/worktrees/` (Claude app worktree sessions) makes plain `pnpm lint` fail with tens of thousands of errors ("multiple candidate TSConfigRootDirs" plus unresolved types in the worktree) and `pnpm format:check` flag its files. Neither is a real regression: run `NODE_OPTIONS=--max-old-space-size=8192 npx eslint . --max-warnings=0 --ignore-pattern ".claude/**"` and check prettier over tracked files only.
