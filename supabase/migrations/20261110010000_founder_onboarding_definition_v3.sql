-- HARDEN · Founder onboarding v3: the early signals founders actually have.
--
-- v2 stays published and immutable: sessions pinned to it keep running its
-- journey. v3 is v2 with two F5.signal options added -- "Paying customers"
-- and "Signed partnerships or distribution deals" (live bench 2026-10-01: a
-- pre-seed founder with paying customers fit no option and was asked six
-- times). Every step key, order, branch and mapping is v2's.

-- HARDEN · Founder onboarding v3 (journey "founder")
-- GENERATED from packages/founder-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('15f819f2-2265-54fc-90f4-30ab90d01cc6', $cq$founder$cq$, $cq$Founder onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', d.id, 3,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"F0","label":"Welcome"},{"phaseKey":"F1","label":"Company"},{"phaseKey":"F2","label":"Materials"},{"phaseKey":"F3","label":"Review"},{"phaseKey":"F4","label":"Team"},{"phaseKey":"F5","label":"Traction"},{"phaseKey":"F6","label":"Raise"},{"phaseKey":"F7","label":"A few questions"},{"phaseKey":"F8","label":"Snapshot"}],"runtime":{"subjectType":"COMPANY","allowUnboundStart":true}}$cq$::jsonb,
       'bdd1a4ceb2b5c9d529f1ffe8465007e3cbd5c0d512e9c409daf214609788fa57'
  from onboarding.definitions d
 where d.journey_type = $cq$founder$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('7e7288a8-5dec-5d80-ac03-cb859d7572bb', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F0.intent$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"What brings you to Capital Q?","supportingText":"One tap. You can change this later.","phaseKey":"F0","options":[{"optionKey":"raising_now","label":"I'm raising for a company","description":"There is a round in motion or about to be."},{"optionKey":"preparing_to_raise","label":"I'm preparing to raise","description":"Getting the company and the story ready first."},{"optionKey":"exploring","label":"I'm exploring Capital Q","description":"Curious what Q can see before committing."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('e7e856d0-7d29-5d52-9fe2-eefb4189899b', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.company_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your company","supportingText":"The name investors would recognise.","phaseKey":"F1","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.bootstrap"}]$cq$::jsonb),
  ('058d8cab-365e-5a52-8c2d-da6096c89821', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Website","supportingText":"Optional. Q can read a website later to fill gaps.","phaseKey":"F1","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('2a0b7475-1545-519d-bbb5-e0830b9e3658', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.country$cq$, 3, $cq$single_select$cq$, false,
   $cq${"prompt":"Where is the company based?","supportingText":"Optional for now.","phaseKey":"F1","options":[{"optionKey":"ng","label":"Nigeria"},{"optionKey":"ke","label":"Kenya"},{"optionKey":"za","label":"South Africa"},{"optionKey":"gh","label":"Ghana"},{"optionKey":"eg","label":"Egypt"},{"optionKey":"gb","label":"United Kingdom"},{"optionKey":"us","label":"United States"},{"optionKey":"de","label":"Germany"},{"optionKey":"fr","label":"France"},{"optionKey":"nl","label":"Netherlands"},{"optionKey":"ae","label":"United Arab Emirates"},{"optionKey":"in","label":"India"},{"optionKey":"sg","label":"Singapore"},{"optionKey":"br","label":"Brazil"},{"optionKey":"ca","label":"Canada"},{"optionKey":"other","label":"Somewhere else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('7596e356-aef8-5a34-9f4e-fb3f3d61e0ef', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.stage$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"What stage is the company at?","whyQAsks":"Stage decides which questions come next and how investors read the numbers.","phaseKey":"F1","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('fe156b92-6386-525d-998b-6c3f787f2e88', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.description$cq$, 5, $cq$long_text$cq$, false,
   $cq${"prompt":"In a sentence or two, what does the company do?","supportingText":"Plain words are best. Who it's for and what it changes for them.","phaseKey":"F1","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('8fcfde69-7a09-5a26-804f-4e2f9c3638d3', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F1.categories$cq$, 6, $cq$reference_select$cq$, false,
   $cq${"prompt":"How would you categorise the company?","supportingText":"Suggested categories come from your description. Pick the ones that fit; nothing is assigned until you confirm.","phaseKey":"F1","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category","business_model","customer_type"],"minItems":1,"maxItems":8}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.taxonomy"}]$cq$::jsonb),
  ('ec9f7cd3-75e1-50e5-8d47-e745ce3cc748', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F2.materials$cq$, 7, $cq$document_upload$cq$, false,
   $cq${"prompt":"What do you already have?","supportingText":"Give Q anything that already explains the business — a deck, a financial model, management accounts. Private to your company unless you choose to share it. You can skip this.","phaseKey":"F2","allowedResourceTypes":["EVIDENCE_DOCUMENT"],"minItems":0,"maxItems":6}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('6d2d2c90-f77c-59b2-8c13-787714390775', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F3.review$cq$, 8, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's what I understood","supportingText":"From what you gave me. Confirm what's right, fix what isn't, and tell me what I missed.","phaseKey":"F3","confirmLabel":"That's right","requireAffirmative":true,"contextKey":"founder.review"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('6f7014c0-eef3-541c-bec0-e42e83ebe8ff', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F4.founder_role$cq$, 9, $cq$single_select$cq$, true,
   $cq${"prompt":"Your role","phaseKey":"F4","options":[{"optionKey":"ceo","label":"CEO"},{"optionKey":"cto","label":"CTO"},{"optionKey":"coo","label":"COO"},{"optionKey":"cpo","label":"Product"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"founder.membership"}]$cq$::jsonb),
  ('2bac89ca-1a27-54ee-963b-14971c1c41fe', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F4.founder_count$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"How many founders?","phaseKey":"F4","min":"1","max":"50","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('a154c7c4-0061-5bd2-abf6-ca621d147eda', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F4.full_time$cq$, 11, $cq$single_select$cq$, true,
   $cq${"prompt":"Are the founders full-time?","phaseKey":"F4","options":[{"optionKey":"all","label":"All founders are full-time"},{"optionKey":"some","label":"Some founders are full-time"},{"optionKey":"none","label":"Not full-time yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('42f7d060-889a-5bdf-9047-74084eb2d429', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F4.team_size$cq$, 12, $cq$range$cq$, true,
   $cq${"prompt":"How many people work on the company today?","supportingText":"Founders included.","phaseKey":"F4","min":"1","max":"100000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('b4d3114a-2b01-5548-b87d-c41c06c7e570', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F4.functions$cq$, 13, $cq$multi_select$cq$, false,
   $cq${"prompt":"Which of these does the founding team cover?","phaseKey":"F4","options":[{"optionKey":"product","label":"Product"},{"optionKey":"engineering","label":"Engineering"},{"optionKey":"sales","label":"Sales and partnerships"},{"optionKey":"operations","label":"Operations"},{"optionKey":"finance","label":"Finance"},{"optionKey":"domain","label":"Deep industry expertise"}],"minSelections":1,"maxSelections":6,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('2f1cb59f-f7cc-5d51-9a53-933b49466c3d', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F5.signal$cq$, 14, $cq$single_select$cq$, true,
   $cq${"prompt":"What early signal do you have?","phaseKey":"F5","options":[{"optionKey":"pilots","label":"Pilots running"},{"optionKey":"lois","label":"Signed letters of intent"},{"optionKey":"waitlist","label":"A waitlist"},{"optionKey":"users","label":"Active users, not yet paying"},{"optionKey":"paying","label":"Paying customers"},{"optionKey":"partnerships","label":"Signed partnerships or distribution deals"},{"optionKey":"none","label":"Nothing measurable yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('e51f191a-4c85-51df-8099-c58446e6fa89', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F5.pilots$cq$, 15, $cq$range$cq$, false,
   $cq${"prompt":"How many pilots or design partners?","phaseKey":"F5","min":"0","max":"10000","step":"1"}$cq$::jsonb,
   $cq${"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["pilots","lois"]}]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('a66343cc-dfe4-5c6c-b725-19cbe8db235e', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F5.revenue_status$cq$, 16, $cq$single_select$cq$, true,
   $cq${"prompt":"How would you describe revenue today?","phaseKey":"F5","options":[{"optionKey":"recurring","label":"Recurring and growing"},{"optionKey":"recurring_flat","label":"Recurring, roughly flat"},{"optionKey":"project","label":"Project or one-off revenue"},{"optionKey":"early","label":"First revenue only"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('7d0d58a2-2479-5b7e-a0cf-786e4009736b', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F5.customers$cq$, 17, $cq$range$cq$, false,
   $cq${"prompt":"Paying customers","phaseKey":"F5","min":"0","max":"10000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('c33479bc-2b9a-5484-8f82-c307e09fbabb', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F5.growth$cq$, 18, $cq$single_select$cq$, false,
   $cq${"prompt":"Growth over the last six months","phaseKey":"F5","options":[{"optionKey":"over_100","label":"More than doubled"},{"optionKey":"50_100","label":"Grew 50–100%"},{"optionKey":"under_50","label":"Grew under 50%"},{"optionKey":"flat","label":"Flat or down"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('295dd85b-c894-5a5e-ae63-58110346dceb', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.raising$cq$, 19, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you raising now?","phaseKey":"F6","options":[{"optionKey":"active","label":"Yes, actively"},{"optionKey":"preparing","label":"Preparing to raise"},{"optionKey":"not_now","label":"Not right now"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('911c90be-f768-5d3c-bbc2-c9505d9b8adf', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.currency$cq$, 20, $cq$single_select$cq$, true,
   $cq${"prompt":"Currency","phaseKey":"F6","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('6813b7ac-afbb-58ca-b13b-072f918686f5', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.target_amount$cq$, 21, $cq$range$cq$, true,
   $cq${"prompt":"Target amount","supportingText":"An exact figure, in the currency above.","phaseKey":"F6","min":"1","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('8840cfa7-9e58-59fd-b44b-87023a4fa297', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.instrument$cq$, 22, $cq$single_select$cq$, false,
   $cq${"prompt":"Instrument","phaseKey":"F6","options":[{"optionKey":"priced","label":"Priced equity round"},{"optionKey":"safe","label":"SAFE"},{"optionKey":"convertible","label":"Convertible note"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('79dd0f51-34f8-5520-bc13-dd5a64ca6502', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.timeframe$cq$, 23, $cq$single_select$cq$, false,
   $cq${"prompt":"When do you want to close?","phaseKey":"F6","options":[{"optionKey":"under_3","label":"Within 3 months"},{"optionKey":"3_6","label":"3–6 months"},{"optionKey":"6_12","label":"6–12 months"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('1ecd19fa-69a5-52b9-aaea-aa4b4a261ff2', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.use_of_funds$cq$, 24, $cq$multi_select$cq$, false,
   $cq${"prompt":"What will the money mainly go to?","phaseKey":"F6","options":[{"optionKey":"product","label":"Product and engineering"},{"optionKey":"hiring","label":"Key hires"},{"optionKey":"gtm","label":"Sales and go-to-market"},{"optionKey":"runway","label":"Runway and operations"},{"optionKey":"expansion","label":"New markets"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('4d1fcb93-c11a-5767-a27e-3f4adf1a2d2d', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F6.confirm$cq$, 25, $cq$confirmation$cq$, true,
   $cq${"prompt":"Save this as your capital objective?","supportingText":"This becomes the company's current raise. You can recalibrate it any time.","phaseKey":"F6","confirmLabel":"Save my raise","requireAffirmative":true,"contextKey":"founder.raise"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[{"targetKey":"capital.objective"}]$cq$::jsonb),
  ('836cf7b5-a5cb-5325-9d55-e6e4098b74ad', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F7.follow_up$cq$, 26, $cq$long_text$cq$, false,
   $cq${"prompt":"A few things I still need","supportingText":"Only what materially changes what I understand. Answer what you can; \"I don't know\" is a real answer.","phaseKey":"F7","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('899f9b87-2a04-59d1-a342-674ac212b2f0', '200bcc2d-5114-50a3-aecb-dd2e5196d0f3', $cq$F8.snapshot$cq$, 27, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's how I currently understand your company","supportingText":"Built from what you told me and the material you shared. It will get sharper as more evidence arrives.","phaseKey":"F8","confirmLabel":"Go to Home","requireAffirmative":true,"contextKey":"founder.snapshot"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = '200bcc2d-5114-50a3-aecb-dd2e5196d0f3';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 3
 where journey_type = $cq$founder$cq$
   and (current_version is null or current_version < 3);
