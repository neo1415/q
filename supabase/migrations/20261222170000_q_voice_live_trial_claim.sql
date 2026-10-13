-- Coordination only: canonical voice_live_trial_usage remains consumption truth.
-- A crash retains the claim. Time passing never proves a paid provider stopped.
create table q_runtime.voice_live_trial_claims (
  user_id uuid primary key references identity.user_profiles(id) on delete restrict,
  tenant_id uuid not null references identity.tenants(id) on delete restrict,
  claim_id uuid not null unique,
  voice_session_id text not null check (voice_session_id ~ '^[A-Za-z0-9._:-]+$' and length(voice_session_id) between 1 and 128),
  remaining_seconds numeric(9,2) not null check (remaining_seconds > 0 and remaining_seconds <= 300),
  created_at timestamptz not null default clock_timestamp()
);
alter table q_runtime.voice_live_trial_claims enable row level security;
revoke all on q_runtime.voice_live_trial_claims from public, anon, authenticated, service_role;
grant select on q_runtime.voice_live_trial_claims to service_role;

create function q_runtime.claim_voice_live_trial(p_tenant uuid, p_user uuid, p_claim uuid, p_voice text, p_allowance integer)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare remaining numeric;
begin
  if p_allowance is null or p_allowance < 1 or p_allowance > 300 then
    raise exception 'invalid trial allowance' using errcode = '23514';
  end if;
  -- Lock the canonical person, not the selected tenant: alternate tenant
  -- contexts and independent API processes share exactly this lock.
  perform 1 from identity.user_profiles where id = p_user and status = 'active' for update;
  if not found then raise exception 'trial owner unavailable' using errcode = '42501'; end if;
  if exists (select 1 from q_runtime.voice_live_trial_claims where user_id = p_user) then return null; end if;
  select p_allowance - coalesce(sum(speech_seconds), 0) into remaining
    from q_runtime.voice_live_trial_usage where user_id = p_user;
  if remaining <= 0 then return null; end if;
  insert into q_runtime.voice_live_trial_claims(user_id,tenant_id,claim_id,voice_session_id,remaining_seconds)
    values(p_user,p_tenant,p_claim,p_voice,remaining);
  return remaining;
end;
$$;

create function q_runtime.release_voice_live_trial(p_tenant uuid, p_user uuid, p_claim uuid, p_provider text, p_final numeric, p_terminated boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare held q_runtime.voice_live_trial_claims%rowtype;
begin
  perform 1 from identity.user_profiles where id = p_user for update;
  select * into held from q_runtime.voice_live_trial_claims
    where user_id=p_user and tenant_id=p_tenant and claim_id=p_claim for update;
  if not found or p_terminated is distinct from true or p_final is null or p_final < 0 then return false; end if;
  if p_provider is null then
    -- Only failure before any provider was created: application lifecycle
    -- must never take this path after creating an external session.
    if p_final <> 0 then return false; end if;
  elsif not exists (
    select 1 from q_runtime.voice_live_trial_usage
      where tenant_id=p_tenant and user_id=p_user and provider_session_id=p_provider
        and voice_session_id=held.voice_session_id and speech_seconds >= p_final
  ) then return false;
  end if;
  delete from q_runtime.voice_live_trial_claims where user_id=p_user and claim_id=p_claim;
  return true;
end;
$$;
revoke all on function q_runtime.claim_voice_live_trial(uuid,uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function q_runtime.release_voice_live_trial(uuid,uuid,uuid,text,numeric,boolean) from public, anon, authenticated;
grant execute on function q_runtime.claim_voice_live_trial(uuid,uuid,uuid,text,integer) to service_role;
grant execute on function q_runtime.release_voice_live_trial(uuid,uuid,uuid,text,numeric,boolean) to service_role;
