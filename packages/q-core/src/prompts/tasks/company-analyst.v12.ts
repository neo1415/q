import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V12_SCHEMA_VERSION,
  CompanyAnalystV12ResultSchema,
  type CompanyAnalystV12Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V11,
  COMPANY_ANALYST_V11_FORMAT_SECTION,
} from "./company-analyst.v11.js";

/**
 * COMPANY_ANALYST v12 — comparisons as cards (founder design 2026-09-28):
 * two to four named things side by side, each with the few points that
 * matter, beside the prose answer. A "which should I choose" question gets
 * the same cards, never an order or a verdict: the charter forbids
 * rankings and investment decisions. Every evidence rule of v11 stands.
 */
export const COMPANY_ANALYST_V12_CARDS_SECTION = `Comparing 2-4 named things: also fill comparisonCards, no order or verdict, 1-4 points each; unknown is "Not known". Else null.

`;

if (
  !COMPANY_ANALYST_V11.template.includes(COMPANY_ANALYST_V11_FORMAT_SECTION)
) {
  throw new Error(
    "COMPANY_ANALYST v12 appends to v11's answer format section, and v11 no longer carries it",
  );
}

export const COMPANY_ANALYST_V12: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV12Result
> = {
  ...COMPANY_ANALYST_V11,
  version: 12,
  status: "ACTIVE",
  changeDescription:
    "Founder design 2026-09-28: comparing or choosing between two to four named things also comes back as comparisonCards (name, line, up to four points), side by side with no order or verdict (the charter forbids rankings), under every evidence rule; null otherwise.",
  effectiveFrom: "2026-09-29",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V12_SCHEMA_VERSION,
    schema: CompanyAnalystV12ResultSchema,
  },
  template: COMPANY_ANALYST_V11.template.replace(
    COMPANY_ANALYST_V11_FORMAT_SECTION,
    `${COMPANY_ANALYST_V11_FORMAT_SECTION}${COMPANY_ANALYST_V12_CARDS_SECTION}`,
  ),
};
