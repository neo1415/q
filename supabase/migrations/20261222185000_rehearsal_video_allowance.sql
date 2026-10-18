-- Founder authorization 2026-10-13: two allocations per canonical account,
-- up to 180 seconds each, with no automatic renewal. Existing pilot counts.
-- Failed starts count conservatively. Same-room retries do not insert a row.
-- Serialize allocation decisions across instances; a stale open room remains
-- occupied until confirmed closed. Never assume a provider stopped at expiry.
create function q_runtime.rehearsal_video_allowance_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, q_runtime
as $$
begin
  perform pg_advisory_xact_lock(18250613, 185);
  if (select count(*) from q_runtime.rehearsal_video_sessions where user_id = new.user_id) > 2 then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_ALLOWANCE_EXHAUSTED';
  end if;
  if new.status in ('STARTING', 'LIVE') and (
    (select count(*) from q_runtime.rehearsal_video_sessions where user_id = new.user_id and status in ('STARTING', 'LIVE')) > 1
    or (select count(*) from q_runtime.rehearsal_video_sessions where status in ('STARTING', 'LIVE')) > 2
  ) then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_CONCURRENCY_LIMIT';
  end if;
  return new;
end;
$$;
create trigger rehearsal_video_allowance_guard
  after insert on q_runtime.rehearsal_video_sessions
  for each row execute function q_runtime.rehearsal_video_allowance_guard();
revoke all on function q_runtime.rehearsal_video_allowance_guard() from public, anon, authenticated;
alter table q_runtime.rehearsal_video_sessions
  add constraint rehearsal_video_absolute_cap check (ends_at <= created_at + interval '180 seconds');
