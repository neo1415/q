---
name: design-direction-founder-2026-09-25
description: "Founder's UI direction overrides parts of CLAUDE.md's prohibited-visuals list — futuristic AI glow wanted, floating draggable Q plus the full Q page, TikTok-style Discover, no ChatGPT-like chat UI, visible theme switcher"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-25T07:27:39.342Z
---

2026-09-25 the founder set the product's visual direction (binding, to be recorded as ADR amendments to docs 17/18 and CLAUDE.md's prohibited-visuals list):
- Q should feel FUTURISTIC; the founder "doesn't mind the AI glow" — glow/light/fluid motion (even shader/3D) is allowed for Q's presence, but premium and professional, within perf budgets (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1), reduced-motion fallbacks and WCAG AA.
- A floating, draggable Q presence on screen (snaps to an edge, can be moved) — IN ADDITION to the dedicated Q page, which stays.
- NO ChatGPT-like message-list-plus-composer interface; history is secondary.
- Discover is TikTok-like: full-screen video on mobile, full-height on desktop.
- Near-zero-latency navigation; "absolute beauty and cinema but also professional".
- Light / dark / system theme options that are easy to spot.
- Founder is not impressed with the current Q presence design.

**Why:** founder's explicit product taste; earlier prohibited-list items (glowing/AI gradients) were written before this and no longer bind where they conflict.

**How to apply:** design specs and UI workers follow scratchpad ux-research.md once written, plus this; still keep the useful prohibitions (badge spam, cards around everything, fake terminals). Research brief worker was told the same. Related: [[no-patching-architecture-first]].
