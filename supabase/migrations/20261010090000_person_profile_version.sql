-- Editable person profiles (BIZ-002; lead-owned migration).
--
-- A person may now edit what Capital Q shows about them -- their display
-- name and a one-line headline -- from the profile page and by asking Q.
-- Both front doors go through one write path, and that write path needs
-- what the company and investor profiles already have: an optimistic
-- version, so an edit made on a stale page is refused rather than
-- silently overwriting a newer one.
--
-- Additive only. Existing rows start at version 1; nothing reads the
-- column yet except the person-profile store.

alter table identity.user_profiles
  add column version integer not null default 1
    check (version >= 1);

comment on column identity.user_profiles.version is
  'Optimistic concurrency for person-profile edits; incremented by every applied change.';

-- No length constraint on display_name/headline here: rows written by the
-- auth trigger before this packet are not known to fit the contract's
-- bounds, and a CHECK would make any later touch of such a row fail. The
-- contract bounds every write this packet introduces.
