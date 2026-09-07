import type { QEvalDataset, QEvalProfile } from "../contracts/index.js";
import {
  Q_EVAL_ADVERSARIAL_DATASET,
  Q_EVAL_GOLDEN_DATASET,
  Q_EVAL_REGRESSION_DATASET,
} from "../datasets/index.js";

/**
 * Profiles (CQ-Q-010 §26-§31). The two deterministic profiles run the
 * scripted model against the local database and spend nothing; the live
 * profile is explicit opt-in over the real gateway with synthetic
 * fixtures. STAGING_FULL and SCHEDULED_DEEP are contracts only.
 */
export type QEvalProfileDefinition = {
  readonly profile: QEvalProfile;
  readonly implemented: boolean;
  readonly providerMode: "FAKE" | "LIVE";
  readonly description: string;
  readonly datasets: readonly QEvalDataset[];
  /** LOCAL_FAST trims slow cases; ids listed here are skipped. */
  readonly skipCaseIds: readonly string[];
};

export const Q_EVAL_PROFILE_DEFINITIONS: Readonly<
  Record<QEvalProfile, QEvalProfileDefinition>
> = {
  LOCAL_FAST: {
    profile: "LOCAL_FAST",
    implemented: true,
    providerMode: "FAKE",
    description:
      "Developer loop: the hard-invariant core plus the golden set, scripted model, no spend, slow cases skipped.",
    datasets: [Q_EVAL_REGRESSION_DATASET, Q_EVAL_GOLDEN_DATASET],
    skipCaseIds: ["QSTREAM-001", "QSTYLE-001"],
  },
  CI_CORE: {
    profile: "CI_CORE",
    implemented: true,
    providerMode: "FAKE",
    description:
      "Every dataset, scripted model, no credentials, no spend. The release gate for Q-affecting changes.",
    datasets: [
      Q_EVAL_REGRESSION_DATASET,
      Q_EVAL_ADVERSARIAL_DATASET,
      Q_EVAL_GOLDEN_DATASET,
    ],
    skipCaseIds: [],
  },
  LIVE_MODEL: {
    profile: "LIVE_MODEL",
    implemented: true,
    providerMode: "LIVE",
    description:
      "Explicit opt-in: the live-eligible cases through the real Model Gateway and configured providers; synthetic fixtures only; answers kept for human review.",
    datasets: [
      Q_EVAL_REGRESSION_DATASET,
      Q_EVAL_ADVERSARIAL_DATASET,
      Q_EVAL_GOLDEN_DATASET,
    ],
    skipCaseIds: [],
  },
  STAGING_FULL: {
    profile: "STAGING_FULL",
    implemented: false,
    providerMode: "LIVE",
    description:
      "Contract only: full golden, adversarial, retrieval, security, cost and latency across providers before a major Q release.",
    datasets: [],
    skipCaseIds: [],
  },
  SCHEDULED_DEEP: {
    profile: "SCHEDULED_DEEP",
    implemented: false,
    providerMode: "LIVE",
    description:
      "Contract only: larger adversarial corpus, provider comparison, red-team, long context, retrieval, voice, recommendations.",
    datasets: [],
    skipCaseIds: [],
  },
};

export function datasetsForProfile(
  profile: QEvalProfile,
): readonly QEvalDataset[] {
  const definition = Q_EVAL_PROFILE_DEFINITIONS[profile];
  if (!definition.implemented) {
    throw new Error(
      `profile ${profile} is a contract only; it is not implemented yet`,
    );
  }
  if (definition.skipCaseIds.length === 0) {
    return definition.datasets;
  }
  return definition.datasets.map((dataset) => ({
    ...dataset,
    cases: dataset.cases.filter((c) => !definition.skipCaseIds.includes(c.id)),
  }));
}
