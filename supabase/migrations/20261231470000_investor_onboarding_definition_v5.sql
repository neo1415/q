-- DECISIONS 79, batch 7 (integration owner's audit decisions, 2026-11-07) ·
-- Investor onboarding v5: every field the profile shows is mandatory.
--
-- New, required: I11.public_description (the firm's description as the
-- profile shows it), just before the thesis. It writes only
-- core.investor_organisations.public_description; Q drafts it from the
-- mandate for their yes.
-- Now required: every preference list the profile and mandate show (the
-- focus strengths, sectors to avoid, business models, customer types,
-- capital intensity, regulated markets, revenue, founder fit and its
-- strength, green flags and their strength, what else they look for, what
-- they'd rather not see, what is never shown, excluded sectors, portfolio
-- and the thesis). "None" answers each list and holds no value (the
-- runtime's NONE_ANSWER_TEXT); "I don't know" stays an answer. The
-- discovery style stays optional.
--
-- v4 (and v1-v3) stay published and immutable: sessions pinned to them keep
-- running them. Every other step key, type, branch and write target is as
-- in v4. Additive only: no table, column, grant or policy changes, and
-- nothing is dropped.

-- OWNER-PROFILE-FIELDS · Investor onboarding v5 (journey "investor")
-- GENERATED from packages/investor-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('07561933-eed8-55c2-86ca-adfaf2257256', $cq$investor$cq$, $cq$Investor onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select '30d76dc6-3151-5ebc-9c28-3a4b483fa445', d.id, 5,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"I0","label":"Role"},{"phaseKey":"I1","label":"Deployment"},{"phaseKey":"I2","label":"Stage and cheque"},{"phaseKey":"I3","label":"Geography and sectors"},{"phaseKey":"I4","label":"Business attributes"},{"phaseKey":"I5","label":"Founding team"},{"phaseKey":"I6","label":"Green flags"},{"phaseKey":"I7","label":"Red flags"},{"phaseKey":"I8","label":"Portfolio"},{"phaseKey":"I9","label":"Discovery style"},{"phaseKey":"I10","label":"Inbound"},{"phaseKey":"I11","label":"Review"},{"phaseKey":"I12","label":"Handoff"}],"runtime":{"subjectType":"INVESTOR_ORGANISATION","allowUnboundStart":true}}$cq$::jsonb,
       'c83c83d7248978c8b325e89d7538515ec42a48cc0e89adb39f619b9f877b04a4'
  from onboarding.definitions d
 where d.journey_type = $cq$investor$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('cc91bf7b-c5e9-599c-a0b1-711710bee003', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I0.investor_type$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"How do you invest?","supportingText":"This describes your organisation, not you personally.","phaseKey":"I0","options":[{"optionKey":"angel","label":"Angel investor"},{"optionKey":"vc","label":"Venture capital fund"},{"optionKey":"family_office","label":"Family office"},{"optionKey":"cvc","label":"Corporate venture"},{"optionKey":"syndicate","label":"Syndicate"},{"optionKey":"accelerator","label":"Accelerator"},{"optionKey":"scout","label":"Scout"},{"optionKey":"institutional","label":"Institutional investor"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('0a74b304-1192-5c69-9d91-e8e664ccdc7e', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I0.organisation_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm","supportingText":"The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.","phaseKey":"I0","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.bootstrap"}]$cq$::jsonb),
  ('42cd4923-fa05-5a84-b6f5-dc010c435d08', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I0.website$cq$, 2, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm's website","supportingText":"Founders can see who you are before they reply. No website yet? Say so; that's an answer.","phaseKey":"I0","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.website"}]$cq$::jsonb),
  ('32b1636c-d095-599f-9110-5d93aca938c0', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I0.business_title$cq$, 3, $cq$short_text$cq$, true,
   $cq${"prompt":"Your role there","supportingText":"A title is descriptive only; it grants no permissions.","phaseKey":"I0","minLength":1,"maxLength":120,"placeholder":"Partner, Principal, Angel"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.representative"}]$cq$::jsonb),
  ('f162b467-660a-5b7e-be02-9c01ab857941', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I0.hq_country$cq$, 4, $cq$reference_select$cq$, true,
   $cq${"prompt":"Where is your firm based?","supportingText":"The country of its headquarters.","phaseKey":"I0","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":1}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.hq_country"}]$cq$::jsonb),
  ('ce047735-fc98-5621-a09b-709b0057566d', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I1.deployment_status$cq$, 5, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you deploying capital right now?","supportingText":"An operating state you can change any time.","phaseKey":"I1","options":[{"optionKey":"actively_investing","label":"Actively investing","description":"Deploying now."},{"optionKey":"selective","label":"Selective","description":"Open, but only for a strong fit."},{"optionKey":"paused","label":"Paused","description":"Not deploying at the moment."},{"optionKey":"exploring_only","label":"Exploring only","description":"Looking, not yet investing."},{"optionKey":"not_sure","label":"Not sure yet","description":"Not decided; change it any time."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]$cq$::jsonb),
  ('e523abd6-7a79-5193-9b20-cefd44b64ec4', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I1.mandate_context$cq$, 6, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which mandate are we defining?","supportingText":"Most investors have one. Choose the draft to continue with; nothing is activated yet.","phaseKey":"I1","resourceType":"INVESTOR_MANDATE","vocabularyCodes":[],"minItems":1,"maxItems":1,"contextKey":"investor.mandates"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.select"}]$cq$::jsonb),
  ('13a0b39f-4d43-5286-bf93-0c340c029ea2', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.stages$cq$, 7, $cq$multi_select$cq$, true,
   $cq${"prompt":"Which stages do you invest at?","phaseKey":"I2","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('af30ad83-fccc-5f70-8552-54b03a1c1591', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.currency$cq$, 8, $cq$single_select$cq$, true,
   $cq${"prompt":"Cheque currency","phaseKey":"I2","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('e9cc1eb1-dc1e-5de4-9c76-e6be4b85ee9e', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.cheque_min$cq$, 9, $cq$range$cq$, true,
   $cq${"prompt":"Minimum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('c0e0802d-18b5-5b41-81fd-f50813858e2f', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.cheque_typical$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"Typical cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('6e36132c-0953-59bf-aea5-c0ad4a241ff9', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.cheque_max$cq$, 11, $cq$range$cq$, true,
   $cq${"prompt":"Maximum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('4c85cb5e-7edb-5a22-8ee8-467bafd9134f', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I2.investment_role$cq$, 12, $cq$multi_select$cq$, true,
   $cq${"prompt":"How do you usually take part?","phaseKey":"I2","options":[{"optionKey":"lead","label":"Lead rounds"},{"optionKey":"co_invest","label":"Co-invest alongside a lead"},{"optionKey":"follow","label":"Follow in later rounds"}],"minSelections":1,"maxSelections":3,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('96810688-1c29-58dd-a2fb-4d1152651212', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I3.geography$cq$, 13, $cq$reference_select$cq$, true,
   $cq${"prompt":"Where do you invest?","supportingText":"Regions or countries, or anywhere.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('cb75a742-a7e6-541a-b2f8-3fdbe643b0d2', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I3.geography_strength$cq$, 14, $cq$single_select$cq$, true,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.geography"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('266bc9bb-76c7-5b51-af24-8d44e67c7288', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I3.sectors$cq$, 15, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which sectors and product areas?","supportingText":"Suggested categories come from your own words; only what you keep is recorded.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('6dac0618-e218-585f-a491-2c1055cd790a', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I3.sector_strength$cq$, 16, $cq$single_select$cq$, true,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.sectors"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('8f67de1b-93a0-5486-ab86-46cbda0c5bc3', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I3.sectors_avoid$cq$, 17, $cq$reference_select$cq$, true,
   $cq${"prompt":"Sectors you'd rather not see","supportingText":"A soft preference: these can still appear. Hard exclusions come later.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('e816aeea-0eec-54e9-a61a-280fd545c932', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I4.business_models$cq$, 18, $cq$reference_select$cq$, true,
   $cq${"prompt":"Business models you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["business_model"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('888b1ee5-42fb-5b24-a69a-4c3da58ec4ca', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I4.customer_types$cq$, 19, $cq$reference_select$cq$, true,
   $cq${"prompt":"Customer types you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["customer_type"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('70b67676-5161-5c9e-98c1-eefee1eb68ac', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I4.capital_intensity$cq$, 20, $cq$single_select$cq$, true,
   $cq${"prompt":"Capital intensity","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"capital_light","label":"Prefer capital-light","description":"Recorded as a strong preference for capital-light businesses."},{"optionKey":"avoid_hardware","label":"Rather not hardware-heavy","description":"Recorded as a soft avoid; hardware companies can still appear."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('cf3b87a4-aa2d-5917-87f0-6cc71a9a0e66', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I4.regulatory_appetite$cq$, 21, $cq$single_select$cq$, true,
   $cq${"prompt":"Regulated markets","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"prefer_regulated","label":"Regulated markets are a plus","description":"Recorded as a strong preference."},{"optionKey":"avoid_regulated","label":"Rather not heavily regulated","description":"Recorded as a soft avoid."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('b2bd30da-5f65-5968-8295-d36f5a0542a4', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I4.revenue_state$cq$, 22, $cq$single_select$cq$, true,
   $cq${"prompt":"Revenue expectations","supportingText":"Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.","phaseKey":"I4","options":[{"optionKey":"pre_revenue_ok","label":"Pre-revenue is fine"},{"optionKey":"revenue_preferred","label":"Some revenue preferred"},{"optionKey":"revenue_required","label":"Revenue expected"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('de4cec52-c0a2-56cd-89c7-fe253c4f2c7d', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I5.founder_preferences$cq$, 23, $cq$multi_select$cq$, true,
   $cq${"prompt":"Founding-team capabilities that matter to you","supportingText":"Investment-relevant capabilities only. Personal characteristics are never criteria.","phaseKey":"I5","options":[{"optionKey":"technical_founding_capability","label":"Technical founding capability"},{"optionKey":"repeat_founder_experience","label":"Repeat founders"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"enterprise_sales_experience","label":"Enterprise sales experience"}],"minSelections":1,"maxSelections":4,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('c049513f-dfd3-5f20-b2da-440442cc921b', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I5.founder_strength$cq$, 24, $cq$single_select$cq$, true,
   $cq${"prompt":"How firm is that?","phaseKey":"I5","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I5.founder_preferences"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('d9d08b5f-beed-574f-83b0-c43c001d1833', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I6.green_flags$cq$, 25, $cq$multi_select$cq$, true,
   $cq${"prompt":"Green flags","supportingText":"Positive signals you weigh. Recorded as strong preferences unless you change the strength.","phaseKey":"I6","options":[{"optionKey":"strong_revenue_growth","label":"Strong revenue growth"},{"optionKey":"capital_efficiency","label":"Capital efficiency"},{"optionKey":"enterprise_customers","label":"Enterprise customers"},{"optionKey":"regulatory_moat","label":"Regulatory moat"},{"optionKey":"repeat_founder","label":"Repeat founder"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"high_retention","label":"High retention"},{"optionKey":"distribution_advantage","label":"Distribution advantage"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('080251d1-8269-551e-a690-69d09007902f', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I6.green_flag_strength$cq$, 26, $cq$single_select$cq$, true,
   $cq${"prompt":"How firm are those?","phaseKey":"I6","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I6.green_flags"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('de49af22-5911-511e-aff3-34b9a3ab8bca', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I6.custom_criteria$cq$, 27, $cq$long_text$cq$, true,
   $cq${"prompt":"Anything else you look for?","supportingText":"In your own words. Kept for people to read; it never becomes an automatic filter.","phaseKey":"I6","minLength":1,"maxLength":1000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('19a1a142-1d30-583d-9aba-b786163fab11', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I7.avoid$cq$, 28, $cq$multi_select$cq$, true,
   $cq${"prompt":"I'd rather not see","supportingText":"A soft negative: these can still appear, ranked lower. Nothing is hidden.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('6d6a456e-6dcb-5d35-8b18-bba3bb189dfd', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I7.hard_exclusions$cq$, 29, $cq$multi_select$cq$, true,
   $cq${"prompt":"Never show me","supportingText":"A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('daa81262-9027-56f0-8c5c-64192007f380', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I7.sector_exclusions$cq$, 30, $cq$reference_select$cq$, true,
   $cq${"prompt":"Sectors to exclude outright","supportingText":"A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.","phaseKey":"I7","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('c1128242-dac1-57de-9b7a-b4beeccf63a8', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I8.portfolio$cq$, 31, $cq$long_text$cq$, true,
   $cq${"prompt":"A few representative portfolio companies","supportingText":"One per line, up to five. Names only; nothing is looked up or linked.","phaseKey":"I8","minLength":1,"maxLength":1200}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.portfolio"}]$cq$::jsonb),
  ('8828a4f5-bd85-5f71-911d-dea41e2af796', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I9.discovery_mode$cq$, 32, $cq$single_select$cq$, false,
   $cq${"prompt":"How adventurous should discovery be?","supportingText":"Hard exclusions always apply, whichever you choose.","phaseKey":"I9","options":[{"optionKey":"strict","label":"Strict","description":"Stay close to what I've explicitly said."},{"optionKey":"balanced","label":"Balanced","description":"Mostly thesis-aligned, with selective adjacent opportunities."},{"optionKey":"exploratory","label":"Exploratory","description":"Show more justified outside-thesis opportunities."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.discovery_mode"}]$cq$::jsonb),
  ('13b7a9c1-ab91-5016-82ef-606941f2babf', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I10.inbound_preference$cq$, 33, $cq$single_select$cq$, true,
   $cq${"prompt":"How should founders reach you?","supportingText":"Your preference for now. Screening rules are set up later; nothing is enforced yet.","phaseKey":"I10","options":[{"optionKey":"closed","label":"Closed","description":"No unsolicited inbound."},{"optionKey":"qualified","label":"Qualified","description":"Founders may request contact once criteria you set later are met."},{"optionKey":"open","label":"Open","description":"Broader inbound accepted."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('98ca2654-e86c-5d85-aa0f-aac741393d03', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I11.public_description$cq$, 34, $cq$long_text$cq$, true,
   $cq${"prompt":"How would you describe your firm to a founder?","supportingText":"A few sentences for your profile. Q can draft it from what you've told it, for you to confirm or change.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.public_description"}]$cq$::jsonb),
  ('693de540-ef41-5c3d-b324-ec7db930b3cf', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I11.additional_context$cq$, 35, $cq$long_text$cq$, true,
   $cq${"prompt":"Add something we missed","supportingText":"Your thesis in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.raw_text"}]$cq$::jsonb),
  ('60327a5f-6707-5d51-bd3b-f0ca4ae4d055', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I11.review$cq$, 36, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's the mandate you've defined","supportingText":"Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.","phaseKey":"I11","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"investor.review"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.confirm"}]$cq$::jsonb),
  ('a0f524aa-4996-5c02-b72b-8b6af5726111', '30d76dc6-3151-5ebc-9c28-3a4b483fa445', $cq$I12.handoff$cq$, 37, $cq$confirmation$cq$, true,
   $cq${"prompt":"Your mandate is ready","supportingText":"Capital Q now has the structured criteria needed to generate your opportunities.","phaseKey":"I12","confirmLabel":"Go to Discover","requireAffirmative":true,"contextKey":"investor.handoff"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = '30d76dc6-3151-5ebc-9c28-3a4b483fa445';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 5
 where journey_type = $cq$investor$cq$
   and (current_version is null or current_version < 5);
