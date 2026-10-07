-- Q.01 (20261218100000): Founder onboarding v4 adds an optional financials
-- block. v4 is current for new sessions; v3 stays published and unchanged,
-- so a session pinned to it keeps its own journey. Every financial step is
-- optional (unknown is allowed) and writes only through the financial
-- claims target; the currency pick writes nothing.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  4, 'new founder sessions pin to v4');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder' and v.version = 3),
  'v3 stays published for sessions already pinned to it');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 3
      and s.step_key like 'F5.%' and s.step_key in
        ('F5.fin_currency', 'F5.monthly_revenue', 'F5.cash')),
  0, 'v3 itself gained no financial steps');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4
      and s.step_key in ('F5.fin_currency', 'F5.monthly_revenue', 'F5.revenue_trend',
                         'F5.gross_margin', 'F5.monthly_burn', 'F5.cash',
                         'F5.runway_months', 'F6.min_cheque')),
  8, 'v4 carries the eight financial steps');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4
      and s.step_key in ('F5.fin_currency', 'F5.monthly_revenue', 'F5.revenue_trend',
                         'F5.gross_margin', 'F5.monthly_burn', 'F5.cash',
                         'F5.runway_months', 'F6.min_cheque')
      and s.required),
  0, 'every financial step is optional: unknown is allowed');

select is(
  (select s.writes_to::text from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4 and s.step_key = 'F5.cash'),
  '[{"targetKey": "company.financial_claims"}]',
  'a figure writes only through the financial claims target');

select is(
  (select s.writes_to::text from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4 and s.step_key = 'F5.fin_currency'),
  '[]', 'the currency pick writes nothing by itself');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4),
  (select count(*)::int + 8 from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 3),
  'v4 is v3 plus exactly the financial steps');

select ok(
  (select s.sequence_order from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4 and s.step_key = 'F5.fin_currency')
  = (select s.sequence_order + 1 from onboarding.steps s
       join onboarding.definition_versions v on v.id = s.definition_version_id
       join onboarding.definitions d on d.id = v.definition_id
      where d.journey_type = 'founder' and v.version = 4 and s.step_key = 'F5.growth'),
  'the financials are asked right after growth');

select * from finish();
rollback;
