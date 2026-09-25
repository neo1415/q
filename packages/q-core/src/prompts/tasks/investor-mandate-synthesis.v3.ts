import type { PromptDefinition } from "../definition.js";
import type {
  InvestorMandateSynthesisV2Result,
  InvestorMandateVariables,
} from "../schemas/investor-mandate.js";
import { INVESTOR_MANDATE_SYNTHESIS_V2 } from "./investor-mandate-synthesis.v2.js";

/**
 * INVESTOR_MANDATE_SYNTHESIS v3 — v2, with every rule stated as a concept
 * (P0-1 prompt audit; lead, 2026-09-25; ADR 0011).
 *
 * v2 keyed its rules to quoted phrases a person might say ("early stage",
 * "never show me hardware", "seed only") and scripted the question to
 * ask. A rule keyed to wording understands the sentences somebody has
 * already met; a paraphrase slips past it. v3 says what each distinction
 * is. The schema, the separations and every other rule are unchanged.
 */
const REPLACEMENTS: readonly (readonly [string, string])[] = [
  [
    `- EXCLUSION_CLAIMED — the investor asked for something to be excluded outright ("never show me hardware", "we don't do crypto, ever"). This is your reading of their words, not a decision; Capital Q asks them before anything becomes ineligible.
- STRONG — a firm stated preference ("we focus on B2B software").
- PREFERENCE — a softer leaning ("we like API businesses").
- AVOID — a stated negative that is not an exclusion ("I'd rather avoid hardware", "we're not usually interested in marketplaces"). AVOID means show it lower, not never show it. Do not promote AVOID to EXCLUSION_CLAIMED because the tone was firm; only an explicit never/not-ever statement is EXCLUSION_CLAIMED.`,
    `- EXCLUSION_CLAIMED — they ask for something never to be shown to them at all, without exception. This is your reading of their words, not a decision; Capital Q asks them before anything becomes ineligible.
- STRONG — a firm stated focus: what they concentrate on.
- PREFERENCE — a softer leaning: what they like, without making it a focus.
- AVOID — a stated negative that still allows exceptions: something they would rather not see, or are usually not interested in. AVOID means show it lower, not never show it. The force of the tone is not the test; only a statement that admits no exception is EXCLUSION_CLAIMED.`,
  ],
  [
    `- Do not invent precision. If they said "early stage", do not decide which stages that means; if they said "usually $250k to $1m, but we've gone higher", do not make $1m an absolute ceiling. Record what they said and raise it as an ambiguity.`,
    `- Do not invent precision. A phrase that covers more than one canonical value is not narrowed to one of them; a figure they describe as usual, or as one they have gone beyond, is not made an absolute limit. Record what they said and raise it as an ambiguity.`,
  ],
  [
    `Ask neutrally: "Should Capital Q exclude these entirely, or show them lower?" — never "you probably meant".`,
    `Ask neutrally, offering the readings as equals; never suggest which one they meant.`,
  ],
  [
    `Observed behaviour NEVER rewrites a declared value: if they declared "seed only" and the observations show Series A, declared stays "seed only", and the difference goes in tensions and inferred.`,
    `Observed behaviour NEVER rewrites a declared value: when what they do differs from what they declared, declared stays as they declared it, and the difference goes in tensions and inferred.`,
  ],
];

let template = INVESTOR_MANDATE_SYNTHESIS_V2.template;
for (const [from, to] of REPLACEMENTS) {
  if (!template.includes(from)) {
    throw new Error(
      "INVESTOR_MANDATE_SYNTHESIS v3 restates v2, which no longer carries a rule it restates",
    );
  }
  template = template.replace(from, to);
}

export const INVESTOR_MANDATE_SYNTHESIS_V3: PromptDefinition<
  InvestorMandateVariables,
  InvestorMandateSynthesisV2Result
> = {
  ...INVESTOR_MANDATE_SYNTHESIS_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "P0-1 prompt audit (ADR 0011): the strength scale, the rule against invented precision, the neutral question and the observed-behaviour rule are stated as concepts instead of quoted phrases; schema and every other rule unchanged.",
  effectiveFrom: "2026-09-25",
  template,
};
