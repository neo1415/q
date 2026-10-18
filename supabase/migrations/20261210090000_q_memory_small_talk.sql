-- Q room R7 (ADR 0062): small-talk memory.
--
-- What a person mentions in passing ("I'm off to Lagos on Friday") so Q can
-- bring it back, once, in a long wait ("By the way, how was Lagos?"). A new
-- memory_type on the existing table, written only by the memory service
-- (the Write Gate: quote verified against the person's own turns), and held
-- to three rules here so they are database facts, not service habits:
--
--   personal_private, always: small talk is never organisation, relationship
--   or network memory, so no other person's purpose can reach it.
--   It always carries the person's own words (quote not null).
--   It always lapses: valid_to is set (90 days from the write, by the
--   service), so nothing about a person's weekend lives forever.
--
-- Additive: the type check gains one value; existing rows are untouched.

alter table q_knowledge.memory_items
  drop constraint memory_items_memory_type_check;

alter table q_knowledge.memory_items
  add constraint memory_items_memory_type_check
  check (memory_type in (
    'preference', 'pronunciation', 'correction', 'fact', 'episodic', 'small_talk'));

alter table q_knowledge.memory_items
  add constraint memory_items_small_talk_check
  check (memory_type <> 'small_talk'
         or (visibility_scope = 'personal_private'
             and owner_context_type = 'user'
             and quote is not null
             and valid_to is not null));

-- The silence ladder's recall: the person's live small talk, newest first.
create index memory_items_small_talk_live_idx
  on q_knowledge.memory_items (tenant_id, owner_context_id, updated_at desc)
  where memory_type = 'small_talk' and status in ('active', 'confirmed');
