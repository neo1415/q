-- ADR 0062 (20261210090000): small-talk memory is personal_private, quoted
-- and always lapses; still server-internal, never a browser row.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(7);

-- Positive: the person's own words, private, with an expiry --------------------------
select lives_ok($$
  insert into q_knowledge.memory_items
    (id, tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status, valid_to)
  values ('00000000-0000-4000-8000-00000000f5a1', pg_temp.rls_id('tenant_a'), 'user',
          pg_temp.rls_id('user_a'), 'small_talk', 'small_talk.lagos_trip',
          'They were going to Lagos on Friday.', 'I''m off to Lagos on Friday',
          repeat('e', 64), 'Q_PROPOSED', 'active', now() + interval '90 days')
$$, 'small talk with a quote, private and lapsing, is recorded');

-- Negative: never without an expiry ----------------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'small_talk',
          'small_talk.exam', 'Their daughter has an exam.', 'my daughter has an exam',
          repeat('f', 64), 'Q_PROPOSED', 'active')
$$, '%memory_items_small_talk_check%', 'small talk without valid_to is refused');

-- Negative: never wider than the person ------------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status, valid_to, visibility_scope)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'small_talk',
          'small_talk.exam', 'Their daughter has an exam.', 'my daughter has an exam',
          repeat('f', 64), 'Q_PROPOSED', 'active', now() + interval '90 days', 'organisation_private')
$$, '%memory_items_small_talk_check%', 'small talk visible beyond the person is refused');

-- Negative: never without the person's words -------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, content_sha256, write_mode, status, valid_to)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'small_talk',
          'small_talk.exam', 'Their daughter has an exam.',
          repeat('f', 64), 'AUTOMATIC_SYSTEM', 'active', now() + interval '90 days')
$$, '%memory_items_small_talk_check%', 'small talk without a quote is refused');

-- Negative: never owned by an organisation ---------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status, valid_to)
  values (pg_temp.rls_id('tenant_a'), 'organisation', pg_temp.rls_id('org_a'), 'small_talk',
          'small_talk.exam', 'Their daughter has an exam.', 'my daughter has an exam',
          repeat('f', 64), 'Q_PROPOSED', 'active', now() + interval '90 days')
$$, '%memory_items_small_talk_check%', 'small talk owned by anyone but a user is refused');

-- Deletable: forgetting keeps the row's history, out of every live read ------------------
select lives_ok($$
  update q_knowledge.memory_items set status = 'forgotten', valid_to = now()
   where id = '00000000-0000-4000-8000-00000000f5a1'
$$, 'small talk can be forgotten');

-- Browser roles ----------------------------------------------------------------------
set local role authenticated;
select throws_like($$ select * from q_knowledge.memory_items where memory_type = 'small_talk' $$,
  '%permission denied%', 'an authenticated browser role cannot read small talk');
reset role;

select * from finish();
rollback;
