-- Lane ob1 (2026-10-16) · q_knowledge.preference_learning_consents
--
-- Whether Q may LEARN how a person likes to work from their conversations
-- (concise or detailed, tone, language), as opposed to keeping what they
-- explicitly told it. Owner decision 2026-10-16: inferring communication
-- preferences is opt-in, "with consent and user controls". No row means
-- not asked and NOT granted, for every existing user too.
--
-- Per person and per tenant: consent given in one organisation's workspace
-- never applies in another, as memory itself never crosses tenants. A
-- "Not now" is remembered with the time it may be asked again (30 days,
-- decided by the application's policy), so Q does not keep asking.
--
-- Not a psychological profile: this row holds a yes or no about learning
-- communication preferences, nothing else. INTERNAL_SERVER_ONLY.

create table q_knowledge.preference_learning_consents (
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  status           text not null check (status in ('GRANTED', 'DECLINED', 'REVOKED')),
  -- DECLINED ("Not now"): when it may be put to them again. Null otherwise.
  ask_again_after  timestamptz,
  -- Where the decision was made.
  decided_via      text not null check (decided_via in ('PROMPT', 'CONVERSATION', 'SETTINGS')),
  policy_version   text not null check (length(policy_version) between 1 and 64),
  decided_at       timestamptz not null default clock_timestamp(),
  primary key (tenant_id, user_id),
  check ((status = 'DECLINED') = (ask_again_after is not null))
);

comment on table q_knowledge.preference_learning_consents is
  'Per person and tenant: may Q infer communication preferences from conversations. No row = not granted. INTERNAL_SERVER_ONLY.';

alter table q_knowledge.preference_learning_consents enable row level security;
revoke all on q_knowledge.preference_learning_consents from anon, authenticated;
-- No policies.
