# Live check: caption cue placement on production (`c7536d46d`) — 2026-11-05

**Build:** Railway web reached SUCCESS on `c7536d46d` at 06:11Z (deployment created 06:05:07Z). Rollback for web is `a452c84fc`.

**Method:** the same script and method as the local after-measurement:

- account `investor.savanna-seed@fictional.capitalq.local`, reads only, no Q turns;
- Discover → Your companies, Harbourline (stage player).
- Values are the active cue's placed top and estimated foot, in percent of the video height.
- The burned lower third starts at about 78%; the title-safe line is 77%.

| Width | Cue top | Cue foot | Result                                                                             |
| ----- | ------- | -------- | ---------------------------------------------------------------------------------- |
| 1440  | 70.2%   | 75%      | **PASS**: above the burned "AI presenter · AI-generated / Harbourline Cargo" title |
| 390   | 69.8%   | 75%      | **PASS**: above the title (the arrival dialog covers the lower area in this shot)  |

**Before, on production at the previous build:** the cue foot was 94%, over the title. See `before-harbourline-*.png`.

**Screenshots:** `live-harbourline-1440.png`, `live-harbourline-390.png`, `live-compare.png`.
