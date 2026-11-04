# Client visual finish — 2026-11-04 (branch `feat/client-visual-finish`)

Account: `investor.savanna-seed@fictional.capitalq.local` (fictional), one-time admin magic link, service key read from Railway api variables in memory only. Screens are 2× device pixels.

- `before-*`: production, all four services on `06597e7c8`.
- `after-local-*`: this branch's web app run locally (`next dev`) against the production api and q-api. Not deployed. The round "N" badge at bottom left is Next's dev indicator, which is not shipped.

**Client WhatsApp screenshots:** none are in the repository (searched `docs/` for client, whatsapp and feedback PNG/JPG). The requirements below are the owner's written list.

**Q Chat (thread) view:** not captured. This investor has no conversation link in the chats list, and no Q turn was sent to make one (that would cost provider credit). The Q page shows the same composer and canvas.

| # | Requirement | Before | After (local) |
|---|---|---|---|
| 1 | Light theme: clean neutral white; gold only as the accent | `before-qpage-light-1440.png`: canvas `#fcfbf8` (cream), gold radial blooms in the page corners | `after-local-qpage-light-1440.png`, `after-local-qcard-light-1440.png`: canvas/surface/raised `#ffffff`, subtle `#f9f9f9`, sunken `#f4f4f4`, strong `#ececec`, borders `#ececec`/`#e0e0e0`/`#8f8f8f`, ink `#0d0d0d`, text `#4d4d4d`/`#666666`; no corner blooms |
| 2 | Dark theme: neutral charcoal, no navy or brown-black | `before-*-dark-*`: canvas `#0f0e0b`, ivory text `#f4efe2`, menu bar `#16140f` (all warm/brown) | `after-local-*-dark-*`: canvas `#212121`, surface `#262626`, raised `#2f2f2f`, sunken and menu bar `#171717`, text `#ececec`/`#c4c4c4`/`#a3a3a3`, borders `#333333`/`#424242`/`#757575` |
| 3 | Talk to Q: no rings, orbits or glows; one state-accurate indicator | `before-talk-2s-dark-1440.png`: gold dots running round every viewport edge, a wide halo and a whitened core behind Q, and an edge glow (QLumen) | `after-local-talk-2s-dark-1440.png`: the edge-dot flow, edge glow, halo and core light are all gone. Q's particle figure plus the "Connecting / Listening …" status line is the one indicator. Reduced motion is unchanged (the swarm's calm path) |
| 4 | No patterned wallpaper | grain and dot grid already removed (d79ff8c63); two gold radial blooms remained on `body::before` | `body::before` removed; flat canvas on every signed-in page (see the after-local Discover and Q Card shots) |
| 5 | Chat-first composer | composer and thread capped at 672 px with a hairline above the composer | 768 px (`max-w-3xl`), divider removed, pinned at the bottom; 390 px: `after-local-qpage-light-390.png` |
| 6 | Q Card | `before-qcard-*`: gold glow shadow plus a large decorative arc inside the card | flat ID card: gold edge, Q mark, portrait, name/role/organisation and QR; glow and arc removed; neutral card surface (`#f9f9f9` light, `#262626` dark) |

**Needs confirmation after deploy:**

- Production captures at the same views.
- The `theme-color` meta: `#ffffff` light, `#212121` dark.
- The PWA launch background: `#212121`.
- The splash colours.
- A voice session that reaches Listening and Speaking.
