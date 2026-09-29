-- Founder Connection Requests (founder decision 2026-09-28; ADR 0023).
--
-- PADL #98 (bilateral discovery) and the GateQ specification (items 11-13):
-- founders discover investors and reach them only through a structured
-- request, and only investors who allow it can be reached. Two changes:
--
-- 1. core.investor_organisations.inbound_preference: the investor's own
--    answer to "How should founders reach you?" (CLOSED | QUALIFIED |
--    OPEN, the contracts' InvestorInboundPreference vocabulary GateQ will
--    promote), until now only an onboarding answer nothing enforced.
--    Backfilled from each organisation's current onboarding answer.
--    NULL means not stated, which is treated as not reachable: unknown
--    never becomes consent.
--
-- 2. network.interests may now be expressed by the COMPANY party: a
--    founder's Connection Request is an interest on the ONE canonical
--    relationship, answered by the investor organisation the way a company
--    answers an investor's interest. One open interest per party per
--    relationship still holds (interests_one_open_per_party_idx).
--
-- Additive: one new nullable column, one widened check, one new column on
-- responses recording which party answered. No row is rewritten except the
-- backfill of the new column.

alter table core.investor_organisations
  add column inbound_preference text
    check (inbound_preference is null
           or inbound_preference in ('CLOSED', 'QUALIFIED', 'OPEN'));

comment on column core.investor_organisations.inbound_preference is
  'How founders may reach this investor (their own declared choice): CLOSED, QUALIFIED (the founder''s company must pass the investor''s declared mandate rules) or OPEN. NULL is not stated and is treated as not reachable.';

update core.investor_organisations o
   set inbound_preference = latest.option_key
  from (
    select distinct on (s.subject_id)
           s.subject_id as investor_organisation_id,
           upper(r.response_jsonb ->> 'optionKey') as option_key
      from onboarding.responses r
      join onboarding.sessions s on s.id = r.session_id
     where r.step_key = 'I10.inbound_preference'
       and r.superseded_by_response_id is null
       and r.withdrawn_at is null
       and s.subject_type = 'INVESTOR_ORGANISATION'
       and s.subject_id is not null
     order by s.subject_id, r.created_at desc
  ) latest
 where o.id = latest.investor_organisation_id
   and o.inbound_preference is null
   and latest.option_key in ('CLOSED', 'QUALIFIED', 'OPEN');

alter table network.interests
  drop constraint if exists interests_expressed_by_party_check;
alter table network.interests
  add constraint interests_expressed_by_party_check
    check (expressed_by_party in ('INVESTOR', 'COMPANY'));

comment on column network.interests.expressed_by_party is
  'Who reached out: INVESTOR (Express Interest) or COMPANY (a founder''s Connection Request, ADR 0023). The other party answers.';

alter table network.interest_responses
  add column responded_by_party text not null default 'COMPANY'
    check (responded_by_party in ('INVESTOR', 'COMPANY'));

comment on column network.interest_responses.responded_by_party is
  'The party that answered: the one the interest was addressed to.';
