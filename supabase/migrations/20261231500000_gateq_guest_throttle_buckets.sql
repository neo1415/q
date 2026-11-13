-- B8: the GateQ guest throttle, shared across API instances and restarts.
-- The key is the sha256 hex of "operation:sessionId" (START uses the gateway
-- public id), never a raw session id or credential. One guest's bucket is one
-- guest's: there is deliberately no global row. Server-only, like
-- gateq.contact_verification_limits: no browser role may read or write it.
create table gateq.guest_throttle_buckets (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default clock_timestamp(),
  count integer not null default 1 check (count between 1 and 10000)
);
-- Expired rows are deleted by the API in small, bounded, skip-locked batches
-- (no cron); this index keeps that sweep from scanning the table.
create index guest_throttle_buckets_window_started_at_idx
  on gateq.guest_throttle_buckets (window_started_at);
alter table gateq.guest_throttle_buckets enable row level security;
revoke all on gateq.guest_throttle_buckets from public, anon, authenticated;
