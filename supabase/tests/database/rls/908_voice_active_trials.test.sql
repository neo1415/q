-- Owner-private GPT-Live trials. Application actor checks remain mandatory.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(13);
insert into q_runtime.voice_active_trials(user_id) values (pg_temp.rls_id('user_a')), (pg_temp.rls_id('user_b'));
select is((select allowance_ms from q_runtime.voice_active_trials where user_id=pg_temp.rls_id('user_a')),300000,'trial allowance is five active minutes');
select throws_ok($$update q_runtime.voice_active_trials set allowance_ms=300001 where user_id=pg_temp.rls_id('user_a')$$,'23514',null,'trial ceiling cannot be increased');
update q_runtime.voice_active_trials set reserved_session_id='00000000-0000-4000-8000-000000009081',heartbeat_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a') and reserved_session_id is null;
select is((with attempt as (update q_runtime.voice_active_trials set reserved_session_id='00000000-0000-4000-8000-000000009082',heartbeat_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a') and reserved_session_id is null returning user_id) select count(*)::int from attempt),0,'another session cannot reserve an already-held account');
select is((select consumed_ms from q_runtime.voice_active_trials where user_id=pg_temp.rls_id('user_a')),0,'opening or idle reservation consumes no speech');
update q_runtime.voice_active_trials set consumed_ms=least(allowance_ms,consumed_ms+greatest(0,1200-session_active_ms)),session_active_ms=greatest(session_active_ms,1200) where user_id=pg_temp.rls_id('user_a');
update q_runtime.voice_active_trials set consumed_ms=least(allowance_ms,consumed_ms+greatest(0,1200-session_active_ms)),session_active_ms=greatest(session_active_ms,1200) where user_id=pg_temp.rls_id('user_a');
select is((select consumed_ms from q_runtime.voice_active_trials where user_id=pg_temp.rls_id('user_a')),1200,'replayed cumulative checkpoint never charges twice');
select is((with attempt as (update q_runtime.voice_active_trials set reserved_session_id=null,session_active_ms=0,heartbeat_at=null where user_id=pg_temp.rls_id('user_a') and reserved_session_id='00000000-0000-4000-8000-000000009082' returning user_id) select count(*)::int from attempt),0,'an unrelated session cannot release the reservation');
update q_runtime.voice_active_trials set reserved_session_id=null,session_active_ms=0,heartbeat_at=null where user_id=pg_temp.rls_id('user_a');
select is((select allowance_ms-consumed_ms from q_runtime.voice_active_trials where user_id=pg_temp.rls_id('user_a')),298800,'reconnect carries remaining lifetime allowance');
select pg_temp.act_as_anonymous();
select throws_ok($$select * from q_runtime.voice_active_trials$$,'42501',null,'anonymous cannot inspect trial counters');
select pg_temp.act_as_user_a();
select throws_ok($$select * from q_runtime.voice_active_trials$$,'42501',null,'browser cannot inspect even its own private counter');
select throws_ok($$update q_runtime.voice_active_trials set consumed_ms=0$$,'42501',null,'browser cannot refill its allowance');
select pg_temp.act_as_privileged();
select is((select consumed_ms from q_runtime.voice_active_trials where user_id=pg_temp.rls_id('user_b')),0,'another person allowance stays independent');
select throws_ok($$update q_runtime.voice_active_trials set consumed_ms=300001 where user_id=pg_temp.rls_id('user_a')$$,'23514',null,'overdrawn trial counters are rejected');
select is((select count(*)::int from pg_policies where schemaname='q_runtime' and tablename='voice_active_trials'),0,'no client-facing RLS policies exist');
select * from finish();
rollback;
