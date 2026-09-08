# investor-onboarding — the investor journey and Investor Mandate Q

**Packets:** CQ-ONB-003 (journey v1) · CQ-Q-022 (Mandate Q)
**Package:** `@capital-q/investor-onboarding`

The published investor journey (I0–I12), the integration layer that carries
confirmed answers into the Investor domain, and — from CQ-Q-022 — what Q does
with an investor's own description of what they invest in.

## What CQ-Q-022 adds, and what it deliberately does not

CQ-INV-002 and CQ-ONB-003 already built the hard parts: a versioned
`core.investor_mandates`, a `core.investor_mandate_constraints` table with a
closed dimension allowlist and a DB CHECK keeping `importance =
'HARD_EXCLUSION'` and `is_hard_exclusion` in lockstep, and every phase from
I0 to I12 including the review screen. Nothing here replaces any of it.

What was missing was Q. `INVESTOR_MANDATE_SYNTHESIS` existed and nothing
called it, so an investor's typed thesis was stored as text beside the
structure and never read.

## The one rule this module is built around

```
HARD_EXCLUSION is unreachable from anything a model produced.
```

Not discouraged. Not behind a flag a caller could pass. `preferenceClassFor`
has no branch that returns it; the only function that does takes the
investor's confirmation as an argument. A hard exclusion decides what a
person never sees, and that consequence belongs to the person who chose it.

The consequence is that these three stay distinct all the way down:

|                                       | meaning              | effect                  |
| ------------------------------------- | -------------------- | ----------------------- |
| preference (`STRONG`, `NICE`)         | "we like this"       | ranks up                |
| **avoid** (`AVOID`)                   | "I'd rather not"     | ranks down, still shown |
| **hard exclusion** (`HARD_EXCLUSION`) | "never show me this" | **ineligible**          |

A model reading firm wording produces `EXCLUSION_CLAIMED` — named for what it
is, a reading — which maps to `AVOID`. Nothing is lost while it waits for an
answer: an unconfirmed exclusion still ranks the candidate down.

## How a thesis becomes a mandate

```
narrative + the selections already made
  → ONE model call through the Model Gateway
  → validated proposals (never exclusions, never taxonomy ids)
  → the investor confirms, edits or rejects — exclusions individually
  → the Investor service writes and versions it
```

### What the synthesis refuses

- **Nothing broadens the mandate.** A dimension the investor answered by
  selection is not re-proposed, so a synthesis cannot quietly widen a stage
  range they narrowed by hand.
- **No sector phrase becomes a taxonomy id.** Capital Q's own service maps
  them. Companies are classified with those same ids, so a model-invented id
  would be a criterion nobody chose — and a phrase that resolves to nothing
  files no constraint at all, because a free string would look like a filter
  while matching nothing. It survives in the raw narrative, where a person
  reads it.
- **No invented precision.** "Early stage" is not resolved into a stage
  range and "usually $250k–$1m, but we've gone higher" does not make $1m an
  absolute ceiling. Both become ambiguities with the question that settles
  them.
- **No protected-trait screening.** The canonical dimension allowlist has no
  column such a criterion could occupy, so it is structurally
  unrepresentable. The check in `semantics.ts` is a second line that lets
  Capital Q _say so_ rather than have the request vanish. It matches
  requests to screen **by** a characteristic — "we back female founders
  through our diversity fund" is a legitimate sentence and is left alone.

### Ambiguity

Three kinds, each tied to a dimension and asked neutrally:

- `SCOPE_OR_EXCLUSION` — "I mostly invest in Africa." Preference, or exclude
  everywhere else? This one changes eligibility, so it is asked first.
- `TYPICAL_OR_LIMIT` — a range that may be typical or absolute.
- `IMPRECISE_VALUE` — a phrase that maps to more than one canonical value.

The question is never leading: _"Should Capital Q exclude these entirely, or
show them lower?"_ — not _"you probably meant"_.

## The separations, and where each is enforced

| Separation                     | Enforcement                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declared ≠ Observed behaviour  | Observations reach `inferences` and `tensions` only; `confirmMandate` never reads them                                                                                                                                 |
| Declared ≠ Q inference         | Same — an inference carries its basis and is never presented as a declaration                                                                                                                                          |
| Declared ≠ GateQ               | I10 inbound preference is a separate column from I9 discovery mode; neither is derived from the other                                                                                                                  |
| Discovery mode ≠ mandate       | The mode is whatever the investor chose at I9. A mandate full of exclusions is not automatically STRICT, and EXPLORATORY overrides no hard exclusion — exclusions are constraint rows, and the mode never touches them |
| Preference ≠ avoid ≠ exclusion | The class scale above, plus the confirmation gate                                                                                                                                                                      |

## Staleness and idempotency

A synthesis records the session revision it was computed from.
`synthesisIsCurrent` refuses one computed from an older revision, so an
investor who edits their stages while a call is in flight does not get the
older reading landing on top. Recomputing costs one model call; being wrong
costs a mandate that misdescribes them.

`sameMandate` compares two confirmed inputs by semantic content — dimension,
value, importance — and not row order, so clicking "Looks right" twice or
retrying a request does not create a second identical version.

## Wave 6 handoff

`InvestorMandateSnapshot` (CQ-INV-002) is already exactly what recommendation
needs: deterministic per `(mandateId, version)`, typed constraints each
carrying `automatedUse`, canonical taxonomy ids, cheque band, stage envelope
and discovery mode — with the raw narrative excluded. No later component
needs to re-parse onboarding text.

**No ranking exists yet, and none is claimed.** CQ-Q-022 prepares the input;
Wave 6 does the matching. No model ranks companies, here or anywhere.

## Security

- All model access through the Model Gateway; no provider SDK in this
  package.
- Mandate material is declared CONFIDENTIAL to the gateway, which decides
  provider eligibility _before_ contacting one. A refusal becomes
  `NO_ELIGIBLE_MODEL_ROUTE` and is honoured rather than worked around.
- Telemetry carries counts, codes and versions — never a cheque figure, an
  exclusion, a phrase or the narrative.
- Authorisation, versioning, events and audit belong to the Investor
  service. This module returns input; it writes nothing.

## Verification

| What                                             | Where                             |
| ------------------------------------------------ | --------------------------------- |
| QIM-002..006, 011, 015, 017, 018 (44 assertions) | `test/investor-mandate-q.test.ts` |
| Journey v1 and write targets (10)                | `test/definition.test.ts`         |

## Known limitations

See the CQ-Q-022 postflight. In short: the semantics, the synthesis service
and the confirmation gate are real and tested; the I11 review screen still
renders the deterministic projection of what the investor selected rather
than Q's reading, and nothing yet calls the synthesis from the live session.
