/**
 * @capital-q/q-evals
 *
 * Owns: the Q evaluation harness — dataset and case contracts, the
 * synthetic eval world, deterministic-first graders, the provider-agnostic
 * runner over the real Q runtime, reports, baselines and comparison
 * (CQ-Q-010; doc 24 §71-§143).
 * Does not own: any Q behaviour. It never calls a provider SDK, never
 * routes around the Context Firewall or the Model Gateway, and never
 * places an eval answer in a production prompt.
 */

export * from "./contracts/index.js";
export {
  Q_EVAL_GRADERS,
  graderById,
  type QEvalGrader,
  type QEvalObservation,
} from "./graders/index.js";
export {
  Q_BEHAVIOUR_RUBRIC,
  Q_EVAL_ADVERSARIAL_DATASET,
  Q_EVAL_DATASETS,
  Q_EVAL_GOLDEN_DATASET,
  Q_EVAL_REGRESSION_DATASET,
  lintDatasets,
  type QEvalLintIssue,
} from "./datasets/index.js";
export {
  Q_EVAL_PROFILE_DEFINITIONS,
  datasetsForProfile,
  type QEvalProfileDefinition,
} from "./profiles/index.js";
export { runQEvals, type QEvalRunnerOptions } from "./runner/index.js";
export {
  compareToBaseline,
  renderComparison,
  renderSummary,
  toBaseline,
} from "./reporters/index.js";
export {
  createQEvalWorld,
  EVAL_INJECTION_TEXT,
  type QEvalWorld,
  type QEvalWorldOptions,
  type RecordedProviderCall,
} from "./fixtures/world.js";

export const PACKAGE_NAME = "@capital-q/q-evals" as const;
