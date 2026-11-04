-- C residual (audit 2026-11-04, SEC-01): a Q artifact starts private to the
-- person who asked for it, not visible to their whole organisation.
-- Widening it is a deliberate act that does not exist yet.
--
-- Default only: existing rows are not rewritten (no silent overwrite of
-- recorded state). Reads are already owner-only in the repository's where
-- clause and the service (2776fc5), so an organisation_private row is not
-- readable by a colleague either way.

alter table artifacts.artifacts
  alter column visibility_scope set default 'personal_private';
