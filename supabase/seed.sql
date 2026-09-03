-- Capital Q local seed.
--
-- Runs after migrations on `supabase start` and `supabase db reset`.
--
-- Rules:
--   * Data insertions only. Schema belongs in supabase/migrations/, never here.
--   * Reference data only. No people, organisations, companies or investors --
--     real or invented. Test fixtures live inside rolled-back tests; demo data
--     arrives as its own concern later.
--   * Idempotent by stable code, so repeated resets never duplicate rows.
--   * Never seed from a production dump, a customer database, a founder deck
--     or any real investor material (DDA seed rule).

-- ---------------------------------------------------------------------------
-- Capability reference set. Must stay aligned with REFERENCE_CAPABILITIES in
-- @capital-q/security; an integration test asserts every registered code
-- exists here. Owning domain packets add their own capabilities.
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('organisation.view',        'View the organisation profile and membership context.'),
  ('organisation.admin',       'Administer the organisation: members, roles and settings.'),
  ('company.financials.view',  'View company financial data.'),
  ('company.financials.edit',  'Edit company financial data.'),
  ('data_room.share',          'Share data room content with another party.'),
  ('q.action.approve',         'Approve a consequential action proposed by Q.')
on conflict (code) do update
  set description = excluded.description;

-- ---------------------------------------------------------------------------
-- Minimal V1 role templates. The detailed product role matrix is deliberately
-- unresolved: these two exist so a membership can be administered at all, and
-- organisation_member may only view (least privilege). The production
-- copy of this reference data lives in the CQ-ORG-001 migration; keep both
-- aligned.
-- ---------------------------------------------------------------------------

insert into permissions.roles (code, name, description, scope_type) values
  ('organisation_admin',  'Organisation administrator',
     'Administers the organisation it is assigned within.', 'organisation'),
  ('organisation_member', 'Organisation member',
     'Baseline membership template: may view the organisation it belongs to.', 'organisation')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      scope_type = excluded.scope_type;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'organisation.view'),
      ('organisation_admin',  'organisation.admin'),
      ('organisation_member', 'organisation.view')
    )
on conflict (role_id, capability_id) do nothing;
