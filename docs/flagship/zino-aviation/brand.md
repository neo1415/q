# Zino Aviation: brand reference

Observed 2026-10-18 from public page source. All assets belong to Zino Aviation. **No public usage licence or brand guidelines were found**, so obtain written permission before reproducing logos or photographs. Unsplash images on the Jet site are under the Unsplash licence, which belongs to their photographers rather than to Zino.

## Logos and wordmark

| Asset                         | URL                                                                                | Notes                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Gold logo (SVG)               | https://jet.zinoaviation.com/assets/img/logo-gold.svg                              | Gold gradient fills (#B0974B to #BEA85F) with white. Same file as the gateway logo. |
| Black logo (SVG)              | https://jet.zinoaviation.com/assets/img/logo-black.svg                             | Single fill, #000000                                                                |
| Gateway logo (SVG)            | https://www.zinoaviation.com/assets/logo.svg                                       | Byte-identical in size to logo-gold.svg (30,898 B)                                  |
| Academy white logo (PNG, Wix) | https://static.wixstatic.com/media/ad758c_6a67a7219fe142ce812f6d0d795c1372~mv2.png | Alt text "White logo.png"                                                           |

The wordmark text is "ZINO". The Jet sub-brand is styled "Zino Aviation Jet(s)", and the Academy sub-brand is "Zino Aviation Academy".

## Colours

**Jet site.** Source: `https://jet.zinoaviation.com/css/style.css?v=20261006a`, `:root` custom properties. The gateway page repeats `--gold` and `--gold-light` inline.

| Token              | HEX     | Role (inferred)                                 |
| ------------------ | ------- | ----------------------------------------------- |
| `--gold`           | #B59B48 | Primary accent                                  |
| `--gold-light`     | #D9C48A | Highlights                                      |
| `--gold-dark`      | #8A7434 | Pressed/hover, text on cream                    |
| `--navy` / `--ink` | #222222 | Primary dark (named "navy", but it is charcoal) |
| `--navy-2`         | #141414 | Deeper dark surfaces                            |
| `--ink-soft`       | #7A7A7A | Secondary text                                  |
| `--paper`          | #FFFFFF | Background                                      |
| `--cream`          | #F6F4EF | Warm background                                 |
| `--line`           | #E7E2D6 | Hairlines                                       |

Other literals in the stylesheet include #1B190F, #0E0E0E, #C9AD5F and #D8BF78.

**Academy site.** Source: Wix theme palette (`color_N` RGB variables in the page source of https://academy.zinoaviation.com/).

| Wix var  | HEX                         |
| -------- | --------------------------- |
| color_18 | #EBC64D (gold)              |
| color_19 | #9D8433 (dark gold)         |
| color_17 | #F2DFA0                     |
| color_15 | #282828                     |
| color_23 | #E34110 (accent orange-red) |

## Typography

**Jet:**

- Sans: **Poppins** (Google Fonts, weights 300–800), set as `--sans`.
- Serif: `--serif: 'ZA Trademark', 'GT Alpina', 'Cormorant Garamond', Georgia, serif`.
  - GT Alpina is self-hosted woff2 under `/assets/fonts/`. It is a commercial Grilli Type face, so its licence must cover any reuse.
  - "ZA Trademark" appears to be a custom brand face.
- Also loaded: **Jost** and **Cormorant Garamond** (Google Fonts). The gateway loads Jost and Poppins.

**Academy (Wix):** Avenir LT (35 Light, 85 Heavy) and an uploaded custom font, "aileron heavy".

## Imagery

- **Jet local images:**
  - `https://jet.zinoaviation.com/assets/img/Businessman_in_private_jet_2K_202607211129.jpeg` (the filename suggests a generated or stock render; its provenance is UNKNOWN)
  - `https://jet.zinoaviation.com/assets/img/crew-cabin-welcome.jpeg`
  - `https://jet.zinoaviation.com/assets/img/jv-selection-feature.jpg`
- **Gateway cards:** https://www.zinoaviation.com/assets/img/gw-jet.jpg and https://www.zinoaviation.com/assets/img/gw-academy.jpg
- **Jet Unsplash images**, for example https://images.unsplash.com/photo-1540962351504-03099e0a754b. Seven IDs are listed in `brand.json`.
- **Academy OG image:** https://static.wixstatic.com/media/ad758c_6f412f4c1cbf4a1280687af85c6a8382~mv2.jpg
- **zinomario.com OG image:** https://static.wixstatic.com/media/ad758c_ff257c7dc8a24fd38df3f54884f0a0a0~mv2.jpg

## Voice

- **Taglines:** "Private Aviation, Simplified." (Jet); "Stop Dreaming Start Flying" (Academy); "Every detail, thoughtfully arranged." (Journey Concierge).
- **Tone:** luxury, discreet, gold-on-charcoal.
- **Marketing superlatives** ("world's first and leading", "state-of-the-art") are unverified and should not be repeated as fact.
