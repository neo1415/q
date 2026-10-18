begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(10);
create function pg_temp.allocate_video(account text, tenant text) returns void language plpgsql as $$
declare rid uuid := gen_random_uuid(); stamp timestamptz := clock_timestamp();
begin
  insert into q_runtime.rehearsals (id,tenant_id,user_id,counterpart_kind,counterpart_id,counterpart_name,persona)
  values (rid,pg_temp.rls_id(tenant),pg_temp.rls_id(account),'COMPANY',gen_random_uuid(),'Company','{}');
  insert into q_runtime.rehearsal_video_sessions (id,tenant_id,user_id,rehearsal_id,interviewer_id,bridge_token_hash,created_at,ends_at)
  values (gen_random_uuid(),pg_temp.rls_id(tenant),pg_temp.rls_id(account),rid,'partner-steve',repeat(replace(rid::text,'-',''),2),stamp,stamp+interval '180 seconds');
end;
$$;
select lives_ok($$select pg_temp.allocate_video('user_a','tenant_a')$$,'first allocation allowed');
select throws_ok($$select pg_temp.allocate_video('user_a','tenant_a')$$,'P0001','CQ_VIDEO_CONCURRENCY_LIMIT','account cannot allocate two open rooms');
select lives_ok($$select pg_temp.allocate_video('user_b','tenant_b')$$,'second account can use second global slot');
select throws_ok($$select pg_temp.allocate_video('user_r','tenant_r')$$,'P0001','CQ_VIDEO_CONCURRENCY_LIMIT','third simultaneous provider room refused');
select is((select count(*)::int from q_runtime.rehearsal_video_sessions),2,'refused allocations leave no reservation');
update q_runtime.rehearsal_video_sessions set status='ENDED',ended_reason='TIME_LIMIT',ended_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a');
select lives_ok($$select pg_temp.allocate_video('user_a','tenant_a')$$,'second account interview allowed after confirmed close');
update q_runtime.rehearsal_video_sessions set status='FAILED',ended_reason='PROVIDER_UNAVAILABLE',ended_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a') and status='STARTING';
select lives_ok($$select pg_temp.allocate_video('user_a','tenant_a')$$,'no lifetime room cap: the weekly ledger is the allowance');
update q_runtime.rehearsal_video_sessions set status='ENDED',ended_reason='TIME_LIMIT',ended_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a') and status='STARTING';
select lives_ok($$select pg_temp.allocate_video('user_a','tenant_b')$$,'a fourth room after the third closed is allowed');
select is((select count(*)::int from q_runtime.rehearsal_video_sessions where user_id=pg_temp.rls_id('user_a')),4,'every allocation is kept as history');
select ok(not has_function_privilege('authenticated','q_runtime.rehearsal_video_allowance_guard()','EXECUTE'),'browser cannot execute guard');
select * from finish();
rollback;
