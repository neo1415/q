-- CQ-REC-008 · recommendation.interaction_events and interaction_state:
-- what an investor did with a recommendation, and what that adds up to
-- (doc 19 §66-§69, §167; doc 20 §70-§73; doc 13 §41.2).
--
--   observed behaviour ≠ declared mandate ≠ Q inference ≠ GateQ rules
--   viewing ≠ interest;  save ≠ interest;  pass ≠ poor company
--   interaction ≠ relationship state;  exposure ≠ popularity
--
-- Two tables, and the difference between them is the point. Events are
-- append-oriented history: every impression, milestone and decision stays
-- interpretable, because exposure without its sequence cannot be corrected
-- for bias later (doc 19 §69). State is a derived projection for reads that
-- must be fast — is this company saved, was it passed — and it is rebuilt
-- from events, never the other way round.
--
-- Nothing here is a ranking input. REC-005's config and the v1 feature
-- schema are untouched by design: a behaviour feature must arrive through a
-- governed feature-schema version, not by a table appearing.
--
-- Nothing here is content. No Q question, no Q answer, no document text, no
-- mandate wording, no transcript. An ASK_Q row records that a person asked
-- Q about a company; the conversation belongs to the Q runtime.

-- ---------------------------------------------------------------------------
-- Events: what happened, in order.
-- ---------------------------------------------------------------------------

