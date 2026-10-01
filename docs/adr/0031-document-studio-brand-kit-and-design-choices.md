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
  website (never a URL from a request or a model): public-host check
  (`judgePublicUrl`), at most two same-site redirects, 6 s, 1 MB of HTML,
  two same-site stylesheets of 256 KB, a PNG/JPEG logo of 512 KB. Only
  colours, font family names and the logo bytes are kept; nothing from the
  page reaches a model. DNS-rebinding to a private address is not checked
  at connect time (the hosted egress has no private network of ours to
  reach); a resolver-pinned fetch is the follow-up if that changes.
- **Words pass.** DOCUMENT_POLISH v1 rewords a newly composed deck's slides
  (conclusion titles from the slide's own words, plain language, the
  common AI tells named as style rules). Code keeps any line whose rewrite
  states a figure the grounding does not carry, and the audit pass records
  every figure on a slide that the record does not hold.

## Consequences

Decks look like the company's own, after one confirmation, and look
sector-appropriate before it. Every rendered figure stays traceable, and the
audit is stored on each version so Q can be proactive about gaps without
filling them. Generated illustrations (image models) are not part of this
decision: they need a Model Gateway image task class, storage and signed
delivery, and are a later packet.
