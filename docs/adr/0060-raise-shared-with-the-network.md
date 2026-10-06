# ADR 0060: A founder may show their raise to every investor on the network

Status: Proposed (lead request P14, 2026-10-06). Needs founder confirmation before deploy.
Amends: the capital-objective classification note in `packages/permissions` resolvers ("an ACTIVE objective is never automatically network-visible; founder onboarding decides later") and the visibility page's wording that the raise "is never shown to the network".

## Context

The raise (capital objective: target, instrument, stage, close date) is `founder_private` by classification and could only be shared with one relationship at a time. Seed finding "raise shared with the network" asked for a way to show it to every investor, because investors otherwise see "Raising: Not shared" and Discover's raise filters cannot match a company. CLAUDE.md's release-blocking invariant forbids founder-private information from _silently_ reaching investor-facing reads or ranking where the investor is not authorised.

## Decision

1. The objective's own scope stays `founder_private`. Nothing becomes visible by default, and onboarding does not change that.
2. A founder may choose, on the visibility page (or approve Q's card), "Show my raise to every investor on Capital Q". The choice is one explicit `network_visible` disclosure policy, with no recipient, on the capital objective. It is granted through the policy manager (disclosure.manage on the company, audited like any grant) and revoked like any share.
3. Every investor-facing read of the raise already asks the disclosure evaluator (company preview, Discover's `disclosedRaises` raise filters, relationship views). They need no change: the policy is the only switch, so the investor is authorised exactly when the founder chose it.
4. What is shown is the structured raise only. The use of funds and the F5 terms (valuation, minimum cheque) stay company-only; they are not in the disclosed projection.
5. `network_visible` means authenticated Capital Q participants who can see the company. It is never `public_external`.
6. Default off. The wording says what investors see, that it can be turned off at any time, and that what was already seen cannot be recalled.

## Consequences

The Context Firewall rule holds: the widening is the founder's explicit, revocable, audited act, enforced server-side by the same evaluator every read uses. "Verified investors only" is not enforced by the disclosure layer itself: `network_visible` admits any authenticated organisation that can see the company; verification and network entitlement remain the separate controls that decide which investors see the company at all. If the founder wants the raise limited to verified investors specifically, that is a follow-up (a verification condition on the evaluator's `network_visible` branch for this resource).
