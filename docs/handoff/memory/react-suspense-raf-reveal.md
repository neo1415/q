---
name: react-suspense-raf-reveal
description: "React 19.2 reveals streamed Suspense content via requestAnimationFrame, so boundaries stay blank and unhydrated in a hidden/background tab"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-21T20:21:06.422Z
---

React 19.2's SSR runtime does not insert a completed Suspense boundary's
content immediately. `$RC` marks the boundary comment `$~`, pushes it onto
`$RB`, and schedules `$RV` through `requestAnimationFrame`. A hidden tab
never fires rAF, so the content sits in its hidden `<div id="S:N">` holder
forever, never moves into place, and never hydrates — the DOM on screen is
the server's markup with no client code behind it.

**Why it matters:** this makes automated/headless verification lie. The
Claude built-in browser pane reports `document.visibilityState === "hidden"`
whenever the pane is not displayed, so every page behind a `<Suspense>`
looked empty and dead. It cost a full session chasing "history hydrated then
was destroyed" when nothing had ever hydrated.

**How to apply:** when a page looks blank or unhydrated in the browser pane,
check `document.visibilityState` first. `document.querySelectorAll('[data-q-workspace]')`
finding an element whose ancestor is `div#S:2` is the signature. Flush
manually with `window.$RV(window.$RB)` to emulate a visible tab, or reopen
the pane with `preview_start` (which displays it). Do not conclude a product
bug from a hidden-tab render.

Structural fix: do not put a page's primary content behind a streaming
Suspense boundary it does not need. See [[qx-003a-hydration-fix]].
