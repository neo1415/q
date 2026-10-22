-- Demonstration data on a real company's profile (owner direction
-- 2026-10-22). Additive.
--
-- Some companies are seeded with demonstration figures so the product can be
-- shown end to end: Capital Q itself, and companies whose owners agreed. Real
-- investors see them, so every surface that shows such a company -- its
-- profile, its Q Card, and Q -- must say so plainly. This is the one durable
-- marker those surfaces read; it is set only by the reviewed demo seed and
-- cleared by an operator, never by a model.
--
-- The column says nothing about verification or truth class: those stay on
-- their own axes (ADR-001). No grant or policy changes.

alter table core.companies
  add column demonstration_data boolean not null default false;

comment on column core.companies.demonstration_data is
  'True when the profile carries demonstration figures (owner-approved demo seed). Every surface shows a "Demonstration data" label; never a verification or truth signal.';
