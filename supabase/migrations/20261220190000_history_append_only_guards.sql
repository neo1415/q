-- RECOVERY F3 (audit DEF-A2): history tables refuse to be rewritten.
--
-- The services connect as `postgres`, which bypasses RLS (verified on hosted
-- 2026-10-08: the Supavisor backends run as postgres, rolbypassrls = true).
-- Grants and policies therefore protect these tables only from browser
-- roles; nothing in the database stops server code from rewriting history.
-- Relationship state is a projection over network.relationship_events, and
-- audit.* is who acted under whose authority: an UPDATE to either silently
-- changes what happened. A trigger fires for every role, the owner and
-- bypass-RLS roles included, so this holds whatever the runtime role is.
--
-- Scope, deliberately: UPDATE and TRUNCATE. No code path does either (a
-- scan of every sql template in apps, packages and scripts found none).
-- DELETE is not guarded yet: sixteen integration-test and dev cleanups
-- delete fixture rows from these tables, and guarding it before they opt
-- in would break them on every shared database. ADR 0065 records the
-- second step (a transaction-local opt-in for cleanup and governed
-- retention) and the list of sites.

create function private.history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is append-only: corrections are new rows, never rewrites',
    tg_table_schema, tg_table_name
    using errcode = '55000';
end
$$;

revoke all on function private.history_append_only() from public, anon, authenticated;

comment on function private.history_append_only() is
  'Refuses UPDATE and TRUNCATE on append-only history (relationship events, audit). Fires for every role, including the bypass-RLS service role.';

create trigger relationship_events_no_update
  before update on network.relationship_events
  for each row execute function private.history_append_only();
create trigger relationship_events_no_truncate
  before truncate on network.relationship_events
  for each statement execute function private.history_append_only();

create trigger material_actions_no_update
  before update on audit.material_actions
  for each row execute function private.history_append_only();
create trigger material_actions_no_truncate
  before truncate on audit.material_actions
  for each statement execute function private.history_append_only();

create trigger security_events_no_update
  before update on audit.security_events
  for each row execute function private.history_append_only();
create trigger security_events_no_truncate
  before truncate on audit.security_events
  for each statement execute function private.history_append_only();
