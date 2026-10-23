-- An investor's note with their Express Interest (owner 2026-10-23,
-- coordinator decision B). A founder who reads "Savanna Seed is interested:
-- 'I'd like a call next week about your API approach'" acts on it; a bare
-- interest flag does not.
--
-- The note is relationship_shared: written by the investor, read only by
-- the two parties of the ONE canonical relationship through the server
-- (the table stays server-internal: RLS on, no policies, no client grants).
-- It is never a ranking or recommendation input. Optional; NULL is no note.
-- Approval binds to company and note, so a changed note is a new approval.
--
-- Additive: one nullable column with a length check. No row is rewritten.

alter table network.interests
  add column note text
    check (note is null or char_length(btrim(note)) between 1 and 1000);

comment on column network.interests.note is
  'The investor''s optional note with the interest (1-1000 characters). relationship_shared: shown only to the two parties of the relationship, never used for ranking or recommendations.';
