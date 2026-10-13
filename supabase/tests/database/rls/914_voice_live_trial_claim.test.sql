begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(26);
select ok((select relrowsecurity from pg_class where oid='q_runtime.voice_live_trial_claims'::regclass), 'claims enforce RLS');
select is((select count(*)::int from pg_policies where schemaname='q_runtime' and tablename='voice_live_trial_claims'),0,'claims have no client policies');
select ok(not has_table_privilege('service_role','q_runtime.voice_live_trial_claims','DELETE'),'server cannot bypass release guard by direct delete');
insert into q_runtime.voice_live_trial_usage(tenant_id,user_id,provider_session_id,voice_session_id,speech_seconds)
values(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'old-a','old',280),
      (pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'old-b','old',10);
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','line-a',300),10::numeric,'global account claim reserves all remaining after canonical cross-tenant 290');
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','line-b',300),null::numeric,'second instance in another tenant cannot spend the same remaining 10');
update q_runtime.voice_live_trial_claims set created_at=clock_timestamp()-interval '1 year';
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','line-b',300),null::numeric,'a stale/crashed claim does not automatically expire');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,0,true),false,'wrong tenant cannot release');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_b'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,0,true),false,'wrong user cannot release');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,0,true),false,'wrong token cannot release');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new-a',8,false),false,'socket close without termination proof retains claim');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new-a',8,true),false,'failed final canonical write retains claim');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new-a',8,null),false,'unknown provider termination retains claim');
insert into q_runtime.voice_live_trial_usage(tenant_id,user_id,provider_session_id,voice_session_id,speech_seconds)
values(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'foreign-line','different-line',0);
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','foreign-line',0,true),false,'another voice line canonical row cannot authorize release');
insert into q_runtime.voice_live_trial_usage(tenant_id,user_id,provider_session_id,voice_session_id,speech_seconds)
values(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'new-a','line-a',7);
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new-a',8,true),false,'incomplete canonical write retains claim');
update q_runtime.voice_live_trial_usage set speech_seconds=8 where provider_session_id='new-a';
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','new-a',8,true),true,'confirmed termination and durable final write release');
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','line-b',300),2::numeric,'reconnect reserves only actual remaining 2, not 10');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,1,true),false,'pre-provider failure cannot invent consumed speech');
select is(q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,0,true),true,'failure before creating provider safely releases');
select throws_ok($$select q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),gen_random_uuid(),'line',301)$$,'23514',null,'allowance cannot exceed account cap');
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_b'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc','independent',300),300::numeric,'another account is unaffected');
insert into q_runtime.voice_live_trial_usage(tenant_id,user_id,provider_session_id,voice_session_id,speech_seconds)
values(pg_temp.rls_id('tenant_b'),pg_temp.rls_id('user_a'),'last','line-b',2);
select is(q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),gen_random_uuid(),'line',300),null::numeric,'exhausted canonical account cannot reconnect');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='q_runtime.claim_voice_live_trial(uuid,uuid,uuid,text,integer)'::regprocedure),'claim has pinned definer search path');
select pg_temp.act_as_anonymous();
select throws_ok($$select * from q_runtime.voice_live_trial_claims$$,'42501',null,'anonymous cannot read claims');
select pg_temp.act_as_user_a();
select throws_ok($$select q_runtime.claim_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),gen_random_uuid(),'line',300)$$,'42501',null,'browser cannot claim even its own account');
select throws_ok($$select q_runtime.release_voice_live_trial(pg_temp.rls_id('tenant_a'),pg_temp.rls_id('user_a'),gen_random_uuid(),null,0,true)$$,'42501',null,'browser cannot release or reset');
select pg_temp.act_as_revoked_user();
select throws_ok($$select * from q_runtime.voice_live_trial_claims$$,'42501',null,'revoked user cannot read claims');
select * from finish();
rollback;
