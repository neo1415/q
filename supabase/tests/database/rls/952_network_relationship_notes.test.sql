-- CRM private notes (migration 20261227140000): one side's own notes on one
-- canonical relationship. Server-only, append-only, organisation_private.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(26);

select ok((select relrowsecurity from pg_class where oid = 'network.relationship_notes'::regclass), 'notes have RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'network' and tablename = 'relationship_notes'), 0, 'no client policies: server-only');
select ok(not has_table_privilege('anon', 'network.relationship_notes', 'SELECT'), 'anonymous cannot read notes');
select ok(not has_table_privilege('authenticated', 'network.relationship_notes', 'SELECT'), 'members read notes only through the scoped API');
select ok(not has_table_privilege('authenticated', 'network.relationship_notes', 'INSERT'), 'members cannot write around the API');
select ok(not has_function_privilege('anon', 'network.relationship_notes_append_only()', 'EXECUTE'), 'the guard function is not public');

-- Company A (tenant A, org A) and Investor B (tenant B, org B), one
-- relationship between them; a second company in org A with no relationship.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Notes Company A', 'notes-company-a'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Notes Company A2', 'notes-company-a2');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Notes Investor B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-00000000ab01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2');

-- Investor B's side: its own tenant, organisation, membership and party.
create function pg_temp.investor_note(
  p_id uuid,
  p_body text default 'Strong team; check churn.',
  p_supersedes uuid default null,
  p_user uuid default null,
  p_membership uuid default null,
  p_org text default 'org_b',
  p_tenant text default 'tenant_b'
) returns void language sql as $$
  insert into network.relationship_notes
    (id, tenant_id, organisation_id, relationship_id, investor_organisation_id, author_user_id, author_membership_id, body, supersedes_note_id)
  values
    (p_id, pg_temp.rls_id(p_tenant), pg_temp.rls_id(p_org), '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-0000000000e2',
     coalesce(p_user, pg_temp.rls_id('user_b')), coalesce(p_membership, pg_temp.rls_id('membership_b')), p_body, p_supersedes);
$$;

-- Company A's side.
create function pg_temp.company_note(
  p_id uuid,
  p_company uuid default '00000000-0000-4000-8000-0000000000c1',
  p_supersedes uuid default null
) returns void language sql as $$
  insert into network.relationship_notes
    (id, tenant_id, organisation_id, relationship_id, company_id, author_user_id, author_membership_id, body, supersedes_note_id)
  values
    (p_id, pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-00000000ab01', p_company,
     pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a'), 'Follow up after the partner meeting.', p_supersedes);
$$;

-- Positive: each side writes its own note on the shared relationship.
select lives_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f001')$$, 'the investor side writes its own note');
select lives_ok($$select pg_temp.company_note('00000000-0000-4000-8000-00000000f101')$$, 'the founder side writes its own note');
select lives_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f002', 'Corrected: churn is fine.', '00000000-0000-4000-8000-00000000f001')$$, 'a correction supersedes a note of the same side');

-- Cross-tenant and wrong-party negatives.
select throws_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f003', 'x', null, null, null, 'org_a', 'tenant_a')$$, '23503', null, 'another organisation cannot write on the investor''s side');
select throws_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f004', 'x', null, pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a'))$$, '23503', null, 'a member of another tenant cannot author an investor note');
select throws_ok($$select pg_temp.company_note('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-0000000000c2')$$, '23503', null, 'a side that is not a party of the relationship is refused');
select throws_ok($$select pg_temp.company_note('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000f002')$$, '23503', null, 'a founder note cannot supersede the investor''s note');
select throws_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f005', 'again', '00000000-0000-4000-8000-00000000f001')$$, '23505', null, 'a note is superseded at most once');
select throws_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f006', '   ')$$, '23514', null, 'a blank note is refused');
select throws_ok($$select pg_temp.investor_note('00000000-0000-4000-8000-00000000f007', repeat('x', 4001))$$, '23514', null, 'a note is bounded');
select throws_ok($$insert into network.relationship_notes (id, tenant_id, organisation_id, relationship_id, company_id, investor_organisation_id, author_user_id, author_membership_id, body)
  values ('00000000-0000-4000-8000-00000000f008', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a'), 'both')$$,
  '23514', null, 'a note has exactly one side');

-- Append-only, for every role including the server.
select throws_ok($$update network.relationship_notes set body = 'rewritten' where id = '00000000-0000-4000-8000-00000000f001'$$, '23514', null, 'a note is never rewritten');
select throws_ok($$delete from network.relationship_notes where id = '00000000-0000-4000-8000-00000000f001'$$, '23514', null, 'a note is never deleted');

-- No browser principal reads either side's notes: owner, other tenant, revoked.
select pg_temp.act_as_user_b();
select throws_ok('select * from network.relationship_notes', '42501', null, 'the investor author too reads only through the API');
select pg_temp.act_as_user_a();
select throws_ok('select * from network.relationship_notes', '42501', null, 'the counterpart founder cannot read the investor''s notes');
select pg_temp.act_as_revoked_user();
select throws_ok('select * from network.relationship_notes', '42501', null, 'a revoked member cannot read notes');
select pg_temp.act_as_anonymous();
select throws_ok('select * from network.relationship_notes', '42501', null, 'anonymous cannot read notes');
reset role;
select pg_temp.reset_test_identity();

select is((select count(*)::int from network.relationship_notes), 3, 'only the valid notes were stored');
select is((select body from network.relationship_notes where id = '00000000-0000-4000-8000-00000000f001'), 'Strong team; check churn.', 'the superseded note stays as history');
select is((select organisation_id from network.relationship_notes where id = '00000000-0000-4000-8000-00000000f101'), pg_temp.rls_id('org_a'), 'the founder note belongs to the founder organisation');

select * from finish();
rollback;
