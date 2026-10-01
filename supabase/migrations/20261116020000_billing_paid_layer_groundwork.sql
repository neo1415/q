-- BILLING-2 (docs/specs/2026-10/readiness-blueprint.md, ADR 0036): the
-- paid layer's groundwork. Additive; nothing changes for anyone today.
--
-- 1. A fourth feature kind, VALUE: a number a plan sets (not a meter, not
--    a gate), read by the owning context as configuration.
-- 2. q.readiness_blueprint (ACCESS): PADL #85 Layer 2 "Pro". Launch on,
--    Free off, Founder Pro on; not an investor feature. Not built yet: the
--    route answers 501 to whoever the plan includes.
-- 3. discover.recommendation_volume (VALUE): how far down an investor's
--    ranked slate they may page (Product Specification: premium tiers may
--    increase volume "without reducing recommendation quality"). Volume
--    only, never position: every plan gets today's number (the slate
--    policy's candidate pool, 200), so nothing changes.

alter table billing.features drop constraint features_kind_check;
alter table billing.features add constraint features_kind_check
  check (kind in ('ACCESS', 'MONTHLY', 'COUNT', 'VALUE'));

insert into billing.features (key, name, description, kind, unit_singular, unit_plural) values
  ('q.readiness_blueprint', 'Capital Readiness Blueprint',
   'Q turns its diagnosis into a sequenced plan: what to fix first, in what order, and what each investor will want to see.',
   'ACCESS', 'blueprint', 'blueprints'),
  ('discover.recommendation_volume', 'Recommendations per feed',
   'How many ranked companies your Discover feed can show. The order is the same on every plan.',
   'VALUE', 'recommendation', 'recommendations');

-- New features on existing plan versions: rows are added, none changed.
insert into billing.plan_features (plan_id, feature_key, included, limit_value)
select p.id, v.feature_key, v.included, v.limit_value
  from (values
    ('launch',       'q.readiness_blueprint',          true,  null),
    ('free',         'q.readiness_blueprint',          false, null),
    ('founder_pro',  'q.readiness_blueprint',          true,  null),
    ('investor_pro', 'q.readiness_blueprint',          false, null),
    ('fund',         'q.readiness_blueprint',          false, null),
    ('launch',       'discover.recommendation_volume', true,  200),
    ('free',         'discover.recommendation_volume', true,  200),
    ('founder_pro',  'discover.recommendation_volume', true,  200),
    ('investor_pro', 'discover.recommendation_volume', true,  200),
    ('fund',         'discover.recommendation_volume', true,  200)
  ) as v (plan_key, feature_key, included, limit_value)
  join billing.plans p on p.key = v.plan_key and p.version = 1;
