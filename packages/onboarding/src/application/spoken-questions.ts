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

/** The question, for steps whose prompt is a label rather than a question. */
export const SPOKEN_QUESTIONS: Readonly<Record<string, string>> = {
  "I0.organisation_name": "What's the name of your firm?",
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
