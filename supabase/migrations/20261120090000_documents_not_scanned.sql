-- ADR 0042 (founder decision 2026-10-03): until a malware scanner is
-- attached, a document version processed under the explicit interim policy
-- ALLOW_UNSCANNED_WITH_WARNING is recorded NOT_SCANNED. Additive: one more
-- allowed value; no row changes, and nothing here can write CLEAN.
alter table evidence.document_versions
  drop constraint document_versions_malware_scan_status_check;
alter table evidence.document_versions
  add constraint document_versions_malware_scan_status_check
  check (malware_scan_status in ('PENDING', 'CLEAN', 'BLOCKED', 'ERROR', 'NOT_SCANNED'));

comment on column evidence.document_versions.malware_scan_status is
  'PENDING until a decision; CLEAN only from a scanner verdict; NOT_SCANNED when processed with no scanner under ADR 0042''s interim policy (never clean).';
