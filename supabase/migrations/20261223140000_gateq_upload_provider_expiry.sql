-- Provider upload URLs can outlive application sessions. Track their actual
-- lifetime before exposure; unknown attempts remain cleanup/reservation debt.
-- No credentials or signed URLs are stored here.
alter table evidence.document_upload_sessions
  add column provider_authorization_expires_at timestamptz,
  add column provider_authorization_state text not null default 'UNISSUED',
  add column provider_authorization_claim_id uuid,
  add column provider_authorization_claimed_at timestamptz;

-- Even an old PENDING_AUTHORIZATION ticket might have called the signer
-- before a crash/failed state write. No old guest ticket proves an absent
-- authorization; only newly inserted rows under the fenced protocol do.
update evidence.document_upload_sessions set provider_authorization_state='UNKNOWN'
where gateq_application_id is not null;

alter table evidence.document_upload_sessions
  add constraint document_upload_provider_authorization_state_check check (
    provider_authorization_state in ('UNISSUED','PENDING','KNOWN','UNKNOWN','UNKNOWN_PENDING')
    and ((provider_authorization_state in ('PENDING','UNKNOWN_PENDING')) =
      (provider_authorization_claim_id is not null and provider_authorization_claimed_at is not null))
    and ((provider_authorization_claim_id is null) = (provider_authorization_claimed_at is null))
    and (provider_authorization_state <> 'KNOWN' or provider_authorization_expires_at is not null)
    and (provider_authorization_state <> 'UNISSUED' or provider_authorization_expires_at is null)
  );

create function evidence.gateq_upload_authorization_retired(u evidence.document_upload_sessions)
returns boolean language sql stable set search_path=pg_catalog as $$
  select u.gateq_application_id is not null and u.provider_authorization_claim_id is null and (
    u.provider_authorization_state='UNISSUED' or
    (u.provider_authorization_state='KNOWN' and u.provider_authorization_expires_at <= now())
  );
$$;
revoke all on function evidence.gateq_upload_authorization_retired(evidence.document_upload_sessions) from public,anon,authenticated;

create function evidence.protect_upload_provider_expiry() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if old.provider_authorization_expires_at is not null and
    (new.provider_authorization_expires_at is null or new.provider_authorization_expires_at < old.provider_authorization_expires_at) then
    raise exception 'provider upload expiry cannot move backwards' using errcode='check_violation';
  end if;
  return new;
end $$;
revoke all on function evidence.protect_upload_provider_expiry() from public,anon,authenticated;
create trigger document_upload_provider_expiry_monotonic before update on evidence.document_upload_sessions
for each row execute function evidence.protect_upload_provider_expiry();
-- Upload sessions already have server-only RLS and no browser grants.
