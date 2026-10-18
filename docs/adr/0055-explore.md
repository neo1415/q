# ADR 0055: Explore replaces Search

Status: Accepted (founder brief 2026-10-05, items E1-E5)
Amends: the navigation in doc 17 §§6-8 and ADR 0017 (Explore joins the main areas; the phone bar is Discover, Explore, Q, Relationships, More). Doc 19's recommendation rules are unchanged and apply.

## Context

The founder asked for "Search" to become Explore: every pitch on the network the viewer may see, broader than Discover but lightly personalised, as a masonry grid; opening a pitch and scrolling shows related pitches; search stays and opens profiles, not Q cards. Research: `docs/research/2026-10-06/explore.md`. Mockups: `docs/design/2026-10-06/a/explore.html`.

## Decision

1. **One read, one rule.** `packages/discovery/src/explore` builds the pool: network-opened pitches (the ADR 0021 query), never the viewer's own organisation's, each company through the network preview's disclosure (NETWORK_VISIBLE or PUBLIC_EXTERNAL for this actor, active). Sectors are read only for companies already allowed. The HTTP API (`/v1/discovery/explore`, `/explore/related/:id`, `/explore/search`) and Q's tools (`explore_pitches_like`, `search_network`) compose the same service.
2. **Candidate sources, then a diversity pass.** Mandate (the Discover slate), adjacent (stage-adjacent slate companies, or a mandate sector at another stage), saves (explicit saves only; views are never read), newest (7 days), exploration. One versioned config (`explore.v1`) weights them; a greedy pass keeps no company twice in four tiles, at most two of one sector in six, an exploration tile every sixth slot, and a company's pitches past two at the end. Deterministic: ties break by recency, then id. No model, no engagement, no popularity, no pay-to-rank.
3. **Explainable.** Every tile carries one reason from a closed vocabulary ("Matches your mandate", "Outside your usual focus", ...); related pitches say what they share (same founder, sector, stage, country). No counts, scores or ranks on the wire or the screen.
4. **Finite.** For you leaves exploration older than 30 days to Everything, so the slate ends with "You're up to date" instead of scrolling forever. Cursors carry the slate's cut-off and position, so pitches posted mid-session never shift later pages.
5. **Grid.** Masonry, 2 columns on phone, 3 on tablet, 4-5 on desktop; each box reserved from the stored aspect ratio (clamped 4:5 to 9:16) through container units, so nothing shifts; placement is shortest-column in rank order and the DOM keeps that order. Posters only, signed, straight from the CDN; the opened feed reuses the pitch player and the one preload controller.
6. **Search** parses stage, sector and country words into removable chips deterministically; results open `/company/:id` or `/investors/:id`. Names are matched only among people the viewer already sees (relationships; a founder's Discover investors). `/search` stays for @handle look-ups.
7. **Navigation.** Explore replaces the Search field in the sidebar and the More sheet and takes Capital's place on the phone bar; Capital stays in the sidebar and More. Q's SEARCH destination opens Explore.

## Consequences

- The slate is computed on read over at most 240 newest network pitches; a precomputed Explore slate table is the next step if the network outgrows that.
- "Not for me" hides a pitch for the session only and never edits a mandate; Save uses the existing interaction (investors only).
- No migration: aspect ratio, duration and sectors already exist.
