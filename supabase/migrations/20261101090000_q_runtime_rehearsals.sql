-- The Investor Twin (founder direction 2026-09-30, C12): a founder
-- rehearses a meeting with an investor, played by Q, then Q coaches them.
--
-- Firewall: the persona is built only from what this founder may already
-- see of the investor -- their network-visible profile, what they wrote to
-- this founder, and calls this founder was on. Never the investor's
-- mandate, never their private conversations with Q. The rehearsal is the
-- founder's own practice: nothing said here becomes a fact, a claim or a
-- memory about the company, and the investor never sees it.
--
-- Server-written only; the founder reads their own rehearsals.

create table q_runtime.rehearsals (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id           uuid,
  investor_organisation_id  uuid not null,
  investor_name             text not null check (length(investor_name) between 1 and 200),
  -- Q's reading of the investor (INVESTOR_PERSONA), with its grounding.
  persona                   jsonb not null check (jsonb_typeof(persona) = 'object'),
  -- [{ "from": "INVESTOR" | "FOUNDER", "text": "...", "at": "..." }]
  turns                     jsonb not null default '[]'::jsonb check (jsonb_typeof(turns) = 'array'),
  asked                     integer not null default 0 check (asked between 0 and 40),
  length                    integer not null default 8 check (length between 3 and 20),
  status                    text not null default 'ACTIVE'
                              check (status in ('ACTIVE', 'FINISHED')),
  scorecard                 jsonb check (scorecard is null or jsonb_typeof(scorecard) = 'object'),
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp()
);

comment on table q_runtime.rehearsals is
  'A founder''s private practice meeting with an investor played by Q. Practice only: never evidence, never shown to the investor.';

create index rehearsals_user_idx
  on q_runtime.rehearsals (user_id, investor_organisation_id, created_at desc);

alter table q_runtime.rehearsals enable row level security;

create policy rehearsals_select_own
  on q_runtime.rehearsals for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.rehearsals to authenticated;
