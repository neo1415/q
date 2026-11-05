# Caption cues clear of the AI presenter's burned-in title — 2026-11-05 (`fix/caption-cue-placement`)

**Defect:** AI-presented pitches carry a lower third burned into the picture: "AI presenter · AI-generated", the company name and the founder line, from about 78% to 94% of the frame height. Our caption cue ended at 94%, right across it.

**Fix:**

- `player/ai-presenter.ts` holds `aiPresenterLine` (moved from `feed-card.tsx`, which re-exports it) and adds `BURNED_TITLE_TOP = 77`.
- `stageCueTop` takes an optional `burnedTitleTop`. The cue's foot ends 2% above whichever comes first: the app's words or the burned title.
- `placeCues` runs for AI-presented pitches in both the stage and inline players.
- Every other pitch is unchanged:
  - the stage keeps its previous rule;
  - the inline player keeps the browser's own placement.

**Measured:** Harbourline, Discover → Your companies (stage). Values are the active cue's placed top and estimated foot, in percent of the video height.

| Width | Before (production)                        | After (this branch, local against prod)      |
| ----- | ------------------------------------------ | -------------------------------------------- |
| 1440  | top 89.2%, foot 94%: over the burned title | top 70.2%, foot 75%: above the title (≤ 77%) |
| 390   | top 88.8%, foot 94%: over the burned title | top 69.8%, foot 75%: above the title         |

**Screenshots:**

- `before-harbourline-{1440,390}.png` and `after-harbourline-{1440,390}.png`.
- `compare.png` puts them side by side. In the 390 shots the arrival dialog covers the lower area.

**Non-AI-presenter pitch:** no unflagged, reachable pitch without the burned lower third turned up. In the two sweeps, every pitch without it carries captions in the picture, so it is flagged and has none of our cues. The unchanged rule for such pitches is pinned by unit tests instead:

- `stageCueTop` with `burnedTitleTop: null` equals the previous result;
- `burnedTitleTop` is null for a non-AI title.
