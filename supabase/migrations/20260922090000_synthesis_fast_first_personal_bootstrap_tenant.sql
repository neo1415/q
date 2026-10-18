-- Two things the last live sessions showed (2026-09-16).
--
-- 1. Evidence synthesis was routed first to gemini-3.8-flash, which on the
--    free tier answered with 503s seventeen times in three hours and took
--    ten seconds when it did answer. The fast, small Gemini model answered
--    every dialogue call in under two seconds; it leads synthesis now, Groq's
--    120b follows, and the larger Gemini model is the last resort.
update ai_ops.routing_policies
set
  preferred_models = '{a2000000-0000-4000-8000-000000000001}',
  fallback_models = '{a2000000-0000-4000-8000-000000000004,a2000000-0000-4000-8000-000000000003,a2000000-0000-4000-8000-000000000005,a2000000-0000-4000-8000-000000000002}'
where code = 'evidence_synthesis.v1';

-- 2. A person who has just signed in belongs to no organisation and so had
--    no tenant to be attributed to, and every ledger row demands one; the
--    arrival conversation refused them. This is the one well-known tenant a
--    person acts under before they set anything up: it holds nothing of
--    anyone's but the attribution of what they asked Q. It grants no
--    organisation, no membership and no subject (see
--    packages/security/src/actor-context/personal.ts).
insert into identity.tenants (id, name, status)
values (
  'b0075742-0000-4000-8000-000000000001',
  'Capital Q — personal (before any organisation)',
  'active'
)
on conflict (id) do nothing;
