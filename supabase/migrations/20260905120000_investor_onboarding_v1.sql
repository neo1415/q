-- CQ-ONB-003 · Investor onboarding: portfolio references (ADR 0007) and
-- Investor Definition v1.
--
-- 1. core.investor_portfolio_references -- representative portfolio
--    companies an investor names about itself. Investor-owned reference
--    data: a name, an optional website, provenance, who added it, and when
--    it was removed. Not a Capital Q Company, linked to none, no ownership,
--    amount, valuation, board or performance fields. History is kept
--    through removed_at.
-- 2. Investor Definition v1 is published as reference data through the same
--    rows the runtime publisher writes. Sessions pin to this version; a
--    change to the journey is v2, never an edit of these rows.

create table core.investor_portfolio_references (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id  uuid not null,
  company_name              text not null check (length(btrim(company_name)) between 1 and 200),
  website_url               text check (website_url is null or (length(website_url) <= 2048 and website_url ~* '^https?://')),
  -- Provenance. V1 is investor-entered; research and integration sources arrive with their own workflows.
  source                    text not null default 'USER_ENTERED' check (source in ('USER_ENTERED')),
  created_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  created_at                timestamptz not null default now(),
  -- Soft removal keeps history; a removed reference is never current again.
  removed_at                timestamptz,
  foreign key (investor_organisation_id, tenant_id)
    references core.investor_organisations (id, tenant_id) on delete restrict
);

comment on table core.investor_portfolio_references is
  'Representative portfolio companies named by an investor (ADR 0007). References only: never a Capital Q company, relationship or match; investor-private until a later profile projection.';

create index investor_portfolio_references_current_idx
  on core.investor_portfolio_references (tenant_id, investor_organisation_id, created_at)
  where removed_at is null;

alter table core.investor_portfolio_references enable row level security;

-- Readable by current members of the organisation behind the investor
-- organisation; written only by the Investor application service. Founders,
-- other investors and anonymous callers see nothing.
create policy investor_portfolio_references_member_select on core.investor_portfolio_references
  for select to authenticated
  using (exists (
    select 1 from core.investor_organisations i
     where i.id = core.investor_portfolio_references.investor_organisation_id
       and i.tenant_id = core.investor_portfolio_references.tenant_id
       and private.is_organisation_member(i.organisation_id)));

grant select on core.investor_portfolio_references to authenticated;

-- ---------------------------------------------------------------------------
-- Investor Definition v1 (generated section begins)
-- ---------------------------------------------------------------------------

