-- QO-27c (2026-10-24) · Investor onboarding v2: the firm's website.
--
-- v1 stays published and immutable: sessions pinned to it keep running its
-- journey. v2 is v1 with one optional short-text step, I0.website, after the
-- firm's name. It writes core.investor_organisations.website_url only (the
-- column exists since 20260903180000); the address is self-reported, never a
-- verified domain. Every v1 step key, branch and mapping is unchanged.
-- No table, column, grant or policy changes.

-- QO-27C-INVESTOR-WEBSITE · Investor onboarding v2 (journey "investor")
-- GENERATED from packages/investor-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('07561933-eed8-55c2-86ca-adfaf2257256', $cq$investor$cq$, $cq$Investor onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select '83365c95-e0d2-5b60-8210-41464ac3b88d', d.id, 2,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"I0","label":"Role"},{"phaseKey":"I1","label":"Deployment"},{"phaseKey":"I2","label":"Stage and cheque"},{"phaseKey":"I3","label":"Geography and sectors"},{"phaseKey":"I4","label":"Business attributes"},{"phaseKey":"I5","label":"Founding team"},{"phaseKey":"I6","label":"Green flags"},{"phaseKey":"I7","label":"Red flags"},{"phaseKey":"I8","label":"Portfolio"},{"phaseKey":"I9","label":"Discovery style"},{"phaseKey":"I10","label":"Inbound"},{"phaseKey":"I11","label":"Review"},{"phaseKey":"I12","label":"Handoff"}],"runtime":{"subjectType":"INVESTOR_ORGANISATION","allowUnboundStart":true}}$cq$::jsonb,
       '9d2aa2fc9622f2848f58cc9527b08aea35a7939da6c6492a066d3bd72266513c'
  from onboarding.definitions d
 where d.journey_type = $cq$investor$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('0aa07d60-2506-51d2-accc-f11428336cf6', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I0.investor_type$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"How do you invest?","supportingText":"This describes your organisation, not you personally.","phaseKey":"I0","options":[{"optionKey":"angel","label":"Angel investor"},{"optionKey":"vc","label":"Venture capital fund"},{"optionKey":"family_office","label":"Family office"},{"optionKey":"cvc","label":"Corporate venture"},{"optionKey":"syndicate","label":"Syndicate"},{"optionKey":"accelerator","label":"Accelerator"},{"optionKey":"scout","label":"Scout"},{"optionKey":"institutional","label":"Institutional investor"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('85c00944-7c1f-5b48-a66c-f76671c76202', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I0.organisation_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your firm","supportingText":"The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.","phaseKey":"I0","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.bootstrap"}]$cq$::jsonb),
  ('e815c14e-f25d-5f6e-abf6-1fbd0e71fbed', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I0.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Your firm's website","supportingText":"Optional. Founders can see who you are before they reply.","phaseKey":"I0","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.website"}]$cq$::jsonb),
  ('1f0c6971-b140-5a28-9712-c2f23612c381', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I0.business_title$cq$, 3, $cq$short_text$cq$, false,
   $cq${"prompt":"Your role there","supportingText":"Optional. A title is descriptive only; it grants no permissions.","phaseKey":"I0","minLength":1,"maxLength":120,"placeholder":"Partner, Principal, Angel"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.representative"}]$cq$::jsonb),
  ('bdc13215-b922-5439-a429-b069a8dfbb1b', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I1.deployment_status$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you deploying capital right now?","supportingText":"An operating state you can change any time.","phaseKey":"I1","options":[{"optionKey":"actively_investing","label":"Actively investing","description":"Deploying now."},{"optionKey":"selective","label":"Selective","description":"Open, but only for a strong fit."},{"optionKey":"paused","label":"Paused","description":"Not deploying at the moment."},{"optionKey":"exploring_only","label":"Exploring only","description":"Looking, not yet investing."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]$cq$::jsonb),
  ('3a44a16a-456c-516c-bd2b-e8001914de3d', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I1.mandate_context$cq$, 5, $cq$reference_select$cq$, true,
   $cq${"prompt":"Which mandate are we defining?","supportingText":"Most investors have one. Choose the draft to continue with; nothing is activated yet.","phaseKey":"I1","resourceType":"INVESTOR_MANDATE","vocabularyCodes":[],"minItems":1,"maxItems":1,"contextKey":"investor.mandates"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.select"}]$cq$::jsonb),
  ('97ba0b58-4290-5f2f-a4b9-d24bfaeef41a', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.stages$cq$, 6, $cq$multi_select$cq$, true,
   $cq${"prompt":"Which stages do you invest at?","phaseKey":"I2","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('ce3e489b-32fc-5fe3-9525-673cd5400dea', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.currency$cq$, 7, $cq$single_select$cq$, true,
   $cq${"prompt":"Cheque currency","phaseKey":"I2","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('55fc5521-7d0f-5fa1-ab3c-2a02ed6e5d44', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.cheque_min$cq$, 8, $cq$range$cq$, false,
   $cq${"prompt":"Minimum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('0b55b3b6-e20b-5ebf-b42f-ae964b689164', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.cheque_typical$cq$, 9, $cq$range$cq$, false,
   $cq${"prompt":"Typical cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('0466d905-6cda-5eb9-a137-0823a877cc2f', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.cheque_max$cq$, 10, $cq$range$cq$, false,
   $cq${"prompt":"Maximum cheque","phaseKey":"I2","min":"0","max":"1000000000000"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('58892a64-9a8f-5a28-a1d0-3b58cd5b67cb', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I2.investment_role$cq$, 11, $cq$multi_select$cq$, false,
   $cq${"prompt":"How do you usually take part?","phaseKey":"I2","options":[{"optionKey":"lead","label":"Lead rounds"},{"optionKey":"co_invest","label":"Co-invest alongside a lead"},{"optionKey":"follow","label":"Follow in later rounds"}],"minSelections":1,"maxSelections":3,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.stage_cheque"}]$cq$::jsonb),
  ('2d2fc2ff-83d2-546f-8d47-0b38892162c0', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I3.geography$cq$, 12, $cq$reference_select$cq$, false,
   $cq${"prompt":"Where do you invest?","supportingText":"Regions or countries. Leave empty for anywhere.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["geography"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('2bdb0be6-9781-5e06-b6b2-41879d735eca', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I3.geography_strength$cq$, 13, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.geography"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('def80c09-f174-5ebc-994f-8a6ac77d4cc7', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I3.sectors$cq$, 14, $cq$reference_select$cq$, false,
   $cq${"prompt":"Which sectors and product areas?","supportingText":"Suggested categories come from your own words; only what you keep is recorded.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('402b6851-2cd4-5b0a-8a1d-2e2f23d7d38b', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I3.sector_strength$cq$, 15, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I3","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I3.sectors"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('a5a3bdda-56c8-5c52-a614-4ba1e68733b9', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I3.sectors_avoid$cq$, 16, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors you'd rather not see","supportingText":"A soft preference: these can still appear. Hard exclusions come later.","phaseKey":"I3","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('4cb6cbf8-afe7-5fbf-aca4-5cad346f1aaa', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I4.business_models$cq$, 17, $cq$reference_select$cq$, false,
   $cq${"prompt":"Business models you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["business_model"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('861a66c0-f22e-517d-899c-01b908c7c22f', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I4.customer_types$cq$, 18, $cq$reference_select$cq$, false,
   $cq${"prompt":"Customer types you back","supportingText":"Recorded as a strong preference.","phaseKey":"I4","resourceType":"TAXONOMY_NODE","vocabularyCodes":["customer_type"],"minItems":1,"maxItems":10}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('d7466678-f7d1-5115-8e5e-623125b3d5b7', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I4.capital_intensity$cq$, 19, $cq$single_select$cq$, false,
   $cq${"prompt":"Capital intensity","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"capital_light","label":"Prefer capital-light","description":"Recorded as a strong preference for capital-light businesses."},{"optionKey":"avoid_hardware","label":"Rather not hardware-heavy","description":"Recorded as a soft avoid; hardware companies can still appear."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('4d5c6c43-f9d9-561f-880b-363456d12ca7', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I4.regulatory_appetite$cq$, 20, $cq$single_select$cq$, false,
   $cq${"prompt":"Regulated markets","phaseKey":"I4","options":[{"optionKey":"any","label":"No preference"},{"optionKey":"prefer_regulated","label":"Regulated markets are a plus","description":"Recorded as a strong preference."},{"optionKey":"avoid_regulated","label":"Rather not heavily regulated","description":"Recorded as a soft avoid."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.business_attributes"}]$cq$::jsonb),
  ('7d681182-a6b5-5ce0-b851-bf671ca75ef3', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I4.revenue_state$cq$, 21, $cq$single_select$cq$, false,
   $cq${"prompt":"Revenue expectations","supportingText":"Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.","phaseKey":"I4","options":[{"optionKey":"pre_revenue_ok","label":"Pre-revenue is fine"},{"optionKey":"revenue_preferred","label":"Some revenue preferred"},{"optionKey":"revenue_required","label":"Revenue expected"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('d2209419-f369-5f36-97c8-7a2bf41b13dd', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I5.founder_preferences$cq$, 22, $cq$multi_select$cq$, false,
   $cq${"prompt":"Founding-team capabilities that matter to you","supportingText":"Investment-relevant capabilities only. Personal characteristics are never criteria.","phaseKey":"I5","options":[{"optionKey":"technical_founding_capability","label":"Technical founding capability"},{"optionKey":"repeat_founder_experience","label":"Repeat founders"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"enterprise_sales_experience","label":"Enterprise sales experience"}],"minSelections":1,"maxSelections":4,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('1cff552f-d1fc-5e11-ab0f-656dcaac469a', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I5.founder_strength$cq$, 23, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm is that?","phaseKey":"I5","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I5.founder_preferences"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.founder_preferences"}]$cq$::jsonb),
  ('aaf22826-2a00-5fbb-b655-a8ac7359e5a5', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I6.green_flags$cq$, 24, $cq$multi_select$cq$, false,
   $cq${"prompt":"Green flags","supportingText":"Positive signals you weigh. Recorded as strong preferences unless you change the strength.","phaseKey":"I6","options":[{"optionKey":"strong_revenue_growth","label":"Strong revenue growth"},{"optionKey":"capital_efficiency","label":"Capital efficiency"},{"optionKey":"enterprise_customers","label":"Enterprise customers"},{"optionKey":"regulatory_moat","label":"Regulatory moat"},{"optionKey":"repeat_founder","label":"Repeat founder"},{"optionKey":"deep_domain_expertise","label":"Deep domain expertise"},{"optionKey":"high_retention","label":"High retention"},{"optionKey":"distribution_advantage","label":"Distribution advantage"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('15dbdf63-8b6b-5c15-b1f0-73ecffa8090e', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I6.green_flag_strength$cq$, 25, $cq$single_select$cq$, false,
   $cq${"prompt":"How firm are those?","phaseKey":"I6","options":[{"optionKey":"must","label":"Must match","description":"A strong requirement for what you want to see."},{"optionKey":"strong","label":"Strong preference","description":"Counts a lot; other opportunities can still appear."},{"optionKey":"nice","label":"Nice to have","description":"A moderate preference."}]}$cq$::jsonb,
   $cq${"op":"EXISTS","stepKey":"I6.green_flags"}$cq$::jsonb,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('6dc76298-286c-526c-b852-29d6cc1ea4f3', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I6.custom_criteria$cq$, 26, $cq$long_text$cq$, false,
   $cq${"prompt":"Anything else you look for?","supportingText":"In your own words. Kept for people to read; it never becomes an automatic filter.","phaseKey":"I6","minLength":1,"maxLength":1000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.green_flags"}]$cq$::jsonb),
  ('752e32cb-4549-5d64-887f-4369a5544a87', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I7.avoid$cq$, 27, $cq$multi_select$cq$, false,
   $cq${"prompt":"I'd rather not see","supportingText":"A soft negative: these can still appear, ranked lower. Nothing is hidden.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('f6fed7ca-f97c-5539-a0ea-b72ca3c0c3ee', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I7.hard_exclusions$cq$, 28, $cq$multi_select$cq$, false,
   $cq${"prompt":"Never show me","supportingText":"A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.","phaseKey":"I7","options":[{"optionKey":"gambling","label":"Gambling"},{"optionKey":"tobacco","label":"Tobacco"},{"optionKey":"weapons","label":"Weapons"},{"optionKey":"adult_content","label":"Adult content"},{"optionKey":"crypto_speculation","label":"Speculative crypto"},{"optionKey":"hardware_heavy","label":"Hardware-heavy"},{"optionKey":"pre_product","label":"Pre-product"},{"optionKey":"single_founder","label":"Single founder"}],"minSelections":1,"maxSelections":8,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.exclusions"}]$cq$::jsonb),
  ('773c5274-6e50-5004-924c-cc19d95c6393', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I7.sector_exclusions$cq$, 29, $cq$reference_select$cq$, false,
   $cq${"prompt":"Sectors to exclude outright","supportingText":"A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.","phaseKey":"I7","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category"],"minItems":1,"maxItems":20}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.taxonomy"}]$cq$::jsonb),
  ('444c7bb6-df7a-5a00-8c7e-e56fcf572f1d', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I8.portfolio$cq$, 30, $cq$long_text$cq$, false,
   $cq${"prompt":"A few representative portfolio companies","supportingText":"One per line, up to five. Names only; nothing is looked up or linked.","phaseKey":"I8","minLength":1,"maxLength":1200}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.portfolio"}]$cq$::jsonb),
  ('ca78aa90-d8d1-542b-9148-27ffd5854be8', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I9.discovery_mode$cq$, 31, $cq$single_select$cq$, true,
   $cq${"prompt":"How adventurous should discovery be?","supportingText":"Hard exclusions always apply, whichever you choose.","phaseKey":"I9","options":[{"optionKey":"strict","label":"Strict","description":"Stay close to what I've explicitly said."},{"optionKey":"balanced","label":"Balanced","description":"Mostly thesis-aligned, with selective adjacent opportunities."},{"optionKey":"exploratory","label":"Exploratory","description":"Show more justified outside-thesis opportunities."}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.discovery_mode"}]$cq$::jsonb),
  ('37eed0b7-df71-5405-87bc-c5fbfc8327e1', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I10.inbound_preference$cq$, 32, $cq$single_select$cq$, true,
   $cq${"prompt":"How should founders reach you?","supportingText":"Your preference for now. Screening rules are set up later; nothing is enforced yet.","phaseKey":"I10","options":[{"optionKey":"closed","label":"Closed","description":"No unsolicited inbound."},{"optionKey":"qualified","label":"Qualified","description":"Founders may request contact once criteria you set later are met."},{"optionKey":"open","label":"Open","description":"Broader inbound accepted."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('87161f20-1e7d-5dde-9a24-05bb5aef9abe', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I11.additional_context$cq$, 33, $cq$long_text$cq$, false,
   $cq${"prompt":"Add something we missed","supportingText":"Optional context in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.","phaseKey":"I11","minLength":1,"maxLength":4000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.raw_text"}]$cq$::jsonb),
  ('c0a1e69b-1a9d-5014-bf30-9fdcfa6971dd', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I11.review$cq$, 34, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's the mandate you've defined","supportingText":"Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.","phaseKey":"I11","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"investor.review"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"investor.mandate.confirm"}]$cq$::jsonb),
  ('f63f9375-c54a-5190-956e-69b20478e659', '83365c95-e0d2-5b60-8210-41464ac3b88d', $cq$I12.handoff$cq$, 35, $cq$confirmation$cq$, true,
   $cq${"prompt":"Your mandate is ready","supportingText":"Capital Q now has the structured criteria needed to generate your opportunities.","phaseKey":"I12","confirmLabel":"Go to Discover","requireAffirmative":true,"contextKey":"investor.handoff"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = '83365c95-e0d2-5b60-8210-41464ac3b88d';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 2
 where journey_type = $cq$investor$cq$
   and (current_version is null or current_version < 2);
