import { QOrchestrationVersionError } from "@capital-q/q-runtime";

/**
 * Orchestration identity (doc 12 §9.3; CQ-Q-003 §27-28).
 *
 * Every run this engine picks up is stamped with the version of the graph
 * that ran it, and a suspended run is only ever continued by a build that
 * still understands that version. The version is a real, stable identifier
 * — never "latest" — and changes whenever a graph change could alter what
 * a resume means: a node added or removed, a state field renamed, a
 * different interrupt point.
 *
 * History:
 *   q-orchestrator-v1  CQ-Q-003: preflight → context seam → pause →
 *                      retrieval seam → answer seam.
 *   q-orchestrator-v2  CQ-Q-004: the Context Firewall replaces the context
 *                      seam, state carries the actor's organisation context
 *                      and a bounded plan descriptor, denial edges end the
 *                      graph. v1 checkpoints lack those channels and are
 *                      therefore NOT resumable by this build: a v1 run
 *                      suspended in some environment fails closed at resume
 *                      rather than being reinterpreted.
 *   q-orchestrator-v3  CQ-Q-005: the answer seam is real (Model Gateway);
 *                      state carries a coded answer failure and the model
 *                      policy version. Same node set, new channels, so v2
 *                      checkpoints are NOT resumable by this build.
 *   q-orchestrator-v4  CQ-Q-006: the answer seam renders a versioned prompt
 *                      bundle; state carries promptBundleVersion. Same node
 *                      set, new channel, so v3 checkpoints are NOT resumable.
 *   q-orchestrator-v5  CQ-Q-008: two action nodes follow the answer seam
 *                      (prepare, then the approval gate that interrupts and,
 *                      on resume, executes through the Approval Engine);
 *                      state carries action, actionId, approvalId and
 *                      actionFailure. New nodes and a second interrupt
 *                      point, so v4 checkpoints are NOT resumable.
 *
 * Coexistence during a deployment: an old build keeps serving runs at its
 * own version; a new build serves new runs at the new version and
 * continues old suspended runs only if the old version is listed here as
 * still resumable. There is no migration engine for checkpoints, by design.
 *
 * The format satisfies the `q_runtime.runs.orchestration_version` check
 * (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).
 */
export const Q_ORCHESTRATION_VERSION = "q-orchestrator-v5" as const;

/** Versions whose checkpoints this build can resume. Additive over time. */
export const Q_RESUMABLE_ORCHESTRATION_VERSIONS: ReadonlySet<string> = new Set([
  Q_ORCHESTRATION_VERSION,
]);

export function isResumableOrchestrationVersion(
  version: string | null,
): version is string {
  return version !== null && Q_RESUMABLE_ORCHESTRATION_VERSIONS.has(version);
}

/** Refuse, never guess: an unknown or absent version is not coerced. */
export function assertResumableOrchestrationVersion(
  version: string | null,
): void {
  if (!isResumableOrchestrationVersion(version)) {
    throw new QOrchestrationVersionError(version);
  }
}
