-- CQ-Q-021 · Founder onboarding v2.
--
-- v1 stays published and immutable: sessions pinned to it keep running its
-- journey. v2 replaces four placeholder steps with the real ones — F2 a
-- document upload against the Evidence API, F3 a review of what Q read from
-- those documents, F7 the questions Q still needs, F8 a Company Intelligence
-- reading — and inherits every other step from v1 unchanged.

-- CQ-Q-021 · Founder onboarding v2 (journey "founder")
-- GENERATED from packages/founder-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('15f819f2-2265-54fc-90f4-30ab90d01cc6', $cq$founder$cq$, $cq$Founder onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select 'f41daec5-631f-5df7-9648-231ff95267d6', d.id, 2,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"F0","label":"Welcome"},{"phaseKey":"F1","label":"Company"},{"phaseKey":"F2","label":"Materials"},{"phaseKey":"F3","label":"Review"},{"phaseKey":"F4","label":"Team"},{"phaseKey":"F5","label":"Traction"},{"phaseKey":"F6","label":"Raise"},{"phaseKey":"F7","label":"A few questions"},{"phaseKey":"F8","label":"Snapshot"}],"runtime":{"subjectType":"COMPANY","allowUnboundStart":true}}$cq$::jsonb,
       '259f4218f89d8ef7a388a95314a2668973a82186b5a9078e53a602be5f451e1e'
  from onboarding.definitions d
 where d.journey_type = $cq$founder$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('33d3ebcd-8268-544c-82dc-cc281720e98a', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F0.intent$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"What brings you to Capital Q?","supportingText":"One tap. You can change this later.","phaseKey":"F0","options":[{"optionKey":"raising_now","label":"I'm raising for a company","description":"There is a round in motion or about to be."},{"optionKey":"preparing_to_raise","label":"I'm preparing to raise","description":"Getting the company and the story ready first."},{"optionKey":"exploring","label":"I'm exploring Capital Q","description":"Curious what Q can see before committing."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('cc480b20-cf56-562b-97a8-bad8060b310b', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.company_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your company","supportingText":"The name investors would recognise.","phaseKey":"F1","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.bootstrap"}]$cq$::jsonb),
  ('cf6ec463-e9e5-5149-9a41-07398c250b0d', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Website","supportingText":"Optional. Q can read a website later to fill gaps.","phaseKey":"F1","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('0abc2f2c-c295-52ba-a338-07efb53f42ba', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.country$cq$, 3, $cq$single_select$cq$, false,
   $cq${"prompt":"Where is the company based?","supportingText":"Optional for now.","phaseKey":"F1","options":[{"optionKey":"ng","label":"Nigeria"},{"optionKey":"ke","label":"Kenya"},{"optionKey":"za","label":"South Africa"},{"optionKey":"gh","label":"Ghana"},{"optionKey":"eg","label":"Egypt"},{"optionKey":"gb","label":"United Kingdom"},{"optionKey":"us","label":"United States"},{"optionKey":"de","label":"Germany"},{"optionKey":"fr","label":"France"},{"optionKey":"nl","label":"Netherlands"},{"optionKey":"ae","label":"United Arab Emirates"},{"optionKey":"in","label":"India"},{"optionKey":"sg","label":"Singapore"},{"optionKey":"br","label":"Brazil"},{"optionKey":"ca","label":"Canada"},{"optionKey":"other","label":"Somewhere else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('ac00b073-1a44-5fe8-bf45-780f23b414d2', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.stage$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"What stage is the company at?","whyQAsks":"Stage decides which questions come next and how investors read the numbers.","phaseKey":"F1","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('68e82fa8-06e7-5bcc-b7bb-a4ec9cb557fc', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.description$cq$, 5, $cq$long_text$cq$, false,
   $cq${"prompt":"In a sentence or two, what does the company do?","supportingText":"Plain words are best. Who it's for and what it changes for them.","phaseKey":"F1","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('dedd1502-f430-5259-8bc1-b3b6534947cb', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F1.categories$cq$, 6, $cq$reference_select$cq$, false,
   $cq${"prompt":"How would you categorise the company?","supportingText":"Suggested categories come from your description. Pick the ones that fit; nothing is assigned until you confirm.","phaseKey":"F1","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category","business_model","customer_type"],"minItems":1,"maxItems":8}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.taxonomy"}]$cq$::jsonb),
  ('831815d1-effe-5e43-82e3-f6f24a3be66d', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F2.materials$cq$, 7, $cq$document_upload$cq$, false,
   $cq${"prompt":"What do you already have?","supportingText":"Give Q anything that already explains the business — a deck, a financial model, management accounts. Private to your company unless you choose to share it. You can skip this.","phaseKey":"F2","allowedResourceTypes":["EVIDENCE_DOCUMENT"],"minItems":0,"maxItems":6}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('4aca041b-80b3-5f11-9300-353bc1903315', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F3.review$cq$, 8, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's what I understood","supportingText":"From what you gave me. Confirm what's right, fix what isn't, and tell me what I missed.","phaseKey":"F3","confirmLabel":"That's right","requireAffirmative":true,"contextKey":"founder.review"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('f744fccc-3550-5f2f-be8a-77e261c74722', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F4.founder_role$cq$, 9, $cq$single_select$cq$, true,
   $cq${"prompt":"Your role","phaseKey":"F4","options":[{"optionKey":"ceo","label":"CEO"},{"optionKey":"cto","label":"CTO"},{"optionKey":"coo","label":"COO"},{"optionKey":"cpo","label":"Product"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"founder.membership"}]$cq$::jsonb),
  ('2354bf08-1366-51f7-b691-892c554fcf56', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F4.founder_count$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"How many founders?","phaseKey":"F4","min":"1","max":"50","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('36d1f764-04dc-58e2-8926-e69fbd159df0', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F4.full_time$cq$, 11, $cq$single_select$cq$, true,
   $cq${"prompt":"Are the founders full-time?","phaseKey":"F4","options":[{"optionKey":"all","label":"All founders are full-time"},{"optionKey":"some","label":"Some founders are full-time"},{"optionKey":"none","label":"Not full-time yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('6f6a480a-f444-5dff-a5d6-6fcf64c487ea', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F4.team_size$cq$, 12, $cq$range$cq$, true,
   $cq${"prompt":"How many people work on the company today?","supportingText":"Founders included.","phaseKey":"F4","min":"1","max":"100000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('59e63639-3c57-5f92-8989-184a3381789f', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F4.functions$cq$, 13, $cq$multi_select$cq$, false,
   $cq${"prompt":"Which of these does the founding team cover?","phaseKey":"F4","options":[{"optionKey":"product","label":"Product"},{"optionKey":"engineering","label":"Engineering"},{"optionKey":"sales","label":"Sales and partnerships"},{"optionKey":"operations","label":"Operations"},{"optionKey":"finance","label":"Finance"},{"optionKey":"domain","label":"Deep industry expertise"}],"minSelections":1,"maxSelections":6,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('6c6f98e2-bebe-5275-81b7-546f5169723f', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F5.signal$cq$, 14, $cq$single_select$cq$, true,
   $cq${"prompt":"What early signal do you have?","phaseKey":"F5","options":[{"optionKey":"pilots","label":"Pilots running"},{"optionKey":"lois","label":"Signed letters of intent"},{"optionKey":"waitlist","label":"A waitlist"},{"optionKey":"users","label":"Active users, not yet paying"},{"optionKey":"none","label":"Nothing measurable yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('9174e859-5b25-5deb-8156-e954411b1f13', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F5.pilots$cq$, 15, $cq$range$cq$, false,
   $cq${"prompt":"How many pilots or design partners?","phaseKey":"F5","min":"0","max":"10000","step":"1"}$cq$::jsonb,
   $cq${"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["pilots","lois"]}]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('ae662cb6-e812-5c2b-87ad-d8534b258d19', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F5.revenue_status$cq$, 16, $cq$single_select$cq$, true,
   $cq${"prompt":"How would you describe revenue today?","phaseKey":"F5","options":[{"optionKey":"recurring","label":"Recurring and growing"},{"optionKey":"recurring_flat","label":"Recurring, roughly flat"},{"optionKey":"project","label":"Project or one-off revenue"},{"optionKey":"early","label":"First revenue only"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('5a24198a-e1ba-59e8-befa-369784e79d01', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F5.customers$cq$, 17, $cq$range$cq$, false,
   $cq${"prompt":"Paying customers","phaseKey":"F5","min":"0","max":"10000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('21849886-4632-564e-9138-fd7420b62e53', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F5.growth$cq$, 18, $cq$single_select$cq$, false,
   $cq${"prompt":"Growth over the last six months","phaseKey":"F5","options":[{"optionKey":"over_100","label":"More than doubled"},{"optionKey":"50_100","label":"Grew 50–100%"},{"optionKey":"under_50","label":"Grew under 50%"},{"optionKey":"flat","label":"Flat or down"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('67763cde-2937-55e6-ba48-986bffb7f604', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.raising$cq$, 19, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you raising now?","phaseKey":"F6","options":[{"optionKey":"active","label":"Yes, actively"},{"optionKey":"preparing","label":"Preparing to raise"},{"optionKey":"not_now","label":"Not right now"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('b53dfa1a-939a-5742-adcf-01c920cc2448', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.currency$cq$, 20, $cq$single_select$cq$, true,
   $cq${"prompt":"Currency","phaseKey":"F6","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('3dfa3a16-ac41-54a4-a330-c0322186d48b', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.target_amount$cq$, 21, $cq$range$cq$, true,
   $cq${"prompt":"Target amount","supportingText":"An exact figure, in the currency above.","phaseKey":"F6","min":"1","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('b4656ba1-47ab-58c3-8ec7-ca1c835baded', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.instrument$cq$, 22, $cq$single_select$cq$, false,
   $cq${"prompt":"Instrument","phaseKey":"F6","options":[{"optionKey":"priced","label":"Priced equity round"},{"optionKey":"safe","label":"SAFE"},{"optionKey":"convertible","label":"Convertible note"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('65a199a4-d804-58fc-9037-93776c598b5b', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.timeframe$cq$, 23, $cq$single_select$cq$, false,
   $cq${"prompt":"When do you want to close?","phaseKey":"F6","options":[{"optionKey":"under_3","label":"Within 3 months"},{"optionKey":"3_6","label":"3–6 months"},{"optionKey":"6_12","label":"6–12 months"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('09a50a86-362d-5eed-a087-1a5bc68113ab', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.use_of_funds$cq$, 24, $cq$multi_select$cq$, false,
   $cq${"prompt":"What will the money mainly go to?","phaseKey":"F6","options":[{"optionKey":"product","label":"Product and engineering"},{"optionKey":"hiring","label":"Key hires"},{"optionKey":"gtm","label":"Sales and go-to-market"},{"optionKey":"runway","label":"Runway and operations"},{"optionKey":"expansion","label":"New markets"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('320167e6-0ab8-5862-a9ba-6a6c4e051838', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F6.confirm$cq$, 25, $cq$confirmation$cq$, true,
   $cq${"prompt":"Save this as your capital objective?","supportingText":"This becomes the company's current raise. You can recalibrate it any time.","phaseKey":"F6","confirmLabel":"Save my raise","requireAffirmative":true,"contextKey":"founder.raise"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[{"targetKey":"capital.objective"}]$cq$::jsonb),
  ('e643e688-e170-534b-ac71-f3cb770f0fd2', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F7.follow_up$cq$, 26, $cq$long_text$cq$, false,
   $cq${"prompt":"A few things I still need","supportingText":"Only what materially changes what I understand. Answer what you can; \"I don't know\" is a real answer.","phaseKey":"F7","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('d194b7b2-2169-5cc4-9394-8b91998afdf8', 'f41daec5-631f-5df7-9648-231ff95267d6', $cq$F8.snapshot$cq$, 27, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's how I currently understand your company","supportingText":"Built from what you told me and the material you shared. It will get sharper as more evidence arrives.","phaseKey":"F8","confirmLabel":"Go to Home","requireAffirmative":true,"contextKey":"founder.snapshot"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = 'f41daec5-631f-5df7-9648-231ff95267d6';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 2
 where journey_type = $cq$founder$cq$
   and (current_version is null or current_version < 2);
