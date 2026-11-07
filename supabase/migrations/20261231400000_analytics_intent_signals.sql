-- Q Workspace §8 A3 · intent signals for a company's founders (Product
-- Specification §6.7.12: saves, interest, connection and data-room requests
-- "can become appropriate founder-facing signals"; §6.7.14: once an investor
-- deliberately reaches out, appropriate identity becomes necessary).
--
-- Unlike passive views, intent is shown in REAL TIME, with NO floor, on
-- every plan. Identity follows the investor's own viewing level:
--
--   saves (quiet, never sent to the founder before):
--     FULL_IDENTITY       person and organisation
--     ORGANISATION_ONLY   organisation
--     ANONYMOUS           "an investor": no person, no organisation
--   interest / connection and data-room requests (deliberate; the
--   relationship already shows the organisation on Relationships):
--     organisation always; the person only if they chose FULL_IDENTITY.
--
-- Read-only over the owning contexts' records (recommendation, network,
-- evidence); nothing here writes or projects relationship state. The same
-- membership rule as the passive projection: an active member of the
-- company's organisation, else nothing.

create function analytics.company_intent_signals(p_actor_user_id uuid, p_company_id uuid, p_since timestamptz)
  returns table (
    signal_type text,
    occurred_at timestamptz,
    visibility text,
    viewer_user_id uuid,
    viewer_organisation_id uuid,
    investor_organisation_id uuid
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with company as (
    select c.id, c.tenant_id
      from core.companies c
     where c.id = p_company_id
       and analytics.may_read_company_engagement(p_actor_user_id, p_company_id)
  ),
  raw as (
    -- A save that still stands: the latest SAVE per investor organisation.
    (select distinct on (e.investor_organisation_id)
           'SAVE'::text as signal_type, e.occurred_at, e.actor_user_id as person,
           e.investor_organisation_id
      from recommendation.interaction_events e
      join company on company.id = e.company_id and company.tenant_id = e.company_tenant_id
      join recommendation.interaction_state s
        on s.tenant_id = e.tenant_id
       and s.investor_organisation_id = e.investor_organisation_id
       and s.company_id = e.company_id
       and s.saved
     where e.interaction_type = 'SAVE'
     order by e.investor_organisation_id, e.occurred_at desc)
    union all
    -- An investor's interest / connection request (ADR 0023: a founder's own
    -- request is theirs, not a signal about the investor).
    select 'INTEREST', ev.occurred_at,
           case when ev.actor_type = 'HUMAN' then ev.actor_id end,
           r.investor_organisation_id
      from network.relationship_events ev
      join network.relationships r on r.id = ev.relationship_id and r.tenant_id = ev.tenant_id
      join company on company.id = r.company_id and company.tenant_id = r.tenant_id
     where ev.event_type = 'interest_expressed'
       and coalesce(ev.payload ->> 'expressedByParty', 'INVESTOR') = 'INVESTOR'
    union all
    select 'DATA_ROOM_REQUEST', q.created_at, q.requested_by_user_id, q.investor_organisation_id
      from evidence.data_room_access_requests q
      join company on company.id = q.company_id and company.tenant_id = q.tenant_id
  ),
  levelled as (
    select raw.*, io.organisation_id as organisation_id,
           coalesce(s.visibility, analytics.default_viewing_visibility()) as level
      from raw
      join core.investor_organisations io on io.id = raw.investor_organisation_id
      left join analytics.viewing_privacy_settings s on s.user_id = raw.person
     where raw.occurred_at >= coalesce(p_since, '-infinity'::timestamptz)
  )
  select
    l.signal_type,
    l.occurred_at,
    case
      when l.signal_type = 'SAVE' then l.level
      when l.level = 'FULL_IDENTITY' then 'FULL_IDENTITY'
      else 'ORGANISATION_ONLY'
    end,
    case when l.level = 'FULL_IDENTITY' then l.person end,
    case
      when l.signal_type <> 'SAVE' or l.level <> 'ANONYMOUS' then l.organisation_id
    end,
    case
      when l.signal_type <> 'SAVE' or l.level <> 'ANONYMOUS' then l.investor_organisation_id
    end
  from levelled l
  order by l.occurred_at desc
  limit 200
$$;
revoke all on function analytics.company_intent_signals(uuid, uuid, timestamptz) from public, anon, authenticated;

create function analytics.my_company_intent_signals(p_company_id uuid, p_since timestamptz default null)
  returns table (signal_type text, occurred_at timestamptz, visibility text, viewer_user_id uuid,
                 viewer_organisation_id uuid, investor_organisation_id uuid)
  language sql stable security definer set search_path = ''
as $$ select * from analytics.company_intent_signals((select private.current_app_user_id()), p_company_id, p_since) $$;
revoke all on function analytics.my_company_intent_signals(uuid, timestamptz) from public, anon;
grant execute on function analytics.my_company_intent_signals(uuid, timestamptz) to authenticated;
