---
name: dev-stack-watch-restarts
description: Building a package restarts the whole dev stack; never poll demo.log for "quiet" because the stack writes to it continuously
metadata:
  type: feedback
---

`pnpm demo` runs `turbo run dev`, which watches package sources *and* `dist`.
Any `pnpm --filter <pkg> build` — or even `prettier --write` over a package's
`src` — restarts web, api, q-api and workers mid-request, killing whatever
smoke is running with ECONNRESET/ECONNREFUSED.

**Why:** I lost hours to this, and worse, to "wait for the stack to settle"
loops that compared `wc -l demo.log` between polls. The running stack logs
every request, so that count never stops changing and the loop can never
exit. Six of those were left spinning for over an hour each before the user
pointed at the task list.

**How to apply:** batch all source edits, build once, then poll
`pnpm demo:status` for `q-api   READY` only — never for log quiet. Cap the
wait with a bounded `for` loop, not `until`. Run live smokes in the
foreground with `timeout`, and never edit source while one is running.
See [[qx-003-artifact-verification]].
