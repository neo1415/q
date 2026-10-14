# Relationship Hub design review

**Design proposal only; not approved for production implementation.** This resumes Claude's researched prototype at `9a0ce187`; the research and existing interactions are retained. All records are fictional. Q responses, navigation receipts, approvals, documents and job states are scripted local simulations. No production API, provider or account is used.

Serve the repository root, then open `design/relationship-hub/review/index.html`. The package links the clickable prototype, 76 screenshots (19 surfaces × desktop/mobile × light/dark), and four downloadable MP4 walkthroughs. Videos are silent; the review page supplies textual equivalents. Native video controls allow pausing and seeking. The prototype shows a persistent simulation notice.

## Reproduce

```sh
python3 -m http.server 4321 --bind 127.0.0.1
# In a second terminal:
CQ_TOOL_CHECKOUT=/workspace/q CQ_CHROMIUM=/usr/bin/chromium node design/relationship-hub/scripts/shots.mjs
CQ_TOOL_CHECKOUT=/workspace/q CQ_CHROMIUM=/usr/bin/chromium node design/relationship-hub/scripts/walkthroughs.mjs
```

Playwright is resolved from an existing checkout; no package changes are required. Playwright recording also requires its ffmpeg helper (`playwright install ffmpeg`), and conversion/validation requires system `ffmpeg` and `ffprobe`. In this cloud environment the installed system ffmpeg was linked into a temporary Playwright browser cache and selected with `PLAYWRIGHT_BROWSERS_PATH=/tmp/cq-hub-browser`. Generated intermediate WebM files are excluded; only MP4s and numeric validation receipts are review deliverables.

## Layout refinement

Actual 390px screenshots showed the prototype role switch clipping “Founder view”. The mobile notice now wraps and the role switch does not shrink. Existing mobile table stacking, bottom navigation, record tabs and Q sheet are preserved. Explicit keyboard focus is visible on mobile controls.

## Review boundaries

Investor and founder workspaces remain distinct; five assessment dimensions are not collapsed into an invented score. Historical contradictory evidence remains visible. Relationship stages are derived, and consequential actions require exact approval. Missing term-sheet navigation demonstrates a failure receipt. None of these simulations certify the corresponding production paths. Research remains in `docs/design/relationship-hub/research.md`.

Please review information density, mobile navigation, evidence provenance, the distinction between a recommendation and an action, and how Q returns to the original record. Production CRM implementation awaits owner design approval.

## Verified artifact evidence (2026-10-14 UTC)

76 screenshots were rendered in Chromium. Desktop overview, mobile investor/founder overview, mobile record/request layout, dark evidence and failed-Q sheet were visually inspected. The clipped mobile role selector was corrected and the corrected screenshot inspected. Full screenshot availability is not a claim that every screenshot received manual review.

Four MP4s decoded fully without ffmpeg errors. H.264/yuv420p and fast-start metadata provide browser playback compatibility. Durations: investor 18.52s, founder 13.56s, Q-navigation 32.88s, mobile 13.60s. Recorder captured no browser runtime errors; final desktop/mobile document widths equaled their 1440px/390px viewports. `review/videos/validation.json` records these measurements. This is design validation, not protected application CI or production acceptance.
