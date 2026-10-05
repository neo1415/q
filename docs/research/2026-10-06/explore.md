# Explore research (E1-E5)

Research agent M1, 2026-10-06. Feeds Explore (what "Search" becomes): the network-wide pitch grid, related-pitch scrolling, and search to profiles.

## 1. Summary for builders

- Instagram Explore is a multi-stage funnel: many **retrieval sources** (heuristics like trending, plus two-tower embedding retrieval with ANN search, precomputed off-peak) → lightweight first-stage ranker (distilled to mimic the heavy model) → heavy multi-task ranker predicting clicks, likes and "see less" combined by a **value model** → final reranking with **integrity filters and diversity rules** ([Meta engineering 2023](https://engineering.fb.com/2023/08/09/ml-applications/scaling-instagram-explore-recommendations-system/), [Meta AI 2019](https://ai.meta.com/blog/powered-by-ai-instagrams-explore-recommender-system/)). Earlier it seeded from accounts you interacted with and expanded via account embeddings (ig2vec), sampling 500 → 150 → 50 → 25.
- TikTok For You ranks on interactions, video information (captions, sounds, hashtags) and device/account settings, deliberately **intersperses diverse content**, and generally will not show two videos in a row from the same creator or sound ([TikTok newsroom](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you/), [diversify update](https://newsroom.tiktok.com/an-update-on-our-work-to-safeguard-and-diversify-recommendations?lang=en)). Search shows categories (Top, Users, Videos...) and "Others searched for" suggestions ([Shopify on TikTok search](https://www.shopify.com/blog/tiktok-search)).
- Capital Q must **adopt the structure, not the objective**. Their value model maximises predicted engagement; Capital Q's must not (CLAUDE.md: never optimise for watch time, clicks, impressions or virality; viewing is not interest; no LLM in ranking; no pay-to-rank).
- Capital Q already has the ranking scaffolding (eligibility → candidates → fit → semantic → evidence → diversity) in `packages/discovery`. Explore is a **second recommendation mode** over the same pipeline with a broader candidate set and lighter personalisation, precomputed into slates.
- Grid: **masonry with reserved aspect-ratio boxes** is right for pitches that mix 9:16, 4:5, 1:1 and 16:9, but needs a deterministic reading order for accessibility. On phone use **2 columns**; desktop 3-5.

## 2. How the two systems work (what matters for us)

| Stage | Instagram Explore | TikTok | Capital Q equivalent |
|---|---|---|---|
| Eligibility / integrity | Integrity filters before and after ranking | Content moderation, eligibility for FYF | Hard eligibility: visibility scope (network_visible), Context Firewall, founder opt-out, declared exclusions |
| Candidate generation | Multiple sources: accounts you engaged with → similar accounts by embedding; trending; two-tower ANN | Interest signals from onboarding, follows, interactions | Sources: (a) declared mandate match (sector, stage, geo), (b) semantic neighbours of mandate thesis, (c) semantic neighbours of companies the investor **saved or expressed interest in** (explicit actions, not views), (d) new on network this week, (e) editorial / Q-curated themes, (f) exploration outside mandate |
| Early ranking | Distilled cheap model | — | Not needed at our scale; one deterministic scorer |
| Late ranking | Multi-task NN, value = w·P(click)+w·P(like)−w·P(see less) | Engagement-driven | Deterministic, versioned config: fit + evidence quality + freshness; **no predicted engagement terms** |
| Reranking | Diversity rules, no repeats in a row | No two in a row from same creator or sound; diversity injection | Diversity: max 1 pitch per company per screen, rotate sectors and countries, cap share of any sector, exploration slot share configured |
| Negative feedback | "See less", "Not interested" | "Not interested" | "Not for me" (removes item; can down-weight a **soft** source, never edits the declared mandate) |
| Precomputation | Off-peak pregeneration, caching | | Precomputed slates + read projection, cursor pagination (CLAUDE.md) |

## 3. Adopt, adapt, improve

**Adopt**
- Multi-source candidate generation merged then deduplicated.
- Precomputed slates and cached embeddings (we already use pgvector + RRF hybrid for search).
- Final diversity rerank with explicit rules (TikTok's "no two in a row from the same creator" → "no two in a row from the same company or same sub-sector").
- Grid → open → vertical related feed → back to the same grid scroll position.
- "Not interested" as explicit negative feedback.

**Adapt**
- Replace predicted engagement with **capital signals**: declared fit, evidence status (DOCUMENT_SUPPORTED / VERIFIED rank higher within a band), freshness (new pitch, updated traction), stage-appropriate completeness (deck at standard, see pitch-deck.md), and "raising now" (declared open round). None of these are engagement.
- Personalisation is **light** (E1): roughly 60% fit-driven, 25% network-wide recency and quality-of-evidence, 15% exploration, all in a versioned config. Investors can switch Explore to "Everything" (unpersonalised, newest first, filtered only by eligibility).
- Founders also browse Explore (to see peers, competitors, investors' portfolio pitches): for founders the fit term is off; ordering is recency + sector proximity to their own company.

**Improve (do better for capital)**
- **Explainable tiles**: every tile can show a one-line "Why you're seeing this" (from reason codes): "Seed fintech in Lagos, matches your mandate" / "New this week" / "Outside your usual focus". Instagram does not explain Explore.
- **No virality loop**: no view counts, like counts or "trending" badges on tiles (popularity ≠ quality; also leaks other investors' behaviour). Show stage, sector, country and "raising" status instead.
- **Evidence badges, not engagement badges**: a small "Revenue verified" or "Deck at standard" marker where true, with evidence-status vocabulary from ADR-001, sparingly (CLAUDE.md: no badge spam).
- **Fairness**: cap per-company exposure so a few polished pitches do not take the whole grid; new founders get a guaranteed exploration share.
- **Respect time**: Explore is finite per session ("You're up to date. 48 new pitches this week.") instead of infinite scroll engineered for time spent. Allow continuing, but mark the end of fresh content.

## 4. The grid (E2): masonry vs square on mobile

| | Square (Instagram pre-2025) | Uniform 3:4 / 4:5 (Instagram 2025) | Masonry (Pinterest) |
|---|---|---|---|
| Crop | Heavy crop of vertical video (9:16 → 1:1 loses ~44% of height) | Moderate crop | None; tile height follows aspect ratio |
| Scanning | Very easy; rows | Easy | Harder; zig-zag, order ambiguous |
| Density on phone | 3 columns, small faces | 3 columns | 2 columns typical |
| Layout stability (CLS) | Trivial | Trivial | Fine **if** heights are reserved from stored aspect ratio before load |
| Accessibility | Natural order | Natural order | Focus and reading order can jump between columns (WCAG 2.4.3 risk) ([Matuzo 2026](https://matuzo.at/blog/2026/grid-lanes-accessibility)) |
| Implementation | CSS grid | CSS grid | JS shortest-column placement (CSS Grid Lanes / masonry is not yet safe everywhere) ([OpenReplay](https://blog.openreplay.com/css-grid-lanes-masonry-layout/)) |

Instagram moved profiles from 1:1 to 3:4 in early 2025 precisely because vertical content dominates ([Planoly](https://planoly.com/blog/guide-to-instagrams-new-vertical-grid), [Hopper](https://help.hopperhq.com/en/articles/10907941-instagram-s-vertical-grid)).

**Recommendation (founder prefers masonry; E2):**
- Masonry, **2 columns on phone (< 640px), 3 on tablet, 4-5 on desktop**, gap 4-8px.
- Tile height = width × stored aspect ratio, **clamped** between 4:5 and 9:16 (landscape 16:9 videos get letterboxed into 4:5 or cropped with focal point) so no tile is a sliver or a tower.
- Place items **in rank order, left-to-right, top-to-bottom by shortest column**, and set the DOM order equal to the placement order (row-ish order) so keyboard and screen reader order roughly follow the visual order. Provide a list-view toggle for accessibility.
- Virtualise (only render visible tiles), reserve heights from data, posters only (no video autoplay in the grid on mobile; on desktop at most one muted hover preview owned by the preload controller).
- Tile content: poster, company name, a 1-line hook, stage · sector · country chips (max 3), duration. Fit band small in a corner for investors (optional, configurable).

## 5. Opening a pitch and scrolling related (E3)

- Tap tile → full-screen vertical player (the same component as Discover), with **shared-element transition** from the tile.
- The **first** item is the tapped pitch; scrolling up loads a **related slate**: same sector or thesis neighbours (semantic), same stage, then a diversity mix; never the same company twice in a row. Related slate computed per anchor pitch and cached.
- Header: back arrow (returns to grid at exact scroll position), "Related to AgroLedger" label so the user knows the feed changed context.
- Actions on each pitch: Open profile (A1 tabs), Save, Not for me; Express Interest only inside the profile (server-confirmed).
- One active player, muted by default, `playsinline`; reduced motion → poster + Play.
- Preload: next 1 pitch first segment, posters for next 3; owned by one controller.

## 6. Search (E4)

- Search box at the top of Explore. Hybrid search (FTS + pgvector, RRF) over companies, investors (organisations), people and pitches, after authorisation.
- Results grouped in tabs: **Top · Companies · Investors · People · Pitches**. Top shows best 3 companies, best 3 investors, then pitches in the masonry grid.
- Tapping a company or investor result opens the **profile** (A1 tabs), not a Q card (E4).
- Suggestions as you type: entity names first, then topics ("payments Nigeria seed"). "Related searches" below results, generated from **taxonomy neighbours**, not from other users' searches (TikTok's "Others searched for" would leak behaviour across firms).
- Natural-language queries ("seed fintech in Kenya with revenue") parse into filters shown as removable chips, deterministically where possible; Q can help but the results come from the search index.
- Empty state: suggested topics from the user's mandate or company.
- Recent searches stored per user, clearable.

## 7. Gaps and recommendations

1. **Pitch metadata at upload**: store aspect ratio, duration, poster, focal point, language and captions for every pitch. The grid cannot reserve heights without aspect ratio.
2. **Captions** on all pitches (auto-generated, founder-confirmed): accessibility, muted autoplay, and searchable text for semantic retrieval.
3. **Topic rows**: optionally top of Explore shows horizontal chips by theme ("Climate in East Africa", "Raising now", "New this week"), computed from taxonomy, not from popularity.
4. **Investor content**: Explore should also include investor intro videos (firms explaining their thesis) for founders. Same grid, labelled "Investor".
5. **Do not log dwell time as a ranking signal.** Logging for performance or product analytics is fine (ANALYTICS ≠ DOMAIN EVENT); the ranker must not read it.
6. **Cursor pagination** with slate id + position; a slate is stable for the session so going back keeps the order.
7. **Moderation**: a report action on every tile and pitch; integrity filters before ranking (Instagram does this at both ends).
8. **Offline / slow network**: grid shows posters from CDN with small sizes (srcset), skeletons with reserved heights, never spinners per tile.
9. **Performance budget**: Explore first grid LCP ≤ 2.5s p75; poster images ≤ 30KB each at 2-column phone width (AVIF/WebP).
10. **Exploration labelling**: items outside mandate say so ("Outside your usual focus") so investors trust the personalisation.
