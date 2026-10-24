# Proposal: per-mandate fit ranking projection

Status: PROPOSED (for owner approval). Author: Lane 4, 2026-10-24.
Context: the Supabase egress restriction (2026-10-24) and F-82.

## Problem

An investor's "which companies best fit my mandate" is answered by ranking the
whole network at question time. After F-82, `FitService.rank` scores every
eligible company: 463 in production. Each one reads a feature snapshot, an
identity, a capital objective and a Q Card, plus eligibility facts. The answer
is right, but every typed, spoken or translated "best fit" turn pays that read.

The Discover slate cannot stand in for it:

- It is built from one rotating candidate window, about 100 of the qualifying
  companies (`candidates/window.ts`).
- It admits only companies with a playable pitch (`discover-feed-eligibility.v1`).

So the slate's top companies are "what to watch next", not the best fit across
the network.

The architecture's answer is a precomputed read projection. Rank once when
something changes, and read the top N when someone asks (CLAUDE.md
"Recommendations": precomputed, versioned, reproducible; no ranking work in the
critical path).

## What is stored

Two tables in the `recommendation` schema, migration
`supabase/migrations/<ts>_recommendation_fit_rankings.sql`.

`recommendation.fit_rankings`: one per build.

| column                       | type                 | notes                                                                            |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `id`                         | uuid pk              |                                                                                  |
| `tenant_id`                  | uuid not null        | the investor organisation's tenant                                               |
| `investor_organisation_id`   | uuid not null        |                                                                                  |
| `mandate_id`                 | uuid not null        |                                                                                  |
| `mandate_version`            | integer not null     | the version it was ranked against                                                |
| `fit_config_version`         | text not null        | e.g. `ranking-config.v7`                                                         |
| `eligibility_policy_version` | text not null        | e.g. `eligibility.v5`                                                            |
| `status`                     | text not null        | `BUILDING` / `CURRENT` / `SUPERSEDED` / `FAILED` (check constraint, not an enum) |
| `considered`                 | integer not null     | eligible companies seen                                                          |
| `scored`                     | integer not null     | companies with a score                                                           |
| `computed_at`                | timestamptz not null |                                                                                  |

Constraints and indexes:

- unique partial index on `(tenant_id, investor_organisation_id, mandate_id) where status = 'CURRENT'`;
- index on `(investor_organisation_id, mandate_id, status)`.

`recommendation.fit_ranking_items`: the order.

| column                       | type              | notes                                                       |
| ---------------------------- | ----------------- | ----------------------------------------------------------- |
| `ranking_id`                 | uuid fk           |                                                             |
| `tenant_id`                  | uuid not null     | denormalised for RLS and indexes                            |
| `company_id`                 | uuid not null     |                                                             |
| `rank`                       | integer not null  | 1 = best                                                    |
| `score`                      | numeric(4,1) null | null = not enough to score (unknown stays unknown, never 0) |
| `band`                       | text null         | the fit band shown on cards                                 |
| `company_projection_version` | text not null     | so a company change can mark it stale                       |

Constraints:

- unique on `(ranking_id, rank)`;
- unique on `(ranking_id, company_id)`.

Rules:

- Items are inserted only while their ranking is `BUILDING`, using the same
  trigger pattern as `slate_items`.
- A rebuild writes a new ranking and supersedes the old one. Nothing is
  overwritten (revisioned data).

## Security and the Context Firewall

- RLS is on, with no policy and no browser grant: server-only, like
  `recommendation.slates`. pgTAP covers three cases:
  - a positive case (the service role reads its rows);
  - the browser role reading nothing;
  - cross-tenant negatives.
- It is built under the investor organisation's build principal
  (`apps/workers/src/recommendations/build-principal.ts`), the same principal as
  the slate. It uses only what that organisation may see: disclosure decides
  every company and every raise as for the slate.
- Founder-private data never reaches the ranking unless it is disclosed to that
  investor. This holds the release-blocking invariant.
- The read re-checks before anything is shown:
  - visibility for the N companies shown (eligibility VIEW);
  - each company's fit detail, through `fit_profile` as the reader.
    A company that stopped being visible is dropped from the answer, never named.
