import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV26Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V26 } from "./company-analyst.v26.js";

/**
 * COMPANY_ANALYST v27 -- Q speaks to the person (QA 2026-10-23, QO-04 /
 * F-45). Answers called the person "the investor", cited "the supplied
 * company profile", and opened with a restatement of the company's stage
 * and place whatever was asked. The first-person line gains its other
 * half: second person for them, never naming the inputs, and the opening
 * is what answers this question. Output schema unchanged (v26).
 */
export const V26_FIRST_PERSON_LINE =
  '- First person for your own work and knowledge ("I\'d start with Portside", "I don\'t know their round size yet"), never "Capital Q records…", "the records show…" or "according to Capital Q".';

export const V27_PERSON_LINE = `${V26_FIRST_PERSON_LINE}
- Second person for them ("you", "your mandate"), never "the investor" or "the founder"; never name your inputs ("the supplied profile", F-labels); open with what answers the question, not its stage and location.`;

/**
 * Wording v27 says more briefly, so the prompt keeps its 5% headroom
 * (prompts.test.ts) with the person line added. Every rule stays. The
 * example's strings no longer model "the supplied fact" voice.
 */
export const V27_TRIMS: ReadonlyArray<readonly [string, string]> = [
  [
    '"answer":"Answer using the supplied authorised facts."',
    '"answer":"It sells to banks."',
  ],
  [
    '"statement":"The supplied fact describes the product."',
    '"statement":"It sells to banks."',
  ],
  [
    '"statement":"The supplied fact describes the product."',
    '"statement":"It sells to banks."',
  ],
  [
    'In citations put the "ref" labels the finding rests on; cite only labels that appear below, and leave it empty rather than guessing.',
    'citations: the "ref" labels it rests on, only from below, else empty.',
  ],
  [
    "Types: FACT for what the facts establish, OBSERVATION for what they show, INFERENCE for your own conclusion from them.",
    "Types: FACT (established), OBSERVATION (what they show), INFERENCE (your conclusion).",
  ],
];

if (COMPANY_ANALYST_V26.template.split(V26_FIRST_PERSON_LINE).length !== 2) {
  throw new Error(
    "COMPANY_ANALYST v27 extends v26, which changed: first person",
  );
}

export const COMPANY_ANALYST_V27: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV26Result
> = {
  ...COMPANY_ANALYST_V26,
  version: 27,
  status: "ACTIVE",
  changeDescription:
    "QA 2026-10-23 (QO-04 / F-45): Q speaks to the person in the second person, never as 'the investor' or 'the founder'; never names its inputs ('the supplied profile', F-labels); opens with what answers this question, never a restatement of a company's declared stage and location unless asked. Output schema unchanged.",
  effectiveFrom: "2026-10-23",
  template: V27_TRIMS.reduce(
    (template, [from, to]) => template.replace(from, to),
    COMPANY_ANALYST_V26.template.replace(
      V26_FIRST_PERSON_LINE,
      V27_PERSON_LINE,
    ),
  ),
};
