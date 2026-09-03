# ADR 0002 — `instrument_code` on the canonical capital objective

## Status

Accepted — 2026-09-04. Clarifies Document 13 §14.1 for CQ-CAP-001.

## Context

Document 25 (Coding-Agent Execution Plan) and founder onboarding step F6
(Document 17) require the capital objective to capture "stage / instrument
where applicable". Document 13 §14.1 sketches `core.capital_objectives` with
`objective_type` and `target_stage` but no instrument column, and no
approved instrument vocabulary exists anywhere in the repository (no taxonomy
package, no contract, no ADR).

Three things must stay distinct:

- `objective_type` — what kind of capital objective this is (V1: `RAISE`);
- `target_stage` — the funding stage language (`seed`, `series_a`, …), which
  is also distinct from the company's own current stage;
- the financing **instrument** — SAFE, priced equity, convertible note,
  revenue-based financing, grant, and so on.

Overloading `objective_type` or `target_stage` with instrument semantics
would corrupt both dimensions and block the later recommendation comparison
between a company's objective and an investor's mandate.

## Decision

`core.capital_objectives` gains a narrow, nullable column:

```text
instrument_code text
  check (instrument_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$')
```

- Optional: unknown or not-applicable stays `NULL`; nothing is inferred from
  the company stage.
- Bounded declared code, not a PostgreSQL enum: CQ-TAX-001 / CQ-TAX-002 will
  supply and map the canonical instrument vocabulary without a schema
  rewrite.
- Exposed on the organisation-internal contract as `instrumentCode`,
  editable through recalibration, and reported in domain events only as the
  change kind `INSTRUMENT` (never the value).
- Instrument-specific financing terms (valuation, cap, discount, interest)
  are explicitly out of scope and need their own later structure and
  evidence.

## Consequences

- The F6 requirement is satisfied structurally instead of being pushed into
  free text or a mislabelled field.
- No locked product decision is contradicted: the PADL, Product
  Specification and Final System Review do not define the capital objective
  schema; this is a data-architecture clarification.
- When taxonomy lands, existing codes are mapped in place; the column and
  contract name remain.
