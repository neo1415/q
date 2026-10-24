-- Approval card upgrade (QA lead, coordinator 2026-10-24): why Q proposes an
-- action, shown on its card as "Why: ...". Written by code where the action
-- knows it, otherwise by the model that prepared it; at most 200 characters.
--
-- Presentation only, like summary and preview: the reason is NOT part of
-- the approval binding (proposed_payload and its hash are unchanged), it
-- never authorises anything, and it is read only through the q-actions
-- service, as every other column of this server-internal table.
--
-- Additive: one nullable column with a length check. No row is rewritten.

alter table q_runtime.actions
  add column reason text
    check (reason is null or char_length(btrim(reason)) between 1 and 200);

comment on column q_runtime.actions.reason is
  'Why Q proposed this action, as shown on its card (1-200 characters). Presentation only: not part of the approval binding or payload hash.';
