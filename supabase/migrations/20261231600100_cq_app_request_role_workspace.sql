-- W2-C (ADR 0082, enterprise audit 21 Nov 2026, finding 1) · proof of
-- concept: the non-bypass request role and the first schema's policies.
--
-- The services connect as `postgres`, which bypasses row-level security, so
-- RLS is a second layer only for the browser roles today. ADR 0082 moves
-- the request path to `cq_app`, a role that does NOT bypass RLS, schema by
-- schema. This migration is the first step and changes nothing anyone can
-- read or write today:
--
--   * cq_app is created NOLOGIN: no service can connect as it, and no
--     credential for it exists. Production keeps connecting as it does.
--   * The claim helpers read the transaction-local settings the transaction
--     helper sets when DATABASE_RLS_CLAIMS=on (default off): cq.tenant_id,
--     cq.user_id, cq.organisation_id, cq.actor_type. A missing or empty
--     claim is null, and null matches no row.
--   * workspace (2 tables, tenant_id and user_id on both, personal_private)
--     gains grants and policies for cq_app only. postgres and service_role
--     keep their grants; the browser roles still hold nothing.
--
-- Additive only: no drop, no revoke of an existing grant, no policy for a
-- browser role, RLS stays enabled and forced.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cq_app') then
    create role cq_app nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;
comment on role cq_app is
  'ADR 0082: the request role of api, q-api and workers once RLS is enforced. NOLOGIN until the rollout; never bypasses RLS.';

-- ---------------------------------------------------------------------------
-- Claims: transaction-local settings, set only by the transaction helper.
-- Invoker functions (not SECURITY DEFINER): they read settings, nothing else.
-- ---------------------------------------------------------------------------

create function private.cq_claim_uuid(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  -- Not a uuid (or empty, or unset): null, so it matches no row.
  select case
    when coalesce(current_setting(p_name, true), '')
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then current_setting(p_name, true)::uuid
    else null
  end
$$;

create function private.cq_claim_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select private.cq_claim_uuid('cq.tenant_id') $$;

create function private.cq_claim_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select private.cq_claim_uuid('cq.user_id') $$;

create function private.cq_claim_organisation_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select private.cq_claim_uuid('cq.organisation_id') $$;

create function private.cq_claim_actor_type()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when current_setting('cq.actor_type', true) in ('HUMAN', 'Q', 'SYSTEM', 'CONNECTED_SYSTEM')
      then current_setting('cq.actor_type', true)
    else null
  end
$$;

revoke all on function private.cq_claim_uuid(text) from public;
revoke all on function private.cq_claim_tenant_id() from public;
revoke all on function private.cq_claim_user_id() from public;
revoke all on function private.cq_claim_organisation_id() from public;
revoke all on function private.cq_claim_actor_type() from public;
grant usage on schema private to cq_app;
grant execute on function private.cq_claim_uuid(text) to cq_app;
grant execute on function private.cq_claim_tenant_id() to cq_app;
grant execute on function private.cq_claim_user_id() to cq_app;
grant execute on function private.cq_claim_organisation_id() to cq_app;
grant execute on function private.cq_claim_actor_type() to cq_app;

-- ---------------------------------------------------------------------------
-- workspace: the person's own board. A row is reachable only when the
-- transaction's tenant and user claims are its own (the person, or Q or
-- the workers acting for them: the actor type does not widen anything).
-- Same privileges as the server holds today: no delete.
-- ---------------------------------------------------------------------------

grant usage on schema workspace to cq_app;
grant select, insert, update on workspace.board_items to cq_app;
grant select, insert on workspace.board_item_events to cq_app;

create policy board_items_own_select on workspace.board_items
  for select to cq_app
  using (tenant_id = (select private.cq_claim_tenant_id())
         and user_id = (select private.cq_claim_user_id()));

create policy board_items_own_insert on workspace.board_items
  for insert to cq_app
  with check (tenant_id = (select private.cq_claim_tenant_id())
              and user_id = (select private.cq_claim_user_id()));

create policy board_items_own_update on workspace.board_items
  for update to cq_app
  using (tenant_id = (select private.cq_claim_tenant_id())
         and user_id = (select private.cq_claim_user_id()))
  with check (tenant_id = (select private.cq_claim_tenant_id())
              and user_id = (select private.cq_claim_user_id()));

create policy board_item_events_own_select on workspace.board_item_events
  for select to cq_app
  using (tenant_id = (select private.cq_claim_tenant_id())
         and user_id = (select private.cq_claim_user_id()));

create policy board_item_events_own_insert on workspace.board_item_events
  for insert to cq_app
  with check (tenant_id = (select private.cq_claim_tenant_id())
              and user_id = (select private.cq_claim_user_id()));
