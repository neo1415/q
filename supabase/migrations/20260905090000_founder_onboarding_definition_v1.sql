-- CQ-ONB-002 · Founder onboarding: runtime extension + Founder Definition v1.
--
-- 1. The step graph gains "reference_select" (select canonical reference
--    entities such as taxonomy nodes by stable id). Interaction semantics
--    only; the runtime validates the response shape against the step.
-- 2. Founder Definition v1 is published as reference data through the same
--    rows the runtime publisher writes. Sessions pin to this version; a
--    change to the journey is v2, never an edit of these rows.

alter table onboarding.steps drop constraint steps_step_type_check;
alter table onboarding.steps add constraint steps_step_type_check check (step_type in (
  'single_select', 'multi_select', 'range', 'short_text', 'long_text',
  'voice_text', 'document_upload', 'confirmation', 'reference_select'));

-- ---------------------------------------------------------------------------
-- Founder Definition v1 (generated section begins)
-- ---------------------------------------------------------------------------

-- CQ-ONB-002 · Founder onboarding v1 (journey "founder")
-- GENERATED from packages/founder-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('15f819f2-2265-54fc-90f4-30ab90d01cc6', $cq$founder$cq$, $cq$Founder onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select 'c781b093-67f4-569b-a38d-5ba88bd26d31', d.id, 1,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"F0","label":"Welcome"},{"phaseKey":"F1","label":"Company"},{"phaseKey":"F2","label":"Materials"},{"phaseKey":"F3","label":"Review"},{"phaseKey":"F4","label":"Team"},{"phaseKey":"F5","label":"Traction"},{"phaseKey":"F6","label":"Raise"},{"phaseKey":"F7","label":"Anything else"},{"phaseKey":"F8","label":"Snapshot"}],"runtime":{"subjectType":"COMPANY","allowUnboundStart":true}}$cq$::jsonb,
       'daa8e1e7ff558122ba4d77444b80ddee248aeb50426168248d13ee8107e82a7e'
  from onboarding.definitions d
 where d.journey_type = $cq$founder$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('1bde2d8a-bce3-5300-9317-2e95c9d5ba80', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F0.intent$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"What brings you to Capital Q?","supportingText":"One tap. You can change this later.","phaseKey":"F0","options":[{"optionKey":"raising_now","label":"I'm raising for a company","description":"There is a round in motion or about to be."},{"optionKey":"preparing_to_raise","label":"I'm preparing to raise","description":"Getting the company and the story ready first."},{"optionKey":"exploring","label":"I'm exploring Capital Q","description":"Curious what Q can see before committing."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('f759d0e1-3fc1-5aae-9bdf-cd7cb55d7269', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.company_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your company","supportingText":"The name investors would recognise.","phaseKey":"F1","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.bootstrap"}]$cq$::jsonb),
  ('e4405746-06b1-5ca6-b945-8172c2a56db5', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Website","supportingText":"Optional. Q can read a website later to fill gaps.","phaseKey":"F1","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('b70c98e6-4489-5cae-a4ad-5e1be65fe6e9', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.country$cq$, 3, $cq$single_select$cq$, false,
   $cq${"prompt":"Where is the company based?","supportingText":"Optional for now.","phaseKey":"F1","options":[{"optionKey":"ng","label":"Nigeria"},{"optionKey":"ke","label":"Kenya"},{"optionKey":"za","label":"South Africa"},{"optionKey":"gh","label":"Ghana"},{"optionKey":"eg","label":"Egypt"},{"optionKey":"gb","label":"United Kingdom"},{"optionKey":"us","label":"United States"},{"optionKey":"de","label":"Germany"},{"optionKey":"fr","label":"France"},{"optionKey":"nl","label":"Netherlands"},{"optionKey":"ae","label":"United Arab Emirates"},{"optionKey":"in","label":"India"},{"optionKey":"sg","label":"Singapore"},{"optionKey":"br","label":"Brazil"},{"optionKey":"ca","label":"Canada"},{"optionKey":"other","label":"Somewhere else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('60f9a91a-304b-52eb-a48a-46b40ddc241b', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.stage$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"What stage is the company at?","whyQAsks":"Stage decides which questions come next and how investors read the numbers.","phaseKey":"F1","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('ded6dc63-f325-5caf-bf8d-14eb339bac4a', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.description$cq$, 5, $cq$long_text$cq$, false,
   $cq${"prompt":"In a sentence or two, what does the company do?","supportingText":"Plain words are best. Who it's for and what it changes for them.","phaseKey":"F1","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('a0fbe8f2-d1f3-593f-b91f-9e54424234ba', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F1.categories$cq$, 6, $cq$reference_select$cq$, false,
   $cq${"prompt":"How would you categorise the company?","supportingText":"Suggested categories come from your description. Pick the ones that fit; nothing is assigned until you confirm.","phaseKey":"F1","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category","business_model","customer_type"],"minItems":1,"maxItems":8}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.taxonomy"}]$cq$::jsonb),
  ('4c4219f6-5127-5701-83b2-7ee0b7ac4646', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F2.materials$cq$, 7, $cq$multi_select$cq$, false,
   $cq${"prompt":"What do you already have?","supportingText":"Tell us what exists today. Uploading arrives in a later release; nothing is collected here.","phaseKey":"F2","options":[{"optionKey":"pitch_deck","label":"Pitch deck"},{"optionKey":"financial_model","label":"Financial model"},{"optionKey":"management_accounts","label":"Management accounts"},{"optionKey":"company_profile","label":"Company profile or memo"},{"optionKey":"other","label":"Something else"},{"optionKey":"nothing_yet","label":"Nothing yet","description":"That's fine. Q starts from what you tell it."}],"minSelections":1,"maxSelections":6,"exclusiveOptionKeys":["nothing_yet"]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('3b307a34-b034-5eb6-a81f-6c76062dbb08', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F3.review$cq$, 8, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's what we have so far","supportingText":"Everything below is what you entered. Go back to change anything.","phaseKey":"F3","confirmLabel":"Looks right","requireAffirmative":true,"contextKey":"founder.review"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('f58c351e-db4e-5a6c-8ac5-6fc2b45ac919', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F4.founder_role$cq$, 9, $cq$single_select$cq$, true,
   $cq${"prompt":"Your role","phaseKey":"F4","options":[{"optionKey":"ceo","label":"CEO"},{"optionKey":"cto","label":"CTO"},{"optionKey":"coo","label":"COO"},{"optionKey":"cpo","label":"Product"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"founder.membership"}]$cq$::jsonb),
  ('c3d176bb-6d9f-5ef0-9791-0e3868426070', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F4.founder_count$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"How many founders?","phaseKey":"F4","min":"1","max":"50","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('a6b8693e-67df-52c4-9cf5-03cc59fb0d3e', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F4.full_time$cq$, 11, $cq$single_select$cq$, true,
   $cq${"prompt":"Are the founders full-time?","phaseKey":"F4","options":[{"optionKey":"all","label":"All founders are full-time"},{"optionKey":"some","label":"Some founders are full-time"},{"optionKey":"none","label":"Not full-time yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('5dc53f00-3e24-5e63-ba65-5e323af67f06', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F4.team_size$cq$, 12, $cq$range$cq$, true,
   $cq${"prompt":"How many people work on the company today?","supportingText":"Founders included.","phaseKey":"F4","min":"1","max":"100000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('77287274-4402-5318-87ae-f0a47a503184', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F4.functions$cq$, 13, $cq$multi_select$cq$, false,
   $cq${"prompt":"Which of these does the founding team cover?","phaseKey":"F4","options":[{"optionKey":"product","label":"Product"},{"optionKey":"engineering","label":"Engineering"},{"optionKey":"sales","label":"Sales and partnerships"},{"optionKey":"operations","label":"Operations"},{"optionKey":"finance","label":"Finance"},{"optionKey":"domain","label":"Deep industry expertise"}],"minSelections":1,"maxSelections":6,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('44f19101-f3e3-58df-9f47-eb0a133526ef', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F5.signal$cq$, 14, $cq$single_select$cq$, true,
   $cq${"prompt":"What early signal do you have?","phaseKey":"F5","options":[{"optionKey":"pilots","label":"Pilots running"},{"optionKey":"lois","label":"Signed letters of intent"},{"optionKey":"waitlist","label":"A waitlist"},{"optionKey":"users","label":"Active users, not yet paying"},{"optionKey":"none","label":"Nothing measurable yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('adef9fa1-562e-5f7d-9247-e4610ef66357', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F5.pilots$cq$, 15, $cq$range$cq$, false,
   $cq${"prompt":"How many pilots or design partners?","phaseKey":"F5","min":"0","max":"10000","step":"1"}$cq$::jsonb,
   $cq${"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["pilots","lois"]}]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('b3847ee9-212f-557a-8daf-3155ceb96d8a', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F5.revenue_status$cq$, 16, $cq$single_select$cq$, true,
   $cq${"prompt":"How would you describe revenue today?","phaseKey":"F5","options":[{"optionKey":"recurring","label":"Recurring and growing"},{"optionKey":"recurring_flat","label":"Recurring, roughly flat"},{"optionKey":"project","label":"Project or one-off revenue"},{"optionKey":"early","label":"First revenue only"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('1e78eb04-8fc9-50df-ae01-eb8a3b728a11', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F5.customers$cq$, 17, $cq$range$cq$, false,
   $cq${"prompt":"Paying customers","phaseKey":"F5","min":"0","max":"10000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('4be8d5be-f147-5605-9ee0-68610af14e9b', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F5.growth$cq$, 18, $cq$single_select$cq$, false,
   $cq${"prompt":"Growth over the last six months","phaseKey":"F5","options":[{"optionKey":"over_100","label":"More than doubled"},{"optionKey":"50_100","label":"Grew 50–100%"},{"optionKey":"under_50","label":"Grew under 50%"},{"optionKey":"flat","label":"Flat or down"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('228d1b51-cf64-580b-abcc-1292f0000fd4', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.raising$cq$, 19, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you raising now?","phaseKey":"F6","options":[{"optionKey":"active","label":"Yes, actively"},{"optionKey":"preparing","label":"Preparing to raise"},{"optionKey":"not_now","label":"Not right now"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('c854f526-4279-5652-9f76-9a95c64ceded', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.currency$cq$, 20, $cq$single_select$cq$, true,
   $cq${"prompt":"Currency","phaseKey":"F6","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('d7553580-6946-5d8d-bdc3-a29f932cc5ee', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.target_amount$cq$, 21, $cq$range$cq$, true,
   $cq${"prompt":"Target amount","supportingText":"An exact figure, in the currency above.","phaseKey":"F6","min":"1","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('b0db352c-ca98-549e-9835-bb76552b8a04', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.instrument$cq$, 22, $cq$single_select$cq$, false,
   $cq${"prompt":"Instrument","phaseKey":"F6","options":[{"optionKey":"priced","label":"Priced equity round"},{"optionKey":"safe","label":"SAFE"},{"optionKey":"convertible","label":"Convertible note"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('8c011ba1-1098-5a0c-8554-7bab0070b272', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.timeframe$cq$, 23, $cq$single_select$cq$, false,
   $cq${"prompt":"When do you want to close?","phaseKey":"F6","options":[{"optionKey":"under_3","label":"Within 3 months"},{"optionKey":"3_6","label":"3–6 months"},{"optionKey":"6_12","label":"6–12 months"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('f7fe5263-5cf3-5067-af18-a460a270f56b', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.use_of_funds$cq$, 24, $cq$multi_select$cq$, false,
   $cq${"prompt":"What will the money mainly go to?","phaseKey":"F6","options":[{"optionKey":"product","label":"Product and engineering"},{"optionKey":"hiring","label":"Key hires"},{"optionKey":"gtm","label":"Sales and go-to-market"},{"optionKey":"runway","label":"Runway and operations"},{"optionKey":"expansion","label":"New markets"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('6cf15029-e6b9-5807-a209-c8cf692aae25', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F6.confirm$cq$, 25, $cq$confirmation$cq$, true,
   $cq${"prompt":"Save this as your capital objective?","supportingText":"This becomes the company's current raise. You can recalibrate it any time.","phaseKey":"F6","confirmLabel":"Save my raise","requireAffirmative":true,"contextKey":"founder.raise"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[{"targetKey":"capital.objective"}]$cq$::jsonb),
  ('539d8179-6365-546f-8fad-478a8514e29a', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F7.follow_up$cq$, 26, $cq$long_text$cq$, false,
   $cq${"prompt":"Anything else you want on record?","supportingText":"Private to you. Investors never see this and it changes nothing about your company profile.","phaseKey":"F7","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('8d42981b-9140-52ea-94db-40a6e3246552', 'c781b093-67f4-569b-a38d-5ba88bd26d31', $cq$F8.snapshot$cq$, 27, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's what we have so far","supportingText":"A plain summary of what you entered. Q has not analysed anything yet.","phaseKey":"F8","confirmLabel":"Go to Home","requireAffirmative":true,"contextKey":"founder.snapshot"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = 'c781b093-67f4-569b-a38d-5ba88bd26d31';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 1
 where journey_type = $cq$founder$cq$
   and (current_version is null or current_version < 1);
