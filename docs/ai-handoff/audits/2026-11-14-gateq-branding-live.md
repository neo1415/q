# GateQ "Brand from website": live proof on real sites, 14 Nov 2026

This audit answers directive point 3 of `directives/2026-11-14-release-workflow-branding-q-voice.md`.

## Setup

- **Production:** `78f8d72d5`, which includes 995b1a0f9 and 12aec5edd. Migration `20261231580000` is applied.
- **Account:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`, the owner and admin of Kilima Angel Network (fictional). Signed in through the web form.
- **Browser:** Playwright with `/opt/pw-browsers/chromium`, deviceScaleFactor 2, at two sizes:
  - desktop: 1440×900;
  - phone: 390×844, with isMobile, hasTouch and an iPhone user agent.
- **Gateway:**
  - id `1b4dfdfb-8b5f-48a6-833d-0df9fce2b42f`;
  - publicId `gq_7aekqs9vfk8kvavm8k7tcacryn`;
  - organisation `68ecc541-f7fe-44ce-a57a-8cd06b68d9fd`;
  - investor organisation `3f414d21-9a8c-4d99-b97d-a5e91d84525f`.
- **Screenshots:** `docs/ai-handoff/evidence/2026-11-14-branding/`.
  - Element shots of the panel (`*-1-suggestion`, `*-2-preview-header`, `*-3-panel`).
  - Full-page shots of the public page and embed.
  - Before taking the panel shots, the script hid fixed and sticky overlays (the Q greeting bubble). Public pages were captured without hiding anything.
- **Scripts:** `scratchpad/b68brand/` (`site.cjs`, `pub.cjs`, `restore.cjs`) and `scratchpad/b67live/qbrand.cjs`. The scratchpad is not durable.

## Safety sequence

1. **Recorded the starting state** with hosted reads:
   - `core.investor_organisations.website_url` was **null** (version 4).
   - The latest appearance was revision 2, `82e0eec4-…`: no accent, no origins, no name, no logo.
   - The gateway was ACTIVE.
   - The original public page was captured (`00-original-public-{desktop,phone}.png`).
2. **Paused the gateway** from the Gate tab. While paused, `/g/<publicId>`, `/embed` and `/logo` all returned **404**. This was checked again after each save.
3. **Stripe, Flutterwave and Linear** were checked only in the admin's Gate-tab preview while the gateway was paused. Flutterwave was also saved while paused (revision 3); see Persistence.
4. **Capital Q's own site** was saved (revision 4). The gateway was then reopened, and the public page and embed were captured on desktop and phone.
5. **Restored** the original state; see Restore.

## How each website was set

| Site        | How it was set                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe      | The record had no website, so the Gate tab offered "Your firm's profile has no website yet…" (`stripe-desktop-0-no-website-form.png`). It was typed there, with "Save to profile and read". |
| Flutterwave | Edited on `/profile` (Website → Edit → Save), because a website was now on record.                                                                                                          |
| Linear      | Same as Flutterwave.                                                                                                                                                                        |
| Capital Q   | Same as Flutterwave.                                                                                                                                                                        |

## Acceptance matrix

| Site                                     | Name                                                                                                                                | Logo                                                                                                                                                                                                                                  | Colours                                                                                                                                                                                                    | Preview                                                                                                                           | Persistence                                                                                                                                                                                                                                                                                                          | Mobile (390)                         | Time      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------- |
| stripe.com (read as `/nl`, geo-redirect) | **FAIL**: the site name is the raw title "Stripe \| Financiële infrastructuur voor meer omzet". The profile name stays the default. | **PASS**: LOGO, SVG (inline header logo, sanitised), 1,916 B, 60×25 viewBox. It is the real Stripe wordmark, not a favicon.                                                                                                           | **NOT_FOUND**: `NO_COLOURS`. The CSS is on `b.stripecdn.com`, which is off-site so not fetched, and the page has no `theme-color`. The panel shows "No brand colour was found… Your current colour stays." | PASS: the wordmark and name are in the header (`stripe-*-2-preview-header.png`)                                                   | Not saved; Flutterwave was saved instead. The asset row `f7dadf7c-…` (image/svg+xml, 1,916 B, sha `266c92c5…`, source `https://stripe.com/nl`) was created at read time.                                                                                                                                             | PASS: same result, no overflow       | 1.2–1.7 s |
| flutterwave.com (read as `/us/`)         | **FAIL**: the site name is the raw title "Endless possibilities for every business - Flutterwave". The brand is the last segment.   | **PASS**: LOGO, SVG, 3,839 B, viewBox 1013×241 (drawn 300×71). It is the real full wordmark with mark.                                                                                                                                | **PASS**: raw `#262c55`. The AA accent is unchanged at `#262c55` (fill 12.6:1, text 13.3:1).                                                                                                               | PASS (`flutterwave-*-2-preview-header.png`)                                                                                       | **PASS while paused**: revision 3 `3fe3e08b-a671-407b-8fa4-719e5ee5119b` (accent `#262c55`, display_name as chosen, logo_asset_id `83d0e17a-a50d-417a-9a10-197088753349`). The asset is LOGO, image/svg+xml, 3,839 B, sha `a20504da…`, equal to the bytes read. `/g/<id>/logo` returns 404 while paused (by design). | PASS                                 | 1.1–1.6 s |
| linear.app                               | **NOT_FOUND**: `TOO_LARGE`                                                                                                          | **NOT_FOUND**: `TOO_LARGE`                                                                                                                                                                                                            | **NOT_FOUND**: `TOO_LARGE`                                                                                                                                                                                 | Fallback: the initial and the profile name, with the manual name, colour and embed fields still editable (`linear-*-3-panel.png`) | n/a                                                                                                                                                                                                                                                                                                                  | PASS (fallback renders, no overflow) | 1.2–1.6 s |
| capital-qweb-production.up.railway.app   | **PASS**: "Capital Q" (og:site_name or equivalent), offered beside the profile name                                                 | **ICON** (correctly not called a logo): PNG apple-touch-icon, 3,114 B, 180×180. The panel says "Only your website's icon was found, not a full logo…" and the icon is off by default. The site has no full-logo file it names as one. | **PASS**: raw `#8a6a12`. The AA accent is unchanged at `#8a6a12` (fill 4.8:1, text 5.1:1).                                                                                                                 | PASS (`capitalq-*-2-preview-header.png`)                                                                                          | **PASS**: revision 4 `7325c8d3-d219-45d8-9507-f90a08c00c2f` (display_name "Capital Q", accent `#8a6a12`, logo_asset_id `fb157864-3edd-4962-a0de-102795e378d6`). The asset is ICON, image/png, 3,114 B, sha `d580ed4d…`.                                                                                              | PASS: public page and embed on phone | 0.4–0.6 s |

