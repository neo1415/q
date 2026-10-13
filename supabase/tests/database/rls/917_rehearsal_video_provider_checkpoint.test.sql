begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(8);
create function pg_temp.reserve_video(account text,tenant text,uncertain boolean) returns void language plpgsql as $$
declare rid uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();
begin
  insert into q_runtime.rehearsals(id,tenant_id,user_id,counterpart_kind,counterpart_id,counterpart_name,persona)
  values(rid,pg_temp.rls_id(tenant),pg_temp.rls_id(account),'COMPANY',gen_random_uuid(),'Company','{}');
  insert into q_runtime.rehearsal_video_sessions(id,tenant_id,user_id,rehearsal_id,interviewer_id,bridge_token_hash,created_at,ends_at,status,ended_reason,ended_at,provider_key_index,provider_pal_id,provider_request_started_at)
  values(gen_random_uuid(),pg_temp.rls_id(tenant),pg_temp.rls_id(account),rid,'partner-steve',repeat(replace(rid::text,'-',''),2),stamp,stamp+interval '180 seconds',
    case when uncertain then 'FAILED' else 'STARTING' end,case when uncertain then 'PROVIDER_UNAVAILABLE' else null end,case when uncertain then stamp else null end,
    case when uncertain then 0 else null end,case when uncertain then 'pal-checkpoint' else null end,case when uncertain then stamp else null end);
end;
$$;
select lives_ok($$select pg_temp.reserve_video('user_a','tenant_a',true)$$,'uncertain create is retained as a reservation');
select throws_ok($$select pg_temp.reserve_video('user_a','tenant_a',false)$$,'P0001','CQ_VIDEO_CONCURRENCY_LIMIT','failed uncertain request still occupies account slot');
select lives_ok($$select pg_temp.reserve_video('user_b','tenant_b',true)$$,'second uncertain reservation occupies global second slot');
select throws_ok($$select pg_temp.reserve_video('user_r','tenant_r',false)$$,'P0001','CQ_VIDEO_CONCURRENCY_LIMIT','unknown remote rooms cannot free global capacity');
update q_runtime.rehearsal_video_sessions set provider_request_resolved_at=clock_timestamp() where user_id=pg_temp.rls_id('user_a');
select lives_ok($$select pg_temp.reserve_video('user_a','tenant_a',false)$$,'confirmed resolution frees concurrency but lifetime allowance still counts');
select throws_ok($$update q_runtime.rehearsal_video_sessions set provider_request_resolved_at=null where provider_request_resolved_at is not null$$,'23514','a resolved provider request never reopens','resolution cannot be erased');
select throws_ok($$update q_runtime.rehearsal_video_sessions set provider_pal_id='other' where provider_request_started_at is not null$$,'23514','a provider request keeps its checkpoint','recorded provider PAL cannot be replaced');
select ok(not has_column_privilege('authenticated','q_runtime.rehearsal_video_sessions','provider_request_started_at','SELECT'),'browser cannot read allocation checkpoint');
select * from finish();
rollback;
