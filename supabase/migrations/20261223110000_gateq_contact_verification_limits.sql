-- Cross-instance, server-only hourly anti-abuse budgets. Destination is a
-- domain-separated HMAC, never a raw email or code. These operational counters
-- intentionally span tenant boundaries to protect the same recipient.
create table gateq.contact_verification_limits (
  scope text not null check (scope in ('APPLICATION', 'SESSION', 'DESTINATION')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default clock_timestamp(),
  send_count integer not null default 0 check (send_count between 0 and 10),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  primary key (scope, key_hash)
);
alter table gateq.contact_verification_limits enable row level security;
revoke all on gateq.contact_verification_limits from public, anon, authenticated;
alter table gateq.application_contacts add column attempt_window_started_at timestamptz not null default clock_timestamp();
