-- Investor materials (owner directive 2026-10-16): optional in investor
-- setup, a fund deck, an investment thesis or an LP letter.
--
-- They are the firm's own organisation documents (company_id null,
-- owner_organisation_id = the firm), defaulting to organisation_private and
-- CONFIDENTIAL like every document; never a company's and never a data room.
-- Only the document-type vocabulary widens: no row changes, RLS and grants
-- are untouched (evidence stays server-only).

alter table evidence.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check check (document_type in (
    'UNCLASSIFIED', 'PITCH_DECK', 'FINANCIAL_MODEL', 'MANAGEMENT_ACCOUNTS',
    'COMPANY_PROFILE', 'FINANCIAL', 'LEGAL', 'CORPORATE', 'GOVERNANCE',
    'PRODUCT', 'COMMERCIAL', 'CUSTOMER', 'OPERATIONAL', 'OTHER',
    'FUND_DECK', 'INVESTMENT_THESIS', 'LP_LETTER'));