Times run from the button press to the result on screen. They include the server action and the site fetch.

### Why Linear fails

`curl https://linear.app` returns 1,268,810 B of HTML. The reader's `HTML_MAX` is 1,000,000 (`packages/q-research/src/website-identity.ts:83`), so the vetted fetch refuses the page instead of reading its first 1 MB. Linear's `<head>`, which holds the meta, icons and manifest, sits well inside the first 1 MB.

Two reads (desktop and phone) gave the same result. The product's wording is "Your website's page was too large to read." The fallback is shown in `linear-desktop-3-panel.png`:

- the profile's name is kept;
- the initial is shown in place of a logo;
- the current colour is kept;
- the admin can type a name and pick a colour.

### Public proof (Capital Q only, gateway reopened)

- `/g/<publicId>` and `/embed` returned 200 on desktop and phone.
- The header bar shows the icon and "Capital Q", with `--cq-accent:#8a6a12`.
- Screenshots:
  - `capitalq-{desktop,phone}-6-public-page.png`
  - `capitalq-{desktop,phone}-6-public-embed.png`
  - `capitalq-desktop-5-open-admin-header.png`
- Every network request on all four pages went to `capital-qweb-production.up.railway.app`, so nothing was hot-linked. The only logo request was `/g/<publicId>/logo?v=fb157864…`.
- `GET /g/<publicId>/logo` returned:
  - status 200;
  - `image/png`, 3,114 B;
  - sha256 `d580ed4d5d2a258a44ff99abbaaf37e08e66e9efdd87a6dcbbc725a8de545286`, equal to the `gateway_logo_assets` row;
  - `X-Content-Type-Options: nosniff`;
  - CSP `default-src 'none'; sandbox`.

