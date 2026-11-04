# Discover tabs over the video — 2026-11-04 (`fix/discover-tabs-overlap`)

**Defect:** in the 7b9a267ce live check (`chore/live6-7b9a267`, `5-yours-1440.png`), the "For you · Your companies" tabs sat over the Your companies video at 1440.

**Cause:** at ≥1024px the tabs' `inset-inline-start` is computed from For you's grid (stage + dossier). Your companies uses its own `.cq-yours-card` grid (`1fr` stage + 440px panel), so the same offset lands on its video.

**Fix:** one CSS rule in `apps/web/app/globals.css`, inside the `min-width: 1024px` block. When `data-discover-tab="YOURS"`, the tabs sit at the top of the 440px panel, in its 72px top padding, aligned with its 28px content inset. The z-index is unchanged (`--cq-z-sticky` token), and the rule doesn't apply below 1024px.

**Evidence:** local `next dev` against the production API, reads only, fictional investor. `tabs-overlap-check.mjs.txt` (a Playwright script kept as text) measures whether the tabs' box and the video's box intersect (left/right in CSS px):

| Width | Tab            | Tabs      | Video   | Overlap                                                              |
| ----- | -------------- | --------- | ------- | -------------------------------------------------------------------- |
| 1440  | Your companies | 1018–1233 | 380–860 | no (was yes on production)                                           |
| 1440  | For you        | 781–996   | 264–743 | no (unchanged)                                                       |
| 1280  | Your companies | 858–1073  | 356–724 | no                                                                   |
| 1024  | Your companies | 602–817   | 356–468 | no                                                                   |
| 390   | Your companies | 87–303    | 0–390   | by design: centred over the full-screen stage on a phone (unchanged) |

**Separate, pre-existing issue, not changed here:** at 1024 the Your companies video renders only about 112px wide. `--cq-feed-video-h` subtracts 440px + 232px from the container width, which leaves almost nothing at 1024. See `yours-1024.png`.
