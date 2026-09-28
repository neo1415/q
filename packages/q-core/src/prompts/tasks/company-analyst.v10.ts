import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V9,
  COMPANY_ANALYST_V9_SECTION,
} from "./company-analyst.v9.js";

/**
 * COMPANY_ANALYST v10 — v9's fit-versus-interest rule stated as a concept
 * rather than as one question's wording.
 *
 * v9 keyed the rule to a sentence ("asked which investors would likely
 * invest, that is prospecting"). The capability it needs is general: any
 * question about who relates to a company — investors, customers,
 * partners, acquirers — is either about who is already involved (evidence)
 * or who would suit it (inference), and the model reads which from the
 * question and the conversation. A rule tied to one phrasing is a phrase
 * list in prose; this one holds for wordings nobody wrote down.
 *
 * Same schema as v8/v9. A new version, because a published prompt is
 * immutable.
 */
export const COMPANY_ANALYST_V10_SECTION = `INVOLVED VERSUS SUITED
When a question concerns which people or organisations relate to a company (investors, customers, partners, acquirers), read from the question and the conversation whether the person wants who is already involved or who would suit it. Already involved is evidence: report it only from a source. Would suit is inference: name specific candidates from tool results, sources or published focus (say which), each with its reason, labelled a likely fit to be checked. Answer the one asked; if both matter, keep them apart. Finding nobody already involved is never a reason to name nobody who would suit.

`;

if (!COMPANY_ANALYST_V9.template.includes(COMPANY_ANALYST_V9_SECTION)) {
  throw new Error(
    "COMPANY_ANALYST v10 replaces v9's likely-investors section, and v9 no longer carries it",
  );
}

export const COMPANY_ANALYST_V10: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV8Result
> = {
  ...COMPANY_ANALYST_V9,
  version: 10,
  status: "DEPRECATED",
  changeDescription:
    "v9's fit-versus-interest rule restated as a concept (already involved = evidence, would suit = labelled inference, read from question and context) instead of keyed to one question's wording.",
  effectiveFrom: "2026-09-25",
  template: COMPANY_ANALYST_V9.template.replace(
    COMPANY_ANALYST_V9_SECTION,
    COMPANY_ANALYST_V10_SECTION,
  ),
};
