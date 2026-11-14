-- GateQ atomic statements, slice 1 (migration 20261231540000): statements,
-- links, disagreement events and turn readings are server-only, append-only,
-- tenant-bound, closed after submission, and every bounded check holds.
--
-- Each refusal names the constraint or trigger message it proves, so a test
-- cannot pass because some earlier rule (a PK, an FK) happened to fire.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(66);

-- Fixtures -------------------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Statement Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs56', 'Statement programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000ee21', '00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

-- Two applications in the same tenant: ee31 (the subject) and ee32 (another).
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_23456789abcdefghjkmnpqrs56'),
  ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_23456789abcdefghjkmnpqrs57');

insert into gateq.application_turns (id, application_id, tenant_id, seq, role, text, client_turn_id) values
  ('00000000-0000-4000-8000-00000000ee41', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 1, 'PERSON',
   'We have 600 weekly users and nobody pays yet.', 'turn-ee00001'),
  ('00000000-0000-4000-8000-00000000ee43', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 3, 'PERSON',
   'Actually 1,500 weekly users.', 'turn-ee00002'),
  ('00000000-0000-4000-8000-00000000ee49', '00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), 1, 'PERSON',
   'Another founder.', 'turn-ee00009');
insert into gateq.application_turns (id, application_id, tenant_id, seq, role, text, client_turn_id, asking_dimension, intent) values
  ('00000000-0000-4000-8000-00000000ee42', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 2, 'Q',
   'How many weekly users?', 'turn-ee00001', 'claims.traction', 'ANSWER');

-- s51 (oldest) .. s54: statements of ee31, in stated order. s59 belongs to ee32.
insert into gateq.application_statements
  (id, application_id, tenant_id, dimension, quantity, value_kind, value, as_of, words, provenance, origin, source_turn_id, stated_at)
values
  ('00000000-0000-4000-8000-00000000ee51', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'),
   'claims.traction', 'weekly_active_users', 'COUNT', '{"count":"600"}', '2026-11-01', '600 weekly users',
   'APPLICANT_PROVIDED', 'TURN', '00000000-0000-4000-8000-00000000ee41', '2026-11-14 10:00:00+00'),
  ('00000000-0000-4000-8000-00000000ee52', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'),
   'claims.revenue', 'revenue', 'ZERO', '{}', null, 'nobody pays yet',
   'APPLICANT_PROVIDED', 'TURN', '00000000-0000-4000-8000-00000000ee41', '2026-11-14 10:00:01+00'),
  ('00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'),
   'claims.traction', 'weekly_active_users', 'COUNT', '{"count":"1500"}', '2026-11-01', '1,500 weekly users',
   'APPLICANT_PROVIDED', 'TURN', '00000000-0000-4000-8000-00000000ee43', '2026-11-14 10:05:00+00'),
  ('00000000-0000-4000-8000-00000000ee54', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'),
   'raise.amount', null, 'UNKNOWN', '{"declined":true}', null, 'I''d rather not say',
   'UNKNOWN', 'TURN', '00000000-0000-4000-8000-00000000ee43', '2026-11-14 10:05:01+00'),
  ('00000000-0000-4000-8000-00000000ee59', '00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'),
   'company.problem', null, 'TEXT', '{"text":"Payments are slow."}', null, 'Payments are slow.',
   'APPLICANT_PROVIDED', 'FORM', null, '2026-11-14 10:06:00+00');

-- Shape ------------------------------------------------------------------------------
select has_table('gateq', 'application_statements', 'statements exist');
select has_table('gateq', 'application_statement_links', 'statement links exist');
select has_table('gateq', 'application_disagreement_events', 'disagreement events exist');
select has_table('gateq', 'application_turn_readings', 'turn readings exist');

select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('gateq.application_statements'::regclass, 'gateq.application_statement_links'::regclass,
                          'gateq.application_disagreement_events'::regclass, 'gateq.application_turn_readings'::regclass)), true,
  'row level security is on for all four tables');
select is((select count(*)::int from pg_policies
            where schemaname = 'gateq' and tablename in ('application_statements', 'application_statement_links',
                                                         'application_disagreement_events', 'application_turn_readings')), 0,
  'there is no policy on any of them');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name in ('application_statements', 'application_statement_links',
                                                            'application_disagreement_events', 'application_turn_readings')
              and grantee in ('anon', 'authenticated')), 0,
  'no browser principal holds a grant on any of them');

