# ADR 0020 — Unknown never excludes

## Status

Accepted by lead — 2026-09-27, pending founder review. Applies an existing
invariant (`CLAUDE.md`: "Unknown stays unknown. Never convert absence into
zero or into negative evidence"; hard exclusions only from declared rules).
Amends eligibility policy v2 (doc 19 §13, §15). No schema change.

## Context

Live defect. An investor's mandate declared a `HARD_EXCLUSION` on
`red_flag`, a dimension no canonical company field answers in V1.
Eligibility v2 evaluated it as `UNKNOWN`, and any `UNKNOWN` made the
company `UNDETERMINED`, which no stage of the pipeline ranks. Every
company was withheld, the slate was empty, and the page said "Nobody has
made themselves discoverable yet" while twelve companies were
discoverable.

The same rule withheld a company whenever its own stage, country or
sector was simply not stated under a matching exclusion. Missing data
acted as negative evidence.

## Decision

1. **A hard exclusion excludes only on positive evidence that the company
   matches it.** `FAIL` (a declared rule definitively matched) still makes
   a company `INELIGIBLE`. An exclusion criterion that is `UNKNOWN` (the
   fact is missing, or V1 cannot evaluate the dimension) no longer makes it
   `UNDETERMINED`: the company stays `ELIGIBLE` and the `UNKNOWN`
   criterion stays on the result with its reason code
   (`COMPANY_STAGE_UNKNOWN`, `COMPANY_GEOGRAPHY_UNKNOWN`,
   `COMPANY_TAXONOMY_UNKNOWN`, `HARD_CRITERION_NOT_EVALUABLE` with the
   rule's dimension). `UNDETERMINED` remains for gates that are not
   exclusions: no single ACTIVE mandate, or a relationship state the policy
   does not understand. Policy version `eligibility.v2` → `eligibility.v3`.
2. **The unchecked rule is said, not hidden.** A rule the company's own
   facts could not answer is reported on that company's Discover card
   (`unverifiedExclusions`). A rule V1 cannot evaluate for any company is
   reported once per page (`unverifiableExclusions`), never per card.
3. **Empty states are truthful.** An empty first page says which of these
   holds, in order: nothing is discoverable (`NO_DISCOVERABLE_COUNTERPARTS`);
   the slate predates the newest discoverable-company change or the current
   policy, so it is rebuilt (`RECOMMENDATIONS_REFRESHING`); every
   discoverable company is removed by a declared rule, with the rules named
   and a link to the mandate (`NONE_PASS_HARD_RULES`); or they pass the
   rules and none matched the mandate (`NONE_MATCH_MANDATE`).
4. **Stale empty slates rebuild.** A company becoming discoverable
   (readiness `marketplace_ready`, or a network visibility) asks every
   CURRENT slate for a rebuild. An empty slate generated before the newest
   discoverable-company change is rebuilt on read and republished even when
   its fingerprint is unchanged, once.

## Consequences

- An investor may see a company that a rule they declared would have
  excluded had the fact been known. They are told, per company or per page,
  that the rule was not checked. This is the honest trade: silence is not
  evidence either way, and withholding on silence emptied the product.
- A slate built under `eligibility.v2` is rebuilt on its next read; its
  items are re-checked under v3 meanwhile.
- When V1 learns to evaluate a dimension (e.g. red flags from verified
  evidence), its exclusions start to `FAIL` on positive matches and the
  once-per-page note disappears for that rule. No contract change needed.
- The mandate editor should say, when a hard exclusion is declared on a
  dimension V1 cannot check, that it will be reported rather than applied.
  Not built here.
