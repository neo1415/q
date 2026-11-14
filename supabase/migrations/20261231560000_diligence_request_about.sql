-- Resolving investor uncertainty (owner addendum, 14 Nov 2026; audit slice 5).
--
-- A diligence request (a document asked for, or questions sent while in
-- diligence) may name the uncertainty it was asked to resolve: the
-- statement Q made about it (or a claim key) and the standing that
-- statement had when it was asked. Additive and nullable: every existing
-- request, and every request asked from the relationship page, names none.
--
-- The standing is a closed list kept apart from the truth, evidence and
-- lifecycle axes (ADR-001; decision 92): a source reporting a claim,
-- independent corroboration or contradiction, the founder confirming it,
-- a document supporting it, and independent verification. KYB never sets
-- it. The row stays append-only (the existing trigger): nothing here is
-- ever rewritten after the request is made.

alter table network.diligence_requests
  add column about text
    check (about is null or (length(about) between 1 and 400 and about !~ '[[:cntrl:]]')),
  add column about_standing text
    check (about_standing is null or about_standing in (
      'REPORTED', 'CORROBORATED', 'CONTRADICTED', 'FOUNDER_CONFIRMED',
      'DOCUMENT_SUPPORTED', 'INDEPENDENTLY_VERIFIED')),
  add constraint diligence_requests_about_standing_needs_about
    check (about_standing is null or about is not null);

comment on column network.diligence_requests.about is
  'The uncertainty this request was asked to resolve (Q''s statement or a claim key); null: none named.';
comment on column network.diligence_requests.about_standing is
  'The standing that uncertainty had when asked (never from KYB); null: none named.';