-- Statements: bounded checks -------------------------------------------------------------
select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'Claims Revenue', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_dimension_check"',
  'a dimension is a bounded key');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, quantity, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.traction', 'Weekly Users', 'COUNT', '{"count":"5"}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_quantity_check"',
  'a quantity is a bounded key');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.revenue', 'FLOAT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_kind_check"',
  'a value kind is one of the seven');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.revenue', 'TEXT', '[]', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_check"',
  'a value is an object, never arbitrary JSON');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x","extra":1}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_shape"',
  'a TEXT value carries only its text');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, quantity, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.traction', 'customers', 'COUNT', '{"count":"0"}', '0', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_shape"',
  'a zero count is the ZERO kind, never a COUNT');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, quantity, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.revenue', 'mrr', 'MONEY', '{"amount":"12.5","currency":"usd"}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_shape"',
  'money carries an ISO currency or an explicit null');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.revenue', 'UNKNOWN', '{"guess":"lots"}', 'x', 'UNKNOWN', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_value_shape"',
  'an UNKNOWN carries no value');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.revenue', 'UNKNOWN', '{}', 'not sure', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_unknown_provenance"',
  'an UNKNOWN statement has UNKNOWN provenance, and only it does');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, quantity, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'claims.traction', 'customers', 'TEXT', '{"text":"many"}', 'many', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_quantity_kind"',
  'a quantity is only ever a number, a zero or an unknown');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', '', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_words_check"',
  'a statement keeps the founder''s words, bounded');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'GUESSED', 'FORM')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_provenance_check"',
  'provenance is the bounded vocabulary');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'CHAT')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_origin_check"',
  'origin is TURN, FORM, DOCUMENT_CONFIRMED or BACKFILL');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'TURN')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_turn_origin"',
  'a statement read from a turn names its turn');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin, source_turn_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'FORM',
          '00000000-0000-4000-8000-00000000ee41')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_form_origin"',
  'a form statement names no turn');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'BACKFILL')
$$, '23514', 'new row for relation "application_statements" violates check constraint "application_statements_backfill_key"',
  'a backfilled statement carries its idempotency key');

insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin, backfill_key, stated_at)
values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"Slow payouts."}',
        'Slow payouts.', 'APPLICANT_PROVIDED', 'BACKFILL', 'fact:ee:1', '2026-11-13 09:00:00+00');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin, backfill_key)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"Slow payouts."}',
          'Slow payouts.', 'APPLICANT_PROVIDED', 'BACKFILL', 'fact:ee:1')
$$, '23505', 'duplicate key value violates unique constraint "application_statements_backfill_key_key"',
  'a backfill runs at most once per legacy line');

-- Statements: scope triggers ------------------------------------------------------------
select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_a'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'FORM')
$$, '23514', 'a application_statements row belongs to its application''s tenant',
  'a statement cannot be filed under another tenant');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin, source_turn_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'TURN',
          '00000000-0000-4000-8000-00000000ee42')
$$, '23514', 'a statement is read from a PERSON turn of its application',
  'a statement is never read from Q''s own turn');

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin, source_turn_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"x"}', 'x', 'APPLICANT_PROVIDED', 'TURN',
          '00000000-0000-4000-8000-00000000ee49')
$$, '23514', 'a statement is read from a PERSON turn of its application',
  'nor from another application''s turn');

select throws_ok($$
  update gateq.application_statements set words = 'rewritten' where id = '00000000-0000-4000-8000-00000000ee51'
$$, '23001', 'gateq.application_statements is append-only: what was said stays said',
  'a statement is never rewritten');

select throws_ok($$
  delete from gateq.application_statements where id = '00000000-0000-4000-8000-00000000ee51'
$$, '23001', 'gateq.application_statements is append-only: what was said stays said',
  'nor deleted');

-- Links -----------------------------------------------------------------------------------
insert into gateq.application_statement_links (id, application_id, tenant_id, kind, from_statement_id, to_statement_id, origin, source_turn_id) values
  ('00000000-0000-4000-8000-00000000ee61', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'DISAGREES',
   '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee51', 'MODEL_READING', '00000000-0000-4000-8000-00000000ee43'),
  ('00000000-0000-4000-8000-00000000ee62', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
   '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee51', 'CODE_DETECTED', null);

