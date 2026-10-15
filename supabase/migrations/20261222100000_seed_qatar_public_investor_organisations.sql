-- R5 (2026-10-10): rehearse with researched investors. QInvest, AlRayan
-- Investment and Alchemist Doha become CANONICAL investor organisations so a
-- founder's Rehearse opens /rehearsals/investor/<id> like any investor.
-- Fix-forward of 20261222093000 (the research records); additive, idempotent.
--
-- UNCLAIMED public profiles. "Public profile built by Q from public
-- sources; not on Capital Q." Unclaimed is the platform's existing meaning:
-- the organisation has no active membership (see platform-publishing). No
-- login account, membership or representative is created here, and nothing
-- below may ever add one: a real owner claims the profile through the claim
-- flow, after which the real investor, not the simulation, is rehearsed.
--
-- Declared Mandate != Q Inference. NO core.investor_mandates row is written:
-- a mandate is what the investor declares. Their public investment focus
-- stays where it already lives, as sourced, evidence-classed public facts on
-- the linked q_runtime.external_persons row (external_entity_facts) and in
-- the persona brief; none of it is a mandate, a ranking feature or a claim
-- by the firm. inbound_preference stays NULL (not reachable) and
-- deployment_state NULL (unknown, never "paused" or "active").
-- verification_state stays 'unverified': the Q Card reads anything else as
-- an organisation verification badge.
--
-- The owning tenant is a platform tenant that holds only these public
-- profiles; it is nobody's workspace. Visibility is network_visible so
-- founders (any tenant) can see them; it is not public_external.

insert into identity.tenants (id, name, status)
values ('b0075742-0000-4000-8000-0000000000a1',
        'Capital Q — public profiles built by Q (unclaimed)', 'active')
on conflict (id) do nothing;

insert into identity.organisations
  (id, tenant_id, organisation_type, legal_name, display_name, slug, country_code, status)
values
  ('b0075742-0000-4000-8000-0000000000b1', 'b0075742-0000-4000-8000-0000000000a1',
   'institution', 'QInvest LLC', 'QInvest', 'qinvest', 'QA', 'active'),
  ('b0075742-0000-4000-8000-0000000000b2', 'b0075742-0000-4000-8000-0000000000a1',
   'institution', 'AlRayan Investment LLC', 'AlRayan Investment', 'alrayan-investment', 'QA', 'active'),
  ('b0075742-0000-4000-8000-0000000000b3', 'b0075742-0000-4000-8000-0000000000a1',
   'accelerator', null, 'Alchemist Doha', 'alchemist-doha', 'QA', 'active')
on conflict (id) do nothing;

insert into identity.tenant_organisations (tenant_id, organisation_id, relationship_type)
values
  ('b0075742-0000-4000-8000-0000000000a1', 'b0075742-0000-4000-8000-0000000000b1', 'primary'),
  ('b0075742-0000-4000-8000-0000000000a1', 'b0075742-0000-4000-8000-0000000000b2', 'primary'),
  ('b0075742-0000-4000-8000-0000000000a1', 'b0075742-0000-4000-8000-0000000000b3', 'primary')
on conflict do nothing;

insert into core.investor_organisations
  (id, tenant_id, organisation_id, investor_type, display_name, hq_country,
   public_description, verification_state, marketplace_visibility)
values
  ('b0075742-0000-4000-8000-0000000000c1', 'b0075742-0000-4000-8000-0000000000a1',
   'b0075742-0000-4000-8000-0000000000b1', 'INSTITUTIONAL', 'QInvest', 'QA',
   'Public profile built by Q from public sources; not on Capital Q. Qatar-based Islamic investment group spanning investment banking, principal investments and asset management.',
   'unverified', 'network_visible'),
  ('b0075742-0000-4000-8000-0000000000c2', 'b0075742-0000-4000-8000-0000000000a1',
   'b0075742-0000-4000-8000-0000000000b2', 'INSTITUTIONAL', 'AlRayan Investment', 'QA',
   'Public profile built by Q from public sources; not on Capital Q. Qatar investment and advisory firm owned by AlRayan Bank, covering asset management, sukuk and M&A advisory.',
   'unverified', 'network_visible'),
  ('b0075742-0000-4000-8000-0000000000c3', 'b0075742-0000-4000-8000-0000000000a1',
   'b0075742-0000-4000-8000-0000000000b3', 'ACCELERATOR', 'Alchemist Doha', 'QA',
   'Public profile built by Q from public sources; not on Capital Q. Technology accelerator in Doha; its Director of Investments backs early-stage tech startups as they reach investors and scale.',
   'unverified', 'network_visible')
on conflict (id) do nothing;

-- The link from a researched record to the canonical investor organisation.
-- One research seed per investor organisation; set null if the organisation
-- ever goes. The loader (load-research-seed) never writes this column, so a
-- reload keeps the link.
alter table q_runtime.external_persons
  add column if not exists investor_organisation_id uuid
    references core.investor_organisations (id) on delete set null;

create unique index if not exists external_persons_investor_org_idx
  on q_runtime.external_persons (investor_organisation_id)
  where investor_organisation_id is not null;

comment on column q_runtime.external_persons.investor_organisation_id is
  'The canonical (unclaimed) investor organisation a PREPARED_PUBLIC_SEED row stands in for. Lets Rehearse and discovery cards use the investor rehearsal. Server-only.';

update q_runtime.external_persons
   set investor_organisation_id = 'b0075742-0000-4000-8000-0000000000c1'
 where tenant_id is null and profile_key = 'qa-demo-qinvest'
   and investor_organisation_id is null;
update q_runtime.external_persons
   set investor_organisation_id = 'b0075742-0000-4000-8000-0000000000c2'
 where tenant_id is null and profile_key = 'qa-demo-alrayan'
   and investor_organisation_id is null;
-- Muhannad Taslaq is the named person the Alchemist Doha persona speaks as.
update q_runtime.external_persons
   set investor_organisation_id = 'b0075742-0000-4000-8000-0000000000c3'
 where tenant_id is null and profile_key = 'qa-demo-muhannad-taslaq'
   and investor_organisation_id is null;