create table recommendation.interaction_events (
  id                        uuid primary key default gen_random_uuid(),
  -- The investor's tenant. The behaviour is the investor's own, and a
  -- founder's tenant never owns a row here.
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  actor_user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  investor_organisation_id  uuid not null,
  -- The company acted upon, with its own tenant: the pair is how a
  -- cross-tenant read is impossible to write by accident.
  company_id                uuid not null,
  company_tenant_id         uuid not null,

  interaction_type          text not null check (interaction_type in (
                              'IMPRESSION', 'WATCH_MILESTONE', 'PROFILE_OPEN', 'ASK_Q',
                              'SAVE', 'UNSAVE', 'PASS', 'INTEREST_OBSERVED')),
  -- Semantic weight, recorded so later work does not have to re-derive it
  -- from the type. It is a class, never a number, and nothing multiplies it.
  strength_class            text not null check (strength_class in (
                              'ATTENTION', 'CONSIDERATION', 'CONTEXTUAL_DECISION', 'INTENT')),
  interaction_version       text not null check (interaction_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  -- Where the person was. Bounded: a surface is product vocabulary, not a
  -- free-text label a client invents.
  surface                   text not null check (surface in (
                              'RECOMMENDATION_FEED', 'COMPANY_PROFILE', 'SAVED_LIST', 'SEARCH', 'Q_CONVERSATION')),

  -- Exposure context (doc 19 §69). Null only where the interaction genuinely
  -- did not come from a slate — a company profile opened from search has no
  -- rank, and inventing one would be worse than not having it.
  slate_id                  uuid,
  slate_item_id             uuid,
  position                  integer check (position is null or position >= 1),
  ranker_version            text check (ranker_version is null or ranker_version ~ '^[a-z][a-z0-9-]*\.v[0-9]+$'),
  ranking_config_version    text check (ranking_config_version is null or ranking_config_version ~ '^[a-z][a-z0-9-]*\.[a-z0-9-]+$'),

  -- Watch, and only watch.
  media_asset_id            uuid,
  watch_milestone           text check (watch_milestone is null or watch_milestone in (
                              'STARTED', 'P25', 'P50', 'P75', 'COMPLETED')),
  -- Optional, never demanded. Doc 17 is explicit that a pass must not open a
  -- feedback modal, so most passes carry nothing.
  pass_reason               text check (pass_reason is null or pass_reason in (
                              'NOT_NOW', 'STAGE', 'SECTOR', 'GEOGRAPHY', 'TRACTION', 'RAISE', 'TIMING', 'OTHER')),

  -- Idempotency identity supplied by the client. It carries NO authority:
  -- the server resolves actor, organisation, slate, position and versions,
  -- and the uniqueness below is scoped per actor so one person's id can
  -- never collide with another's.
  client_event_id           text not null check (client_event_id ~ '^[A-Za-z0-9_:-]{8,64}$'),
  -- One continuous period of use. Bounded, opaque, never a device fingerprint.
  session_id                text check (session_id is null or session_id ~ '^[A-Za-z0-9_:-]{8,64}$'),

  occurred_at               timestamptz not null,
  recorded_at               timestamptz not null default now(),
  -- Bounded, versioned extras only. Never prose, never a payload a client
  -- can grow without limit (doc 19 §69 experiment slot lives here).
  metadata                  jsonb not null default '{}'::jsonb
                              check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),

  -- A milestone belongs to a media asset; nothing else does.
  constraint interaction_watch_shape check (
    (interaction_type = 'WATCH_MILESTONE') = (watch_milestone is not null)
    and (watch_milestone is null or media_asset_id is not null)
  ),
  -- A reason is a property of a pass.
  constraint interaction_pass_reason_shape check (
    pass_reason is null or interaction_type = 'PASS'
  ),
  -- Rank without a slate is a number nobody can interpret.
  constraint interaction_position_needs_slate check (
    position is null or slate_id is not null
  ),
  foreign key (company_id, company_tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  -- Restrict, not cascade: a slate being superseded must not erase the
  -- exposure that happened while it was current.
  foreign key (slate_id, tenant_id)
    references recommendation.slates (id, tenant_id) on delete restrict
);

comment on table recommendation.interaction_events is
  'Append-oriented record of what an investor did with a recommendation. Observed behaviour only: never a mandate, never relationship state, never a ranking input, never content.';
comment on column recommendation.interaction_events.client_event_id is
  'Idempotency identity from the client. Grants no authority; unique per actor only.';
comment on column recommendation.interaction_events.strength_class is
  'Semantic class (doc 19 §66). A class, never a score; nothing weights it.';

-- The retry guarantee: the same logical event from the same person is one row.
create unique index interaction_events_client_id_idx
  on recommendation.interaction_events (tenant_id, actor_user_id, client_event_id);

-- A transport retry that invented a new client id must still not inflate
-- exposure. An impression is one per person, per slate, per company, per
-- session; the same company in a NEW slate is a new, legitimate impression.
create unique index interaction_events_impression_once_idx
  on recommendation.interaction_events (actor_user_id, slate_id, company_id, session_id)
  where interaction_type = 'IMPRESSION' and slate_id is not null and session_id is not null;

-- The same milestone of the same playback is one row, however often it is sent.
create unique index interaction_events_milestone_once_idx
  on recommendation.interaction_events (actor_user_id, media_asset_id, watch_milestone, session_id)
  where interaction_type = 'WATCH_MILESTONE' and session_id is not null;

-- The reads this table exists for: one investor's history of one company,
-- and exposure analysis over a slate.
create index interaction_events_investor_company_idx
  on recommendation.interaction_events (tenant_id, investor_organisation_id, company_id, occurred_at desc);
create index interaction_events_slate_position_idx
  on recommendation.interaction_events (slate_id, position)
  where slate_id is not null;

-- ---------------------------------------------------------------------------
-- State: what it adds up to, for reads that cannot afford the history.
-- ---------------------------------------------------------------------------

create table recommendation.interaction_state (
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null,
  company_id                uuid not null,
  company_tenant_id         uuid not null,

  -- "I want to revisit this" (doc 17 §100). Not interest.
  saved                     boolean not null default false,
  saved_at                  timestamptz,
  -- Context-specific and reversible. Never a hard exclusion, never a
  -- judgement about the company (doc 19 §66-§67).
  passed                    boolean not null default false,
  passed_at                 timestamptz,
  last_pass_reason          text check (last_pass_reason is null or last_pass_reason in (
                              'NOT_NOW', 'STAGE', 'SECTOR', 'GEOGRAPHY', 'TRACTION', 'RAISE', 'TIMING', 'OTHER')),

  -- Bounded exposure summary. A count for the person's own feed, never a
  -- popularity signal and never read by ranking.
  impression_count          integer not null default 0 check (impression_count >= 0),
  last_impression_at        timestamptz,
  last_interaction_at       timestamptz,

  -- Advances on every applied event, so a concurrent save and unsave settle
  -- deterministically rather than by whichever transaction committed last.
  applied_sequence          bigint not null default 0 check (applied_sequence >= 0),
  updated_at                timestamptz not null default now(),

  primary key (tenant_id, investor_organisation_id, company_id),
  foreign key (company_id, company_tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table recommendation.interaction_state is
  'Derived projection of interaction_events for fast reads. Rebuildable from events; never the source of truth, never a ranking input.';

-- The Saved section, and the feed asking "what has this investor already dealt with".
create index interaction_state_saved_idx
  on recommendation.interaction_state (tenant_id, investor_organisation_id, saved_at desc)
  where saved;
create index interaction_state_passed_idx
  on recommendation.interaction_state (tenant_id, investor_organisation_id, passed_at desc)
  where passed;

-- ---------------------------------------------------------------------------
-- History is append-oriented: an event is never edited.
-- ---------------------------------------------------------------------------

create function recommendation.protect_interaction_event()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception 'recommendation.interaction_events is append-only'
    using errcode = 'restrict_violation';
end;
$$;
revoke all on function recommendation.protect_interaction_event() from public;

create trigger interaction_events_immutable
  before update or delete on recommendation.interaction_events
  for each row execute function recommendation.protect_interaction_event();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant. Who looked at whom is
-- itself confidential, and a founder must never read it at all.
-- ---------------------------------------------------------------------------

alter table recommendation.interaction_events enable row level security;
alter table recommendation.interaction_state enable row level security;
