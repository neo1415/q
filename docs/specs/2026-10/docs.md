# DOCS: Q's document studio (2026-10)

Owner: DOCS worker, branch `build/docs`. Migration prefix `202611130*`.
Controlling sources: CLAUDE.md, ADR 0011, 0013, 0017, 0025, QX-003/QX-004
(artifact and deck contracts in `packages/contracts/src/q/artifact.ts`),
BIZ-001 (export), BIZ-005 (brand kit), docs 17-18 (UX, visual design).

## 1. Goals, in the founder's words

> An agent focused on creating documents (images, colours, fonts, designs,
> pictures, graphs, formatting) and proactive about it, so a person can
> easily create and edit pitch decks and other documents from anywhere (any
> Q surface, text or voice).

Broken into what we build:

| #   | Goal                                                           | What exists (d1190e45)                                                                                                                 | What DOCS adds                                                                                                                   |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Decks and documents from any Q surface                         | Home Q hands `document.*` (PITCH_DECK, INVESTMENT_BRIEF, OWN_MANDATE, ANSWER_EXPORT, Q_REPORT); onboarding deck offer; Home deck offer | The existing `document.*` hands (every Q surface runs the Home Q path), the Documents page, and a toast wherever the person is   |
| G2  | Brand kit: logo, colours, fonts, extracted / asked / confirmed | `BrandInput` seam in deck-render (direction + accent only)                                                                             | `artifacts.brand_kit_versions`, website extraction as recommendations, confirmation, applied to every render                     |
| G3  | Multiple specialist steps                                      | Compose from findings, Pexels photos, ARTIFACT_REVISION v3, layout inspector                                                           | Pipeline: compose → design direction → brand → imagery → charts → words → audit, each step a function with a test                |
| G4  | Charts from their real numbers, never invented                 | COLUMN only, grounding sentence                                                                                                        | BAR, COLUMN, LINE, DONUT drawn properly; source line on the slide; provenance audit that blocks any figure not in the grounding  |
| G5  | Words that do not look AI-written                              | Bullets are finding statements                                                                                                         | DOCUMENT_POLISH v1 model pass (conclusion titles, plain words), figure-checked, falls back to the original                       |
| G6  | Ready/revised document pops up anywhere, open or download      | Card polls while PREPARING inside the conversation only                                                                                | One `DocumentReadyCenter` in the app shell: toast card on every page, Open (viewer) / PDF / PPTX                                 |
| G7  | Export any Q answer as a PDF                                   | ANSWER_EXPORT hand (Q decides)                                                                                                         | A "PDF" control on every answer → same deterministic composer → toast                                                            |
| G8  | Q edits any document it made, new version, never overwrite     | `revise_my_document` (core tool), append-only versions                                                                                 | Brand re-application and audit notes reach the revision; unchanged contract                                                      |
| G9  | Proactive                                                      | Home deck offer once                                                                                                                   | After a deck is made, Q names the top audit gaps ("no traction figures on record") and offers the fix; Documents page shows them |
| G10 | Newspaper layouts later (DAILY)                                | n/a                                                                                                                                    | Template/block interface documented here (§7); DAILY adds the template                                                           |

## 2. Research findings (with sources)