### Q turn

- On the Gate tab, Q was asked "brand my gateway from our website". It answered in about 75 s with an approval card, "Brand your gateway #8a6a12 · Any website may embed it", and the buttons Approve, Change it, Keep it with me and Drop (`q-turn-card-desktop.png`).
- The action is `aef973d2-47bb-4e24-9b39-dfe537dde739` (`app.gateway.appearance.set`). Its payload is `{accentHex:"#8a6a12", embedOrigins:[]}`, with **no name or logo**.
- It was not approved. It was dropped and is now REJECTED.

## Defects, ranked

1. **P2: the site name is taken from the raw `<title>`.**
   - What happens: Stripe reads as "Stripe | Financiële…" and Flutterwave as "Endless possibilities… - Flutterwave".
   - Cause: `nameFound` uses `markup.title` as it is. `siteNameOfTitle` is used only for the inline-SVG search, and it always takes the _first_ segment, which is wrong for Flutterwave.
   - Suggested fix: when the source is TITLE, prefer the segment that matches the domain label.
   - File: `packages/q-research/src/website-identity.ts:400-413` and `:308`.
2. **P2: a page over 1 MB is refused outright (linear.app).**
   - Suggested fix: read the first `HTML_MAX` bytes and parse the head, rather than failing as TOO_LARGE.
   - Files: `website-identity.ts:83` and the vetted-http truncation behaviour.
3. **P2: the admin preview loses the firm name and logo while paused**, and admins are told to pause before branding.
   - The header falls back to "Your firm" (`linear-*-2-preview-header.png`). Cause: `organisationName` comes from the public projection, which is null while paused (`apps/web/app/(app)/gateq/page.tsx:239`).
   - A saved logo shows as a broken image: naturalWidth is 0 in `flutterwave-save-desktop-4-reloaded-header.png`. Cause: it is drawn from `/g/<id>/logo`, which returns 404 while paused (`gateway-appearance.tsx:57-63`, `apps/api/src/http/gateq.ts:1055`).
4. **P2: brand colours are not found on sites whose CSS is on a CDN subdomain** (Stripe: `b.stripecdn.com`).
   - Cause: the same-site filter (`website-identity.ts:355-358`) skips them.
   - A possible fix is an allow-list of the site's own asset hosts that were linked from the page, still vetted.
5. **P3: Q's branding proposal carries only the accent.** It has no displayName or logoAssetId, so "brand my gateway from our website" through Q is partial. The likely file is the `app.gateway.appearance.set` Q tool mapping.
6. **P3: mixed name on the public page.**
   - The bar shows the gateway display name ("Capital Q"), but the heading still says "Apply to Kilima Angel Network (fictional)".
   - Product call: this may be intended, since the canonical name stays authoritative.
7. **Note: the sites are read from the Netherlands** (Railway europe-west4), so Stripe gives a Dutch locale. This is expected and not a defect.

## Restore

1. **Appearance:** saved from the Gate tab (Remove logo, empty name, empty colour, empty sites). This created **revision 5 `189da4de-9d28-4856-bd00-bea546c3ddd6`**, which equals revision 2: accent null, no name, no logo, origins `[]`. Revisions 1–4 are unchanged (append-only).
2. **Website:** cleared on `/profile` (Website → Edit → empty → Save; investor.profile.update). `website_url` is **null** again, at version 10.
3. **Gateway:** **ACTIVE** (Open to applications).
4. **Public page and embed:**
   - `/g/<publicId>` returns 200 with "K · Kilima Angel Network (fictional)" and no images.
   - `/logo` returns 404.
   - The embed's CSP is `frame-ancestors *`.
   - `99-restored-public-{desktop,phone}.png` are **pixel-identical** to `00-original-public-{desktop,phone}.png` (PIL difference bbox None).
   - The `#8a6a12` accent there is Capital Q's default.

