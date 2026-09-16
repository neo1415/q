# Discovery (doc 19)

Who an investor or a founder could reasonably meet, chosen by declared
eligibility and declared fit, ranked deterministically, and explained from
the fields that produced it.

## The order

```
hard eligibility → candidate generation → declared hard exclusions
  → explicit fit → deterministic rank
```

Semantic fit, evidence weighting and exploration are later steps in that
same order and are deliberately absent rather than approximated. A pretend
relevance score is worse than an honest gap, and the order above is the
part that has to be right first.

No model runs in this path. The slate is reproducible from the rows alone:
the same inputs give the same order, and `DISCOVERY_RANKING_VERSION`
changes whenever a weight, a signal or the order does.

## Cross-tenant, because that is what the word means

This packet began as a bug. `network_visible` means visible to
authenticated Capital Q participants (ADR-001), but the only search that
existed scoped candidates to the caller's own tenant — and every
organisation has its own tenant. A founder could make their company
discoverable and no investor could ever see it, which is exactly what
happened in the browser.

The candidate queries in
`packages/discovery/src/infrastructure/postgres-discovery-repository.ts`
are cross-tenant and say so in SQL. The filter is the declared visibility
column; the caller's own organisation is the only exclusion, because their
own company is the subject of their own conversations rather than a
discovery result. Classification chooses candidates; the disclosure layer
still decides each one.

## What may be matched on, in each direction

**Investor → companies.** The investor's own mandate, against the
company's declared, network-visible profile. Their data, used for them:
declared stage range, and taxonomy preferences by strength (MUST 40,
STRONG 25, NICE 10) against the company's active classifications. A
mandate preference marked as an exclusion is a removal, never a low score,
and only declared rules can exclude.

**Founder → investors.** The declared investor profile and nothing else:
whether they say they are deploying, and whether the profile is filled in.
An investor's mandate is investor-private, and doc 19 §204.9 makes it
release-blocking that private investor behaviour must not shape what a
founder sees. The slate always carries
`RANKED_ON_DECLARED_PROFILE_ONLY` so the screen can say so. When an
investor deliberately publishes a mandate, that is the packet that may
change this, and not before.

## What does not exist here

No popularity, no trending, no view count, no dwell, no
recency-of-activity, no pay-to-rank. There is no port for "what this
person looked at", because a port that cannot express it cannot be misused
later. Viewing is not interest.

The score never reaches the wire. `rank` exists so a slate can be
reproduced and audited; the API drops it and the screen shows the reasons
instead, in the person's own declared vocabulary.

## Surfaces

- `GET /v1/discovery/companies` and `GET /v1/discovery/investors`, cursor-paged.
- `/discover` in the web app picks the direction from the person's own context.
- `discovery.slate` is the Q tool. It exists because the question people
  actually ask is "who can you tell me about?" — which a name search
  cannot answer, since it needs a name. Q asks the platform which side the
  person is on rather than guessing.

## Why a slate is thin

Every slate carries notes, so a person who sees three results knows
whether that is the network or their own mandate:
`NO_ACTIVE_MANDATE`, `MANDATE_HAS_NO_PREFERENCES`,
`NO_DISCOVERABLE_COUNTERPARTS`, `RANKED_ON_DECLARED_PROFILE_ONLY`.

An eligible counterpart with nothing declared in common still appears, last
and unexplained. Eligible is not the same as recommended, and hiding them
would be a ranking decision dressed as a filter.

## Not built yet

- Semantic fit over company descriptions (CQ-RAG exists; it is not wired
  into this path).
- Evidence and freshness as ranking signals.
- Exploration and diversity.
- Precomputed slates. Today each request ranks a bounded candidate set of
  200 live; that is well within budget at this size and will not be at the
  next one.
- GateQ. Discovery answers "who could you meet"; whether a founder may
  reach an investor is a different question with its own rules.