- One difference to decide (open question 1): a per-user grant that an
  organisation-level principal does not see could make the stored order differ
  slightly from what that user would compute. The live re-check covers the N
  shown; the order is the organisation's.

## When it is rebuilt

Reuse the slate refresh triggers and queue (`recommendation.refresh_requests`,
`REFRESH_REASONS`). Any reason that refreshes a slate also marks that key's fit
ranking stale:

- `MANDATE_ACTIVATED`, `MANDATE_UPDATED`, `MANDATE_HARD_CHANGED`;
- `COMPANY_*`, `DISCLOSURE_CHANGED`, `TAXONOMY_CHANGED`, `RELATIONSHIP_CHANGED`;
- and the pipeline or config version change.

There are two options for the job. The proposal is (a).

- **(a) Extend `recommendation-refresh`.** After the slate build, the same
  claimed request rebuilds the fit ranking. One claim, one build, coalesced
  exactly as slates are.
- **(b) A separate `recommendation-fit-ranking` job** with its own claim row.
  This is cleaner to observe, but adds a job type and an outbox event.

Company-level changes: a `COMPANY_UPDATED` affects every investor. When only
one company changed, rescore just that company against each current ranking and
re-sort. That is one fit read per investor, not a full rebuild. A full rebuild
runs only for mandate, config, taxonomy or policy changes.

## Read path

`discover_companies` with order FIT, for an investor:

1. Read the `CURRENT` ranking for (tenant, investor organisation, active
   mandate), where `mandate_version` and `fit_config_version` match today's.
2. Unscoped ask: take the top N by `rank`. Scoped ask (sector, country, stage):
   use the catalog's matches (already read cheaply by id) ordered by their
   stored `rank`. Unranked matches go after the ranked ones, as today.
3. The answer runs `fit_profile` only for the N shown, as today.
4. No current ranking: fall back to today's lean network rank (batched
   snapshots, no one-liners or stated evidence, two-minute per-person cache)
   and enqueue a rebuild.

The answer wording stays: "N companies on Capital Q; ranked by fit with your
mandate, the top five: …", because the stored order is the network's fit
order.

## Backfill

`apps/workers/src/backfill-fit-rankings.ts` runs over active mandates:

- one mandate at a time, in input batches of 100 (as the fit service reads
  today);
- throttled and resumable;
- off-peak, and only after the egress restriction is lifted.

Dry-run mode counts the mandates and companies only.

## Egress estimate

This is an estimate from the code shape, not a measurement. It should be
measured before and after with the q-api `discoverMs` log line and Supabase's
egress report.

| path                                                                   | per "best fit" ask                                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| before F-82 lean change (all reads, 463 companies)                     | roughly 3–5 MB                                                                                  |
| today's lean network rank (batched snapshots, no one-liners or stated) | roughly 1.5–2.5 MB; the `features` jsonb dominates                                              |
| with this projection                                                   | about N item rows (~100 B each) plus N `fit_profile` reads (~5 KB each): roughly 30 KB for five |

The build still reads the network, from the worker, which also counts toward
egress. But it reads once per change, not once per question, and company-level
changes rescore one company. The saving is the ratio of "best fit" asks to
ranking-relevant changes, which should be large: every QA re-score, voice turn
and parallel extra is an ask.

## Tests

- pgTAP: RLS on and no browser grant; cross-tenant negative; one `CURRENT` per
  key; items insertable only while `BUILDING`.
- Unit: the build is deterministic for the same inputs and config, and unknown
  never scores 0.
- Unit: the read prefers a matching `CURRENT` ranking; a stale `mandate_version`
  or config falls back and enqueues.
- Unit: the read drops a company no longer visible to the reader.
- Read counts: a ranking hit makes one ranking query plus N `fit_profile` reads.

## Open questions for the owner

1. Is the order computed under the investor organisation's principal
   acceptable, with per-user grants re-checked live for the N shown?
2. Job shape: extend `recommendation-refresh` (a), or a separate job (b)?
3. Freshness: is a ranking up to one refresh behind acceptable? A mandate edit
   triggers a rebuild, and until it lands, Q uses the lean live rank.
4. Should the projection also serve Discover's "best fit" sort, so Discover and
   Q truly share one order, while the slate keeps its rotation for the feed?
