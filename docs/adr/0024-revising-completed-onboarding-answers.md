# ADR 0024 — Revising completed onboarding answers (Q and the profile edit every fact)

## Status

Accepted on 2026-09-29, by founder decision: "Q must be able to edit every
profile field". Migration: `20261024090000_onboarding_revise`.

## Context

Most of an investor's profile was first given during onboarding: sectors,
geographies, business models, customer types, stages, cheque sizes,
criteria, founder preferences, exclusions, discovery style and portfolio.
The same is true of a founder's company categories, team facts and
traction. The profile shows those answers. Each step's write targets
merged the answer into the canonical records (the mandate, the company)
dimension by dimension.

Once the session completed, nothing could change them. Every mutation
required an ACTIVE session. Q's mandate tool explicitly left sector and
constraint preferences to "the mandate form", but no such form existed
after onboarding.

## Decision

1. **Revise, don't fork.** A new runtime use case, `reviseResponse`, changes
   one answer of a COMPLETED session. It goes through the same
   `commitResponse` as a submission:
   - the step's write targets run on the new answer, so the mandate or the
     company changes exactly as onboarding would have changed it, merged by
     dimension;
   - the old response is superseded, never overwritten;
   - the session stays COMPLETED.

   The call is idempotent (a new `revise` mutation operation) and
   version-checked.

2. **Only declared steps.** Each journey declares its revisable steps
   (`INVESTOR_REVISABLE_STEPS`, `FOUNDER_REVISABLE_STEPS`), and composition
   passes them to the runtime. Any other step is refused
   (`STEP_NOT_REVISABLE`). Never revisable:
   - the bootstrap, organisation-name and mandate-selection steps;
   - the confirmations;
   - the inbound preference (ADR 0023);
   - company fields that already have their own edit path (name, website,
     country, stage, description);
   - the raise (the Capital page).

   Published definitions stay hash-locked: the lists live beside the
   definitions, not inside the manifest.

3. **Surfaces.**
   - `POST /v1/onboarding/sessions/:id/revisions`, with the same body as a
     submission.
   - Q's `propose_profile_answer_change` names a fact and the person's
     words. q-api resolves the words against the step's own options, or the
     reference taxonomy's names and aliases for a category step. Node ids
     are the deployed ids. It then holds the exact validated answer for
     approval (`onboarding.answer.revise`, CONFIRM_REQUIRED).
   - On approval, q-api revises the approver's own completed session
     in-process, with the same write targets the API composes.

## Consequences

- Q's approved change and the profile read the same record, so an approved
  change now shows on the profile. Previously a mandate change could
  succeed while the profile still showed the old onboarding answer.
- A revision can make a later conditional step eligible. That step stays
  unanswered, which is a valid state (unknown stays unknown).
- The profile's per-card Edit (the profile redesign) uses the same route.
