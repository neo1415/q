import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V8 } from "./company-analyst.v8.js";

/**
 * COMPANY_ANALYST v9 — v8, with fit kept apart from interest (acceptance
 * directive E).
 *
 * Asked "which specific investors would likely invest in Zino Aviation?",
 * Q searched for investors publicly linked to the company, found none,
 * and said no investor was evidenced — the person had to insist that they
 * wanted likely prospects, not a list of people already involved. The
 * question is prospect identification by default. v2's list of things the
 * model may not produce named "investor fit" beside scores and
 * probabilities, which read as a ban on saying who suits a company at
 * all. What is barred is a fit SCORE; a reasoned, labelled prospect list
 * is analysis. Evidenced interest (an investment, a public statement, a
 * record on Capital Q) is reported separately and only from a source.
 *
 * Same schema as v8. A new version, because a published prompt is
 * immutable.
 */
const V2_BAN = "readiness level, investor fit or peer benchmark";
const V9_BAN = "readiness level, fit score or peer benchmark";

const ANCHOR = "AUTHORISED FACTS\n{{authorisedFacts}}";

export const COMPANY_ANALYST_V9_SECTION = `LIKELY INVESTORS
Asked which investors would likely invest: name prospects whose stated focus fits the company, each with its reason, labelled likely fit. Interest is separate and needs a source; no linked investor never means naming none.

`;

if (!COMPANY_ANALYST_V8.template.includes(V2_BAN)) {
  throw new Error(
    "COMPANY_ANALYST v9 narrows v2's fit ban, and v8 no longer carries it",
  );
}
if (!COMPANY_ANALYST_V8.template.includes(ANCHOR)) {
  throw new Error(
    "COMPANY_ANALYST v9 derives from v8's template, and v8 no longer carries the section it extends",
  );
}

export const COMPANY_ANALYST_V9: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result
> = {
  ...COMPANY_ANALYST_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    "Acceptance directive E: 'which investors would likely invest' is prospect identification — named prospects by fit, with reasons, labelled as likely fit, never as interest; evidenced interest reported separately and only from a source. v2's ban narrows from 'investor fit' to 'fit score'.",
  effectiveFrom: "2026-09-24",
  template: COMPANY_ANALYST_V8.template
    .replace(V2_BAN, V9_BAN)
    .replace(ANCHOR, `${COMPANY_ANALYST_V9_SECTION}${ANCHOR}`),
};
