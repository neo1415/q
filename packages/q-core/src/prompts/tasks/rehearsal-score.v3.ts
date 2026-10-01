import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_REVIEW_SCHEMA_NAME,
  REHEARSAL_REVIEW_V3_SCHEMA_VERSION,
  RehearsalReviewLenientSchema,
  type RehearsalReviewLenient,
  type RehearsalReviewVariables,
} from "../schemas/rehearsal.js";
import { REHEARSAL_SCORE_V2 } from "./rehearsal-score.v2.js";

/**
 * REHEARSAL_SCORE v3 -- v2's words, with a lenient output shape that code
 * trims (normaliseRehearsalReview), for the same reason as the persona v3.
 */
export const REHEARSAL_SCORE_V3: PromptDefinition<
  RehearsalReviewVariables,
  RehearsalReviewLenient
> = {
  ...REHEARSAL_SCORE_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "REHEARSE audit (live 2026-10-01): lenient output bounds, trimmed by code, so a long note never refuses the whole review.",
  effectiveFrom: "2026-10-01",
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_REVIEW_SCHEMA_NAME,
    schemaVersion: REHEARSAL_REVIEW_V3_SCHEMA_VERSION,
    schema: RehearsalReviewLenientSchema,
  },
};
