# SongScribe AI — brand kit, extracted from the public site

These assets and values were extracted from songscribe.ai on 2026-10-18. The site is Next.js, with `dpl_DyihGKC4SRas2mu3UtUGMEqopFf1` in asset URLs. Machine-readable values: [`brand.json`](brand.json).

**Usage terms:**

- The site publishes **no brand guidelines and no asset licence**. The footer reads "© 2026 SongScribe AI. All rights reserved."
- Treat logos, imagery and the sample audio and cover art as the company's copyright.
- The sample songs contain real people's names (for example "Bella", "Jay", "Shenequa", "Shola & Shade"). Do not reuse them in a Capital Q demo without the founders' written permission.

## Logos and wordmark

| Asset          | URL                                                                                                                                                                                                            | Notes                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary logo   | `https://www.songscribe.ai/images/songscribe-logo.png`                                                                                                                                                         | PNG, 588×146 source and 206×51 display. A white ribbon or flame-like "S" glyph on the left, then "**SONG**" in bold red and "**SCRIBE**" in bold white sans. For dark backgrounds |
| Favicon        | `https://www.songscribe.ai/favicon.ico` (48×48)                                                                                                                                                                |                                                                                                                                                                                   |
| SVG            | `/images/songscribe-logo.svg` returns **404**. Ask the founders for vector files                                                                                                                               |                                                                                                                                                                                   |
| og:image       | **None.** `og:title`, `og:description` and `twitter:card=summary_large_image` are set, but no image is; `/opengraph-image` returns 404                                                                         |                                                                                                                                                                                   |
| UI icons (SVG) | `/images/icon-business.svg`, `/images/icon-creators.svg`, `/images/icon-personal.svg`, `/images/icon-check.svg`, `/images/step-story-icon.svg`, `/images/step-create-icon.svg`, `/images/step-refine-icon.svg` | Preloaded on the home page                                                                                                                                                        |

## Colours

**Sources:**

- home-page HTML Tailwind arbitrary classes, with use counts;
- compiled CSS `/_next/static/immutable/chunks/3-7na4sx69238.css`;
- the logo PNG, sampled.

| Role                  | HEX       | Where found                                                                                          |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| **Primary red** (CTA) | `#E63946` | `bg-[#e63946]` ×151 and `text-[#e63946]` ×36 in the home HTML; the most frequent hex in the CSS (53) |
| Logo / heading red    | `#DC2B3C` | `text-[#dc2b3c]` ×14 and `bg-[#dc2b3c]`; the logo "SONG" samples at about `#D82838`                  |
| Red hover             | `#D32F3C` | `bg-[#d32f3c]` ×8                                                                                    |
| Red pressed / deep    | `#C22533` | `bg-[#c22533]`                                                                                       |
| Deep maroon           | `#7F1D1D` | `bg-[#7f1d1d]`                                                                                       |
| Background            | `#0A0A0A` | `bg-[#0a0a0a]`; the shadcn `--background` in dark mode                                               |
| Background (deepest)  | `#050505` | `bg-[#050505]`                                                                                       |
| Body text (muted)     | `#9CA3AF` | `text-[#9ca3af]` ×55                                                                                 |
| Body text (light)     | `#D1D5DB` | `text-[#d1d5db]` ×28                                                                                 |
| Light surface         | `#FAFAFA` | the shadcn `--accent-foreground` and `--background` (light mode), in the CSS                         |
| Accent amber          | `#F59E0B` | `.bg-[#F59E0B]` in the CSS ("Popular" or status chips)                                               |

## Typography

- **Inter**, from `next/font` (body class `inter_…__variable`; `font-family: Inter, Inter Fallback`). Used for body and UI.
- **Space Grotesk**, from `next/font` (body class `space_grotesk_…__variable`; `--font-space-grotesk`). Used for display and headings (ASSUMPTION, from the class usage).
- **Geist Mono** is referenced as `--font-geist-mono`, for mono accents.

## Style notes

- Dark, cinematic look: near-black backgrounds, bold red CTAs and the red "SONG" half of the wordmark.
- Lifestyle photography: couples, studio producers, business meetings.
- Built with shadcn/ui on Radix: accordion FAQ, `data-radix-collection-item`.
- The CTA is repeated many times ("Try Free Demo").
- Each sample card carries square cover art, a genre tag, a duration and a one-line description in quotes.
- **Capital Q fit:** map these colours to `--cq-*` venture-brand tokens. Do not hard-code the hexes in components.

## Product imagery

Site images (`https://www.songscribe.ai` + path):

- `/images/hero-couple.jpg` (hero)
- `/images/card-personal.jpg`, `/images/card-creators.jpg`, `/images/card-business.jpg` (segment cards)
- `/images/section-usecases-bg.jpg`, `/images/business-meeting.jpg`, `/images/final-cta-bg.jpg`, `/images/pricing-section-bg.jpg`
- `/images/samples-hero-bg.png`, `/images/samples-cta-bg.jpg`
- `/images/licensing-hero-bg.jpg`, `/images/licensing-cards-bg.jpg`, `/images/licensing-enterprise-bg.jpg`, `/images/licensing-cta-bg.jpg`
- `/images/bubble-top-left.jpg` (and the matching `-top-right`, `-bottom-left`, `-bottom-right` files)
- `/images/faq-support-bg.jpg` ("Producer in studio")

**Sample cover art** sits in a public Cloudflare R2 bucket, `https://pub-dac0caed4dc94ff68cc15f3661cbee79.r2.dev/…`. There are 23 covers on /samples. For example:

- `…/Personal%20Gifts/Bella%20My%20Forever%20Love/For%20Bella.png`
- `…/Beats/Instrumentals/Afrolove%20Afrobeat/Afrolove%20Afrobeat.png`

The audio files load client-side and their URLs were not enumerated. The licence status of the photography (stock or commissioned) is UNKNOWN.
