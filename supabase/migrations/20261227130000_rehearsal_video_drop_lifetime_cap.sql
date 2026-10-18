-- The shared weekly allowance ledger (20261226150000) is the per-account
-- video allowance for GateQ and Rehearsals, with its tester exemption. The
-- earlier lifetime cap of three rehearsal rooms per account stayed in this
-- guard and refused every account after its third room ever, testers
-- included. Keep the concurrency limits only; the ledger decides allowance.
create or replace function q_runtime.rehearsal_video_allowance_guard()
returns trigger language plpgsql set search_path = pg_catalog,q_runtime as $$
begin
  perform pg_advisory_xact_lock(18250613,185);
  if (new.status in ('STARTING','LIVE') or (new.provider_request_started_at is not null and new.provider_request_resolved_at is null)) and (
    (select count(*) from q_runtime.rehearsal_video_sessions where user_id=new.user_id and
      (status in ('STARTING','LIVE') or (provider_request_started_at is not null and provider_request_resolved_at is null)))>1
    or (select count(*) from q_runtime.rehearsal_video_sessions where
      status in ('STARTING','LIVE') or (provider_request_started_at is not null and provider_request_resolved_at is null))>2
  ) then raise exception using errcode='P0001',message='CQ_VIDEO_CONCURRENCY_LIMIT';
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.rehearsal_video_allowance_guard() from public,anon,authenticated;
