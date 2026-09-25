---
name: machine-freeze-concurrency-cap
description: "Too many concurrent agents each running their own dev stack froze the user's laptop (forced restart 2026-09-24); cap workers and always kill servers when done"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-24T20:54:04.386Z
---

On 2026-09-24 the user's machine froze and had to be restarted because ~8 worker agents each ran their own web/api/q-api dev stacks plus builds and terminals. User instruction: "once you are done with a service or a server or whatever, make sure it is fully closed and killed before opening another one."

**Why:** the laptop (16 GB, Windows) cannot carry more than a few Next dev + node service stacks at once; builds already took 15 min under load and agents stalled.

**How to apply:** run about 4 useful worker agents at a time (user raised it from 3 on 2026-09-25); tell every worker in its prompt to (1) reuse one stack, (2) stop every process it started (by PID it recorded) before starting another and before finishing, (3) never leave terminals/servers running at the end. Check listening ports 3000–3999 before spawning more work. Related: [[claude-app-process-tree-kills-servers]], [[dev-stack-watch-restarts]].
