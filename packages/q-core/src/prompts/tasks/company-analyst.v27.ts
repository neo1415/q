import type { PromptDefinition } from "../definition.js";
import type {
  CompanyAnalystV26Result,
  CompanyAnalystV5Variables,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V26 } from "./company-analyst.v26.js";

/**
 * COMPANY_ANALYST v27 -- CANDIDATE, not registered by default (turn
 * latency round 5, 2026-10-21). The answer model writes at about 100
 * tokens a second, and an offline count (scripts/handoff/
 * answer-output-split.mjs) puts 22-34% of its object in structure Capital
 * Q already holds. Two of those go to code here, with no change to what a
 * person reads:
 *
 * - a finding's `basis` is the supplied fact labels only. Restated text
 *   was never shown (findingBlockOf drops basis) and nothing stored it;
 * - a card for a company the fit tools scored leaves `measures` out, and
 *   Capital Q fills them from those results (model-gateway
 *   `withFitMeasures`), so they are the platform's own levels.
 *
 * Output schema unchanged (v26). It becomes ACTIVE only after q-evals
 * LIVE_MODEL parity against v26 (`q-eval run --prompts candidate`; see
 * TURN-LATENCY-2026-10-21-HANDOFF.md).
 */
export const V27_BASIS_FROM =
  "basis is supplied fact labels or supporting statements";
export const V27_BASIS_TO =
  "basis is the supplied fact labels only (F1, F2), never restated text";

export const V27_CARDS_FROM =
  "fill answerCards (comparisonCards null); the answer is a few spoken sentences about them";
export const V27_CARDS_TO =
  "fill answerCards (comparisonCards null); a card for a company the fit tools scored leaves measures out, as Capital Q fills them from those results; the answer is a few spoken sentences about them";

for (const [anchor, name] of [
  [V27_BASIS_FROM, "basis line"],
  [V27_CARDS_FROM, "answer cards line"],
] as const) {
  if (COMPANY_ANALYST_V26.template.split(anchor).length !== 2) {
    throw new Error(`COMPANY_ANALYST v27 extends v26, which changed: ${name}`);
  }
}

export const COMPANY_ANALYST_V27: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV26Result
> = {
  ...COMPANY_ANALYST_V26,
  version: 27,
  status: "ACTIVE",
  changeDescription:
    "Turn latency round 5: a finding's basis is fact labels only, and a fit-scored card's measures are filled by code from the fit tools' results. Candidate: active only after q-evals parity with v26.",
  effectiveFrom: "2026-10-21",
  template: COMPANY_ANALYST_V26.template
    .replace(V27_BASIS_FROM, V27_BASIS_TO)
    .replace(V27_CARDS_FROM, V27_CARDS_TO),
};
