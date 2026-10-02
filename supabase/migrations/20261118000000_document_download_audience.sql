-- ADR 0041 · Who may download a pitch deck (founder decision 2026-10-02).
--
-- A founder chooses, as one choice, who may download a PITCH_DECK:
--
--   ORGANISATION  only their own organisation (the default: private)
--   INVESTORS     also every investor for whom the company is viewable,
--                 the same rule that admits an investor to its pitch
--                 (media's resolveViewableCompany)
--
-- Deliberately its own column and not `visibility_scope`: that scope is
-- inherited by what is extracted from the document (sources, evidence,
-- knowledge), and sharing the file's bytes must never widen who may read
-- what Q learned from it. Only a PITCH_DECK can be shared this way; any
-- other type is always ORGANISATION, enforced here and not only in code.
--
-- Additive only. evidence.documents stays server-only (RLS on, no
-- policies, no client grants): the application decides who downloads,
-- and every download is a short-lived signed URL, never a public object.

alter table evidence.documents
  add column download_audience text not null default 'ORGANISATION'
    constraint documents_download_audience_check
      check (download_audience in ('ORGANISATION', 'INVESTORS')),
  add constraint documents_download_audience_deck_only
    check (download_audience = 'ORGANISATION' or document_type = 'PITCH_DECK');

comment on column evidence.documents.download_audience is
  'Who may download the file (ADR 0041). ORGANISATION: the owner only (default). INVESTORS: also investors for whom the company is viewable (the pitch rule). PITCH_DECK only. Never widens visibility_scope or anything derived from the document.';

-- The investor read: one company's shared deck, newest first.
create index documents_investor_deck_idx
  on evidence.documents (tenant_id, company_id, updated_at desc)
  where download_audience = 'INVESTORS' and status = 'ACTIVE';
