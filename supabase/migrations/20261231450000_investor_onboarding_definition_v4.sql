-- Owner 2026-11-07 (DECISIONS 79) · Investor onboarding v4: the mandatory
-- set and the firm's headquarters country.
--
-- New, required: I0.hq_country, after the website: one geography node that
-- is a country (like founder F1.country v8). It writes only
-- core.investor_organisations.hq_country, which KYB jurisdiction and
-- founder-side ranking already read; no step asked it before.
-- Now required: I0.website, I0.business_title, I2.cheque_min,
-- I2.cheque_typical, I2.cheque_max, I2.investment_role, I3.geography and
-- I3.sectors. Now optional: I9.discovery_mode (nothing ranks on it).
-- "I don't know" answers every required step and is recorded as unknown
-- (the runtime's isNotKnownAnswer), never as a value.
--
-- v3 (and v1-v2) stay published and immutable: sessions pinned to them keep
-- running them. Every other step key, type, branch and write target is as
-- in v3. Additive only: no table, column, grant or policy changes, and
-- nothing is dropped.

-- OWNER-MANDATORY-SET · Investor onboarding v4 (journey "investor")
-- GENERATED from packages/investor-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('07561933-eed8-55c2-86ca-adfaf2257256', $cq$investor$cq$, $cq$Investor onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', d.id, 4,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"I0","label":"Role"},{"phaseKey":"I1","label":"Deployment"},{"phaseKey":"I2","label":"Stage and cheque"},{"phaseKey":"I3","label":"Geography and sectors"},{"phaseKey":"I4","label":"Business attributes"},{"phaseKey":"I5","label":"Founding team"},{"phaseKey":"I6","label":"Green flags"},{"phaseKey":"I7","label":"Red flags"},{"phaseKey":"I8","label":"Portfolio"},{"phaseKey":"I9","label":"Discovery style"},{"phaseKey":"I10","label":"Inbound"},{"phaseKey":"I11","label":"Review"},{"phaseKey":"I12","label":"Handoff"}],"runtime":{"subjectType":"INVESTOR_ORGANISATION","allowUnboundStart":true}}$cq$::jsonb,
       '04f350819e45929aa67d5f0955a84c090694b2c04074608ca552dcd998eee688'
  from onboarding.definitions d
 where d.journey_type = $cq$investor$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('a865889e-6c4e-55dc-b46b-6fbb6567ada8', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I0.investor_type$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"How do you invest?","supportingText":"This describes your organisation, not you personally.","phaseKey":"I0","options":[{"optionKey":"angel","label":"Angel investor"},{"optionKey":"vc","label":"Venture capital fund"},{"optionKey":"family_office","label":"Family office"},{"optionKey":"cvc","label":"Corporate venture"},{"optionKey":"syndicate","label":"Syndicate"},{"optionKey":"accelerator","label":"Accelerator"},{"optionKey":"scout","label":"Scout"},{"optionKey":"institutional","label":"Institutional investor"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('8b57478b-566f-5a2e-9589-1fa1ad1b7ca3', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I0.organisation_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm","supportingText":"The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.","phaseKey":"I0","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.bootstrap"}]$cq$::jsonb),
  ('32ee73d5-0bbf-549c-a608-3e06bb4b7fd4', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I0.website$cq$, 2, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm's website","supportingText":"Founders can see who you are before they reply. No website yet? Say so; that's an answer.","phaseKey":"I0","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.website"}]$cq$::jsonb),
  ('8c796ee6-1ba7-52b0-8a59-d4155b496a52', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I0.hq_country$cq$, 3, $cq$reference_select$cq$, true,
   $cq${"prompt":"Where is your firm based?","supportingText":"The country of its headquarters.","phaseKey":"I0","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":1}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.hq_country"}]$cq$::jsonb),
  ('49dd336c-3751-543a-9f05-ddd76c7de6e4', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I0.business_title$cq$, 4, $cq$short_text$cq$, true,
   $cq${"prompt":"Your role there","supportingText":"A title is descriptive only; it grants no permissions.","phaseKey":"I0","minLength":1,"maxLength":120,"placeholder":"Partner, Principal, Angel"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.representative"}]$cq$::jsonb),
  ('c324bb22-a894-5160-b68a-d7a6195503f3', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I1.deployment_status$cq$, 5, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you deploying capital right now?","supportingText":"An operating state you can change any time.","phaseKey":"I1","options":[{"optionKey":"actively_investing","label":"Actively investing","description":"Deploying now."},{"optionKey":"selective","label":"Selective","description":"Open, but only for a strong fit."},{"optionKey":"paused","label":"Paused","description":"Not deploying at the moment."},{"optionKey":"exploring_only","label":"Exploring only","description":"Looking, not yet investing."},{"optionKey":"not_sure","label":"Not sure yet","description":"Not decided; change it any time."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]$cq$::jsonb),
  ('33d0f230-3db7-5d85-acd8-0c1b668f6b93', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I1.mandate_context$cq$, 6, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which mandate are we defining?","supportingText":"Most investors have one. Choose the draft to continue with; nothing is activated yet.","phaseKey":"I1","resourceType":"INVESTOR_MANDATE","vocabularyCodes":[],"minItems":1,"maxItems":1,"contextKey":"investor.mandates"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.select"}]$cq$::jsonb),
  ('1a77daf0-307e-5633-afe5-3d86d2357b2b', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.stages$cq$, 7, $cq$multi_select$cq$, true,
   $cq${"prompt":"Which stages do you invest at?","phaseKey":"I2","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('4fb0910e-d11f-5b91-9be9-aabf99ffa57e', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.currency$cq$, 8, $cq$single_select$cq$, true,
   $cq${"prompt":"Cheque currency","phaseKey":"I2","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('182d145d-140b-59be-9656-1d65b2f3ad44', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.cheque_min$cq$, 9, $cq$range$cq$, true,
   $cq${"prompt":"Minimum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('faa8edaf-b2d7-5459-82a2-ca556661f0a4', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.cheque_typical$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"Typical cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('aef257ba-7b31-5090-b035-f4860c23e3d0', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.cheque_max$cq$, 11, $cq$range$cq$, true,
   $cq${"prompt":"Maximum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('54063d36-9c7d-52a4-9267-92a83f5be71a', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I2.investment_role$cq$, 12, $cq$multi_select$cq$, true,
   $cq${"prompt":"How do you usually take part?","phaseKey":"I2","options":[{"optionKey":"lead","label":"Lead rounds"},{"optionKey":"co_invest","label":"Co-invest alongside a lead"},{"optionKey":"follow","label":"Follow in later rounds"}],"minSelections":1,"maxSelections":3,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('98000ea3-37fe-5fe4-9c8d-63bdedd43ba0', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I3.geography$cq$, 13, $cq$reference_select$cq$, true,
   $cq${"prompt":"Where do you invest?","supportingText":"Regions or countries, or anywhere.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('ddf9aa99-5002-5a78-97f8-49e65e9b721a', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I3.geography_strength$cq$, 14, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.geography"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('059ed52b-e7f7-5b2f-bb07-eff8746a5cd2', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I3.sectors$cq$, 15, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which sectors and product areas?","supportingText":"Suggested categories come from your own words; only what you keep is recorded.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('14539c44-2611-5706-9598-ef764c231c21', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I3.sector_strength$cq$, 16, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.sectors"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('a500e3c0-bbc0-5904-b4d4-9d091c56aa8c', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I3.sectors_avoid$cq$, 17, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors you'd rather not see","supportingText":"A soft preference: these can still appear. Hard exclusions come later.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('15f2dd18-3785-5d59-af84-3706418b0af4', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I4.business_models$cq$, 18, $cq$reference_select$cq$, false,
   $cq${"prompt":"Business models you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["business_model"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('7eb9ae18-330e-502e-a079-95a9c8d65105', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I4.customer_types$cq$, 19, $cq$reference_select$cq$, false,
   $cq${"prompt":"Customer types you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["customer_type"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('17f4113e-ac4d-5360-97e7-b752ab1c392c', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I4.capital_intensity$cq$, 20, $cq$single_select$cq$, false,
   $cq${"prompt":"Capital intensity","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"capital_light","label":"Prefer capital-light","description":"Recorded as a strong preference for capital-light businesses."},{"optionKey":"avoid_hardware","label":"Rather not hardware-heavy","description":"Recorded as a soft avoid; hardware companies can still appear."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('7e521fa4-8684-5187-b45f-1b9fedfb495e', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I4.regulatory_appetite$cq$, 21, $cq$single_select$cq$, false,
   $cq${"prompt":"Regulated markets","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"prefer_regulated","label":"Regulated markets are a plus","description":"Recorded as a strong preference."},{"optionKey":"avoid_regulated","label":"Rather not heavily regulated","description":"Recorded as a soft avoid."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('506f66e6-4adc-5a3d-88de-856c24939648', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I4.revenue_state$cq$, 22, $cq$single_select$cq$, false,
   $cq${"prompt":"Revenue expectations","supportingText":"Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.","phaseKey":"I4","options":[{"optionKey":"pre_revenue_ok","label":"Pre-revenue is fine"},{"optionKey":"revenue_preferred","label":"Some revenue preferred"},{"optionKey":"revenue_required","label":"Revenue expected"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('e73870eb-3541-532a-bba2-808a261cdfa8', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I5.founder_preferences$cq$, 23, $cq$multi_select$cq$, false,
   $cq${"prompt":"Founding-team capabilities that matter to you","supportingText":"Investment-relevant capabilities only. Personal characteristics are never criteria.","phaseKey":"I5","options":[{"optionKey":"technical_founding_capability","label":"Technical founding capability"},{"optionKey":"repeat_founder_experience","label":"Repeat founders"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"enterprise_sales_experience","label":"Enterprise sales experience"}],"minSelections":1,"maxSelections":4,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('bd0ee223-b102-5b2e-a70d-eed60daa3b72', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I5.founder_strength$cq$, 24, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I5","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I5.founder_preferences"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('a1c942cf-631d-5b94-ba11-43930ada66b6', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I6.green_flags$cq$, 25, $cq$multi_select$cq$, false,
   $cq${"prompt":"Green flags","supportingText":"Positive signals you weigh. Recorded as strong preferences unless you change the strength.","phaseKey":"I6","options":[{"optionKey":"strong_revenue_growth","label":"Strong revenue growth"},{"optionKey":"capital_efficiency","label":"Capital efficiency"},{"optionKey":"enterprise_customers","label":"Enterprise customers"},{"optionKey":"regulatory_moat","label":"Regulatory moat"},{"optionKey":"repeat_founder","label":"Repeat founder"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"high_retention","label":"High retention"},{"optionKey":"distribution_advantage","label":"Distribution advantage"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('0b55037f-a136-513e-bf51-bd554f5ac678', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I6.green_flag_strength$cq$, 26, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm are those?","phaseKey":"I6","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I6.green_flags"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('982403ca-f42b-5890-8c38-4c3d7d6e350d', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I6.custom_criteria$cq$, 27, $cq$long_text$cq$, false,
   $cq${"prompt":"Anything else you look for?","supportingText":"In your own words. Kept for people to read; it never becomes an automatic filter.","phaseKey":"I6","minLength":1,"maxLength":1000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('e64f8659-c0e0-51a5-a537-c8b77a115a90', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I7.avoid$cq$, 28, $cq$multi_select$cq$, false,
   $cq${"prompt":"I'd rather not see","supportingText":"A soft negative: these can still appear, ranked lower. Nothing is hidden.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('34bca485-5860-5c16-b347-d23a8e257eb1', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I7.hard_exclusions$cq$, 29, $cq$multi_select$cq$, false,
   $cq${"prompt":"Never show me","supportingText":"A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('ecf39696-d078-5313-bc75-5120b1ce0828', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I7.sector_exclusions$cq$, 30, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors to exclude outright","supportingText":"A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.","phaseKey":"I7","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('d2273188-784b-59c7-be66-541951f05c1b', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I8.portfolio$cq$, 31, $cq$long_text$cq$, false,
   $cq${"prompt":"A few representative portfolio companies","supportingText":"One per line, up to five. Names only; nothing is looked up or linked.","phaseKey":"I8","minLength":1,"maxLength":1200}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.portfolio"}]$cq$::jsonb),
  ('321d3d0c-6b45-504d-8e93-a667d397b492', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I9.discovery_mode$cq$, 32, $cq$single_select$cq$, false,
   $cq${"prompt":"How adventurous should discovery be?","supportingText":"Hard exclusions always apply, whichever you choose.","phaseKey":"I9","options":[{"optionKey":"strict","label":"Strict","description":"Stay close to what I've explicitly said."},{"optionKey":"balanced","label":"Balanced","description":"Mostly thesis-aligned, with selective adjacent opportunities."},{"optionKey":"exploratory","label":"Exploratory","description":"Show more justified outside-thesis opportunities."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.discovery_mode"}]$cq$::jsonb),
  ('3bd29165-40fd-5ac1-9b77-ea03c2c3af30', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I10.inbound_preference$cq$, 33, $cq$single_select$cq$, true,
   $cq${"prompt":"How should founders reach you?","supportingText":"Your preference for now. Screening rules are set up later; nothing is enforced yet.","phaseKey":"I10","options":[{"optionKey":"closed","label":"Closed","description":"No unsolicited inbound."},{"optionKey":"qualified","label":"Qualified","description":"Founders may request contact once criteria you set later are met."},{"optionKey":"open","label":"Open","description":"Broader inbound accepted."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('f8366881-8570-5c54-97a8-2a0d9ef0b2c9', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I11.additional_context$cq$, 34, $cq$long_text$cq$, false,
   $cq${"prompt":"Add something we missed","supportingText":"Optional context in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.raw_text"}]$cq$::jsonb),
  ('a34aa201-7625-5dd3-b60c-e5840000c75d', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I11.review$cq$, 35, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's the mandate you've defined","supportingText":"Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.","phaseKey":"I11","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"investor.review"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.confirm"}]$cq$::jsonb),
  ('9c0dc915-2b60-56eb-896f-afa2bb0bb9d0', '1e6324de-26ea-53f7-8cb3-ed3e418d34e3', $cq$I12.handoff$cq$, 36, $cq$confirmation$cq$, true,
   $cq${"prompt":"Your mandate is ready","supportingText":"Capital Q now has the structured criteria needed to generate your opportunities.","phaseKey":"I12","confirmLabel":"Go to Discover","requireAffirmative":true,"contextKey":"investor.handoff"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = '1e6324de-26ea-53f7-8cb3-ed3e418d34e3';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 4
 where journey_type = $cq$investor$cq$
   and (current_version is null or current_version < 4);
