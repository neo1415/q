# The docked Board panel overlapped itself (owner screenshot, 6 Nov)

**Cause.** The Board's one-column, tabbed layout was switched by a viewport media query (`max-width: 760px`). The docked Board panel is about 350px wide on a desktop window, so it still drew the page's two-column grid: the timeline plus a 340px Pinned/Files rail. The empty-state heading, the rail and the suggestion pills overlapped.

**Fix (`c71eb2ee4`).** `.cq-board` is now a size container (`container: cq-board / inline-size`). The layout rules moved from `@media` to `@container cq-board (max-width: 760px)`; only the outer padding stays viewport-based.

**Check.** On production (fictional investor, 1280×720, Board docked), the fixed CSS was injected into the live page:

- `prod-before.png`: the overlap.
- `prod-after.png`: Timeline / Pinned 0 / Files 6 tabs with a clean file list.

Ships with CI on `c71eb2ee4`.

**Production (deployed `c71eb2ee4` at 10:45 UTC, CI 42201578294 all green):** `live-after-deploy.png` shows the docked Board with Timeline / Pinned 0 / Files 6 tabs and no overlap. No CSS was injected for this check. PASS.
