import { getMeter } from "@capital-q/observability";

/**
 * Bounded onboarding runtime metrics. Labels: journey type, step type,
 * resolution, bound flag -- never a step key with content, a response, a
 * user or a session id.
 */

type Meter = ReturnType<typeof getMeter>;
type Counter = ReturnType<Meter["createCounter"]>;

type OnboardingMetrics = {
  readonly sessionsStarted: Counter;
  readonly sessionsCompleted: Counter;
  readonly responsesCommitted: Counter;
  readonly stepsSkipped: Counter;
  readonly versionConflicts: Counter;
  readonly suggestionsResolved: Counter;
  readonly runtimeErrors: Counter;
};

let metrics: OnboardingMetrics | undefined;

export function getOnboardingMetrics(): OnboardingMetrics {
  if (metrics === undefined) {
    const meter = getMeter("@capital-q/onboarding");
    metrics = {
      sessionsStarted: meter.createCounter("onboarding_sessions_started_total"),
      sessionsCompleted: meter.createCounter(
        "onboarding_sessions_completed_total",
      ),
      responsesCommitted: meter.createCounter(
        "onboarding_responses_committed_total",
      ),
      stepsSkipped: meter.createCounter("onboarding_steps_skipped_total"),
      versionConflicts: meter.createCounter(
        "onboarding_version_conflicts_total",
      ),
      suggestionsResolved: meter.createCounter(
        "onboarding_suggestions_resolved_total",
      ),
      runtimeErrors: meter.createCounter("onboarding_runtime_errors_total"),
    };
  }
  return metrics;
}
