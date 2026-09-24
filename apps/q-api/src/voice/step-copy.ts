/**
 * How Q says each onboarding step, when the platform (not the model) has
 * to compose the line (CQ-QX-005, ACC round 3 #3, #4).
 *
 * A step's `prompt` is a form label as often as a question — "Your firm",
 * "Typical cheque", "Website" — and every runtime-composed line that read
 * it out became Q's whole sentence: "Website?", "Your role there?",
 * "typical cheque? Just the number is fine.". This is the platform's own
 * copy for those steps: a question to ask, and a noun to name the step by
 * ("I've updated your role"). Copy the platform owns, keyed by step — not
 * a reading of anything the person said.
 */

/** The question, for steps whose prompt is a label rather than a question. */
export const SPOKEN_QUESTIONS: Readonly<Record<string, string>> = {
  "I0.organisation_name": "What's the name of your firm?",
  "I0.business_title": "What's your role there?",
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
  "I11.review": "Here's the mandate you've defined. Does it look right?",
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

/** The step as a noun: "your {noun}". */
export const STEP_NOUNS: Readonly<Record<string, string>> = {
  "I0.investor_type": "way of investing",
  "I0.organisation_name": "firm name",
  "I0.business_title": "role",
  "I1.deployment_status": "deployment status",
  "I1.mandate_context": "mandate",
  "I2.stages": "stages",
  "I2.currency": "cheque currency",
  "I2.cheque_min": "minimum cheque",
  "I2.cheque_typical": "typical cheque",
  "I2.cheque_max": "maximum cheque",
  "I2.investment_role": "investment role",
  "I3.geography": "geography",
  "I3.geography_strength": "geography preference",
  "I3.sectors": "sectors",
  "I3.sector_strength": "sector preference",
  "I3.sectors_avoid": "sectors to avoid",
  "I4.business_models": "business models",
  "I4.customer_types": "customer types",
  "I4.capital_intensity": "capital intensity",
  "I4.regulatory_appetite": "appetite for regulated markets",
  "I4.revenue_state": "revenue expectation",
  "I5.founder_preferences": "founding-team preferences",
  "I5.founder_strength": "founding-team preference",
  "I6.green_flags": "green flags",
  "I6.green_flag_strength": "green-flag preference",
  "I6.custom_criteria": "other criteria",
  "I7.avoid": "things to avoid",
  "I7.hard_exclusions": "hard exclusions",
  "I7.sector_exclusions": "sector exclusions",
  "I8.portfolio": "portfolio companies",
  "I9.discovery_mode": "discovery setting",
  "I10.inbound_preference": "inbound preference",
  "I11.additional_context": "additional context",
  "F0.intent": "reason for being here",
  "F1.company_name": "company name",
  "F1.website": "website",
  "F1.country": "country",
  "F1.stage": "stage",
  "F1.description": "company description",
  "F1.categories": "categories",
  "F2.materials": "materials",
  "F4.founder_role": "role",
  "F4.founder_count": "number of founders",
  "F4.full_time": "founders' time commitment",
  "F4.team_size": "team size",
  "F4.functions": "founding-team coverage",
  "F5.signal": "early signal",
  "F5.pilots": "pilots",
  "F5.revenue_status": "revenue status",
  "F5.customers": "paying customers",
  "F5.growth": "growth",
  "F6.raising": "raising status",
  "F6.currency": "raise currency",
  "F6.target_amount": "target amount",
  "F6.instrument": "instrument",
  "F6.timeframe": "close timeframe",
  "F6.use_of_funds": "use of funds",
};

/** The step as a noun, falling back to its prompt when it reads as one. */
export function stepNoun(stepKey: string, prompt: string): string {
  const noun = STEP_NOUNS[stepKey];
  if (noun !== undefined) return noun;
  const trimmed = prompt.trim().replace(/[.?!:]+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}