-- CQ-ONB-003 · Investor onboarding v1 (journey "investor")
-- GENERATED from packages/investor-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('07561933-eed8-55c2-86ca-adfaf2257256', $cq$investor$cq$, $cq$Investor onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', d.id, 1,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"I0","label":"Role"},{"phaseKey":"I1","label":"Deployment"},{"phaseKey":"I2","label":"Stage and cheque"},{"phaseKey":"I3","label":"Geography and sectors"},{"phaseKey":"I4","label":"Business attributes"},{"phaseKey":"I5","label":"Founding team"},{"phaseKey":"I6","label":"Green flags"},{"phaseKey":"I7","label":"Red flags"},{"phaseKey":"I8","label":"Portfolio"},{"phaseKey":"I9","label":"Discovery style"},{"phaseKey":"I10","label":"Inbound"},{"phaseKey":"I11","label":"Review"},{"phaseKey":"I12","label":"Handoff"}],"runtime":{"subjectType":"INVESTOR_ORGANISATION","allowUnboundStart":true}}$cq$::jsonb,
       '4946387a8cb5fb1dcbc7c5562d4caaebb753e5a859e3cc49fb260ed1d9b4e29a'
  from onboarding.definitions d
 where d.journey_type = $cq$investor$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('a254824d-7960-5b16-bbc2-3703a2344c99', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I0.investor_type$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"How do you invest?","supportingText":"This describes your organisation, not you personally.","phaseKey":"I0","options":[{"optionKey":"angel","label":"Angel investor"},{"optionKey":"vc","label":"Venture capital fund"},{"optionKey":"family_office","label":"Family office"},{"optionKey":"cvc","label":"Corporate venture"},{"optionKey":"syndicate","label":"Syndicate"},{"optionKey":"accelerator","label":"Accelerator"},{"optionKey":"scout","label":"Scout"},{"optionKey":"institutional","label":"Institutional investor"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('3ad393bc-120a-51e0-a320-c273fe06f431', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I0.organisation_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm","supportingText":"The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.","phaseKey":"I0","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.bootstrap"}]$cq$::jsonb),
  ('04b19319-a57e-5e26-8070-7dc837e03b97', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I0.business_title$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Your role there","supportingText":"Optional. A title is descriptive only; it grants no permissions.","phaseKey":"I0","minLength":1,"maxLength":120,"placeholder":"Partner, Principal, Angel"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.representative"}]$cq$::jsonb),
  ('ea3a058d-5593-524b-9652-17144a94679a', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I1.deployment_status$cq$, 3, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you deploying capital right now?","supportingText":"An operating state you can change any time.","phaseKey":"I1","options":[{"optionKey":"actively_investing","label":"Actively investing","description":"Deploying now."},{"optionKey":"selective","label":"Selective","description":"Open, but only for a strong fit."},{"optionKey":"paused","label":"Paused","description":"Not deploying at the moment."},{"optionKey":"exploring_only","label":"Exploring only","description":"Looking, not yet investing."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]$cq$::jsonb),
  ('5a6424d2-4aae-5eff-a038-9f8d295ad479', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I1.mandate_context$cq$, 4, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which mandate are we defining?","supportingText":"Most investors have one. Choose the draft to continue with; nothing is activated yet.","phaseKey":"I1","resourceType":"INVESTOR_MANDATE","vocabularyCodes":[],"minItems":1,"maxItems":1,"contextKey":"investor.mandates"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.select"}]$cq$::jsonb),
  ('24084530-4ecd-591f-b8b5-140607c84202', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.stages$cq$, 5, $cq$multi_select$cq$, true,
   $cq${"prompt":"Which stages do you invest at?","phaseKey":"I2","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('75c0d426-a151-546a-a3cb-404f12805332', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.currency$cq$, 6, $cq$single_select$cq$, true,
   $cq${"prompt":"Cheque currency","phaseKey":"I2","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('dc395e78-812e-5de5-9e85-6e5eb622ae26', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.cheque_min$cq$, 7, $cq$range$cq$, false,
   $cq${"prompt":"Minimum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('a742adae-7afc-5432-ba2c-d5cf9cf430c1', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.cheque_typical$cq$, 8, $cq$range$cq$, false,
   $cq${"prompt":"Typical cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('7a307836-9b30-56ca-b391-4aa6e5cf2930', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.cheque_max$cq$, 9, $cq$range$cq$, false,
   $cq${"prompt":"Maximum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('235c4601-650f-53c4-a478-f2dd4f2b4d1a', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I2.investment_role$cq$, 10, $cq$multi_select$cq$, false,
   $cq${"prompt":"How do you usually take part?","phaseKey":"I2","options":[{"optionKey":"lead","label":"Lead rounds"},{"optionKey":"co_invest","label":"Co-invest alongside a lead"},{"optionKey":"follow","label":"Follow in later rounds"}],"minSelections":1,"maxSelections":3,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('48c9b692-5752-59d2-89a7-5cb4f9d2c722', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I3.geography$cq$, 11, $cq$reference_select$cq$, false,
   $cq${"prompt":"Where do you invest?","supportingText":"Regions or countries. Leave empty for anywhere.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('12d693ee-6c12-57b3-b0b8-bf7203367dbe', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I3.geography_strength$cq$, 12, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.geography"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('702cb0af-fe96-54ed-af74-4b97f155ff47', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I3.sectors$cq$, 13, $cq$reference_select$cq$, false,
   $cq${"prompt":"Which sectors and product areas?","supportingText":"Suggested categories come from your own words; only what you keep is recorded.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('8a6f9132-1bbc-5aaa-802d-586666643540', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I3.sector_strength$cq$, 14, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.sectors"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('aa8d00ab-c3fb-5d33-839d-c5dc233804aa', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I3.sectors_avoid$cq$, 15, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors you'd rather not see","supportingText":"A soft preference: these can still appear. Hard exclusions come later.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('23b2d5e0-ffb1-5718-9ed2-6be63ed7a7fe', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I4.business_models$cq$, 16, $cq$reference_select$cq$, false,
   $cq${"prompt":"Business models you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["business_model"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('332800c9-7677-556e-9481-1b82e7350cc2', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I4.customer_types$cq$, 17, $cq$reference_select$cq$, false,
   $cq${"prompt":"Customer types you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["customer_type"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('cc5933ed-7883-530f-a141-71818042991d', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I4.capital_intensity$cq$, 18, $cq$single_select$cq$, false,
   $cq${"prompt":"Capital intensity","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"capital_light","label":"Prefer capital-light","description":"Recorded as a strong preference for capital-light businesses."},{"optionKey":"avoid_hardware","label":"Rather not hardware-heavy","description":"Recorded as a soft avoid; hardware companies can still appear."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('79339848-0d24-588e-9fae-deb1c0dce49c', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I4.regulatory_appetite$cq$, 19, $cq$single_select$cq$, false,
   $cq${"prompt":"Regulated markets","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"prefer_regulated","label":"Regulated markets are a plus","description":"Recorded as a strong preference."},{"optionKey":"avoid_regulated","label":"Rather not heavily regulated","description":"Recorded as a soft avoid."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('5add93e3-eb1a-5a4d-b06b-ed5e6ba00d31', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I4.revenue_state$cq$, 20, $cq$single_select$cq$, false,
   $cq${"prompt":"Revenue expectations","supportingText":"Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.","phaseKey":"I4","options":[{"optionKey":"pre_revenue_ok","label":"Pre-revenue is fine"},{"optionKey":"revenue_preferred","label":"Some revenue preferred"},{"optionKey":"revenue_required","label":"Revenue expected"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('f30b5d67-22f1-5b4d-812f-7483c1a3a352', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I5.founder_preferences$cq$, 21, $cq$multi_select$cq$, false,
   $cq${"prompt":"Founding-team capabilities that matter to you","supportingText":"Investment-relevant capabilities only. Personal characteristics are never criteria.","phaseKey":"I5","options":[{"optionKey":"technical_founding_capability","label":"Technical founding capability"},{"optionKey":"repeat_founder_experience","label":"Repeat founders"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"enterprise_sales_experience","label":"Enterprise sales experience"}],"minSelections":1,"maxSelections":4,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('7e71cffd-f883-50b0-a9eb-af38e9768030', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I5.founder_strength$cq$, 22, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I5","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I5.founder_preferences"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('93499adb-d31a-5b6b-9e38-57f86e3387b3', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I6.green_flags$cq$, 23, $cq$multi_select$cq$, false,
   $cq${"prompt":"Green flags","supportingText":"Positive signals you weigh. Recorded as strong preferences unless you change the strength.","phaseKey":"I6","options":[{"optionKey":"strong_revenue_growth","label":"Strong revenue growth"},{"optionKey":"capital_efficiency","label":"Capital efficiency"},{"optionKey":"enterprise_customers","label":"Enterprise customers"},{"optionKey":"regulatory_moat","label":"Regulatory moat"},{"optionKey":"repeat_founder","label":"Repeat founder"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"high_retention","label":"High retention"},{"optionKey":"distribution_advantage","label":"Distribution advantage"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('2e54fff2-3a35-5ba6-b0d5-2465e35cb0be', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I6.green_flag_strength$cq$, 24, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm are those?","phaseKey":"I6","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I6.green_flags"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('81dee2ee-54ce-5826-a9f7-375b79607a50', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I6.custom_criteria$cq$, 25, $cq$long_text$cq$, false,
   $cq${"prompt":"Anything else you look for?","supportingText":"In your own words. Kept for people to read; it never becomes an automatic filter.","phaseKey":"I6","minLength":1,"maxLength":1000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('c71efcc5-8609-5218-80e6-0cb2512b9a34', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I7.avoid$cq$, 26, $cq$multi_select$cq$, false,
   $cq${"prompt":"I'd rather not see","supportingText":"A soft negative: these can still appear, ranked lower. Nothing is hidden.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('0a46008b-a71d-5011-9cee-d72c505ff8cc', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I7.hard_exclusions$cq$, 27, $cq$multi_select$cq$, false,
   $cq${"prompt":"Never show me","supportingText":"A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('68a9cce0-c559-5de1-bd89-fb5eadf4a5c9', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I7.sector_exclusions$cq$, 28, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors to exclude outright","supportingText":"A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.","phaseKey":"I7","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('6ad02ca1-f8f8-586c-9320-273d8d5bf915', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I8.portfolio$cq$, 29, $cq$long_text$cq$, false,
   $cq${"prompt":"A few representative portfolio companies","supportingText":"One per line, up to five. Names only; nothing is looked up or linked.","phaseKey":"I8","minLength":1,"maxLength":1200}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.portfolio"}]$cq$::jsonb),
  ('5fd0955f-6cb9-5f62-b3d7-b3e4294e19f7', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I9.discovery_mode$cq$, 30, $cq$single_select$cq$, true,
   $cq${"prompt":"How adventurous should discovery be?","supportingText":"Hard exclusions always apply, whichever you choose.","phaseKey":"I9","options":[{"optionKey":"strict","label":"Strict","description":"Stay close to what I've explicitly said."},{"optionKey":"balanced","label":"Balanced","description":"Mostly thesis-aligned, with selective adjacent opportunities."},{"optionKey":"exploratory","label":"Exploratory","description":"Show more justified outside-thesis opportunities."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.discovery_mode"}]$cq$::jsonb),
  ('2e6afea9-2eb0-56f3-8d2c-19b8fbfa7ed2', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I10.inbound_preference$cq$, 31, $cq$single_select$cq$, true,
   $cq${"prompt":"How should founders reach you?","supportingText":"Your preference for now. Screening rules are set up later; nothing is enforced yet.","phaseKey":"I10","options":[{"optionKey":"closed","label":"Closed","description":"No unsolicited inbound."},{"optionKey":"qualified","label":"Qualified","description":"Founders may request contact once criteria you set later are met."},{"optionKey":"open","label":"Open","description":"Broader inbound accepted."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('a6d0bf57-7369-5014-a0c8-9d8b553b3cf8', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I11.additional_context$cq$, 32, $cq$long_text$cq$, false,
   $cq${"prompt":"Add something we missed","supportingText":"Optional context in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.raw_text"}]$cq$::jsonb),
  ('8d2bace8-152b-5704-81b8-4dd447600554', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I11.review$cq$, 33, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's the mandate you've defined","supportingText":"Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.","phaseKey":"I11","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"investor.review"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.confirm"}]$cq$::jsonb),
  ('800c3382-4344-5bdf-ba95-844244ba0508', 'f034f378-fd76-5fb5-a30e-2ff7ef0850de', $cq$I12.handoff$cq$, 34, $cq$confirmation$cq$, true,
   $cq${"prompt":"Your mandate is ready","supportingText":"Capital Q now has the structured criteria needed to generate your opportunities.","phaseKey":"I12","confirmLabel":"Go to Discover","requireAffirmative":true,"contextKey":"investor.handoff"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = 'f034f378-fd76-5fb5-a30e-2ff7ef0850de';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 1
 where journey_type = $cq$investor$cq$
   and (current_version is null or current_version < 1);
