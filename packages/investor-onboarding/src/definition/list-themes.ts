import { INVESTOR_STEPS } from "./investor-v1.js";

/**
 * The investor's preference lists, asked by theme (owner rule, e2e run 4
 * 2026-11-07: "ask the lists in as few natural questions as possible;
 * never a 10-question form"). v5 made all fourteen lists mandatory, and
 * asked one per turn they read as a form; Q asked the exclusions three
 * times.
 *
 * Each theme is one natural question. One answer fills every list it
 * speaks to (the reading files it), and a list the answer leaves out was
 * asked and has nothing for them: it is "None" (NONE_ANSWER_TEXT), shown
 * in the review for them to change. Journey data: the interview reads it,
 * nothing here reads a sentence.
 *
 * Not themed: the strength of a focus ("how firm is that?"), which follows
 * only a list that holds something; the portfolio; the thesis and the
 * anything-else note, which are their own words.
 */
export type InvestorListTheme = {
  readonly key: string;
  /** The question, as Q asks it. */
  readonly question: string;
  /** The lists it asks, in the journey's order. */
  readonly stepKeys: readonly string[];
};

export const INVESTOR_LIST_THEMES: readonly InvestorListTheme[] = [
  {
    key: "off_the_table",
    question:
      "What's off the table for you: anything you'd rather not see, anything that should never be shown to you, or none?",
    stepKeys: [
      INVESTOR_STEPS.sectorsAvoid,
      INVESTOR_STEPS.avoid,
      INVESTOR_STEPS.hardExclusions,
      INVESTOR_STEPS.sectorExclusions,
    ],
  },
  {
    key: "company_fit",
    question:
      "What kind of company fits you: business model and customers, how much revenue you expect, and whether capital-heavy or regulated businesses are fine, or no preference?",
    stepKeys: [
      INVESTOR_STEPS.businessModels,
      INVESTOR_STEPS.customerTypes,
      INVESTOR_STEPS.capitalIntensity,
      INVESTOR_STEPS.regulatoryAppetite,
      INVESTOR_STEPS.revenueState,
    ],
  },
  {
    key: "what_you_look_for",
    question:
      "What makes you lean in: the founders you back, the green flags you look for, or anything else that matters to you?",
    stepKeys: [
      INVESTOR_STEPS.founderPreferences,
      INVESTOR_STEPS.greenFlags,
      INVESTOR_STEPS.customCriteria,
    ],
  },
];

/** The theme a list belongs to, if any. */
export function investorListThemeOf(
  stepKey: string,
): InvestorListTheme | undefined {
  return INVESTOR_LIST_THEMES.find((theme) => theme.stepKeys.includes(stepKey));
}
