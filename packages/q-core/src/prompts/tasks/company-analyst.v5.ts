import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V5_SCHEMA_VERSION,
  COMPANY_ANALYST_V5_UNTRUSTED,
  CompanyAnalystV5ResultSchema,
  CompanyAnalystV5VariablesSchema,
  type CompanyAnalystV5Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V4 } from "./company-analyst.v4.js";

/**
 * COMPANY_ANALYST v5 — v4 plus what the person asked Q to prepare
 * (ADR 0011, ADR 0013).
 *
 * One field is added to the result and one paragraph to the template. The
 * paragraph exists so the model reads the request as meaning rather than
 * as a phrase: "prepare a short investment brief", "put together something
 * I can send round" and "write me a one-pager on the company" are the same
 * ask, and no list of words would hold all three.
 *
 * The field is a reading and nothing else. The answer seam checks the
 * quote against the message, takes the subject from the run's own
 * authorised plan rather than from anything the model said, and only then
 * asks the artifact service to write.
 */
const ANCHOR = "AUTHORISED FACTS\n{{authorisedFacts}}";

const ARTIFACT_SECTION = `PREPARING A DOCUMENT
If in THIS message they ask for a document about their company (a brief, a one-pager, "something I can send round"), set artifactRequest: kind PREPARE, artifactType INVESTMENT_BRIEF, their words as quote. To change one you already prepared, kind REVISE with what they want changed in instruction. Otherwise null. A question is not a request for a document; you neither write nor store it here.

`;

if (!COMPANY_ANALYST_V4.template.includes(ANCHOR)) {
  throw new Error(
    "COMPANY_ANALYST v5 derives from v4's template, and v4 no longer carries the section it extends",
  );
}

export const COMPANY_ANALYST_V5: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV5Result
> = {
  ...COMPANY_ANALYST_V4,
  version: 5,
  // Deprecated by v6, which reads a request for slides as well as for
  // prose. Retired, never removed: a run recorded against v5 stays
  // explainable by the exact template and schema it ran under.
  status: "DEPRECATED",
  changeDescription:
    "ADR 0013: the structured result carries artifactRequest, a request to prepare or revise a document about the company, which the answer seam validates and the artifact application service persists. The model reads the request; it does not write.",
  effectiveFrom: "2026-09-22",
  variables: {
    schema: CompanyAnalystV5VariablesSchema,
    untrusted: [...COMPANY_ANALYST_V5_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V5_SCHEMA_VERSION,
    schema: CompanyAnalystV5ResultSchema,
  },
  template: COMPANY_ANALYST_V4.template.replace(
    ANCHOR,
    `${ARTIFACT_SECTION}${ANCHOR}`,
  ),
};
