-- What Q fetched in a conversation, kept for its follow-ups (owner live
-- 2026-10-17, conversation 971c5a53).
--
-- Q's words and the blocks it rendered are already on conversation_messages.
-- A tool result that was read but never rendered (a profile read for a
-- spoken answer, a fit profile behind a sentence, a research answer) was
-- lost after the turn, so "what did you say about their team?" sent Q to
-- look it up again. Each row here is one successful read-only tool result
-- that the run already received: it passed the tool's own authorize step
-- and output validation under that run's Context Firewall plan. Nothing is
-- fetched to fill this table, and nothing in it widens what a later run may
-- read: the Q API reads it back only for the conversation's own owner, only
-- at or below the later run's sensitivity ceiling, newest first and
-- bounded.
--
-- Retention: a row expires 14 days after it was fetched (bounded to 30 by
-- the check) and the workers' retention pass deletes expired rows. The
-- conversation, run and message history are untouched; this is working
-- context, not a record of truth (audit and run events stay where they are).
--
-- Owner-scoped and server-only, as every q_runtime table: no client grants
-- and no policies. Ownership is checked here too: the row's owner, run and
-- conversation must agree with q_runtime.runs and q_runtime.conversations.

create table q_runtime.conversation_tool_results (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  conversation_id  uuid not null,
  -- The conversation's owner, who alone may have this read back.
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  -- The turn: the run that fetched it.
  run_id           uuid not null,
  -- Its place among that run's calls, as they returned.
  call_index       integer not null check (call_index between 0 and 999),
  tool_name        text not null check (length(tool_name) between 1 and 120),
  arguments        jsonb not null default '{}'::jsonb
                     check (pg_column_size(arguments) <= 8192),
  result           jsonb not null check (pg_column_size(result) <= 65536),
  -- The tool's declared sensitivity for what it returned. Nothing above
  -- CONFIDENTIAL is kept: those are read fresh, under their own plan.
  sensitivity      text not null
                     check (sensitivity in ('PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL')),
  created_at       timestamptz not null default clock_timestamp(),
  expires_at       timestamptz not null default (clock_timestamp() + interval '14 days'),

  constraint conversation_tool_results_retention_check
    check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  foreign key (conversation_id, tenant_id)
    references q_runtime.conversations (id, tenant_id) on delete cascade,
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete cascade,
  unique (run_id, call_index)
);

comment on table q_runtime.conversation_tool_results is
  'Successful read-only tool results a Q run already received, kept per conversation turn for follow-ups; owner-only, server-only, expires (retention pass).';

create index conversation_tool_results_conversation_idx
  on q_runtime.conversation_tool_results (conversation_id, created_at desc);
create index conversation_tool_results_expiry_idx
  on q_runtime.conversation_tool_results (expires_at);

-- The row's owner, run and conversation agree with the run that fetched it.
create function q_runtime.check_conversation_tool_result_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from q_runtime.runs r
      join q_runtime.conversations c
        on c.id = r.conversation_id and c.tenant_id = r.tenant_id
     where r.id = new.run_id
       and r.tenant_id = new.tenant_id
       and r.conversation_id = new.conversation_id
       and r.actor_user_id = new.user_id
       and c.user_id = new.user_id
  ) then
    raise exception 'a tool result belongs to its own run, conversation and owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.check_conversation_tool_result_owner() from public;

create trigger conversation_tool_results_owner
  before insert on q_runtime.conversation_tool_results
  for each row execute function q_runtime.check_conversation_tool_result_owner();

-- Written once; only retention removes a row.
create function q_runtime.protect_conversation_tool_results() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.conversation_tool_results is written once'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.protect_conversation_tool_results() from public;

create trigger conversation_tool_results_write_once
  before update on q_runtime.conversation_tool_results
  for each row execute function q_runtime.protect_conversation_tool_results();

-- As every q_runtime table: no policies and no client grants. The Q API is
-- the boundary and reads a row back only for the conversation's owner.
alter table q_runtime.conversation_tool_results enable row level security;
