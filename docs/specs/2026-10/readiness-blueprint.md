# Capital Readiness Blueprint and premium recommendation volume: groundwork

Owner: BILLING (branch `build/billing-2`). ADR 0036. Migration `20261116020000`.

The founder's direction (2026-10-01): "start adding the paid layer, but just enough that when we make
the decision it is easy to build". This document fixes the contract, the plan boundary and the entry
points. Nothing is generated yet: the route answers 501 and makes no model call.

## 1. What it is

PADL #85 (LOCKED) sets up three layers:

- **Layer 1, Diagnosis (free):** assessment, strengths, weaknesses, benchmarks, red flags and
  fundraising gaps.
- **Layer 2, Strategic Intelligence ("Pro"):** a Capital Readiness Blueprint, consisting of:
  - a prioritised improvement roadmap;
  - a step-by-step implementation strategy;
  - proprietary investor intelligence and investor-specific recommendations;
  - action sequencing and strategic fundraising planning;
  - personalised improvement pathways.
- **Layer 3, Human Execution:** optional.

Decision #106 keeps the full diagnosis free. Paid value is "deeper strategy, execution and
expertise", never the diagnosis withheld.

So the Blueprint is **what to do about the diagnosis, in what order, and for whom**. It never answers
a question the free diagnosis answers.

## 2. Inputs

All inputs pass through the Context Firewall for the founder's own company, before retrieval:

1. **Q's diagnosis:** the InvestIQ pillar assessment, gaps, strengths and red flags, as the company
   specialist produces them today (`read_my_record`, company analysis). The diagnosis version is
   stamped in `basis.diagnosisVersion`.
2. **The company's evidence:** claims and documents, carried with their truth class, evidence status
   and lifecycle (ADR-001). Contradictions stay contradictions.
3. **The raise:** the capital objective (target, instrument, stage) and the commitments ladder.
4. **Investor fit, for up to 5 named investors:**
   - Only organisations the founder may see: in a relationship, or network-visible.
   - Fit comes from each investor's **declared mandate** only.
   - Observed behaviour never becomes a rule (FSR: Declared Mandate ≠ Observed Behaviour ≠ Q
     Inference).
   - Another investor's private data is never used.
5. **Rehearsal reviews and meeting records** the founder owns. These are optional sources of
   "likely questions".

## 3. Output (contract: `ReadinessBlueprintDtoSchema`, `packages/contracts/src/q/readiness-blueprint.ts`)