select is((select count(*)::int from gateq.application_statement_links
            where application_id = '00000000-0000-4000-8000-00000000ee31'), 2,
  'a newer statement can disagree with, and separately correct, an older one');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'REPLACES',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee52', 'CODE_DETECTED')
$$, '23514', 'new row for relation "application_statement_links" violates check constraint "application_statement_links_kind_check"',
  'a link is CORRECTS or DISAGREES');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee52', 'GUESSED')
$$, '23514', 'new row for relation "application_statement_links" violates check constraint "application_statement_links_origin_check"',
  'a link''s origin is the bounded vocabulary');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee53', 'CODE_DETECTED')
$$, '23514', 'new row for relation "application_statement_links" violates check constraint "application_statement_links_no_self_link"',
  'a statement never links to itself');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin, source_turn_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'DISAGREES',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee51', 'MODEL_READING', '00000000-0000-4000-8000-00000000ee43')
$$, '23505', 'duplicate key value violates unique constraint "application_statement_links_once"',
  'each (kind, from, to) is recorded once');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee52', 'MODEL_READING')
$$, '23514', 'new row for relation "application_statement_links" violates check constraint "application_statement_links_reading_turn"',
  'a link read by the model names the turn it was read from');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee51', '00000000-0000-4000-8000-00000000ee53', 'CODE_DETECTED')
$$, '23514', 'a link points from a newer statement to an older one',
  '"to" newer than "from" is refused');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee59', '00000000-0000-4000-8000-00000000ee51', 'CODE_DETECTED')
$$, '23514', 'a link joins two statements of its own application',
  'a link cannot reach into another application');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_a'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee52', 'CODE_DETECTED')
$$, '23514', 'a application_statement_links row belongs to its application''s tenant',
  'a link cannot be filed under another tenant');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin, source_turn_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'CORRECTS',
          '00000000-0000-4000-8000-00000000ee53', '00000000-0000-4000-8000-00000000ee52', 'MODEL_READING', '00000000-0000-4000-8000-00000000ee42')
$$, '23514', 'a link is read from a PERSON turn of its application',
  'a link is never read from Q''s own turn');

select throws_ok($$
  delete from gateq.application_statement_links where id = '00000000-0000-4000-8000-00000000ee62'
$$, '23001', 'gateq.application_statement_links is append-only: what was said stays said',
  'a link is never deleted');

-- Disagreement events --------------------------------------------------------------------
insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state, source_turn_id) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'LEFT_OPEN',
   '00000000-0000-4000-8000-00000000ee43');
insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state, resolved_by_statement_id) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'RESOLVED',
   '00000000-0000-4000-8000-00000000ee51');

select is((select count(*)::int from gateq.application_disagreement_events
            where link_id = '00000000-0000-4000-8000-00000000ee61'), 2,
  'a disagreement can be left open and later resolved by one of its statements');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'FORGOTTEN')
$$, '23514', 'new row for relation "application_disagreement_events" violates check constraint "application_disagreement_events_state_check"',
  'a disagreement state is LEFT_OPEN, REOPENED or RESOLVED');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'RESOLVED')
$$, '23514', 'new row for relation "application_disagreement_events" violates check constraint "application_disagreement_events_resolution"',
  'a resolution names the statement that resolved it');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state, resolved_by_statement_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'LEFT_OPEN',
          '00000000-0000-4000-8000-00000000ee53')
$$, '23514', 'new row for relation "application_disagreement_events" violates check constraint "application_disagreement_events_resolution"',
  'only a resolution names a resolving statement');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee62', 'LEFT_OPEN')
$$, '23514', 'only a DISAGREES link has disagreement events',
  'a correction is not a disagreement');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state, resolved_by_statement_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'RESOLVED',
          '00000000-0000-4000-8000-00000000ee52')
$$, '23514', 'a disagreement is resolved by one of its statements or a later one',
  'an unrelated older statement cannot resolve a disagreement');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'LEFT_OPEN')
$$, '23514', 'a disagreement event belongs to a link of its application',
  'an event cannot reach another application''s link');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ee61', 'LEFT_OPEN')
$$, '23514', 'a application_disagreement_events row belongs to its application''s tenant',
  'an event cannot be filed under another tenant');

