-- Persist the selected account and PAL before a paid create request.
-- An uncertain request remains a financial/concurrency reservation even if
-- the private join was never issued and the canonical user continues by voice.
alter table q_runtime.rehearsal_video_sessions
  add column provider_request_started_at timestamptz,
  add column provider_request_resolved_at timestamptz,
  add constraint rehearsal_video_request_checkpoint check (
    (provider_request_started_at is null and provider_request_resolved_at is null)
    or (provider_request_started_at is not null and provider_key_index is not null
      and provider_pal_id is not null and
      (provider_request_resolved_at is null or provider_request_resolved_at >= provider_request_started_at))
  );
create function q_runtime.rehearsal_video_provider_checkpoint_guard()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.provider_request_started_at is not null and (
    new.provider_request_started_at is distinct from old.provider_request_started_at
    or new.provider_pal_id is distinct from old.provider_pal_id
  ) then
    raise exception using errcode='23514', message='a provider request keeps its checkpoint';
  end if;
  if old.provider_request_resolved_at is not null and new.provider_request_resolved_at is distinct from old.provider_request_resolved_at then
    raise exception using errcode='23514', message='a resolved provider request never reopens';
  end if;
  return new;
end;
$$;
create trigger rehearsal_video_provider_checkpoint_guard before update on q_runtime.rehearsal_video_sessions
for each row execute function q_runtime.rehearsal_video_provider_checkpoint_guard();
revoke all on function q_runtime.rehearsal_video_provider_checkpoint_guard() from public,anon,authenticated;
create or replace function q_runtime.rehearsal_video_allowance_guard()
returns trigger language plpgsql set search_path = pg_catalog,q_runtime as $$
begin
  perform pg_advisory_xact_lock(18250613,185);
  if (select count(*) from q_runtime.rehearsal_video_sessions where user_id=new.user_id)>2 then
    raise exception using errcode='P0001',message='CQ_VIDEO_ALLOWANCE_EXHAUSTED';
  end if;
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