- **Roadmap:** up to 30 steps. Each step has:
  - title, why it matters to investors, and the diagnosis gap it closes;
  - InvestIQ pillar, priority (NOW / NEXT / LATER), effort (HOURS / DAYS / WEEKS);
  - executor (FOUNDER / WITH_Q / EXPERT_SUPPORT, the PADL #85 progression);
  - dependencies, and a checkable "done when";
  - evidence references with truth class, evidence status and confidence.
- **Sequencing:** up to 8 phases over a 3, 6 or 12 month horizon, each naming its step ids.
- **Investor plans:** up to 5. Each has a fit summary from the declared mandate, likely questions,
  and the steps to prepare first, with the same evidence axes.
- **Uncertainty:** what Q could not assess and why. Unknown stays unknown.
- **Basis:** the diagnosis version, the as-of date of the evidence, and the mandate versions, so a
  stale blueprint is visible.

## 4. Evidence and truth rules

These are the rules the generator must pass. A deterministic checker is built with the feature.

- **Every step cites evidence**, unless its truth class is UNKNOWN; then it says what evidence is
  missing. No invented percentages: confidence is the Q confidence level, not a number.
- **Inference is never presented as fact.** General model knowledge is never evidence about this
  company.
- **No manufactured issues** (Product Specification and PADL: "Capital Q must not manufacture issues
  to generate advisory revenue"). A step must close a gap the diagnosis found.
- **EXPERT_SUPPORT is offered only when it genuinely helps.** It is disclosed as optional and never
  ranked above a self-serve step for commercial reasons (neutrality).
- **Founder-private facts stay with the founder.** They may shape the founder's own blueprint, never
  any investor-facing ranking or assessment (release-blocking invariant).
- **Writes go through the Write Gate.** A blueprint is an artifact (revisioned, append-only), not a
  fact store.

## 5. Free / Pro boundary

| Free (Layer 1)                                      | Pro (Layer 2, `q.readiness_blueprint`)                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Full diagnosis, pillars, strengths, gaps, red flags | Sequenced roadmap with dependencies and "done when"                                            |
| Q answers any question about the diagnosis          | Investor-specific plans for up to 5 investors                                                  |
| Next-step offers in conversation                    | A horizon plan (3, 6 or 12 months) kept as a revisioned document, re-run when evidence changes |

Q may say that the Blueprint exists when the founder asks how to fix something. It never withholds a
diagnosis answer to sell it (PADL #85 "Q shall never intentionally withhold valuable intelligence").

## 6. Plans (seeded)

`q.readiness_blueprint` is an ACCESS feature:

| Plan         | Included |
| ------------ | -------- |
| Launch       | yes      |
| Founder Pro  | yes      |
| Free         | no       |
| Investor Pro | no       |
| Fund         | no       |

## 7. UX entry points

- **Capital** (founder): a "Readiness Blueprint" section says "Coming with Pro", with links to ask Q
  (the free diagnosis) and to see plans. It shows no sample plan and no fake content. Built now.
- **Later:**
  - "Plan my raise" on Capital (an existing chip).
  - A Q offer after the diagnosis.
  - The Blueprint as a document in Documents, with PDF export.
  - Each step's "Do this with Q" opening the matching Q tool.

## 8. Route (stub)

`POST /v1/q/readiness-blueprints` takes a `ReadinessBlueprintRequestSchema` body. It checks
validation, then the plan:

- 400 for a malformed request;
- 402 `ENTITLEMENT_REQUIRED` when the plan does not include the Blueprint;
- 501 `NOT_IMPLEMENTED`, with a plain sentence, when it does.

It reads nothing and calls no model. When built, the route checks that the company is the actor's
own before any read, and a Q tool `prepare_readiness_blueprint` joins the capability registry.

## 9. Costs (estimate, to measure when built)

- **Model use:** one EVIDENCE_SYNTHESIS run per blueprint, roughly 20–40k input tokens (diagnosis,
  evidence summaries, mandates) and 4–8k output tokens. One extra run per named investor is only
  needed if the investor plans are split out.
- **Measurement:** use `ai_ops.model_usage` from the first build.
- **Recommendation:** meter regenerations (for example 4 per month on Pro) once cost is known, as a
  MONTHLY companion feature.

## 10. Premium recommendation volume (built)

The Product Specification says "Premium platform tiers may increase the volume and frequency of AI
recommendations without reducing recommendation quality".

- **`discover.recommendation_volume`** is a plan VALUE (a new feature kind: a number, never a
  refusal). It sets how far down the ranked slate the feed may page. Every plan is seeded with 200,
  the slate policy's candidate pool, so nothing changes today.
- **The slate reader (`packages/discovery`)** takes an optional `volume(actor)`. It cuts at that
  rank, for both filtered and unfiltered pages. It never reorders, boosts or refills from below the
  cut; ranking and slate building never read a plan.
- **Failure:** if the plan cannot be read, the feed serves the whole slate.
- **"Frequency" (slate rebuild cadence)** is not plan-driven yet. That would be a builder-side value
  and needs the founder's decision.

## 11. Founder decisions needed

1. Price and limits for the Blueprint (with Founder Pro, or as an add-on), and a regeneration cap.
2. Whether recommendation volume differs by plan, and the numbers. Today every plan is 200.
3. Whether EXPERT_SUPPORT steps may name FDN Advisory, with disclosure (PADL #85 Layer 3).
