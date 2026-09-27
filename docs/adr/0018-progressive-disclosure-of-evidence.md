# ADR 0018 — Progressive disclosure of evidence

## Status

Proposed — 2026-09-27, for lead review. Founder-directed (R23). Amends the
presentation rules in doc 17 and doc 18 that show truth class, evidence
status and findings inline with every answer and field. Changes no data
model, contract or invariant.

## Context

The founder reviewed the live product and found chats and pages cluttered
with evidence, fact and gap blocks, truth-class labels and "self-reported"
chips. Investors want the answer first. `CLAUDE.md` requires evidence
before opinion, three independent axes (truth class, evidence status,
lifecycle status), unknown kept unknown and contradictions kept visible.
Those are rules about what is stored and what is true, not about how much
of it is on screen by default.

## Decision

1. **Default presentation is minimal.** A Q reply shows its answer; a
   profile shows its values; a document shows its prose.
2. **Provenance is one tap away.** A small "Sources" control (a closed
   `<details>`, 44 px target, keyboard and screen-reader reachable) reveals
   the findings, truth class, evidence status, lifecycle status and the
   sources for that answer, value or section. Collapsed is not removed:
   everything the server sent is rendered inside it.
3. **Declared profile fields** carry their provenance ("Your statement ·
   self-reported") once per profile block under "Sources", not beneath
   every value.
4. **What stays visible regardless:** a contradiction notice (both values
   shown, neither chosen), "Not stated" for unknown values, approvals with
   their exact payload, and any sentence that would otherwise read as
   verified fact. Presentation never upgrades a claim: nothing hidden
   behind "Sources" may be restated outside it as stronger than it is.

## Consequences

- The evidence invariants in `CLAUDE.md` hold unchanged: the three axes
  remain separate in the data model and the contracts, inference is never
  shown as verified fact, and no confidence percentage is introduced.
- Components use one shared `SourcesDisclosure`; tests assert it starts
  closed and still contains the provenance.
- Doc 17/18 passages that require inline truth labels are superseded to
  this extent only.