## Cost

- One Q turn: 5 `ai_ops.model_usage` rows since 23:41Z for Njeri, **$0.054961**.
- The website reads make no model calls.
- Recorded with `test-budget.mjs record 5134080d 0.055 …` against the $0.15 ceiling.

## Re-check 15 Nov (30c99ccc5)

Production `30c99ccc5` (brand-name sources, 2 MB prefix, declared colours and first-party CDN stylesheets, paused admin preview with the saved logo, full Q proposal, public heading from the saved name). Same account, gateway, browser, sizes and safety sequence as above. Scripts: `scratchpad/b69brand/` (copies of `b68brand` plus `qbrand.cjs`, `drop.cjs`, `cmp.cjs`). Screenshots: `docs/ai-handoff/evidence/2026-11-15-branding/`.

### Starting state and safety

- `website_url` **null** (version 10); latest appearance revision 5 `189da4de-…` (all empty); gateway ACTIVE. Original public page captured (`00-original-public-{desktop,phone}.png`).
- Paused from the Gate tab before any third-party site. `/g/<publicId>`, `/embed` and `/logo` returned **404** while paused, also after each save. Unauthenticated `GET /gateq/logo/<gatewayId>` returns 307 to sign-in.
- Stripe, Flutterwave and Linear were shown only in the paused admin preview. Only Capital Q's own site was shown publicly.

### Acceptance matrix

| Site                                   | Name (value, source)                                    | Logo                                                                                                                      | Colour (raw → AA accent)                                                                                                                                 | Preview (desktop + phone)                                        | Saved while paused: admin preview after reload                                                                                                                        | Time (press → result) |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| stripe.com (read as `/nl`)             | **PASS** "Stripe", `SCHEMA_ORG` (was the raw title)     | **PASS** LOGO, SVG 1,916 B, viewBox 60×25, real wordmark                                                                  | **PASS (found)** `#b9b9f9` (secondary `#7f7dfc`) → `#6e6ca7` (4.5:1 / 4.8:1). Was NOT_FOUND. Note: a light tint, not Stripe's main `#635bff`             | PASS, no overflow                                                | **PASS** revision 6 `2ace2118-…` (Stripe, `#b9b9f9`, logo `f7dadf7c-…`). Header shows the wordmark from `/gateq/logo/<id>` (60×25 rendered) and "Stripe"              | 1.1–1.6 s             |
| flutterwave.com (read as `/us/`)       | **PASS** "Flutterwave", `OG_SITE_NAME` (was the slogan) | **PASS** LOGO, SVG 3,839 B, viewBox 1013×241, full wordmark                                                               | **PASS** `#262c55` → unchanged (12.6:1 / 13.3:1)                                                                                                         | PASS                                                             | not saved this time (saved on 14 Nov)                                                                                                                                 | 1.1 s                 |
| linear.app                             | **PASS** "Linear" (was TOO_LARGE)                       | **PASS** LOGO, SVG 3,092 B, viewBox 400×100 (drawn h 22), mark + wordmark                                                 | **NOT_FOUND** `NO_COLOURS`: the only declared colour is `theme-color #08090a`, filtered as not brand-like. The panel keeps the current colour, as worded | PASS (the profile name + logo; colour field says none was found) | **PASS** revision 7 `e9442643-…` (Linear, logo `9e83653e-…`, colour kept `#b9b9f9`). Header shows the logo (88×22 rendered) and "Linear", not "Your firm", not broken | 1.1 s                 |
| capital-qweb-production.up.railway.app | **PASS** "Capital Q", `OG_SITE_NAME`                    | **ICON** (correctly not a logo): PNG 3,114 B, 180×180; "Only your website's icon was found…", off by default and left off | **PASS** `#8a6a12` (secondary `#e2b858`) → unchanged (4.8:1 / 5.1:1)                                                                                     | PASS; header "C · Capital Q"                                     | revision 8 `323d37b7-…` (Capital Q, `#8a6a12`, no logo)                                                                                                               | 0.5 s                 |