select throws_ok($$
  update gateq.application_disagreement_events set state = 'REOPENED' where link_id = '00000000-0000-4000-8000-00000000ee61'
$$, '23001', 'gateq.application_disagreement_events is append-only: what was said stays said',
  'a disagreement event is never rewritten');

-- Turn readings --------------------------------------------------------------------------
insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, recorded_statement_ids, reading_version) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee41', 'READ',
   array['00000000-0000-4000-8000-00000000ee51', '00000000-0000-4000-8000-00000000ee52']::uuid[], 2);

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee41', 'NO_STATEMENTS', 2)
$$, '23505', 'duplicate key value violates unique constraint "application_turn_readings_turn_id_key"',
  'a PERSON turn has one reading');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'SKIPPED', 2)
$$, '23514', 'new row for relation "application_turn_readings" violates check constraint "application_turn_readings_outcome_check"',
  'an outcome is READ, NO_STATEMENTS or REJECTED');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'READ', 2)
$$, '23514', 'new row for relation "application_turn_readings" violates check constraint "application_turn_readings_outcome_statements"',
  'READ recorded at least one statement');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, recorded_statement_ids, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'NO_STATEMENTS',
          array['00000000-0000-4000-8000-00000000ee53']::uuid[], 2)
$$, '23514', 'new row for relation "application_turn_readings" violates check constraint "application_turn_readings_outcome_statements"',
  'NO_STATEMENTS recorded none');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, not_recorded, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'REJECTED', '{}', 2)
$$, '23514', 'new row for relation "application_turn_readings" violates check constraint "application_turn_readings_not_recorded_check"',
  'what was not recorded is a bounded list');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'REJECTED', 0)
$$, '23514', 'new row for relation "application_turn_readings" violates check constraint "application_turn_readings_reading_version_check"',
  'a reading names its schema version');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee42', 'NO_STATEMENTS', 2)
$$, '23514', 'a reading is of a PERSON turn of its application',
  'Q''s own turn is never read');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, recorded_statement_ids, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'READ',
          array['00000000-0000-4000-8000-00000000ee51']::uuid[], 2)
$$, '23514', 'a reading lists only statements read from its turn',
  'a reading cannot claim another turn''s statement as recorded');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ee43', 'NO_STATEMENTS', 2)
$$, '23514', 'a application_turn_readings row belongs to its application''s tenant',
  'a reading cannot be filed under another tenant');

select throws_ok($$
  delete from gateq.application_turn_readings where turn_id = '00000000-0000-4000-8000-00000000ee41'
$$, '23001', 'gateq.application_turn_readings is append-only: what was said stays said',
  'a reading is never deleted');

-- Browser principals ---------------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from gateq.application_statements$$, '42501', null, 'anon cannot read statements');
reset role;
set local role authenticated;
select throws_ok($$select count(*) from gateq.application_statements$$, '42501', null, 'authenticated cannot read statements');
select throws_ok($$select count(*) from gateq.application_turn_readings$$, '42501', null, 'nor turn readings');
reset role;

-- Closed after submission ----------------------------------------------------------------
update gateq.applications set status = 'SUBMITTED', submitted_at = now()
 where id = '00000000-0000-4000-8000-00000000ee31';

select throws_ok($$
  insert into gateq.application_statements (application_id, tenant_id, dimension, value_kind, value, words, provenance, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'company.problem', 'TEXT', '{"text":"late"}', 'late', 'APPLICANT_PROVIDED', 'FORM')
$$, '23001', 'a submitted application''s statements are closed',
  'no statement is added after submission');

select throws_ok($$
  insert into gateq.application_statement_links (application_id, tenant_id, kind, from_statement_id, to_statement_id, origin)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'DISAGREES',
          '00000000-0000-4000-8000-00000000ee54', '00000000-0000-4000-8000-00000000ee52', 'CODE_DETECTED')
$$, '23001', 'a submitted application''s statements are closed',
  'no link is added after submission');

select throws_ok($$
  insert into gateq.application_disagreement_events (application_id, tenant_id, link_id, state)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee61', 'REOPENED')
$$, '23001', 'a submitted application''s statements are closed',
  'no disagreement event is added after submission');

select throws_ok($$
  insert into gateq.application_turn_readings (application_id, tenant_id, turn_id, outcome, reading_version)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee43', 'NO_STATEMENTS', 2)
$$, '23001', 'a submitted application''s statements are closed',
  'no reading is added after submission');

select * from finish();
rollback;
