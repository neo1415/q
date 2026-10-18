# ADR 0036: Readiness Blueprint groundwork and plan values (recommendation volume)

Status: PROPOSED (BILLING-2, 2026-10-01). It amends ADR 0034. A PADL amendment draft is in the last
section.

## Context

PADL #85 (LOCKED) names a paid Layer 2: the "Capital Readiness Blueprint". Decision #106 keeps the
diagnosis free. The Product Specification allows premium tiers to raise "the volume and frequency of
AI recommendations without reducing recommendation quality", and the neutrality decisions forbid
pay-to-rank.

The founder wants the groundwork laid now, so that building it later is easy. The locked sources do
not settle three points:

1. what exactly separates free next-step guidance from the paid Blueprint;
2. what "volume" means in a deterministic, ranked feed;
3. how a plan sets a number that is not a quota.

## Decision

1. **Blueprint scope.** The Blueprint is the sequenced plan built _on_ the diagnosis: roadmap,
   sequencing and investor-specific plans. It never restates or withholds diagnosis content.
   Contracts are fixed now (`ReadinessBlueprintDtoSchema`), with ADR-001's truth class and evidence
   status as separate axes, plus Q's confidence level, on every step.
2. **Plan gate before the build.** `q.readiness_blueprint` is an ACCESS feature (Launch and Founder
   Pro on; Free off). `POST /v1/q/readiness-blueprints` answers 402 or 501 (new problem code
   `NOT_IMPLEMENTED`) until the generator exists. No placeholder output is ever shown as Q's work.
3. **Plan VALUES.** A fourth feature kind, `VALUE`, is a number a plan sets: never a refusal, never
   metered, read by the owning context as configuration. `EntitlementService.valueOf` reads it; an
   operator override can change it per account.
4. **Recommendation volume** (`discover.recommendation_volume`) is a VALUE: the deepest rank of the
   precomputed slate that a reader may page to.
   - It is applied in the slate reader only, as a rank cut.
   - Ranking, candidate generation and slate building never read a plan, so position and quality are
     identical on every plan.
   - Seeded at 200 (the slate policy's candidate pool) on every plan: no change today.
   - Unreadable means the whole slate is served.

## Consequences

- `@capital-q/discovery` gains an optional `volume(actor)` dependency, with no billing import; the
  apps compose it.
- The plan page shows VALUE features as "Up to N …" with no meter.
- New code `NOT_IMPLEMENTED` (501) joins the error vocabulary.
- "Frequency" (rebuild cadence) remains a policy constant until the founder decides.

## PADL amendment draft (for the founder)

> **Decision #85 amendment: Layer 2 delivery and recommendation volume.** The Capital Readiness
> Blueprint is delivered as a revisioned Q document built from the free diagnosis, the company's
> evidence and the named investors' declared mandates. Every step names the gap it closes and its
> evidence, and Q never withholds or rewords a diagnosis answer to make the Blueprint necessary.
> Premium tiers may increase how many ranked recommendations a feed shows (volume). They never change
> a company's position, eligibility or explanation, and no payment by a company affects any
> investor's feed.
