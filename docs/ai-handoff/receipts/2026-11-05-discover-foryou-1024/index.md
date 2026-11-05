# For you video at 1024–1279 — 2026-11-05 (`fix/discover-foryou-1024`)

**Defect:** at 1024px the For you pitch was 176×313. `--cq-feed-video-h` always kept 560px + 48px for the dossier.

**Fix:** CSS only, in `apps/web/app/globals.css`:

- `.cq-feed-stage` carries `--cq-foryou-dossier`: 480px from 1024 to 1279px, and 560px from 1280px, which is unchanged.
- The desktop tabs offset follows the same breakpoint (`100% - 528px` below 1280, `100% - 608px` from 1280).

**Browser-measured check:** local `next dev` against the production API, reads only, fictional investor. The script is in `foryou-layout-check.mjs.txt`. Values are in CSS px; tabs and dossier are left–right ranges.

| Width       | Tab            | Video (w×h)                   | Dossier        | Tabs                   | Overlaps                     |
| ----------- | -------------- | ----------------------------- | -------------- | ---------------------- | ---------------------------- |
| 1024        | For you        | 256×455 (was 176×313)         | 544–1024 (480) | 558–773                | none                         |
| 1152        | For you        | 384×683                       | 672–1152       | 686–901                | none                         |
| 1279        | For you        | 479×852 (height-capped)       | 767–1279       | 781–996                | none                         |
| 1280        | For you        | 432×768 (unchanged)           | 720–1280       | 734–949                | none                         |
| 1440        | For you        | 479×852 (unchanged)           | 767–1440       | 781–996                | none                         |
| 1024 / 1440 | Your companies | 260×462 / 479×852 (unchanged) | —              | —                      | none                         |
| 390         | For you        | full screen                   | —              | centred over the stage | by design (phone, unchanged) |

**Notes:**

- At 1024 the dossier's filter chips and "Ask Q" wrap onto a second line. Everything stays visible and usable.
- From 1279 to 1280 the video steps down by 47px, because 1280 keeps its previous size.

**Separate, pre-existing issue, not changed:** two caption layers sometimes draw on top of each other inside the video (`foryou-1024.png`; also visible in the earlier Your companies shots).
