---
name: no-unnecessary-builds
description: The user asked me not to run builds and heavy checks on every step; build a package only when a test or the running stack needs its dist
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 782a5694-29f2-46aa-acde-6c8d24e943d9
  modified: 2026-09-17T12:35:52.335Z
---

On 2026-09-17 the user said: "don't do unnecessary builds and stuff every time, do them only when you really need them so you won't waste my time."

**Why:** each turbo build takes 20-60s, restarts the file-watched dev servers (dropping any live voice call), and the user watches the clock.

**How to apply:** apps consume packages via dist, so build a package once, right before the first test or live check that needs it, and not after every edit. Typecheck with `tsc --noEmit -p apps/<app>/tsconfig.json` instead of building. Run only the test files touched, then the full suite once at the end. Related: [[claude-app-process-tree-kills-servers]].
