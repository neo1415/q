-- ADR 0043 S3: the Q conversation a standing instruction asks its cards in
-- (one per instruction, set on its first card). Additive and nullable.

alter table q_runtime.standing_instructions
  add column conversation_id uuid;

comment on column q_runtime.standing_instructions.conversation_id is
  'The Q conversation this instruction''s approval cards are asked in; set once, on the first card.';
