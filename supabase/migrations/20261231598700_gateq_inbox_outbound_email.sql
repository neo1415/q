-- GateQ inbox: email to an applicant who may not be on Capital Q.
--
-- An approved pass or reply (gateq.inbox_messages) is already the exact
-- words a member approved, under their idempotency key. This adds what else
-- that approval binds, and what became of the email:
--
--   subject            the subject line the person approved (null on rows
--                      sent before subjects were kept: never back-filled)
--   recipient_sha256   the sha256 of the lower-cased address it was approved
--                      for; the address itself stays in the frozen submission
--   inbox_message_deliveries
--                      one outcome per message (SENT, SUPPRESSED for a
--                      reserved test address, UNAVAILABLE, NO_ADDRESS,
--                      FAILED), recipient domain only. Append-only; a failed
--                      send is never retried on its own.
--
-- Additive only: two nullable columns and one new server-only table. No
-- existing row or policy changes.

alter table gateq.inbox_messages
  add column subject text
    check (subject is null or (length(btrim(subject)) between 1 and 150 and subject !~ '[\r\n]')),
  add column recipient_sha256 text
    check (recipient_sha256 is null or recipient_sha256 ~ '^[0-9a-f]{64}$');

-- The outbound rate limit counts a tenant's recent answers.
create index inbox_messages_by_tenant_recent_idx
  on gateq.inbox_messages (tenant_id, created_at);

create table gateq.inbox_message_deliveries (
  message_id        uuid primary key references gateq.inbox_messages (id) on delete restrict,
  application_id    uuid not null references gateq.applications (id) on delete restrict,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  outcome           text not null
                      check (outcome in ('SENT', 'SUPPRESSED', 'UNAVAILABLE', 'NO_ADDRESS', 'FAILED')),
  recipient_domain  text check (recipient_domain is null or length(recipient_domain) between 1 and 253),
  created_at        timestamptz not null default now()
);

comment on table gateq.inbox_message_deliveries is
  'GateQ inbox: what became of the email for one approved pass or reply. Recipient domain only; append-only; never a retry trigger.';

create or replace function gateq.inbox_delivery_matches_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.inbox_messages m
     where m.id = new.message_id
       and m.application_id = new.application_id
       and m.tenant_id = new.tenant_id
  ) then
    raise exception 'a delivery belongs to its own message, application and tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.inbox_delivery_matches_message() from public;

create trigger inbox_message_deliveries_message before insert on gateq.inbox_message_deliveries
  for each row execute function gateq.inbox_delivery_matches_message();
create trigger inbox_message_deliveries_immutable before update or delete on gateq.inbox_message_deliveries
  for each row execute function gateq.protect_inbox_history();

-- Server-only, as every inbox table: RLS on, no policy, no browser grant.
alter table gateq.inbox_message_deliveries enable row level security;
revoke all on gateq.inbox_message_deliveries from anon, authenticated;