### Q turn

- On the paused Gate tab, with Capital Q's site on record, Q was asked "brand my gateway from our website". The approval card appeared in about 73 s: "Brand your gateway #8a6a12 · Any website may embed it. Shown as Capital Q.", with Approve, Change it, Keep it with me and Drop (`q-turn-card-desktop.png`).
- The action is `902d4cf1-9c7b-4c9e-8321-b1be188604fd`. Its `proposed_payload.input` is `{accentHex:"#8a6a12", displayName:"Capital Q", embedOrigins:[]}`. It has no `logoAssetId`, which is correct, because only an icon was found and Q's path takes only a real logo.
- **Gap:** the card does not say that the icon was found and not used.
- Not approved. It was dropped and is now REJECTED.
- Cost: 4 `ai_ops.model_usage` rows, **$0.059370**.

### Public proof (Capital Q only, reopened)

- `/g/<publicId>` and `/embed` returned 200 on desktop and phone.
- The bar shows "C · Capital Q", the heading is now **"Apply to Capital Q"** (saved display name; the 14 Nov defect 6 is fixed) and `--cq-accent` is `#8a6a12`.
- Every request went to `capital-qweb-production.up.railway.app`. There is no image and no logo request, and `/logo` returns 404 because no logo was saved.
- Screenshots: `capitalq-{desktop,phone}-6-public-{page,embed}.png` and `capitalq-desktop-5-open-admin-header.png`.

### Defects now

1. **Fixed on 30c99ccc5:**
   - name from the raw title (14 Nov defect 1);
   - Linear TOO_LARGE (defect 2);
   - the paused preview losing the name and logo (defect 3: the saved logo renders through the authenticated `/gateq/logo/<id>`, and the name shows);
   - CDN colours for Stripe (defect 4);
   - Q proposal without a name (defect 5);
   - mixed public heading (defect 6).
2. **P3: the Q card is silent about the icon.** When only an icon is found, the card and the reply mention name and colour but not that the icon was left out. Users may expect a logo.
3. **P3: misleading save message while paused.** It reads "Saved. Your public gateway shows it now.", but the public page is 404 until the gateway is reopened.
4. **P3: Stripe's colour.** `#b9b9f9`, a light tint, was picked ahead of Stripe's main brand colour; the AA adjustment keeps it usable.
5. **P3: the name repeats beside a wordmark.** The preview header shows "Stripe" or "Linear" next to a wordmark that already spells it.
6. **Note: Linear's near-black `theme-color` is ignored.** This is by design (not brand-like); the panel says no colour was found.

### Restore

- **Appearance:** saved empty, giving **revision 9 `0c06e9bd-ec72-4d9a-b52a-d29042674e2a`**: accent null, no name, no logo, origins `[]`, equal to revision 5. Revisions 6–8 are unchanged (append-only).
- **Website:** cleared on `/profile`. `website_url` is **null** again (version 15).
- **Gateway:** **ACTIVE** (Open to applications).
- **Public page:**
  - it returns 200 with "K · Kilima Angel Network (fictional)" and no images;
  - `/logo` returns 404 and the embed's CSP is `frame-ancestors *`;
  - `99-restored-public-{desktop,phone}.png` are **pixel-identical** to `00-original-public-{desktop,phone}.png` (PIL difference bbox None, same capture method).

### Cost

$0.0594 for one Q turn. Recorded with `test-budget.mjs record 7fb77d6a 0.0594 …` against the $0.12 ceiling. The website reads make no model calls.
