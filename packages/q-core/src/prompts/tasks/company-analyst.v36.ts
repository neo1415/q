import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V36_SCHEMA_VERSION,
  CompanyAnalystV36ResultSchema,
  type CompanyAnalystV36Result,
  type CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V35 } from "./company-analyst.v35.js";

/**
 * COMPANY_ANALYST v36 -- RC3 (Q voice audit, 15 Nov 2026; owner directive
 * Phase 5): v35's template, word for word, with output schema v36, which
 * adds `spoken` -- the concise spoken form of the same answer, written in
 * the same call from the same evidence. Its meaning is in the field
 * description; code keeps it only when every figure and name in it is in
 * `answer`. Additive: every v35 answer is a valid v36 answer.
 */
export const COMPANY_ANALYST_V36: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV36Result
> = {
  ...COMPANY_ANALYST_V35,
  version: 36,
  status: "ACTIVE",
  changeDescription:
    "RC3 (Q voice audit, 15 Nov 2026): v35's template unchanged; output schema v36 adds spoken (at most three spoken sentences of the same answer, no new figure or name), so the voice says a concise form and the screen shows the full answer.",
  effectiveFrom: "2026-11-15",
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V36_SCHEMA_VERSION,
    schema: CompanyAnalystV36ResultSchema,
  },
};
