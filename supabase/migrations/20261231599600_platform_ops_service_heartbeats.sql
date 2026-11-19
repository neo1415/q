-- Console System health (incident 19 Nov 2026: q-api's pool wedged for 72
-- minutes and nothing a person could see said so). The workers have no
-- public port, so they say they are alive here: one row per service,
-- upserted on each operational check with the time, the process's own
-- database pool (counts and ages only) and the check's finding codes.
--
-- Additive. Server-only, like every platform_ops table: RLS on with no
-- policy, nothing granted to anon or authenticated; the privileged server
-- role writes (workers) and reads (the API's console overview, behind the
-- overview.read operator permission).

create table platform_ops.service_heartbeats (
  service    text primary key check (service in ('workers')),
  beat_at    timestamptz not null,
  -- databasePoolSnapshot: slots, held, waiting, oldestHeldMs, recycles,
  -- lastRecycledAt. Never statement text or ids.
  pool       jsonb not null default '{}'::jsonb
               check (jsonb_typeof(pool) = 'object'),
  -- The last operational check: { checkedAt, findings: [codes] }.
  ops_check  jsonb not null default '{}'::jsonb
               check (jsonb_typeof(ops_check) = 'object'),
  updated_at timestamptz not null default now()
);

comment on table platform_ops.service_heartbeats is
  'Console System health: each background service''s last heartbeat, its database pool (counts and ages) and its last operational check''s finding codes. Server-only.';

alter table platform_ops.service_heartbeats enable row level security;

revoke all on platform_ops.service_heartbeats from public, anon, authenticated;
grant select, insert, update, delete on platform_ops.service_heartbeats to postgres, service_role;
