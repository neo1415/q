# ADR 0007 — Investor portfolio references

**Status:** Accepted (CQ-ONB-003)
**Clarifies:** Document 11 (Investor bounded context owns portfolio context), Document 13 (no physical portfolio table), Product Specification investor onboarding I8 ("add representative portfolio companies or skip").

## Context

The technical architecture places an investor's portfolio context inside the Investor
bounded context, and investor onboarding step I8 asks for one to five representative
portfolio companies (or nothing). Document 13's physical schema defines no table for it,
and the onboarding runtime deliberately owns no business truth: leaving portfolio names
only inside onboarding responses would make journey state a permanent source of truth.

A named portfolio company is not a Capital Q Company. An investor typing "Stripe" must
not create a `core.companies` row, a relationship, a match or any public statement.

## Decision

1. **A minimal Investor-owned reference table.** `core.investor_portfolio_references`
   stores `tenant_id`, `investor_organisation_id`, `company_name`, nullable
   `website_url`, `source`, `created_by_user_id`, `created_at` and nullable `removed_at`.
   Nothing else: no ownership percentage, amount, valuation, board seat or performance
   data. Removal sets `removed_at`; rows are never hard-deleted, so history is kept.
2. **References, not companies.** There is no `linked_company_id` in V1. Linking a
   reference to a canonical company, if ever wanted, is a later deliberate provenance
   workflow (public research, integration or Q research), never automatic
   de-duplication at entry.
3. **Provenance is explicit.** V1 accepts only `USER_ENTERED`; `PUBLIC_RESEARCH`,
   `INTEGRATION` and `Q_RESEARCH` may be added later with their own provenance rules.
4. **Investor-private by default.** The table follows the Investor domain's posture:
   readable by current members of the organisation behind the investor organisation
   (RLS), written only by the Investor application service under `investor.edit`, and
   never projected to founders until a future Investor Profile packet decides which
   fields, if any, are shown. Events and audit carry identifiers only.
5. **Onboarding orchestrates, Investor owns.** Onboarding's five-item ceiling is journey
   UX; the domain ceiling is separate and larger. Onboarding never writes the table
   directly.

## Consequences

- Investor onboarding I8 lands on canonical, Investor-owned data without inventing a
  company entity or an import pipeline.
- A future portfolio import, research enrichment or founder-facing "selected portfolio"
  projection extends this table's provenance and disclosure rules rather than replacing it.
- Document 13's physical schema gains one narrowly scoped table; the omission is
  recorded here rather than silently patched.
