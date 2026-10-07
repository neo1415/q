import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V19_SCHEMA_VERSION,
  CompanyAnalystV19ResultSchema,
  type CompanyAnalystV19Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V18 } from "./company-analyst.v18.js";

/**
 * COMPANY_ANALYST v19 -- one-pagers and memos (Q room W5, R8).
 *
 * A founder can ask for a one-pager or a memo as well as a brief or a
 * deck; each is written from the same record by the same pipeline, with a
 * document layout. The only change is the closed set the model may name
 * (ONE_PAGER, MEMO) and the line that tells it so; the result schema
 * widens with it, so v18's history stays explainable by v18's schema.
 */
export const V18_DOCUMENT_TYPES =
  "artifactType INVESTMENT_BRIEF (prose) or PITCH_DECK (slides)";
export const V19_DOCUMENT_TYPES =
  "artifactType PITCH_DECK (a deck, slides), ONE_PAGER (a one-pager), MEMO (an investment memo) or INVESTMENT_BRIEF (a brief or other prose)";

if (COMPANY_ANALYST_V18.template.split(V18_DOCUMENT_TYPES).length !== 2) {
  throw new Error(
    `COMPANY_ANALYST v19 rewrites v18, which changed: ${V18_DOCUMENT_TYPES}`,
  );
}

export const COMPANY_ANALYST_V19: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV19Result
> = {
  ...COMPANY_ANALYST_V18,
  version: 19,
  status: "ACTIVE",
  changeDescription:
    "Q room W5 (R8, 2026-10-07): a founder may ask for a one-pager or a memo as well as a brief or a deck (artifactType ONE_PAGER / MEMO); the same pipeline writes each from their record with a document layout.",
  effectiveFrom: "2026-10-07",
  template: COMPANY_ANALYST_V18.template.replace(
    V18_DOCUMENT_TYPES,
    V19_DOCUMENT_TYPES,
  ),
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V19_SCHEMA_VERSION,
    schema: CompanyAnalystV19ResultSchema,
  },
};
