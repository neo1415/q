import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V4_SCHEMA_VERSION,
  COMPANY_ANALYST_V4_UNTRUSTED,
  CompanyAnalystV4ResultSchema,
  CompanyAnalystV4VariablesSchema,
  type CompanyAnalystV4Result,
  type CompanyAnalystV4Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V3 } from "./company-analyst.v3.js";

/**
 * COMPANY_ANALYST v4 — v3 plus memory in, and the person's own name out
 * (ADR 0011, ADR 0012).
 *
 * One section is added to the template: what Capital Q remembers about
 * the person, rendered from their own earlier words, placed before the
 * facts so a preference or a correction they stated last week holds
 * without being asked again. The result gains `displayName`: a request
 * to be called something else, which is a change to their own record
 * and goes through the Approval Engine like any other change.
 */
const ANCHOR = "AUTHORISED FACTS\n{{authorisedFacts}}";

const MEMORY_SECTION = `WHAT CAPITAL Q REMEMBERS ABOUT THIS PERSON
From their own earlier words: how to address them, how names are said, corrections, facts they stated, earlier conversations. Honour a preference, pronunciation or correction without being asked again; treat a remembered fact as told, not verified; never recite memory unprompted or claim to remember what is not here.
{{memory}}

If in THIS message they ask to be called something else ("call me John", "change my name from Daniel to Dan"), put the new name in displayName with their exact words as quote and say it is ready for their approval: their own name, never a company field, never applied by you.

`;

if (!COMPANY_ANALYST_V3.template.includes(ANCHOR)) {
  throw new Error(
    "COMPANY_ANALYST v4 derives from v3's template, and v3 no longer carries the section it extends",
  );
}

export const COMPANY_ANALYST_V4: PromptDefinition<
  CompanyAnalystV4Variables,
  CompanyAnalystV4Result
> = {
  ...COMPANY_ANALYST_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "ADR 0012: what Capital Q remembers about the person is rendered into the prompt as untrusted memory; ADR 0011: the structured result carries displayName, a request to be called something else, for the Approval Engine to propose.",
  effectiveFrom: "2026-09-17",
  variables: {
    schema: CompanyAnalystV4VariablesSchema,
    untrusted: [...COMPANY_ANALYST_V4_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V4_SCHEMA_VERSION,
    schema: CompanyAnalystV4ResultSchema,
  },
  template: COMPANY_ANALYST_V3.template.replace(
    ANCHOR,
    `${MEMORY_SECTION}${ANCHOR}`,
  ),
};
