-- Investor organisations gain the same visibility switch companies have
-- (CQ-PRE-REC-001 §31-§35 applied to the other side of the network).
--
-- An investor was private with no way to be otherwise: a founder could
-- never see who might be a fit, and doc 19 §44 ("founder-facing investor
-- discovery uses the investor's declared, network-visible mandate") had no
-- column to read. The two states are the same two a founder chooses, and
-- for the same reason: public exposure at an external URL is not a V1
-- product rule, and relationship-specific sharing belongs to GateQ.
--
-- Default private. Becoming visible is an intentional act by an editor of
-- the investor organisation, never a side effect of finishing onboarding.
alter table core.investor_organisations
  add column if not exists marketplace_visibility text not null
    default 'organisation_private'
    check (marketplace_visibility in (
      'organisation_private',
      'network_visible'
    ));

comment on column core.investor_organisations.marketplace_visibility is
  'Who may see the declared investor profile: organisation_private (default) or network_visible to authenticated Capital Q participants. Set only through the investor visibility use case; never inferred, never a side effect of onboarding.';

create index if not exists investor_organisations_visibility_idx
  on core.investor_organisations (marketplace_visibility, investor_type);
