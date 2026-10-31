-- Live re-check 2026-10-31 · Investor onboarding v3: "Not sure yet" on
-- whether they are deploying capital.
--
-- I1.deployment_status is required and offered four operating states only.
-- An investor said they did not know (the partners had not decided), Q
-- offered to record that, they said "Yes, please.", and with no option to
-- hold it their words were kept as the deployment status. v3 adds one
-- option, not_sure ("Not sure yet"): an answer that settles the step,
-- never a deployment state. Its write target leaves
-- core.investor_organisations.deployment_state null (unknown; the column
-- is nullable since 20260903180000), never paused or active.
--
-- v1 and v2 stay published and immutable: sessions pinned to them keep
-- their journey. Every v2 step key, branch and mapping is unchanged.
-- Additive reference data only: no table, column, grant or policy changes,
-- nothing dropped.

-- LIVE-RECHECK-1031-INVESTOR-NOT-SURE · Investor onboarding v3 (journey "investor")
-- GENERATED from packages/investor-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('07561933-eed8-55c2-86ca-adfaf2257256', $cq$investor$cq$, $cq$Investor onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select 'ea0ee364-947b-5550-a0a1-290e0636d4ca', d.id, 3,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"I0","label":"Role"},{"phaseKey":"I1","label":"Deployment"},{"phaseKey":"I2","label":"Stage and cheque"},{"phaseKey":"I3","label":"Geography and sectors"},{"phaseKey":"I4","label":"Business attributes"},{"phaseKey":"I5","label":"Founding team"},{"phaseKey":"I6","label":"Green flags"},{"phaseKey":"I7","label":"Red flags"},{"phaseKey":"I8","label":"Portfolio"},{"phaseKey":"I9","label":"Discovery style"},{"phaseKey":"I10","label":"Inbound"},{"phaseKey":"I11","label":"Review"},{"phaseKey":"I12","label":"Handoff"}],"runtime":{"subjectType":"INVESTOR_ORGANISATION","allowUnboundStart":true}}$cq$::jsonb,
       'fc19cb3ae5326c875afd17abbc33514b8a65eb6b4edf07424372b334fad1136c'
  from onboarding.definitions d
 where d.journey_type = $cq$investor$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('59eafd6b-ed4f-5b3c-ab9c-b4d5b5a22767', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I0.investor_type$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"How do you invest?","supportingText":"This describes your organisation, not you personally.","phaseKey":"I0","options":[{"optionKey":"angel","label":"Angel investor"},{"optionKey":"vc","label":"Venture capital fund"},{"optionKey":"family_office","label":"Family office"},{"optionKey":"cvc","label":"Corporate venture"},{"optionKey":"syndicate","label":"Syndicate"},{"optionKey":"accelerator","label":"Accelerator"},{"optionKey":"scout","label":"Scout"},{"optionKey":"institutional","label":"Institutional investor"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('4840bdfd-701a-51fa-9928-ee69866fcf4d', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I0.organisation_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm","supportingText":"The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.","phaseKey":"I0","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.bootstrap"}]$cq$::jsonb),
  ('8e19173b-b0c3-5e1d-8919-54b5305840af', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I0.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Your firm's website","supportingText":"Optional. Founders can see who you are before they reply.","phaseKey":"I0","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.website"}]$cq$::jsonb),
  ('ea786e4a-546d-55f5-8ba4-b92139394e3a', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I0.business_title$cq$, 3, $cq$short_text$cq$, false,
   $cq${"prompt":"Your role there","supportingText":"Optional. A title is descriptive only; it grants no permissions.","phaseKey":"I0","minLength":1,"maxLength":120,"placeholder":"Partner, Principal, Angel"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.representative"}]$cq$::jsonb),
  ('7a279114-7bed-5ad5-80d8-7cbafdf17297', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I1.deployment_status$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you deploying capital right now?","supportingText":"An operating state you can change any time.","phaseKey":"I1","options":[{"optionKey":"actively_investing","label":"Actively investing","description":"Deploying now."},{"optionKey":"selective","label":"Selective","description":"Open, but only for a strong fit."},{"optionKey":"paused","label":"Paused","description":"Not deploying at the moment."},{"optionKey":"exploring_only","label":"Exploring only","description":"Looking, not yet investing."},{"optionKey":"not_sure","label":"Not sure yet","description":"Not decided; change it any time."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]$cq$::jsonb),
  ('c46511a1-102f-5f54-ae5d-0fa619e578aa', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I1.mandate_context$cq$, 5, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which mandate are we defining?","supportingText":"Most investors have one. Choose the draft to continue with; nothing is activated yet.","phaseKey":"I1","resourceType":"INVESTOR_MANDATE","vocabularyCodes":[],"minItems":1,"maxItems":1,"contextKey":"investor.mandates"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.select"}]$cq$::jsonb),
  ('5ff7997d-8281-5769-a937-815508464836', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.stages$cq$, 6, $cq$multi_select$cq$, true,
   $cq${"prompt":"Which stages do you invest at?","phaseKey":"I2","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('4ba1ee33-f2ae-5f4f-90c4-d88445b833d8', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.currency$cq$, 7, $cq$single_select$cq$, true,
   $cq${"prompt":"Cheque currency","phaseKey":"I2","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('38459f44-7e4f-5b20-972e-6b59577679ce', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.cheque_min$cq$, 8, $cq$range$cq$, false,
   $cq${"prompt":"Minimum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('9fa5a1a7-947e-5344-a6e7-ed318c71b013', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.cheque_typical$cq$, 9, $cq$range$cq$, false,
   $cq${"prompt":"Typical cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('1d31d266-4327-59bb-8d17-969cbef7b320', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.cheque_max$cq$, 10, $cq$range$cq$, false,
   $cq${"prompt":"Maximum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('c41b478b-dc14-5b7a-8f28-210e6a161196', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I2.investment_role$cq$, 11, $cq$multi_select$cq$, false,
   $cq${"prompt":"How do you usually take part?","phaseKey":"I2","options":[{"optionKey":"lead","label":"Lead rounds"},{"optionKey":"co_invest","label":"Co-invest alongside a lead"},{"optionKey":"follow","label":"Follow in later rounds"}],"minSelections":1,"maxSelections":3,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('da71ff4d-ce8d-501c-bc30-efe8c2649be9', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I3.geography$cq$, 12, $cq$reference_select$cq$, false,
   $cq${"prompt":"Where do you invest?","supportingText":"Regions or countries. Leave empty for anywhere.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('9f07637c-7fab-5365-8aa4-3db3d4049769', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I3.geography_strength$cq$, 13, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.geography"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('6106049b-5430-52ec-858a-f4c3ca2e2f7d', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I3.sectors$cq$, 14, $cq$reference_select$cq$, false,
   $cq${"prompt":"Which sectors and product areas?","supportingText":"Suggested categories come from your own words; only what you keep is recorded.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('549911fa-0bca-57eb-80f2-aea1d00a3e3f', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I3.sector_strength$cq$, 15, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.sectors"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('54ceebf2-681b-530e-ba8d-146cb132000b', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I3.sectors_avoid$cq$, 16, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors you'd rather not see","supportingText":"A soft preference: these can still appear. Hard exclusions come later.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('4b2232a4-d825-56e9-9d0d-2f531a04531e', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I4.business_models$cq$, 17, $cq$reference_select$cq$, false,
   $cq${"prompt":"Business models you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["business_model"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('1dd328f9-f00e-5198-ae93-bf8d83e28f73', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I4.customer_types$cq$, 18, $cq$reference_select$cq$, false,
   $cq${"prompt":"Customer types you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["customer_type"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('32bdbf36-6b76-5f46-a9c2-324bb42b8557', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I4.capital_intensity$cq$, 19, $cq$single_select$cq$, false,
   $cq${"prompt":"Capital intensity","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"capital_light","label":"Prefer capital-light","description":"Recorded as a strong preference for capital-light businesses."},{"optionKey":"avoid_hardware","label":"Rather not hardware-heavy","description":"Recorded as a soft avoid; hardware companies can still appear."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('2d09804a-5159-587b-8333-3d29d821e38e', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I4.regulatory_appetite$cq$, 20, $cq$single_select$cq$, false,
   $cq${"prompt":"Regulated markets","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"prefer_regulated","label":"Regulated markets are a plus","description":"Recorded as a strong preference."},{"optionKey":"avoid_regulated","label":"Rather not heavily regulated","description":"Recorded as a soft avoid."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('256b4bf1-d9c8-5e73-8136-ef132fd62cc9', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I4.revenue_state$cq$, 21, $cq$single_select$cq$, false,
   $cq${"prompt":"Revenue expectations","supportingText":"Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.","phaseKey":"I4","options":[{"optionKey":"pre_revenue_ok","label":"Pre-revenue is fine"},{"optionKey":"revenue_preferred","label":"Some revenue preferred"},{"optionKey":"revenue_required","label":"Revenue expected"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('512558eb-734d-513e-839e-36d3ba5e6158', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I5.founder_preferences$cq$, 22, $cq$multi_select$cq$, false,
   $cq${"prompt":"Founding-team capabilities that matter to you","supportingText":"Investment-relevant capabilities only. Personal characteristics are never criteria.","phaseKey":"I5","options":[{"optionKey":"technical_founding_capability","label":"Technical founding capability"},{"optionKey":"repeat_founder_experience","label":"Repeat founders"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"enterprise_sales_experience","label":"Enterprise sales experience"}],"minSelections":1,"maxSelections":4,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('b212295c-daa1-59e9-817f-e308a13e6089', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I5.founder_strength$cq$, 23, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I5","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I5.founder_preferences"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('b925c186-ea79-5315-acf0-bda487c8bd48', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I6.green_flags$cq$, 24, $cq$multi_select$cq$, false,
   $cq${"prompt":"Green flags","supportingText":"Positive signals you weigh. Recorded as strong preferences unless you change the strength.","phaseKey":"I6","options":[{"optionKey":"strong_revenue_growth","label":"Strong revenue growth"},{"optionKey":"capital_efficiency","label":"Capital efficiency"},{"optionKey":"enterprise_customers","label":"Enterprise customers"},{"optionKey":"regulatory_moat","label":"Regulatory moat"},{"optionKey":"repeat_founder","label":"Repeat founder"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"high_retention","label":"High retention"},{"optionKey":"distribution_advantage","label":"Distribution advantage"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('a6b9d098-d199-5c0c-8f64-1a4bcee3882c', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I6.green_flag_strength$cq$, 25, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm are those?","phaseKey":"I6","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I6.green_flags"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('9a519443-61f6-59ba-b435-3128d0976aa0', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I6.custom_criteria$cq$, 26, $cq$long_text$cq$, false,
   $cq${"prompt":"Anything else you look for?","supportingText":"In your own words. Kept for people to read; it never becomes an automatic filter.","phaseKey":"I6","minLength":1,"maxLength":1000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('3893c22f-2f75-5012-9a31-9c5ababe6ed8', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I7.avoid$cq$, 27, $cq$multi_select$cq$, false,
   $cq${"prompt":"I'd rather not see","supportingText":"A soft negative: these can still appear, ranked lower. Nothing is hidden.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('08b2b764-9f45-5202-a943-6b32a14ed94e', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I7.hard_exclusions$cq$, 28, $cq$multi_select$cq$, false,
   $cq${"prompt":"Never show me","supportingText":"A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('460fde75-a340-5bd2-9db5-d863fc5e11ca', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I7.sector_exclusions$cq$, 29, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors to exclude outright","supportingText":"A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.","phaseKey":"I7","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('c0852990-6d88-5f16-a49c-191e8f1bef29', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I8.portfolio$cq$, 30, $cq$long_text$cq$, false,
   $cq${"prompt":"A few representative portfolio companies","supportingText":"One per line, up to five. Names only; nothing is looked up or linked.","phaseKey":"I8","minLength":1,"maxLength":1200}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.portfolio"}]$cq$::jsonb),
  ('0194cc2a-30b2-5517-a78d-d4738454cc23', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I9.discovery_mode$cq$, 31, $cq$single_select$cq$, true,
   $cq${"prompt":"How adventurous should discovery be?","supportingText":"Hard exclusions always apply, whichever you choose.","phaseKey":"I9","options":[{"optionKey":"strict","label":"Strict","description":"Stay close to what I've explicitly said."},{"optionKey":"balanced","label":"Balanced","description":"Mostly thesis-aligned, with selective adjacent opportunities."},{"optionKey":"exploratory","label":"Exploratory","description":"Show more justified outside-thesis opportunities."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.discovery_mode"}]$cq$::jsonb),
  ('acd323ab-5e91-5314-8a5e-c8fab5760945', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I10.inbound_preference$cq$, 32, $cq$single_select$cq$, true,
   $cq${"prompt":"How should founders reach you?","supportingText":"Your preference for now. Screening rules are set up later; nothing is enforced yet.","phaseKey":"I10","options":[{"optionKey":"closed","label":"Closed","description":"No unsolicited inbound."},{"optionKey":"qualified","label":"Qualified","description":"Founders may request contact once criteria you set later are met."},{"optionKey":"open","label":"Open","description":"Broader inbound accepted."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('cd9c505c-01ff-535a-b80d-4c8e44f95863', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I11.additional_context$cq$, 33, $cq$long_text$cq$, false,
   $cq${"prompt":"Add something we missed","supportingText":"Optional context in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.raw_text"}]$cq$::jsonb),
  ('f0bdd556-6300-52dc-9fdf-aa90f162599c', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I11.review$cq$, 34, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's the mandate you've defined","supportingText":"Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.","phaseKey":"I11","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"investor.review"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.confirm"}]$cq$::jsonb),
  ('fa762762-00c3-5684-a995-712708f7af05', 'ea0ee364-947b-5550-a0a1-290e0636d4ca', $cq$I12.handoff$cq$, 35, $cq$confirmation$cq$, true,
   $cq${"prompt":"Your mandate is ready","supportingText":"Capital Q now has the structured criteria needed to generate your opportunities.","phaseKey":"I12","confirmLabel":"Go to Discover","requireAffirmative":true,"contextKey":"investor.handoff"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = 'ea0ee364-947b-5550-a0a1-290e0636d4ca';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 3
 where journey_type = $cq$investor$cq$
   and (current_version is null or current_version < 3);
