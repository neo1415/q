---
name: format-check-graphify-out
description: pnpm format:check fails only because untracked graphify-out/ is not in .prettierignore; tracked files pass
metadata: 
  node_type: memory
  type: project
  originSessionId: 527a3870-2616-4832-9211-ae49f1424757
  modified: 2026-09-18T08:17:26.224Z
---

`pnpm format:check` in the Capital Q repo reports ~244 warnings, all under `graphify-out/` (untracked, ignored via the global `~/.config/git/ignore`, but prettier still walks it). Tracked files pass.

**Why:** graphify writes its output into the repo root, and CLAUDE.md forbids editing the client repo's ignore files for my tooling.

**How to apply:** treat format:check as PASS when every flagged path is under `graphify-out/`; verify with `prettier --check . | grep warn | grep -v graphify-out/`, and say so in the postflight rather than claiming a clean run. Related: [[claude-app-process-tree-kills-servers]].
