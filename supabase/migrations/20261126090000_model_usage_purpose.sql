-- Usage by task (lead 2026-10-03: "This month: Q used about $X for you",
-- broken down by what it was for). Additive: a closed purpose on each new
-- ledger row, written by the gateway from the caller's attribution (or
-- derived: a Q run is a conversation, an instruction's correlation id is
-- that instruction). The ledger is append-only, so rows written before
-- this read as OTHER and the usage read derives theirs the same way; no
-- existing row is changed.

alter table ai_ops.model_usage
  add column purpose text not null default 'OTHER'
    check (purpose in ('CONVERSATION', 'INSTRUCTION', 'DELEGATED_WORK', 'REHEARSAL',
                       'RESEARCH', 'ONBOARDING', 'MEETING', 'DOCUMENT', 'OTHER'));

comment on column ai_ops.model_usage.purpose is
  'What the call was for, for usage views. OTHER on rows written before 20261126090000; reads derive those from correlation_id and q_run_id.';

-- The person's month reads by user.
create index model_usage_user_occurred_idx
  on ai_ops.model_usage (user_id, occurred_at desc) where user_id is not null;
