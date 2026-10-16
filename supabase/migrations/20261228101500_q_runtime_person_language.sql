-- The language each person wants Q to use (owner directive 2026-10-16,
-- multilingual Q, Arabic first). Kept with their other Q choice, the
-- personality, on their own standing row: one per person, following them
-- across devices and organisations (it is about the person, not a
-- membership).
--
-- Null means AUTO: Q follows the device and the language they speak. A
-- value is a BCP 47 tag; which tags Capital Q offers is the contract's list
-- (packages/contracts Q_LANGUAGE_PREFERENCES), so offering another
-- language needs no migration. The check keeps the column a well-formed,
-- bounded tag and nothing else.
--
-- Server-written only, as before: the existing select-own policy already
-- covers the new column; no grant changes.

alter table q_runtime.person_standing
  add column language text
    check (language is null
           or (length(language) <= 35
               and language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'));

comment on column q_runtime.person_standing.language is
  'The person''s chosen language for Q (BCP 47), or null for AUTO (follow the device and what they speak).';
