import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV19Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V20 } from "./company-analyst.v20.js";

/**
 * COMPANY_ANALYST v21 -- no boilerplate disclaimers (lead live replay of
 * Zino's questions, 2026-10-07): v20 talked in the first person but still
 * added "this is mandate alignment—not an investment conclusion" and "a
 * prioritisation for diligence rather than a decision to invest" to one
 * short answer. One bullet after v20's caveat rule; code also keeps at
 * most one such sentence (q-core withOneCaveat).
 */
export const V20_CAVEAT_LINE =
  '- Caveat once, briefly, only when it would change what they do. Unknown is said plainly once ("round size isn\'t known yet"), not repeated for every item.';

export const V21_NO_DISCLAIMER_LINE =
  '- No boilerplate disclaimers: never "not an investment recommendation/conclusion/verdict", "this is mandate alignment" or "rather than a decision to invest". They know a fit score is not a decision.';

if (COMPANY_ANALYST_V20.template.split(V20_CAVEAT_LINE).length !== 2) {
  throw new Error(
    "COMPANY_ANALYST v21 extends v20, which changed: caveat line",
  );
}

export const COMPANY_ANALYST_V21: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV19Result
> = {
  ...COMPANY_ANALYST_V20,
  version: 21,
  status: "DEPRECATED",
  changeDescription:
    "Lead live replay 2026-10-07: no boilerplate disclaimers ('not an investment conclusion', 'this is mandate alignment'); one line after v20's caveat rule. Schema unchanged.",
  effectiveFrom: "2026-10-07",
  template: COMPANY_ANALYST_V20.template.replace(
    V20_CAVEAT_LINE,
    `${V20_CAVEAT_LINE}\n${V21_NO_DISCLAIMER_LINE}`,
  ),
};