**Deck structure and attention.** Investors spend under four minutes on a
seed deck and the first slide gets more than twice the attention of any
other; titles should state the conclusion ("Revenue grew 3.4x in 12
months", not "Traction"); funded decks scored markedly higher on design
([DocSend/Papermark figures via presentations.ai](https://www.presentations.ai/blog/pitch-deck-statistics);
[ManyPixels 2026 guide](https://www.manypixels.co/blog/presentations/pitch-deck-design);
[Visme structure](https://visme.co/blog/pitch-deck-structure/)).
Consequences: the cover carries the company name, one-line description and
logo; slide order stays problem/what we do → product → market → model →
traction → team → raise (the existing `DECK_ORDER`); the words pass rewrites
titles as conclusions only when the conclusion is already in the slide's
own grounded words.

**How generators structure it.** Gamma: input (prompt, outline, document,
URL) → full structured draft (text, images, layout) → refinement by an
agent that restyles and rewrites
([Gamma guide](https://gamma.app/explore/content/guides/what-is-gamma-and-how-does-it-use-ai-to-build-presentations)).
Beautiful.ai: "smart slides" whose layout is a rule system: hierarchy,
spacing, alignment and type are enforced and rebalance as content changes,
so a person "cannot make an ugly slide"
([Beautiful.ai design rules](https://www.beautiful.ai/blog/ai-can-build-slides-fast--but-great-presentations-still-need-design-rules)).
Consequences: we keep the Beautiful.ai model (the deterministic layout in
`deck-render` owns all geometry; the model never emits sizes or positions)
and the Gamma loop (draft, then an agent that revises by instruction).

**Charts.** Bar lengths start at zero; label directly rather than with a
legend; remove non-data ink; source at the bottom left; never encode by
colour alone; colour-blind-safe palettes
([UK Analysis Function checklist](https://analysisfunction.civilservice.gov.uk/policy-store/charts-a-checklist);
[IPA principles](https://data.poverty-action.org/data-science/data-visualization/communicating/data-visualization-principles.html)).
Consequences: one series per chart in the accent colour (so colour never
carries meaning); values printed on every bar/point; zero baseline for BAR
and COLUMN; LINE only for an ordered sequence; DONUT only for parts of a
whole that sum to a stated total, otherwise refused to BAR; a "Source:" line
under every chart.

**AI-looking prose.** Recognisable tells: inflated vocabulary ("delve",
"tapestry", "pivotal", "landscape", "testament"), em dashes for emphasis,
reflexive triplets, "it's not X, it's Y", formatting overkill
([Pangram](https://www.pangram.com/signs-of-ai-writing);
[Wikipedia-derived summary](https://worldcomgroup.com/es/insights/how-to-spot-ai-writing-tips-from-wikipedia-on/)).
Consequence: the polish prompt states these as style rules for the model
(ADR 0011: meaning by model; no word list in code over anybody's words).
Code checks only what code can: no new figure, length bounds.

**Typography.** OFL families suit a document product (free incl.
commercial use, embeddable): Inter / Source Sans for body, Source Serif 4,
IBM Plex Serif or Fraunces for headings
([OFL list](https://openfontlicense.org/ofl-fonts/);
[Inter + IBM Plex Serif](https://maxibestof.one/typefaces/inter/pairing/ibm-plex-serif)).
Consequences: four curated pairings are reference data (§4.3). PPTX names
the chosen fonts (PowerPoint substitutes if absent); the PDF embeds the
bundled Noto Sans (full Unicode, ₦ and Yoruba diacritics; see `fonts.ts`)
and the deck records the pairing so a later build that bundles the faces
draws them without a data change.

**Accessible colour.** WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large
text. A brand colour too light for text is used as a fill, never as ink;
ink is chosen as black or white, whichever reads, unless the person chose
one (ADR 0025: their choice applies and the inspector reports it).

## 3. UX flows

**F1 Create from anywhere.** "Make me a pitch deck" / "turn this into a
one-pager" / "write up the call as a report" on Home Q, the Q sheet on any
page, or voice → the existing `document.*` hands → stage
line "Preparing the document" → answer says it is being made → when READY
the toast appears on whatever page the person is on.

**F2 Document-ready toast.** Bottom-right on desktop, above the bottom nav
on phones; one card per document (max three stacked, newest on top):
type icon, title, "Ready" or "Version 3 ready", buttons **Open** (opens the
viewer in place), **PDF**, **PPTX** (decks only), and a close (×, 44px).
Stays until dismissed while hovered or focused; otherwise leaves after
12 s. `role="status"`, `aria-live="polite"`. Reduced motion: no slide-in,
opacity only. Same card component everywhere; one owner component
(`DocumentReadyCenter`) mounted once in the app shell.

**F3 Edit.** "Make the cover green", "shorten slide 4", "use my brand" →
`revise_my_document` → new version, earlier kept → toast "Version N ready".

**F4 Brand kit.** Documents page → Brand: logo, colours (primary,
secondary, background, text), heading/body font pairing. Sources: (a) Q
reads the company website (theme colour, CSS colours by frequency, font
families, logo/icon) and shows them as **Suggested** with the source URL;
(b) the person uploads a logo / picks colours; (c) Q recommends a pairing
and palette from the sector's design direction. Nothing is applied until
the person presses **Use this brand** (or edits values themselves, which
is a declaration). "Apply to my deck" makes a new version.

**F5 Answer to PDF.** Every Q answer with text has a quiet "PDF" control
in its action row → server files it as an ANSWER_EXPORT document (exactly
the words shown) → toast with Download.

**F6 Proactive.** After a deck is prepared, its audit is on the version;
Q's answer and the Documents page list at most three suggestions ("No
traction figures on record: tell me your monthly revenue and I'll chart
it"). Q never fills one in itself.

**States.** Documents page: loading skeleton rows; empty ("No documents
yet. Ask Q for a deck, a one-pager or a report." + one button that opens
Q with that prompt); error with Retry. Toast: preparing never shows a
toast (cards show progress); FAILED shows a toast "Q couldn't finish
<title>" with "Try again" that opens Q. Light + dark via `--cq-*` tokens;
phone + desktop.

## 4. Data model and contracts

### 4.1 Migration `20261113000000_artifacts_brand_kits.sql`

`artifacts.brand_kit_versions` (server-only, RLS on, no browser grant, the
same posture as `artifacts.artifacts`):

| column                     | type        | note                                                    |
| -------------------------- | ----------- | ------------------------------------------------------- |
| id                         | uuid pk     |                                                         |
| tenant_id, organisation_id | uuid        | FK to identity.organisations (id, tenant_id)            |
| company_id                 | uuid null   | FK core.companies                                       |
| version                    | int ≥1      | unique (organisation_id, version)                       |
| status                     | text        | `RECOMMENDED` · `CONFIRMED` · `DECLINED`                |
| source                     | text        | `WEBSITE` · `PERSON` · `Q_DESIGN`                       |
| source_url                 | text null   | page the suggestion was read from                       |
| palette                    | jsonb       | `{primary, secondary?, background?, ink?}` as `#rrggbb` |
| fonts                      | jsonb null  | `{pairing}` reference code (§4.3)                       |
| logo                       | bytea null  | PNG/JPEG ≤ 512 KB, magic-byte checked                   |
| logo_content_type          | text null   | `image/png` · `image/jpeg`                              |
| based_on_version           | int null    | the RECOMMENDED version a CONFIRMED row confirms        |
| created_by_user_id         | uuid        |                                                         |
| created_at                 | timestamptz |                                                         |

Append-only: an UPDATE/DELETE trigger raises. The **effective kit** is the
latest CONFIRMED row; confirming copies the exact payload of the named
RECOMMENDED version (approval binds to the payload: the request carries the
version number, and a newer suggestion does not change what was confirmed).
Capability codes reuse `artifact.view` / `artifact.revise`.

### 4.2 Contracts (additive, in `contracts/src/q/artifact.ts`, DOCS block)

- `QBrandKitSchema` (the public projection: palette, fonts, `hasLogo`,
  status, source, sourceUrl, version, createdAt) and
  `QBrandKitStateSchema = { effective?: QBrandKit, suggestion?: QBrandKit }`.
- `QDeckSchema.brand?: { kitVersion: int, pairing?: code }`: the version of
  the kit the deck was drawn with (a version renders the same forever; the
  logo is read by kit version at render).
- `QChartSchema.source?: string(≤120)`: the short line printed under the
  chart; `grounding` stays the full provenance.
- `QArtifactContentSchema.audit?: { passed: bool, checks: {code, ok, note}[] ≤24, suggestions: string[] ≤3 }`.
- Paths: `GET/POST /v1/q/brand-kit`, `POST /v1/q/brand-kit/suggest`,
  `POST /v1/q/brand-kit/confirm {version}`, `GET /v1/q/brand-kit/logo?version=`,
  `POST /v1/q/answer-exports {runId}`.

### 4.3 Reference data: design directions and pairings

`packages/deck-render/src/design.ts`: four pairings
(`INTER_SOURCE_SERIF`, `PLEX_SANS_PLEX_SERIF`, `SOURCE_SANS_FRAUNCES`,
`INTER_ONLY`) and a sector → direction table keyed by taxonomy **sector
codes** (reference ids, not words): fintech/financial services →
MINIMAL_INSTITUTIONAL + PLEX; deep tech/software/AI → DARK_TECHNICAL +
INTER; consumer/food/agri/health → WARM_GROWTH + SOURCE_SANS_FRAUNCES;
default institutional. Used only when the person chose no direction and
has no confirmed kit, and stated on the deck as Q's design choice.

## 5. Pipeline (packages/q-specialists `company/document-studio.ts`)

```
compose (existing, findings → slides/sections; unknown → gaps)
→ design      sector → direction + pairing (only if none chosen)
→ brand       confirmed kit → accent/background/ink/pairing/kitVersion
→ imagery     Pexels (licensed, credit stored on the slide)
→ charts      kind chosen by data shape; source line; donut only if parts sum
→ words       DOCUMENT_POLISH v1 (model), every line figure-checked
→ audit       layout faults + contrast + figure provenance + chart rules
```

Each step is a pure function over `QArtifactContent` except imagery and
words (ports). A step that fails returns its input unchanged; the deck is
never lost to a step. Generated illustrations (Gemini/OpenAI image models)
are **not built in this packet**: no image-generation route exists in the
Model Gateway today, generated bytes need storage and signed delivery, and
every image costs founder credits. The illustration slot is named in
the pipeline; a later packet adds the gateway task class `IMAGE_GENERATION`
and storage.

**Figure provenance (G4).** `auditFigures(content, grounding)` lists every
number on every slide (title, subtitle, bullets, figures, chart points) and
fails the check when one is not present in the grounding statements. The
polish step's lines are accepted only through the same check
(`inventsFigures`); a failing chart is removed and its numbers stay in the
section prose.

## 6. Q tools and capability registry (`// DOCS block`)

| tool / capability         | group      | approval                                               | does                                                                                                 |
| ------------------------- | ---------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apply_my_brand`          | DOCUMENT   | INSTANT (own private draft, new version; earlier kept) | Redraws one of their documents in their confirmed brand                                              |
| `get_brand_kit`           | DOCUMENT   | read                                                   | Reads their confirmed brand and any suggestion waiting                                               |
| `suggest_brand_kit`       | DOCUMENT   | INSTANT, writes RECOMMENDED only                       | Reads their company website (or colours they named) and files a suggestion they confirm on Documents |
| `audit_my_document`       | DOCUMENT   | read                                                   | Returns the audit of one of their documents and what would improve it                                |
| `navigate.DOCUMENTS`      | NAVIGATION |                                                        | Opens Documents (list, brand kit)                                                                    |
| `offer.confirm_brand`     | OFFER      |                                                        | Confirming a brand is the person's own press of **Use this brand**                                   |
| `offer.export_answer_pdf` | OFFER      |                                                        | The PDF control under each answer (Q can also file its last answer with `document.ANSWER_EXPORT`)    |

Confirmation stays a human control: Q can suggest, never confirm.
`revise_my_document` and `list_my_documents` are unchanged.

## 7. Layout engine interface (for DAILY's newspaper)

The engine is three layers; DAILY adds a template, not a renderer.

1. **Content** (contract): what is said. A newspaper adds its own content
   member (masthead, dateline, articles with headline/standfirst/body,
   photos with caption and credit, charts with source).
2. **Layout** (`deck-render`): a pure function from content + theme to
   pages of **boxes**: `TEXT` (role, wrapped lines, size, colour), `IMAGE`
   (url, alt, credit), `CHART` (kind, bars/points, source), `RULE`,
   `CIRCLE`. Measurement is `measure()`/`wrap()` (font-independent, so
   every renderer agrees). Faults (`dropped`, overflow) are facts on the
   layout and the inspector reads them.
3. **Renderers** (`svg.ts`, `pdf.ts`, `pptx.ts`): draw boxes, decide
   nothing.

A newspaper template is `layOutNewspaper(content, theme) → LaidOutDeck`
with `width/height` set to A4/A3 and slides as pages: masthead = TITLE text

- RULE; columns = TEXT boxes of role BULLET/LABEL at column x offsets
  (column width 45-75 characters at the body size, from `measure`); photo =
  IMAGE box + LABEL caption + credit LABEL; article continues on the next
  page by passing the unconsumed `wrap()` lines forward. Images must come
  from an allowed licensed host (today `images.pexels.com`; DAILY adds its
  licensed news-photo hosts to the allow-list with credit required).

## 8. Authority, firewall and privacy

- Every document is the requesting organisation's private draft
  (`organisation_private`); preparing and revising are INSTANT (ADR 0013);
  sharing/sending stays PREPARE_APPROVE through existing chat/email tools.
- Composition reads only findings produced under the run's permitted plan
  (Context Firewall before retrieval, unchanged). Founder-private figures
  in a founder's own deck are theirs; a deck about another company uses
  only what the actor may read or public sources (marked preliminary).
- Website extraction fetches only the company's own recorded website,
  `judgePublicUrl` (no private/link-local hosts), same-site redirects ≤2,
  6 s timeout, 1 MB HTML / 512 KB logo / 2 CSS files of 256 KB; only
  colours, font names and the logo leave the page. Nothing is sent to a
  model.
- Pexels: search words from the deck's own titles only (existing).
- Logo bytes never reach a prompt; brand kit rows are server-only.
- The polish model receives the document's own words (already the
  actor's) and returns wording; no record access, no tools.

## 9. Failure and edge cases

Thin record → no deck, Q asks for what is missing (existing THIN_RECORD).
Website unreachable / no colours → suggestion with whatever was found, or
"I couldn't read colours from your site; tell me them or upload a logo".
Logo not PNG/JPEG (SVG, ICO, WebP) → not stored, said plainly. Brand ink
fails contrast → black/white chosen, audit notes it (unless person chose
ink). Chart with mixed units → no chart. Donut whose parts do not form a
whole → BAR. Polish model fails → original words. Toast while offline →
next poll. Same document announced twice → one toast per (id, version).

## 10. Tests and live checks

- deck-render: brand theme (palette, contrast guard), chart kinds layout
  (zero baseline, direct labels, source line), SVG/PDF/PPTX validity with
  logo and each chart kind (PDF parsed by pdfjs, PPTX unzipped).
- q-specialists: pipeline steps, `auditFigures` catches an invented figure
  in a bullet, a chart point, a figure tile; polish lines with new figures
  rejected; design direction by sector code.
- q-artifacts / q-api: brand kit service (suggest → confirm copies the
  exact version; confirm of a stale/unknown version refused; cross-org
  read refused), extraction parser on fixture HTML/CSS (no network).
- pgTAP `590_artifacts_brand_kits.test.sql`: RLS on, anon/authenticated
  have no access (cross-tenant and revoked by construction), append-only
  trigger, constraints.
- web: toast center (announce → shows once per version; auto-dismiss;
  pause on hover/focus; Open/PDF/PPTX links; reduced motion), answer PDF
  control.
- q-tools: registry completeness (every new tool registered).
- Live (after deploy, fictional founder): create deck by voice on
  Discover → toast appears there; suggest brand from website → confirm →
  "apply my brand" → v2 with logo; answer → PDF.

## 11. As built (2026-10-01) and deviations

- Creation from any surface uses the existing `document.*` hands rather
  than a new `create_document` tool: every Q surface (Home, the Q sheet on
  any page, voice) runs the Home Q answer path, so a second creation tool
  would be a duplicate capability. `apply_my_brand` was added instead.
- `suggest_brand_kit` and `apply_my_brand` are instant actions
  (`Q_INSTANT_ACTION_TOOLS`): the first files a suggestion that applies to
  nothing, the second writes a new version of the person's own private
  document.
- Documents is a navigation destination (TURN_READER v18).
- DONUT is drawn as one stacked part-of-whole bar (exact in every renderer,
  more accurate to read than angles); parts that do not form a whole are
  drawn as bars.
- The PDF embeds Noto Sans whatever the pairing (full Unicode); PPTX and the
  viewer name the pairing's faces.
- Generated illustrations are not built (no image route in the Model
  Gateway; storage, signed delivery and founder credits). Pexels photos are.
- ADR 0031 records the brand-kit, design-choice and website-read decisions.
