/**
 * How Q asks each onboarding step whose `prompt` is a form label rather
 * than a question ("Your firm", "Typical cheque", "Website") (CQ-QX-005,
 * ACC round 3 #3, #4). Copy the platform owns, keyed by step, never a
 * reading of anything the person said.
 *
 * One source for every surface that asks a step's question: the interview
 * (q-api) and the conversation screen (web), so a label-only step reads as
 * the same question everywhere (QA 25 Oct: the heading after a tap read
 * just "Website"). Pure data: safe in a browser bundle.
 */

/** The question as Q asks it, for every step a label or a bare form question would read badly. */
export const SPOKEN_QUESTIONS: Readonly<Record<string, string>> = {
  "I0.organisation_name": "What's the name of your firm?",
  // Owner 2026-10-27: every step Q asks out loud, in plain words, never a
  // form label ("How do you invest?" alone meant nothing spoken).
  "I0.investor_type":
    "How do you invest: as an angel, through a fund, a family office, an accelerator, or something else?",
  "I1.deployment_status":
    "Are you actively writing cheques at the moment, or being more selective right now?",
  "I2.stages":
    "Which stages do you like to back: pre-seed, seed, Series A, or later?",
  "I2.investment_role":
    "Do you usually lead rounds, or come in alongside a lead?",
  "I3.geography": "Where do you invest? Any particular countries or regions?",
  "I3.geography_strength": "Is that a must for you, or more of a preference?",
  "I3.sectors": "Which sectors or kinds of products interest you most?",
  "I3.sector_strength": "Is that a must for you, or more of a preference?",
  "I5.founder_strength": "Is that a must for you, or more of a preference?",
  "I6.green_flag_strength": "Are those musts, or more of a preference?",
  "I6.custom_criteria":
    "Is there anything else you look for that we haven't covered?",
  "I9.discovery_mode":
    "When I show you companies, should I stick closely to what you've told me, or also show you a few interesting ones just outside it?",
  "I10.inbound_preference":
    "How open are you to founders reaching out to you: only well-matched ones, anyone, or nobody for now?",
  "F0.intent":
    "What brings you to Capital Q: are you raising for a company now, getting ready to raise, or just exploring?",
  "F1.country": "Where is the company based?",
  "F1.stage": "What stage is the company at: pre-seed, seed, Series A?",
  "F1.description": "In a sentence or two, what does the company do?",
  "F1.categories":
    "How would you describe the space you're in: the sector or industry?",
  "F2.materials":
    "Do you have a pitch deck or anything else I can read? You can upload it right here.",
  "F4.founder_count": "How many founders are there?",
  "F4.full_time": "Are the founders all full-time on it?",
  "F4.team_size": "How many people work on the company today?",
  "F4.functions":
    "What does the founding team cover between you: product, engineering, sales, operations?",
  "F5.signal":
    "What early traction do you have: pilots, paying customers, a waitlist, signed partners?",
  "F5.pilots": "How many pilots or design partners do you have?",
  "F5.revenue_status":
    "How would you describe your revenue today: recurring and growing, one-off projects, or just your first revenue?",
  "F5.growth": "How much have you grown over the last six months?",
  "F5.fin_currency": "Which currency do you report your numbers in?",
  "F5.monthly_revenue": "Roughly how much did you bill last month?",
  "F5.revenue_trend": "How has your monthly revenue been moving lately?",
  "F5.gross_margin": "What's your gross margin, roughly?",
  "F5.monthly_burn": "How much are you spending beyond revenue each month?",
  "F5.cash": "How much cash do you have in the bank today?",
  "F5.runway_months": "How many months of runway does that give you?",
  "F6.raising": "Are you raising right now?",
  "F6.timeframe": "When are you hoping to close the round?",
  "F6.use_of_funds": "What will the money mainly go towards?",
  "F6.min_cheque": "What's the smallest cheque you'd take?",
  "I0.business_title": "What's your role there?",
  "I0.website": "What's your firm's website?",
  "I1.mandate_context":
    "Are we setting up your main investment strategy, or a different one?",
  "I2.currency": "Which currency do you write cheques in?",
  "I2.cheque_min": "What's your minimum cheque?",
  "I2.cheque_typical": "What's a typical cheque for you?",
  "I2.cheque_max": "What's your maximum cheque?",
  "I3.sectors_avoid": "Are there sectors you'd rather not see?",
  "I4.business_models": "Which business models do you back?",
  "I4.customer_types": "Which customer types do you back?",
  "I4.capital_intensity": "How capital-intensive can a company be for you?",
  "I4.regulatory_appetite": "How do you feel about regulated markets?",
  "I4.revenue_state": "What revenue do you expect a company to have?",
  "I5.founder_preferences": "Which founding-team capabilities matter to you?",
  "I6.green_flags": "What are your green flags?",
  "I7.avoid": "What would you rather not see?",
  "I7.hard_exclusions": "Is there anything you never want to be shown?",
  "I7.sector_exclusions": "Are there sectors to exclude outright?",
  "I8.portfolio": "Could you name a few representative portfolio companies?",
  "I11.additional_context": "Is there anything we missed?",
  "I11.review":
    "That's your mandate. Shall I make it live, so Discover can match companies to it now?",
  "I12.handoff": "Your mandate is ready. Shall I take you to Discover?",
  "F1.company_name": "What's your company called?",
  "F1.website": "What's your website?",
  "F3.review": "Here's what I understood. Does it look right?",
  "F4.founder_role": "What's your role in the company?",
  "F5.customers": "How many paying customers do you have?",
  "F6.currency": "Which currency are you raising in?",
  "F6.target_amount": "How much are you raising?",
  "F6.instrument": "What instrument are you raising on?",
  "F7.follow_up": "There are a few things I still need. Could you fill me in?",
  "F8.snapshot":
    "Here's how I currently understand your company. Does that look right?",
};
