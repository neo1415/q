# Capital Q: brand reference

The source of visual truth is the repository's semantic tokens in `packages/ui/src/tokens/tokens.css`. Per ADR-001, tokens use the `--cq-*` prefix only.

- **Colour format.** Tokens are authored in OKLCH. The HEX values below were converted with the standard OKLab → sRGB matrices and gamut-clipped, so they are approximations. Use the OKLCH originals in code.
- **Usage terms.** Capital Q assets are the owner's. Components must use the tokens, never raw hex (root `CLAUDE.md`). The design amendments are ADR 0017 and `docs/design/ux-direction-2026-09.md`.

## Logo, wordmark and marks

| Asset                        | Path                                                                                                                               | Notes                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| App icon (SVG)               | `apps/web/app/icon.svg`                                                                                                            | A magnifier-like "Q": ring and tail stroke `#C9A227`, inner dot `#E2B858`, on a rounded square `#16140F`                                             |
| PWA icons (PNG)              | `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (`?v=gold`)                  | Gold variant                                                                                                                                         |
| Favicon                      | `apps/web/app/favicon.ico`                                                                                                         |                                                                                                                                                      |
| "Capital" splash wordmark    | `apps/web/src/features/splash/capital-wordmark.tsx`                                                                                | A title-case italic serif drawn as an outlined vector SVG path, so no font file is needed. Uses `currentColor`.                                      |
| Q mark                       | `packages/ui/src/patterns/q-mark.tsx`                                                                                              | A word-mark in an accent frame (doc 18 §33). "Not a mascot, not a sparkle, not an orb." State is shown by frame tone and always accompanied by text. |
| Public landing imagery (FDN) | https://www.fdncapitalpartners.com/assets/img/cq-hero-desk.webp, `cq-feat-q-0923.webp`, `cq-journey-1-0922b.webp`, `intel-bg.webp` | Hosted by FDN Capital Partners on the CapitalQ™ page. Usage requires FDN's permission.                                                               |

The PWA manifest name is "Capital Q", with `background_color` `#0B0A08` and `theme_color` = the light canvas token (`apps/web/app/manifest.ts`).

## Core colour tokens

| Token                 | Light OKLCH           | Light HEX | Dark HEX |
| --------------------- | --------------------- | --------- | -------- |
| `--cq-canvas`         | oklch(0.985 0.004 92) | #FBFAF7   | #0B0D12  |
| `--cq-surface`        | oklch(0.995 0.002 92) | #FEFDFC   | #111418  |
| `--cq-surface-raised` | oklch(1 0 0)          | #FFFFFF   | #171B20  |
| `--cq-surface-subtle` | oklch(0.965 0.005 92) | #F4F3F0   | #1C1F24  |
| `--cq-surface-strong` | oklch(0.925 0.007 92) | #E8E6E1   | #2B2E33  |
| `--cq-text-primary`   | oklch(0.19 0.012 258) | #101419   | #EFEEEB  |
| `--cq-text-secondary` | oklch(0.43 0.012 258) | #4C5057   | #ABAEB3  |
| `--cq-text-tertiary`  | oklch(0.53 0.01 258)  | #686C72   | #86898E  |
| `--cq-border`         | oklch(0.86 0.008 258) | #CED1D6   | #34383E  |
| `--cq-accent`         | oklch(0.53 0.18 258)  | #1767D1   | #66A5FF  |
| `--cq-accent-hover`   | oklch(0.48 0.18 258)  | #0057C0   | #77B2FF  |
| `--cq-accent-soft`    | oklch(0.94 0.035 258) | #DDECFF   | #132643  |
| `--cq-positive`       | oklch(0.5 0.13 151)   | #0D773A   | #67BA7D  |
| `--cq-warning`        | oklch(0.53 0.12 70)   | #975D00   | #E5B15B  |
| `--cq-danger`         | oklch(0.56 0.2 27)    | #D02C2A   | #F27166  |

**Verified-gold metal** (used only by `.cq-verified-badge`, founder 2026-10-11):

| Token                 | Light HEX | Dark HEX |
| --------------------- | --------- | -------- |
| `--cq-gold-highlight` | #FDE7A2   | #F6DD90  |
| `--cq-gold-light`     | #F2CD64   | #E8C35A  |
| `--cq-gold-mid`       | #E0AF3B   | #D6A62E  |
| `--cq-gold-deep`      | #BF8B1F   | #B5820C  |
| `--cq-gold-edge`      | #845A0F   | #E2C06D  |
| `--cq-gold-ink`       | #231200   | #1C0E00  |

**Stage, Q card and Q presence tokens:**

- `--cq-stage-canvas`: #0B0F18.
- `--cq-stage-accent`: #77B2FF.
- `--cq-qcard-edge`: #3280DD (light) / #4C99F8 (dark).
- `--cq-q-light`: #005BD2 (light) / #88BFFF (dark).
- `--cq-q-core`: #FFFBF3.

Under ADR 0017, glow is allowed on Q only.

## Typography

- `--cq-font-ui`: `-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. This is the native platform sans, with no download (founder directive 2026-09-28).
- `--cq-font-mono`: `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`. Geist Mono is also loaded locally in `apps/web/app/layout.tsx` as `--font-geist-mono`.
- `--cq-font-editorial`: `Georgia, "Times New Roman", Times, serif`. Used for Q Daily mastheads only.

## Prohibitions (root `CLAUDE.md`)

The following are prohibited:

- glowing brains;
- robot heads;
- neural particles;
- purple-blue AI gradients;
- Sparkles as the Q icon;
- gradient headings;
- `backdrop-blur` everywhere;
- badge spam;
- uppercase tracking-widest eyebrows.

Other rules:

- Pass is neutral, not red.
- Never communicate meaning by colour alone.
- Light mode is first-class, and the target is WCAG 2.2 AA.
