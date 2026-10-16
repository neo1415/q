# Form onboarding parity — gap note (lane ob2, 2026-10-16)

Scope: owner directive 2026-10-16, "Form onboarding equally capable". Field
list source of truth: the published onboarding definitions
(`packages/founder-onboarding/src/definition/founder-v5.ts`,
`packages/investor-onboarding/src/definition/investor-v1.ts`). Lane `ob1`
owns the canonical coverage model; this note does **not** fork the field
list. When ob1's coverage contract lands, the "coverage state" column below
is filled from it, not from a second list.

## What is already shared (no gap)

- **One definition, one session, one persistence path.** The form screens
  render the session view of the same published definition the conversation
  uses. `/say` places spoken answers through the same submit/skip paths a
  tap uses (`apps/api/src/http/onboarding.ts`), so the write targets,
  idempotency, versions and canonical records are identical.
- **Every definition step is rendered by the form.** Founder v5: 36/36 steps
  are in a form group (`apps/web/src/features/founder-onboarding/models/journey.ts`
  `GROUPS`). Investor v1: 35/35 (`investor-onboarding/models/journey.ts`).
- **Conditional steps** come from the definition's `branching`; the form shows
  only eligible steps, exactly as the conversation does.
- **Mode switching** exists both ways ("Talk with Q" on the form; "Use the
  form" on the voice stage) over the same session, so answers given in either
  mode appear in the other after reload.
- **Saved progress** is server-side per step (session version + step states).

## Gaps (form vs. the directive)

| # | Gap | Founder | Investor | Owner |
|---|---|---|---|---|
| G1 | Registration defaults: the organisation typed at sign-up does not prefill the name step | missing | missing | ob2 (this lane) |
| G2 | Registration role choice: journey chosen at sign-up; welcome re-asked "raising or investing?" | missing | missing | ob2 |
| G3 | Per-field coverage state (known / supplied-unconfirmed / confirmed / missing / contradictory / inapplicable / evidence needed / deferrable) | none: steps are only completed/skipped/pending | same | ob1 contract, ob2 renders |
| G4 | Completion overview: which required fields remain, across sections, with jump-to | progress bar by section only; Review step lists Q suggestions | same | ob2 on ob1 contract |
| G5 | "Supplied but unconfirmed" values from Q (spoken, deck, research) shown in place on the step they fill, with confirm/edit/reject | only on Review (founder) | not shown in place | ob2 on ob1 contract |
| G6 | Optional uploads available on any step, not only F2 | F2 only | **no upload at all** | ob2 (investor: materials are not in the definition — needs an ob1 coverage decision, not a forked field) |
| G7 | Inline validation for every field type (ranges, money, URL, required) before submit | partial (name, URL server-side) | partial | ob2 |
| G8 | Required vs optional marked on each field | not shown | not shown | ob2 |
| G9 | Deferrable fields ("later") distinct from skip | skip only | skip only | ob1 contract |
| G10 | Q's recorded notes / statements visible in the form as unconfirmed (never as fact) | not shown | not shown | ob1 contract |

## Registration-side defects found while mapping

- **D1 crossover (fixed in this lane):** `bootstrapInvestor` reused the active
  organisation context whatever it was. A founder (active context = their
  company organisation) starting the investor journey got an investor
  organisation created *inside the company's organisation*. Symmetrically
  `bootstrapCompany` reused a firm's context for a company. Fix: a journey
  reuses the active organisation only when it is a workspace of that journey's
  kind and holds nothing of the other kind; otherwise it creates the person's
  own organisation.
- **D2 teammate treated as founder (fixed in this lane):** a person invited into a
  company's organisation (MEMBER/ADMIN, not OWNER) who started the founder
  journey had a second company created in that organisation with
  `is_founder = true` for them. Fix: a company organisation that already holds
  a company is reused only by its OWNER; anyone else gets their own new
  organisation.

## Field list (generated from the published definitions)


### founder v5

| Step | Type | Required | Condition | Writes to | Prompt |
|---|---|---|---|---|---|
| F0.intent | single_select | yes | always |  | What brings you to Capital Q? |
| F1.company_name | short_text | yes | always | company.bootstrap | Your company |
| F1.website | short_text | no | always | company.basics | Website |
| F1.country | single_select | no | always | company.basics | Where is the company based? |
| F1.stage | single_select | yes | always | company.basics | What stage is the company at? |
| F1.description | long_text | no | always | company.basics | In a sentence or two, what does the company do? |
| F1.categories | reference_select | no | always | company.taxonomy | How would you categorise the company? |
| F2.materials | document_upload | no | always |  | What do you already have? |
| F3.review | confirmation | yes | always |  | Here's what I understood |
| F4.founder_role | single_select | yes | always | founder.membership | Your role |
| F4.founder_count | range | yes | always | company.team_facts | How many founders? |
| F4.full_time | single_select | yes | always | company.team_facts | Are the founders full-time? |
| F4.team_size | range | yes | always | company.team_facts | How many people work on the company today? |
| F4.functions | multi_select | no | always |  | Which of these does the founding team cover? |
| F5.signal | single_select | yes | F1.stage IN pre_seed/seed/unsure |  | What early signal do you have? |
| F5.pilots | range | no | F1.stage IN pre_seed/seed/unsure and F5.signal IN pilots/lois |  | How many pilots or design partners? |
| F5.revenue_status | single_select | yes | F1.stage IN series_a/series_b/series_c_plus |  | How would you describe revenue today? |
| F5.customers | range | no | F1.stage IN series_a/series_b/series_c_plus |  | Paying customers |
| F5.growth | single_select | no | F1.stage IN series_a/series_b/series_c_plus |  | Growth over the last six months |
| F5.fin_currency | single_select | no | always |  | Which currency do you report your numbers in? |
| F5.monthly_revenue | range | no | F1.stage IN series_a/series_b/series_c_plus and F5.revenue_status answered or F1.stage IN pre_seed/seed/unsure and F5.signal IN paying | company.financial_claims | Roughly what did you bill last month? |
| F5.revenue_trend | single_select | no | F1.stage IN series_a/series_b/series_c_plus and F5.revenue_status answered or F1.stage IN pre_seed/seed/unsure and F5.signal IN paying | company.financial_claims | How has monthly revenue moved lately? |
| F5.gross_margin | range | no | F1.stage IN series_a/series_b/series_c_plus and F5.revenue_status answered or F1.stage IN pre_seed/seed/unsure and F5.signal IN paying | company.financial_claims | What is your gross margin? |
| F5.monthly_burn | range | no | always | company.financial_claims | How much do you spend beyond revenue each month? |
| F5.cash | range | no | always | company.financial_claims | How much cash is in the bank today? |
| F5.runway_months | range | no | always | company.financial_claims | How many months of runway is that? |
| F6.raising | single_select | yes | always |  | Are you raising now? |
| F6.currency | single_select | yes | F6.raising IN active/preparing |  | Currency |
| F6.target_amount | range | yes | F6.raising IN active/preparing |  | Target amount |
| F6.instrument | single_select | no | F6.raising IN active/preparing |  | Instrument |
| F6.timeframe | single_select | no | F6.raising IN active/preparing |  | When do you want to close? |
| F6.use_of_funds | multi_select | no | F6.raising IN active/preparing |  | What will the money mainly go to? |
| F6.min_cheque | range | no | F6.raising IN active/preparing | company.financial_claims | What is the smallest cheque you would take? |
| F6.confirm | confirmation | yes | F6.raising IN active/preparing | capital.objective | Save this as your capital objective? |
| F7.follow_up | long_text | no | always |  | A few things I still need |
| F8.snapshot | confirmation | yes | always |  | Here's how I currently understand your company |

### investor v1

| Step | Type | Required | Condition | Writes to | Prompt |
|---|---|---|---|---|---|
| I0.investor_type | single_select | yes | always |  | How do you invest? |
| I0.organisation_name | short_text | yes | always | investor.bootstrap | Your firm |
| I0.business_title | short_text | no | always | investor.representative | Your role there |
| I1.deployment_status | single_select | yes | always | investor.deployment_status, investor.mandate.ensure | Are you deploying capital right now? |
| I1.mandate_context | reference_select | yes | always | investor.mandate.select | Which mandate are we defining? |
| I2.stages | multi_select | yes | always | investor.mandate.stage_cheque | Which stages do you invest at? |
| I2.currency | single_select | yes | always | investor.mandate.stage_cheque | Cheque currency |
| I2.cheque_min | range | no | always | investor.mandate.stage_cheque | Minimum cheque |
| I2.cheque_typical | range | no | always | investor.mandate.stage_cheque | Typical cheque |
| I2.cheque_max | range | no | always | investor.mandate.stage_cheque | Maximum cheque |
| I2.investment_role | multi_select | no | always | investor.mandate.stage_cheque | How do you usually take part? |
| I3.geography | reference_select | no | always | investor.mandate.taxonomy | Where do you invest? |
| I3.geography_strength | single_select | no | I3.geography answered | investor.mandate.taxonomy | How firm is that? |
| I3.sectors | reference_select | no | always | investor.mandate.taxonomy | Which sectors and product areas? |
| I3.sector_strength | single_select | no | I3.sectors answered | investor.mandate.taxonomy | How firm is that? |
| I3.sectors_avoid | reference_select | no | always | investor.mandate.taxonomy | Sectors you'd rather not see |
| I4.business_models | reference_select | no | always | investor.mandate.taxonomy | Business models you back |
| I4.customer_types | reference_select | no | always | investor.mandate.taxonomy | Customer types you back |
| I4.capital_intensity | single_select | no | always | investor.mandate.business_attributes | Capital intensity |
| I4.regulatory_appetite | single_select | no | always | investor.mandate.business_attributes | Regulated markets |
| I4.revenue_state | single_select | no | always |  | Revenue expectations |
| I5.founder_preferences | multi_select | no | always | investor.mandate.founder_preferences | Founding-team capabilities that matter to you |
| I5.founder_strength | single_select | no | I5.founder_preferences answered | investor.mandate.founder_preferences | How firm is that? |
| I6.green_flags | multi_select | no | always | investor.mandate.green_flags | Green flags |
| I6.green_flag_strength | single_select | no | I6.green_flags answered | investor.mandate.green_flags | How firm are those? |
| I6.custom_criteria | long_text | no | always | investor.mandate.green_flags | Anything else you look for? |
| I7.avoid | multi_select | no | always | investor.mandate.exclusions | I'd rather not see |
| I7.hard_exclusions | multi_select | no | always | investor.mandate.exclusions | Never show me |
| I7.sector_exclusions | reference_select | no | always | investor.mandate.taxonomy | Sectors to exclude outright |
| I8.portfolio | long_text | no | always | investor.portfolio | A few representative portfolio companies |
| I9.discovery_mode | single_select | yes | always | investor.mandate.discovery_mode | How adventurous should discovery be? |
| I10.inbound_preference | single_select | yes | always |  | How should founders reach you? |
| I11.additional_context | long_text | no | always | investor.mandate.raw_text | Add something we missed |
| I11.review | confirmation | yes | always | investor.mandate.confirm | Here's the mandate you've defined |
| I12.handoff | confirmation | yes | always |  | Your mandate is ready |
