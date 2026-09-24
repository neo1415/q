import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V5_UNTRUSTED,
  COMPANY_ANALYST_V6_SCHEMA_VERSION,
  CompanyAnalystV5VariablesSchema,
  CompanyAnalystV6ResultSchema,
  type CompanyAnalystV5Variables,
  type CompanyAnalystV6Result,
} from "../schemas/company-analyst.js";
import {
  COMPANY_ANALYST_V6,
  COMPANY_ANALYST_V6_SECTION,
} from "./company-analyst.v6.js";

/**
 * COMPANY_ANALYST v7 — v6, without the machinery in the reply (CQ-QX-005).
 *
 * Asked for a deck, a small model narrated its own structured output to
 * the person: "The artifact request details are recorded and ready for
 * your approval", "I have a few quick questions (see clarifyingQuestions)".
 * Neither is true of anything the person can see — the platform prepares
 * the document and says so itself — and both expose the schema a person
 * should never know exists. The one paragraph about documents now says
 * what the reply does instead. Same schema, same reading; only the words
 * around it change, so this is a new version rather than an edit.
 */
const V7_SECTION = `PREPARING A DOCUMENT
If in THIS message they ask for a document about their company, set artifactRequest: kind PREPARE, their words as quote, artifactType INVESTMENT_BRIEF (prose) or PITCH_DECK (slides), visualDirection MINIMAL_INSTITUTIONAL, DARK_TECHNICAL or WARM_GROWTH if they said how it looks, else null. To change one: kind REVISE, the change in instruction. Otherwise null; a question is not a request. The platform prepares it and says so: never say a request was recorded or awaits approval, and never name a JSON field.
`;

if (!COMPANY_ANALYST_V6.template.includes(COMPANY_ANALYST_V6_SECTION)) {
  throw new Error(
    "COMPANY_ANALYST v7 rewrites v6's document paragraph, and v6 no longer carries it",
  );
}

export const COMPANY_ANALYST_V7: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV6Result
> = {
  ...COMPANY_ANALYST_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "CQ-QX-005: the reply to a document request never narrates the structured output (no 'request recorded', no 'awaiting approval', no schema field names); the platform reports the document itself.",
  effectiveFrom: "2026-09-24",
  variables: {
    schema: CompanyAnalystV5VariablesSchema,
    untrusted: [...COMPANY_ANALYST_V5_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V6_SCHEMA_VERSION,
    schema: CompanyAnalystV6ResultSchema,
  },
  template: COMPANY_ANALYST_V6.template.replace(
    COMPANY_ANALYST_V6_SECTION,
    V7_SECTION,
  ),
};
