# ADR 0031: Document studio: brand kit, Q's design choices and the website read

Status: Accepted (2026-10-01, DOCS worker; number chosen past the two 0029s
already proposed in other worktrees: renumber on merge if needed)
Amends: QX-004 §3.3 (three named visual directions; no model-chosen colours),
ADR 0025 (person-requested deck style), ADR 0009 (controlled public web
research)

## Context

The founder asked for a documents agent that designs (colours, fonts, images,
charts) and is proactive, from any Q surface (spec:
`docs/specs/2026-10/docs.md`). Three things the existing decisions do not
cover:

1. A company's own brand (logo, colours, fonts) applied to every document
   Q makes for it, found from its website and confirmed by the person.
2. Q choosing a starting look (direction and type pairing) for a sector,
   rather than always the institutional default.
3. Reading the company's own website directly for colours and a logo:
   ADR 0009 routes public web reads through the research providers, which
   return page text and never stylesheets or images.

## Decision

- **Brand kit** (`artifacts.brand_kit_versions`, append-only, server-only).
  A suggestion (from the website, or Q's design choice) is RECOMMENDED and
  applies to nothing. Only the person's own press of "Use this brand" (or
  values they set themselves) makes a CONFIRMED version, and a
  confirmation copies exactly the suggestion shown. Q has a tool to
  suggest and never one to confirm.
- **Applied as content.** A confirmed brand is written into the deck when
  it is composed (accent, page/text colours, type pairing, the kit version
  whose logo the cover shows), so a stored version renders the same
  forever. Text colours from a brand are used only when they reach WCAG AA
  4.5:1 on the page; a colour too light for text is used as a fill. Colours
  a person names for one document in words (ADR 0025) still win. The
  `--cq-*` product tokens are never touched.
- **Q's design choice is reference data, not a model.** When the person
  chose no direction and has no brand, a deck about their own company takes
  the direction and type pairing listed for its taxonomy industry code
  (`deck-render/src/design.ts`): still one of the three named directions,
  plus one of four OFL type pairings. No model chooses colours or fonts.
- **The website read.** The Q API may fetch the company's own recorded
  website (never a URL from a request or a model) through one vetted client
  (`apps/q-api/src/composition/vetted-http.ts`): the URL passes
  `judgePublicUrl`; the name is resolved by the client itself and refused
  when ANY resolved address is loopback, private, link-local/metadata,
  CGNAT, reserved, multicast, or an IPv6 form that reaches IPv4
  (IPv4-mapped, IPv4-compatible, NAT64, 6to4, Teredo) or is unique/link
  local; the socket is pinned to the vetted address through the request's
  own `lookup` (no second resolution, so no rebinding window) while the
  name stays the Host header and TLS SNI; redirects (at most two, same
  site) are each vetted from scratch; 6 s per hop, 1 MB of HTML, two
  same-site stylesheets of 256 KB, a PNG/JPEG logo of 512 KB. Only colours,
  font family names and the logo bytes are kept; nothing from the page
  reaches a model.
- **Words pass.** DOCUMENT_POLISH v1 rewords a newly composed deck's slides
  (conclusion titles from the slide's own words, plain language, the
  common AI tells named as style rules). Code keeps any line whose rewrite
  states a figure the grounding does not carry, and the audit pass records
  every figure on a slide that the record does not hold.

## Addendum (2026-10-01): generated images

Founder-approved. Generated illustrations are a Model Gateway task class,
IMAGE_GENERATION (`packages/model-gateway/src/images`), with OpenAI
(`gpt-image-1`, medium quality) and Gemini (`gemini-2.5-flash-image`)
adapters behind the same adapter pattern as text, a fake for tests, and
every attempt recorded in `ai_ops.model_usage` with an estimated cost.

- **Off unless enabled** (`CQ_DOCUMENT_IMAGES=enabled`) and only with the
  server's storage key (`SUPABASE_SECRET_KEY` on q-api). Budgets counted
  from the provenance table before every call: per document (one Q run,
  default 2), per organisation per UTC day (default 6), across Capital Q
  per UTC day (default 40). A spent budget is "no picture", never a failed
  document.
- **Prompts are built by code** from the deck's own words only: the slide
  title, the cover's one-line description and the brand accent. No
  figures, no names, never the team slide. The gateway appends standing
  exclusions the caller cannot drop: no text, no logos or brand marks of
  any company, no real or identifiable people or likeness of a real
  person.
- **Used where a picture is wanted and the stock library had none**
  (after Pexels in the pipeline, at most two per deck), or when the person
  asks (`illustrate_my_document`, a new version).
- **Provenance**: `artifacts.document_images` (append-only, server-only;
  provenance always AI_GENERATED, provider, model, the exact prompt, cost);
  the deck names the image as `cq-image:<id>` with provenance AI_GENERATED
  and the credit "AI-generated image · Capital Q", shown on the picture in
  the viewer.
- **Delivery**: bytes in the private `cq-document-images` bucket. The
  viewer draws pictures over the slide from a 10-minute signed storage URL
  (browser to storage directly, never through Next.js); PDF and PPTX
  exports read the bytes server-side as the actor. A signed URL or bytes
  are only ever produced for the image's own organisation.

## Consequences

Decks look like the company's own, after one confirmation, and look
sector-appropriate before it. Every rendered figure stays traceable, and the
audit is stored on each version so Q can be proactive about gaps without
filling them. Generated illustrations are covered by the addendum above.
