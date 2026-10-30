import type { PromptDefinition } from "../definition.js";
import {
  PLAN_REVIEW_SCHEMA_NAME,
  PLAN_REVIEW_V3_SCHEMA_VERSION,
  PlanReviewResultV3Schema,
  type PlanReviewResultV3,
  type PlanReviewVariables,
} from "../schemas/plan.js";
import { PLAN_REVIEW_V4 } from "./plan.v4.js";

/**
 * Plan job 32e70db7 (plan 08ce8485, 2026-10-30): both reviewers asked for
 * an organisation-verification step and for a decision on the waiting
 * company-profile update, as points on no step and in different words, so
 * the person read each twice. v5 has every defect name the situation refs
 * it concerns (output schema v3, `refs`); code merges by step and by shared
 * refs, never by wording. Rubric plan-rubric/v1 and the 99 bar unchanged.
 */
const REVIEW_STEPKEY_V4 =
  "stepKey is the step's key, or null for the plan as a whole;";
export const REVIEW_REFS_V5 =
  "stepKey is the step's key, or null for the plan as a whole (such as a step that is missing); refs are the refs of THE SITUATION the defect concerns -- the facts a missing step must use, or the facts behind the problem -- empty only when no fact bears on it;";

function replaced(template: string, from: string, to: string): string {
  if (template.split(from).length !== 2) {
    throw new Error(
      `plan v5: the v4 line it replaces changed: ${from.slice(0, 60)}`,
    );
  }
  return template.replace(from, to);
}

export const PLAN_REVIEW_V5: PromptDefinition<
  PlanReviewVariables,
  PlanReviewResultV3
> = {
  ...PLAN_REVIEW_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "Plan job 32e70db7 (2026-10-30): the same missing step (organisation verification, the waiting profile update) came from both reviewers in different words on no step, and reached the person twice. Every defect now carries refs, the situation refs it concerns (output schema v3); code merges points on the same step or sharing a ref. Rubric plan-rubric/v1 and the 99 bar unchanged.",
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: PLAN_REVIEW_SCHEMA_NAME,
    schemaVersion: PLAN_REVIEW_V3_SCHEMA_VERSION,
    schema: PlanReviewResultV3Schema,
  },
  template: replaced(
    PLAN_REVIEW_V4.template,
    REVIEW_STEPKEY_V4,
    REVIEW_REFS_V5,
  ),
};
