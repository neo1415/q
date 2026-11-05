# Your companies video at every desktop width — 2026-11-05 (`fix/discover-yours-1024`)

**Defect:** at 1024px the Your companies video was only about 112px wide. `--cq-feed-video-h` subtracted a fixed 440px panel and a 232px rail reserve from about 784px.

**Fix:** CSS only, in `apps/web/app/globals.css`:

- `.cq-yours-card` now carries `--cq-yours-panel` and `--cq-yours-reserve`:
  - 320px / 204px from 1024 to 1279px;
  - 440px / 232px from 1280px, the same values as before.
- The grid, the video height and the rail and skeleton-rail offsets read these variables, with a 440px fallback, so For you is unchanged.
- The tabs rule follows the same breakpoint: top of the panel, at `100% - panel + 18px`.

**Browser-measured check:** local `next dev` against the production API, reads only, fictional investor. The script is in `yours-layout-check.mjs.txt`. Values are in CSS px; tabs, rail and panel are left edges or left–right ranges.

| Width | Tab            | Video (w×h)             | Tabs                   | Rail           | Panel left | Tabs over video              | Rail over video or panel |
| ----- | -------------- | ----------------------- | ---------------------- | -------------- | ---------- | ---------------------------- | ------------------------ |
| 1024  | Your companies | 260×462 (was ~112 wide) | 722–937                | 616–688        | 704        | no                           | no                       |
| 1152  | Your companies | 388×690                 | 850–1065               | 744–816        | 832        | no                           | no                       |
| 1280  | Your companies | 368×654 (unchanged)     | 858–1073               | 738–810        | 840        | no                           | no                       |
| 1440  | Your companies | 479×852 (unchanged)     | 1018–1233              | 874–946        | 1000       | no                           | no                       |
| 1440  | For you        | 479×852 (unchanged)     | 781–996                | —              | —          | no                           | —                        |
| 390   | Your companies | full screen             | centred over the stage | over the stage | —          | by design (phone, unchanged) | by design                |

**Out of scope, noted:** For you at 1024 shows a 176×313 video. Its own formula keeps at least 560px for the dossier, so it is small but readable, and unchanged here.
