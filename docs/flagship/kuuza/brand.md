# KUUZA AI — brand kit, extracted from the public site

These assets and values were extracted from the public kuuza.ai site on 2026-10-18. The site is Next.js on Vercel, with the deployment id `dpl_DqfCsuuvg5rkffKE4be6F8dpDBf2` visible in asset URLs. Machine-readable values: [`brand.json`](brand.json).

**Usage terms:** the site publishes **no brand guidelines and no licence for its assets**, and its Terms and Privacy pages return 404. Treat every asset as the company's copyright. Use one in a Capital Q profile only with the founders' written permission, or replace it with founder-supplied files.

## Logos and wordmark

| Asset                                            | URL                                                                                                                                          | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary lockup, gradient mark and white wordmark | `https://www.kuuza.ai/logo-assets/Lockup%20PNG%2CSVG/Logo-Lock-Gradient.png`                                                                 | Used in the header and footer. The mark is a hexagon of horizontal stripes graded from crimson (top) to teal-grey (bottom). The wordmark "KUUZA AI" is in widely tracked, thin, geometric capitals. For dark backgrounds |
| Alternate lockup, Ice and Red                    | `https://www.kuuza.ai/logo-assets/Logo-Lock-Ice-Red.png`                                                                                     | Used in the footer and CTA area                                                                                                                                                                                          |
| Favicon                                          | `https://www.kuuza.ai/favicon.ico` (48×48)                                                                                                   |                                                                                                                                                                                                                          |
| SVG                                              | The folder name `Lockup PNG,SVG` suggests that SVGs exist, but `…/Logo-Lock-Gradient.svg` returns **404**. Ask the founders for vector files |                                                                                                                                                                                                                          |
| og:image / Twitter card                          | **None published.** The page has no `og:` tags; its meta description is "KUuZA - Innovative Solutions"                                       |                                                                                                                                                                                                                          |

## Colours

Each colour was found in the compiled Tailwind CSS (`/_next/static/chunks/05zxubf11s_zm.css`) as a named utility class or an arbitrary value. Usage counts come from the same CSS file.

| Token (site class) | HEX       | Where found                                                                                                                                              | Role                              |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `crimson`          | `#E9273B` | `.bg-crimson`, `.text-crimson` and `.border-crimson`. The most-used custom hex (16 uses). It matches the logo-mark red, which sampled at about `#E82038` | Primary brand accent, CTAs        |
| `charcoal`         | `#131313` | `.bg-charcoal`; `body{background-color:#131313}`                                                                                                         | Page background (dark-first site) |
| `ice-blue`         | `#EFF6FC` | `.bg-ice-blue`, `.text-ice-blue`. It matches the wordmark white, sampled at about `#E8F0F8`                                                              | Light text and wordmark           |
| `teal`             | `#7DBDC1` | `.bg-teal`, `.text-teal`. It matches the bottom of the logo-mark gradient                                                                                | Secondary accent                  |
| teal (deep)        | `#6AAEB2` | `.text-[#6aaeb2]`, `bg-[rgba(106,174,178,.1)]`                                                                                                           | Secondary accent, tints           |
| crimson (deep) 1   | `#A40F1E` | `.to-[#a40f1e]` gradient stop                                                                                                                            | Gradient end                      |
| crimson (deep) 2   | `#A4202D` | `.to-[#a4202d]` gradient stop                                                                                                                            | Gradient end                      |
| surface            | `#1A1A1A` | `.bg-[#1a1a1a]`, `.from-[#1a1a1a]`                                                                                                                       | Card and gradient start           |
| muted text         | `#9CA3AF` | `.text-text-subtle`                                                                                                                                      | Secondary text                    |

**Signature gradient:** `#1A1A1A → #A40F1E` (or `#A4202D`), a charcoal-to-deep-crimson linear gradient.

## Typography

- **Inter** is self-hosted as TTF in the 18pt optical size, Thin through Black with italics. Weights 200–800 appear in the CSS. The stack is `var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **JetBrains Mono** is referenced as `--font-jetbrains-mono` for numeric and UI accents.
- **Headings** are heavy-weight Inter with some uppercase tracked labels (`tracking-[0.2em]`, `uppercase tracking-wider`).

## Style notes

- Dark-first: black and charcoal backgrounds, white type, crimson CTAs, teal as a secondary accent.
- Photographic: smiling professionals of African heritage on calls and headsets. Hero stats sit in glass cards (`backdrop-blur-sm`), with "LIVE" session mock-ups and score chips.
- Emoji accents (🚀 🔥) appear in the hero stat chips.
- **Capital Q fit:** Capital Q's design rules prohibit raw hex in components and `backdrop-blur` everywhere. Map these colours to `--cq-*` tokens or to a venture-brand slot rather than copying them.

## Product imagery (from the site, `https://www.kuuza.ai` + path)

| Path                                                                                                                                                                          | Content and notes                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/images/founders.jpg`                                                                                                                                                        | Founders photo on /about. Personal likeness: needs consent                                                                                                                                          |
| `/images/features-analytics.jpg`                                                                                                                                              | Analytics-section photo carrying the "HQ: Nairobi, Kenya" overlay chip                                                                                                                              |
| `/images/features-hero.png`, `/images/hero-bg-2.png`, `/images/pricing-hero.jpg`, `/images/cs-hero-bg.jpg`, `/images/indivdual-hero.png`                                      | Page heroes                                                                                                                                                                                         |
| `/images/showcase-trainee.jpg`, `/images/showcase-coach.jpg`, `/images/facecard01.jpg`, `/images/photo-rounded.png`                                                           | Live-session UI showcase                                                                                                                                                                            |
| `/images/success-rita.jpg`, `/images/success-olabisi.jpg`, `/images/success-david.jpg`, `/images/success-setu.jpg`, `/images/success-fdn.jpg`, `/images/success-aviation.jpg` | Testimonial portraits and logos. These are real people's likenesses: do not reuse                                                                                                                   |
| `/images/f1.jpg` … `/images/f8.jpg`, `/images/614.jpg`                                                                                                                        | Feature tiles                                                                                                                                                                                       |
| `/images/fpkdl.com_750_1764538186_portrait-beautiful-smiling-black-woman_484921-108046.jpg`                                                                                   | The filename shows a **Freepik stock image** fetched through a downloader site (fpkdl.com). Licence status is UNKNOWN. **Do not reuse.** Flag it to the founders as an asset-licensing hygiene item |
| `/images/image_fx.png`, `/images/image_fxs.jpg`                                                                                                                               | Filenames suggest Google ImageFX AI-generated imagery (ASSUMPTION)                                                                                                                                  |
