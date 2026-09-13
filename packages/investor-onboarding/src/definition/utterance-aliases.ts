import type { OnboardingUtteranceAliases } from "@capital-q/onboarding";

import { INVESTOR_STEPS } from "./investor-v1.js";

/**
 * Plain-language names an investor uses for the options Investor Definition
 * v1 offers (CQ-PRE-REC-001 §19, §24). Recognition only: "Series A and
 * seed" becomes the two stage options and is submitted through the ordinary
 * validated path. Anything richer — a cheque band, a sector list, an
 * exclusion in their own words — goes to Q's mandate reading, whose
 * proposals the person confirms. Nothing here can name a hard exclusion.
 */
export const INVESTOR_UTTERANCE_ALIASES: OnboardingUtteranceAliases = {
  [INVESTOR_STEPS.investorType]: {
    angel: ["angel", "angel investor", "individual", "personal"],
    vc: ["vc", "venture", "venture fund", "fund", "venture capital"],
    family_office: ["family office", "family"],
    cvc: ["corporate", "corporate venture", "cvc", "strategic"],
    syndicate: ["syndicate", "spv"],
    accelerator: ["accelerator", "incubator", "studio"],
    scout: ["scout"],
    institutional: ["institutional", "pension", "sovereign", "endowment", "lp"],
    other: ["something else", "other"],
  },
  [INVESTOR_STEPS.deploymentStatus]: {
    actively_investing: [
      "actively",
      "active",
      "deploying",
      "investing now",
      "open",
    ],
    selective: [
      "selective",
      "selectively",
      "opportunistic",
      "only the right deal",
    ],
    paused: ["paused", "on hold", "not deploying", "between funds"],
    exploring_only: ["exploring", "just looking", "researching", "learning"],
  },
  [INVESTOR_STEPS.stages]: {
    pre_seed: ["preseed", "pre seed", "angel round"],
    seed: ["seed", "seed stage", "seed rounds"],
    series_a: ["series a", "a round", "a rounds"],
    series_b: ["series b", "b round", "b rounds"],
    series_c_plus: [
      "series c",
      "series d",
      "growth",
      "late stage",
      "later stage",
    ],
  },
  [INVESTOR_STEPS.currency]: {
    usd: ["dollars", "usd", "us dollar", "$"],
    eur: ["euro", "euros", "eur"],
    gbp: ["pounds", "sterling", "gbp", "£"],
    ngn: ["naira", "ngn"],
    kes: ["shillings", "kes"],
    zar: ["rand", "zar"],
    aed: ["dirham", "aed"],
    inr: ["rupee", "rupees", "inr"],
    sgd: ["singapore dollar", "sgd"],
  },
  [INVESTOR_STEPS.investmentRole]: {
    lead: ["lead", "we lead", "leading", "price rounds"],
    co_invest: [
      "co invest",
      "co-invest",
      "alongside",
      "with a lead",
      "coinvest",
    ],
    follow: ["follow", "follow on", "follow-on", "later rounds"],
  },
  [INVESTOR_STEPS.discoveryMode]: {
    strict: ["strict", "only my mandate", "exactly", "tight", "narrow"],
    balanced: ["balanced", "mostly", "some flexibility", "middle"],
    exploratory: [
      "exploratory",
      "broad",
      "surprise me",
      "show me more",
      "wide",
    ],
  },
  [INVESTOR_STEPS.inboundPreference]: {
    closed: ["closed", "no inbound", "not open", "referrals only"],
    qualified: ["qualified", "only qualified", "screened", "warm"],
    open: ["open", "anyone", "cold is fine", "open to inbound"],
  },
};
