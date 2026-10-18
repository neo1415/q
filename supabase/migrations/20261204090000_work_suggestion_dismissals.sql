-- WORK-58 (founder decision 2026-10-04): Q's work page suggests a few
-- next steps from the person's own account signals. "Not now" on one is
-- remembered per person, so the same suggestion does not come back.
-- Additive: one new server-written table; no client role reaches it.

create table q_runtime.work_suggestion_dismissals (
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  user_id         uuid not null references identity.user_profiles (id) on delete restrict,
  -- A stable, opaque key the suggestion read derives from the signal (its
  -- kind plus the subject it is about); never free text from a client.
  suggestion_key  text not null check (suggestion_key ~ '^[a-z_]{2,40}:[A-Za-z0-9:_-]{1,160}$'),
  dismissed_at    timestamptz not null default clock_timestamp(),
  primary key (user_id, suggestion_key)
);

comment on table q_runtime.work_suggestion_dismissals is
  'A suggestion on Q''s work page that the person set aside ("Not now", WORK-58). Additive: a later identical dismissal is a no-op; nothing is overwritten.';

create index work_suggestion_dismissals_tenant_idx
  on q_runtime.work_suggestion_dismissals (tenant_id, user_id);

alter table q_runtime.work_suggestion_dismissals enable row level security;

-- Server-only: the API reads and writes the person's own rows under their
-- actor context; no browser principal holds any privilege here.
revoke all on q_runtime.work_suggestion_dismissals from public, anon, authenticated;
