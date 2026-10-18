-- Q.01 · Founder onboarding v4: an adaptive financials block.
--
-- v3 stays published and immutable: sessions pinned to it keep running its
-- journey. v4 is v3 with optional F5 financial steps after growth (reporting
-- currency, last month's revenue and its trend and gross margin for a company
-- with revenue; burn, cash and runway for every company) and, when raising,
-- the smallest cheque after the use of funds. Each figure is written as the
-- founder's own claim through the Knowledge Write Gate (USER_CLAIM,
-- SELF_REPORTED, founder_private). Every v3 step key, order, branch and
-- mapping is unchanged.

-- Q01-FINANCIALS · Founder onboarding v4 (journey "founder")
-- GENERATED from packages/founder-onboarding/src/definition by renderOnboardingDefinitionMigration.
-- Do not edit by hand: a change to the journey is a new definition version.
-- Reference data published through the same rows the runtime publisher writes;
-- publishing the same manifest again is an idempotent no-op (manifest hash below).

insert into onboarding.definitions (id, journey_type, name)
values ('15f819f2-2265-54fc-90f4-30ab90d01cc6', $cq$founder$cq$, $cq$Founder onboarding$cq$)
on conflict (journey_type) do nothing;

insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
select '6a0e9750-9e04-5954-a135-471adc410e4a', d.id, 4,
       $cq${"schemaVersion":1,"phases":[{"phaseKey":"F0","label":"Welcome"},{"phaseKey":"F1","label":"Company"},{"phaseKey":"F2","label":"Materials"},{"phaseKey":"F3","label":"Review"},{"phaseKey":"F4","label":"Team"},{"phaseKey":"F5","label":"Traction"},{"phaseKey":"F6","label":"Raise"},{"phaseKey":"F7","label":"A few questions"},{"phaseKey":"F8","label":"Snapshot"}],"runtime":{"subjectType":"COMPANY","allowUnboundStart":true}}$cq$::jsonb,
       '09fdde22621697256881531420507bcc1dac2173d339a5cf86140629cbb9396c'
  from onboarding.definitions d
 where d.journey_type = $cq$founder$cq$;

insert into onboarding.steps
  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)
