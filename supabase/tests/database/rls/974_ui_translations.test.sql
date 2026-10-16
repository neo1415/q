-- Lane lang · q_runtime.ui_translations: shared machine translations of the
-- interface catalogue, server-only; the row's hash is the English string's;
-- an accepted row has text and a rejected one a reason, never both; and the
-- gateway knows the UI_TRANSLATION task class.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

select lives_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, translated_text, model_code)
     values ('fr', 'ui-text.v1', encode(sha256(convert_to('Settings', 'UTF8')), 'hex'), 'Settings', 'ACCEPTED', 'Paramètres', 'gpt-5.6-luna') $$,
  'the server keeps an accepted translation');
select throws_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, translated_text)
     values ('fr', 'ui-text.v1', encode(sha256(convert_to('Settings', 'UTF8')), 'hex'), 'Settings', 'ACCEPTED', 'Réglages') $$,
  '23505', null, 'one translation per language, version and string');
select throws_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, translated_text)
     values ('fr', 'ui-text.v1', repeat('0', 64), 'Discover', 'ACCEPTED', 'Découvrir') $$,
  '23514', null, 'the hash must be the English string''s');
select throws_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status)
     values ('fr', 'ui-text.v1', encode(sha256(convert_to('Explore', 'UTF8')), 'hex'), 'Explore', 'ACCEPTED') $$,
  '23514', null, 'an accepted row carries its text');
select lives_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, rejection_reason)
     values ('sw', 'ui-text.v1', encode(sha256(convert_to('Waiting on {name}.', 'UTF8')), 'hex'), 'Waiting on {name}.', 'REJECTED', 'PLACEHOLDERS') $$,
  'a rejected translation is kept with its reason and no text');
select throws_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, translated_text)
     values ('Not A Tag', 'ui-text.v1', encode(sha256(convert_to('Work', 'UTF8')), 'hex'), 'Work', 'ACCEPTED', 'x') $$,
  '23514', null, 'the language is a well-formed tag');
select is(
  (select count(*)::int from ai_ops.routing_policies where task_class = 'UI_TRANSLATION' and status = 'ACTIVE'),
  1, 'one active routing policy for UI_TRANSLATION');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_runtime.ui_translations $$, '42501', null,
  'a browser user cannot read translations directly (served by the server)');
select throws_ok(
  $$ insert into q_runtime.ui_translations (language, catalog_version, source_hash, source_text, status, translated_text)
     values ('de', 'ui-text.v1', encode(sha256(convert_to('Work', 'UTF8')), 'hex'), 'Work', 'ACCEPTED', 'Arbeit') $$,
  '42501', null, 'a browser user cannot write a translation');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_runtime.ui_translations $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