values
  ('23a83a24-1b08-5f81-a695-82ea2176ccaa', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F0.intent$cq$, 0, $cq$single_select$cq$, true,
   $cq${"prompt":"What brings you to Capital Q?","supportingText":"One tap. You can change this later.","phaseKey":"F0","options":[{"optionKey":"raising_now","label":"I'm raising for a company","description":"There is a round in motion or about to be."},{"optionKey":"preparing_to_raise","label":"I'm preparing to raise","description":"Getting the company and the story ready first."},{"optionKey":"exploring","label":"I'm exploring Capital Q","description":"Curious what Q can see before committing."}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('a1c56e25-b52d-552a-9048-ef3ac45ee8c9', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.company_name$cq$, 1, $cq$short_text$cq$, true,
   $cq${"prompt":"Your company","supportingText":"The name investors would recognise.","phaseKey":"F1","minLength":1,"maxLength":120}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.bootstrap"}]$cq$::jsonb),
  ('7dd977aa-9e10-56b4-ba03-38c77f5b6643', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.website$cq$, 2, $cq$short_text$cq$, false,
   $cq${"prompt":"Website","supportingText":"Optional. Q can read a website later to fill gaps.","phaseKey":"F1","minLength":1,"maxLength":200,"placeholder":"example.com"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('d3bc659e-f6a9-5527-882e-481812e41497', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.country$cq$, 3, $cq$single_select$cq$, false,
   $cq${"prompt":"Where is the company based?","supportingText":"Optional for now.","phaseKey":"F1","options":[{"optionKey":"ng","label":"Nigeria"},{"optionKey":"ke","label":"Kenya"},{"optionKey":"za","label":"South Africa"},{"optionKey":"gh","label":"Ghana"},{"optionKey":"eg","label":"Egypt"},{"optionKey":"gb","label":"United Kingdom"},{"optionKey":"us","label":"United States"},{"optionKey":"de","label":"Germany"},{"optionKey":"fr","label":"France"},{"optionKey":"nl","label":"Netherlands"},{"optionKey":"ae","label":"United Arab Emirates"},{"optionKey":"in","label":"India"},{"optionKey":"sg","label":"Singapore"},{"optionKey":"br","label":"Brazil"},{"optionKey":"ca","label":"Canada"},{"optionKey":"other","label":"Somewhere else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('a07c6560-3a1c-5f02-ac8d-b28d3555527d', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.stage$cq$, 4, $cq$single_select$cq$, true,
   $cq${"prompt":"What stage is the company at?","whyQAsks":"Stage decides which questions come next and how investors read the numbers.","phaseKey":"F1","options":[{"optionKey":"pre_seed","label":"Pre-seed"},{"optionKey":"seed","label":"Seed"},{"optionKey":"series_a","label":"Series A"},{"optionKey":"series_b","label":"Series B"},{"optionKey":"series_c_plus","label":"Series C or later"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('d8193e2c-5330-5773-a121-3d93c521ff32', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.description$cq$, 5, $cq$long_text$cq$, false,
   $cq${"prompt":"In a sentence or two, what does the company do?","supportingText":"Plain words are best. Who it's for and what it changes for them.","phaseKey":"F1","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.basics"}]$cq$::jsonb),
  ('c5b28637-16e1-5a89-af03-c7843f162d0c', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F1.categories$cq$, 6, $cq$reference_select$cq$, false,
   $cq${"prompt":"How would you categorise the company?","supportingText":"Suggested categories come from your description. Pick the ones that fit; nothing is assigned until you confirm.","phaseKey":"F1","resourceType":"TAXONOMY_NODE","vocabularyCodes":["industry","product_category","business_model","customer_type"],"minItems":1,"maxItems":8}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.taxonomy"}]$cq$::jsonb),
  ('11777352-130e-54ef-935c-b3e72080080c', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F2.materials$cq$, 7, $cq$document_upload$cq$, false,
   $cq${"prompt":"What do you already have?","supportingText":"Give Q anything that already explains the business — a deck, a financial model, management accounts. Private to your company unless you choose to share it. You can skip this.","phaseKey":"F2","allowedResourceTypes":["EVIDENCE_DOCUMENT"],"minItems":0,"maxItems":6}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('44767506-6861-5630-bf81-0c68e8360de9', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F3.review$cq$, 8, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's what I understood","supportingText":"From what you gave me. Confirm what's right, fix what isn't, and tell me what I missed.","phaseKey":"F3","confirmLabel":"That's right","requireAffirmative":true,"contextKey":"founder.review"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('ebbdfad7-d21d-5f51-bae6-9b1e1c4d7adc', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F4.founder_role$cq$, 9, $cq$single_select$cq$, true,
   $cq${"prompt":"Your role","phaseKey":"F4","options":[{"optionKey":"ceo","label":"CEO"},{"optionKey":"cto","label":"CTO"},{"optionKey":"coo","label":"COO"},{"optionKey":"cpo","label":"Product"},{"optionKey":"other","label":"Something else"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"founder.membership"}]$cq$::jsonb),
  ('cb95637a-1aaa-58cb-affb-6981875dfc79', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F4.founder_count$cq$, 10, $cq$range$cq$, true,
   $cq${"prompt":"How many founders?","phaseKey":"F4","min":"1","max":"50","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('94877e16-0b34-50fe-b0fd-42fc68e52477', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F4.full_time$cq$, 11, $cq$single_select$cq$, true,
   $cq${"prompt":"Are the founders full-time?","phaseKey":"F4","options":[{"optionKey":"all","label":"All founders are full-time"},{"optionKey":"some","label":"Some founders are full-time"},{"optionKey":"none","label":"Not full-time yet"}]}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('6eb2aa5d-940f-507c-8b10-9f50b9bb30ca', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F4.team_size$cq$, 12, $cq$range$cq$, true,
   $cq${"prompt":"How many people work on the company today?","supportingText":"Founders included.","phaseKey":"F4","min":"1","max":"100000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.team_facts"}]$cq$::jsonb),
  ('f08279c4-774f-5206-9350-358a9b31cc5e', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F4.functions$cq$, 13, $cq$multi_select$cq$, false,
   $cq${"prompt":"Which of these does the founding team cover?","phaseKey":"F4","options":[{"optionKey":"product","label":"Product"},{"optionKey":"engineering","label":"Engineering"},{"optionKey":"sales","label":"Sales and partnerships"},{"optionKey":"operations","label":"Operations"},{"optionKey":"finance","label":"Finance"},{"optionKey":"domain","label":"Deep industry expertise"}],"minSelections":1,"maxSelections":6,"exclusiveOptionKeys":[]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('8010d756-6af3-5932-9a90-9aca6e700579', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.signal$cq$, 14, $cq$single_select$cq$, true,
   $cq${"prompt":"What early signal do you have?","phaseKey":"F5","options":[{"optionKey":"pilots","label":"Pilots running"},{"optionKey":"lois","label":"Signed letters of intent"},{"optionKey":"waitlist","label":"A waitlist"},{"optionKey":"users","label":"Active users, not yet paying"},{"optionKey":"paying","label":"Paying customers"},{"optionKey":"partnerships","label":"Signed partnerships or distribution deals"},{"optionKey":"none","label":"Nothing measurable yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('86ec2a69-973a-511d-af13-20bcfd9a0c0b', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.pilots$cq$, 15, $cq$range$cq$, false,
   $cq${"prompt":"How many pilots or design partners?","phaseKey":"F5","min":"0","max":"10000","step":"1"}$cq$::jsonb,
   $cq${"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["pilots","lois"]}]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('740b0912-8ab2-58c6-abfe-17ab2d075765', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.revenue_status$cq$, 16, $cq$single_select$cq$, true,
   $cq${"prompt":"How would you describe revenue today?","phaseKey":"F5","options":[{"optionKey":"recurring","label":"Recurring and growing"},{"optionKey":"recurring_flat","label":"Recurring, roughly flat"},{"optionKey":"project","label":"Project or one-off revenue"},{"optionKey":"early","label":"First revenue only"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('3a6a2b55-610d-535a-91eb-e5ee5dcbd7da', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.customers$cq$, 17, $cq$range$cq$, false,
   $cq${"prompt":"Paying customers","phaseKey":"F5","min":"0","max":"10000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('19bcd6d7-48c6-5b76-a361-a0c4021c4569', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.growth$cq$, 18, $cq$single_select$cq$, false,
   $cq${"prompt":"Growth over the last six months","phaseKey":"F5","options":[{"optionKey":"over_100","label":"More than doubled"},{"optionKey":"50_100","label":"Grew 50–100%"},{"optionKey":"under_50","label":"Grew under 50%"},{"optionKey":"flat","label":"Flat or down"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('6ecd8ffc-e076-5aa2-b92f-ebff25863b89', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.fin_currency$cq$, 19, $cq$single_select$cq$, false,
   $cq${"prompt":"Which currency do you report your numbers in?","supportingText":"Only your team sees your financials. Skip anything you don't know yet.","phaseKey":"F5","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('c55f6bf5-cc61-55e4-9509-005afcb085a8', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.monthly_revenue$cq$, 20, $cq$range$cq$, false,
   $cq${"prompt":"Roughly what did you bill last month?","supportingText":"A round number is fine.","phaseKey":"F5","min":"0","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"ANY","expressions":[{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]},{"op":"EXISTS","stepKey":"F5.revenue_status"}]},{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["paying"]}]}]}$cq$::jsonb,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('dedc1d0d-f4e3-581c-b06b-264b8601b9f0', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.revenue_trend$cq$, 21, $cq$single_select$cq$, false,
   $cq${"prompt":"How has monthly revenue moved lately?","phaseKey":"F5","options":[{"optionKey":"growing","label":"Growing month on month"},{"optionKey":"flat","label":"Roughly flat"},{"optionKey":"declining","label":"Declining"},{"optionKey":"lumpy","label":"Lumpy: depends on the month"}]}$cq$::jsonb,
   $cq${"op":"ANY","expressions":[{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]},{"op":"EXISTS","stepKey":"F5.revenue_status"}]},{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["paying"]}]}]}$cq$::jsonb,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('f52b83be-a23b-5649-adef-1d9963068232', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.gross_margin$cq$, 22, $cq$range$cq$, false,
   $cq${"prompt":"What is your gross margin?","supportingText":"As a percentage of revenue.","phaseKey":"F5","min":"-100","max":"100","step":"1","unit":"%"}$cq$::jsonb,
   $cq${"op":"ANY","expressions":[{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["series_a","series_b","series_c_plus"]},{"op":"EXISTS","stepKey":"F5.revenue_status"}]},{"op":"ALL","expressions":[{"op":"IN","stepKey":"F1.stage","values":["pre_seed","seed","unsure"]},{"op":"IN","stepKey":"F5.signal","values":["paying"]}]}]}$cq$::jsonb,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('2df7dbc7-a555-5924-9034-fbad89d4cae2', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.monthly_burn$cq$, 23, $cq$range$cq$, false,
   $cq${"prompt":"How much do you spend beyond revenue each month?","supportingText":"Net burn. Investors never see this unless you share it.","phaseKey":"F5","min":"0","max":"1000000000000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('7acb9cdd-cd15-50ed-8c7f-065e2005a9a0', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.cash$cq$, 24, $cq$range$cq$, false,
   $cq${"prompt":"How much cash is in the bank today?","supportingText":"Investors never see this unless you share it.","phaseKey":"F5","min":"0","max":"1000000000000","step":"1"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('98d582a5-8ffc-560e-a94e-815d6d2a5477', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F5.runway_months$cq$, 25, $cq$range$cq$, false,
   $cq${"prompt":"How many months of runway is that?","phaseKey":"F5","min":"0","max":"240","step":"1","unit":"months"}$cq$::jsonb,
   null,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('043cbf43-63eb-574b-9778-312ac959167a', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.raising$cq$, 26, $cq$single_select$cq$, true,
   $cq${"prompt":"Are you raising now?","phaseKey":"F6","options":[{"optionKey":"active","label":"Yes, actively"},{"optionKey":"preparing","label":"Preparing to raise"},{"optionKey":"not_now","label":"Not right now"}]}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('2a1d0e38-4078-5046-8761-ca5af7560fc3', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.currency$cq$, 27, $cq$single_select$cq$, true,
   $cq${"prompt":"Currency","phaseKey":"F6","options":[{"optionKey":"usd","label":"US dollar"},{"optionKey":"eur","label":"Euro"},{"optionKey":"gbp","label":"Pound sterling"},{"optionKey":"ngn","label":"Nigerian naira"},{"optionKey":"kes","label":"Kenyan shilling"},{"optionKey":"zar","label":"South African rand"},{"optionKey":"aed","label":"UAE dirham"},{"optionKey":"inr","label":"Indian rupee"},{"optionKey":"sgd","label":"Singapore dollar"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('e2706a46-0f7c-55bd-a947-11f2b18d827b', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.target_amount$cq$, 28, $cq$range$cq$, true,
   $cq${"prompt":"Target amount","supportingText":"An exact figure, in the currency above.","phaseKey":"F6","min":"1","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('a0d2c338-ab2b-5fd5-b898-9b760cbf6def', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.instrument$cq$, 29, $cq$single_select$cq$, false,
   $cq${"prompt":"Instrument","phaseKey":"F6","options":[{"optionKey":"priced","label":"Priced equity round"},{"optionKey":"safe","label":"SAFE"},{"optionKey":"convertible","label":"Convertible note"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('9fde7c68-79be-51b4-992a-b2a4eefa0865', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.timeframe$cq$, 30, $cq$single_select$cq$, false,
   $cq${"prompt":"When do you want to close?","phaseKey":"F6","options":[{"optionKey":"under_3","label":"Within 3 months"},{"optionKey":"3_6","label":"3–6 months"},{"optionKey":"6_12","label":"6–12 months"},{"optionKey":"unsure","label":"Not sure yet"}]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('993e9e7f-7500-5bf2-af7c-309c09829733', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.use_of_funds$cq$, 31, $cq$multi_select$cq$, false,
   $cq${"prompt":"What will the money mainly go to?","phaseKey":"F6","options":[{"optionKey":"product","label":"Product and engineering"},{"optionKey":"hiring","label":"Key hires"},{"optionKey":"gtm","label":"Sales and go-to-market"},{"optionKey":"runway","label":"Runway and operations"},{"optionKey":"expansion","label":"New markets"}],"minSelections":1,"maxSelections":5,"exclusiveOptionKeys":[]}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[]$cq$::jsonb),
  ('7d12e84a-0964-599f-8404-408e931bcb89', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.min_cheque$cq$, 32, $cq$range$cq$, false,
   $cq${"prompt":"What is the smallest cheque you would take?","supportingText":"In the raise's currency. Skip if any size is welcome.","phaseKey":"F6","min":"0","max":"1000000000000","step":"1"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[{"targetKey":"company.financial_claims"}]$cq$::jsonb),
  ('5b6339e0-e899-596c-aa53-e2ce54e6d381', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F6.confirm$cq$, 33, $cq$confirmation$cq$, true,
   $cq${"prompt":"Save this as your capital objective?","supportingText":"This becomes the company's current raise. You can recalibrate it any time.","phaseKey":"F6","confirmLabel":"Save my raise","requireAffirmative":true,"contextKey":"founder.raise"}$cq$::jsonb,
   $cq${"op":"IN","stepKey":"F6.raising","values":["active","preparing"]}$cq$::jsonb,
   $cq$[{"targetKey":"capital.objective"}]$cq$::jsonb),
  ('7230a692-eb34-5c06-bc67-2bfaa88fa382', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F7.follow_up$cq$, 34, $cq$long_text$cq$, false,
   $cq${"prompt":"A few things I still need","supportingText":"Only what materially changes what I understand. Answer what you can; \"I don't know\" is a real answer.","phaseKey":"F7","minLength":1,"maxLength":2000}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb),
  ('90b149e5-7145-53c5-b97d-e4e86952f5db', '6a0e9750-9e04-5954-a135-471adc410e4a', $cq$F8.snapshot$cq$, 35, $cq$confirmation$cq$, true,
   $cq${"prompt":"Here's how I currently understand your company","supportingText":"Built from what you told me and the material you shared. It will get sharper as more evidence arrives.","phaseKey":"F8","confirmLabel":"Go to Home","requireAffirmative":true,"contextKey":"founder.snapshot"}$cq$::jsonb,
   null,
   $cq$[]$cq$::jsonb);

-- Publication freezes the version and its steps (trigger-enforced).
update onboarding.definition_versions set published_at = now() where id = '6a0e9750-9e04-5954-a135-471adc410e4a';

-- New sessions pin to this version; existing sessions keep theirs.
update onboarding.definitions
   set current_version = 4
 where journey_type = $cq$founder$cq$
   and (current_version is null or current_version < 4);
