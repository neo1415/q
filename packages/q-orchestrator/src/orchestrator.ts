import { Command, isInterrupted } from "@langchain/langgraph";

import { type QRunHandle } from "@capital-q/contracts";
import { getTracer, type Logger } from "@capital-q/observability";
import {
  QRunAlreadyStartedError,
  QRunAlreadyTerminalError,
  QRunNotFoundError,
  QRunNotResumableError,
  createUnconfiguredQActions,
  runRef,
  toQRunHandle,
  type ContextFirewallPort,
  type QActionPort,
  type QAnswerPort,
  type QCancelInput,
  type QOrchestrationInput,
  type QOrchestrationRuntime,
  type QOrchestrator,
  type QPausePolicy,
  type QResumeInput,
  type QRetrievalPort,
  type QRunRecord,
  type QRunRef,
  type QRuntimeService,
} from "@capital-q/q-runtime";

import type { QCheckpointStore } from "./checkpoint-store.js";
import {
  buildQGraph,
  QCancellationSignal,
  QTerminalSignal,
  type QCompiledGraph,
} from "./graph.js";
import { QGraphStateSchema, type QGraphState } from "./state.js";
import { Q_CHECKPOINT_NAMESPACE, threadIdForRun } from "./thread.js";
import {
  assertResumableOrchestrationVersion,
  Q_ORCHESTRATION_VERSION,
} from "./version.js";

/**
 * LangGraph behind Capital Q's QOrchestrator (doc 12 §10.2).
 *
 * The order is fixed and is the security boundary:
 *
 *   authorise the actor against the canonical run (404-safe)
 *     → check the canonical lifecycle and the orchestration version
 *       → move the canonical lifecycle
 *         → and only then touch the engine
 *
 * The engine is never asked for state on the strength of a thread id. When
 * it returns — finished, interrupted, or thrown — the canonical run is
 * moved accordingly, and the handle returned is the run's, not the
 * engine's. Nothing LangGraph-shaped crosses this file's exports.
 */

export type LangGraphQOrchestratorOptions = {
  readonly runtime: QOrchestrationRuntime;
  /** The Q-002 cancellation use case; cancellation stays a runtime decision. */
  readonly cancelRun: QRuntimeService["cancelRun"];
  readonly checkpoints: QCheckpointStore;
  /** The Context Firewall (CQ-Q-004). Runs before, and again ahead of, any retrieval. */
  readonly firewall: ContextFirewallPort;
  readonly retrieval: QRetrievalPort;
  readonly answer: QAnswerPort;
  /** The Approval Engine seam (CQ-Q-008). Absent: no action is ever prepared. */
  readonly actions?: QActionPort | undefined;
  readonly pausePolicy: QPausePolicy;
  readonly logger?: Logger | undefined;
};

const tracer = getTracer("q-orchestrator", Q_ORCHESTRATION_VERSION);

/** Unwraps the engine's error envelopes to find a Capital Q signal. */
function rootCause(error: unknown, depth = 0): unknown {
  if (
    depth < 5 &&
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    error.cause !== undefined
  ) {
    return rootCause(error.cause, depth + 1);
  }
  return error;
}

function isTerminal(status: QRunRecord["status"]): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

/**
 * A run belongs to the organisation context it was created under. An
 * actor acting for another organisation — even the same person — is told
 * the run is not there, the same answer a stranger gets (CQ-Q-004 §34).
 */
function requireSameOrganisationContext(
  run: QRunRecord,
  actor: QOrchestrationInput["actor"],
): void {
  if (run.actorOrganisationId !== (actor.organisationId ?? null)) {
    throw new QRunNotFoundError();
  }
}

export function createLangGraphQOrchestrator(
  options: LangGraphQOrchestratorOptions,
): QOrchestrator {
  const { runtime, cancelRun, logger } = options;
  const graph: QCompiledGraph = buildQGraph(
    {
      runtime,
      firewall: options.firewall,
      retrieval: options.retrieval,
      answer: options.answer,
      actions: options.actions ?? createUnconfiguredQActions(),
      pausePolicy: options.pausePolicy,
      logger,
    },
    options.checkpoints.saver,
  );

  function config(ref: QRunRef, signal: AbortSignal | undefined) {
    return {
      configurable: {
        thread_id: threadIdForRun(ref.runId),
        checkpoint_ns: Q_CHECKPOINT_NAMESPACE,
      },
      ...(signal === undefined ? {} : { signal }),
    };
  }

  async function handleOf(ref: QRunRef): Promise<QRunHandle> {
    const run = await runtime.readRun(ref);
    if (run === null) {
      // The run was authorised moments ago; its disappearance is a fault.
      throw new Error("q run vanished during orchestration");
    }
    return toQRunHandle(run);
  }

  /**
   * Drives the engine for one invocation and reconciles the canonical
   * lifecycle with what it did. Resolves with the run's handle whatever
   * the outcome; only faults that mean the caller's own request was wrong
   * are thrown, and those happen before this is reached.
   */
  async function execute(
    ref: QRunRef,
    invoke: () => Promise<unknown>,
    operation: "start" | "resume",
  ): Promise<QRunHandle> {
    return tracer.startActiveSpan(
      `q.orchestration.${operation}`,
      {
        attributes: {
          "q.run_id": ref.runId,
          "q.orchestration_version": Q_ORCHESTRATION_VERSION,
        },
      },
      async (span) => {
        const startedAt = Date.now();
        let outcome = "unknown";
        try {
          const result = await invoke();

          if (isInterrupted(result)) {
            const current = await runtime.readRun(ref);
            if (current?.status === "AWAITING_APPROVAL") {
              // The approval gate interrupted: the Approval Engine already
              // moved the run and recorded the request in one transaction.
              outcome = "awaiting_approval";
            } else {
              // The pause node interrupted with nothing before it; the
              // canonical move is made here, outside the engine.
              await runtime.pause(ref);
              outcome = "paused";
            }
          } else {
            const state = QGraphStateSchema.parse(result);
            if (state.context === "DENIED") {
              // The Context Firewall left nothing Q may reason over. One
              // public code for every reason: the person learns only that
              // this is not available in their access context.
              await runtime.fail(ref, "POLICY_DENIED");
              outcome = "policy_denied";
            } else if (
              state.action !== null &&
              state.action !== "NONE" &&
              state.action !== "AWAITING_APPROVAL"
            ) {
              // The execution gate's durable answer decides the run's end.
              // A model never does; nothing here reads what Q said.
              outcome = await settleAction(ref, state);
            } else if (state.answer === "ANSWERED") {
              await runtime.complete(ref, {
                modelPolicyVersion: state.modelPolicyVersion ?? undefined,
                promptBundleVersion: state.promptBundleVersion ?? undefined,
              });
              outcome = "completed";
            } else if (state.answer === "FAILED") {
              // The gateway ended without an answer: a coded failure, the
              // same public sentence family as any other, never its text.
              const code = state.answerFailure ?? "MODEL_PROVIDER_UNAVAILABLE";
              const current = await runtime.readRun(ref);
              if (
                code === "RUN_CANCELLED" &&
                current?.status === "CANCEL_REQUESTED"
              ) {
                await runtime.finishCancellation(ref);
                outcome = "cancelled";
              } else {
                await runtime.fail(ref, code);
                outcome = "answer_failed";
              }
            } else {
              // No model execution is configured (CQ-Q-005). The run ends
              // honestly: a retryable public failure, never a fake answer.
              await runtime.fail(ref, "MODEL_PROVIDER_UNAVAILABLE");
              outcome = "model_not_configured";
            }
          }
        } catch (error: unknown) {
          const cause = rootCause(error);
          if (cause instanceof QCancellationSignal) {
            await runtime.finishCancellation(ref);
            outcome = "cancelled";
          } else if (cause instanceof QTerminalSignal) {
            outcome = "already_terminal";
          } else {
            // Diagnostics stay here. The run gets a coded failure and the
            // person a plain sentence; the engine's error never travels.
            logger?.error(
              { err: error, qRunId: ref.runId, operation },
              "q orchestration failed",
            );
            await runtime.fail(ref, "INTERNAL_ERROR");
            outcome = "failed";
          }
        } finally {
          span.setAttribute("q.outcome", outcome);
          span.setAttribute("q.duration_ms", Date.now() - startedAt);
          span.end();
        }
        logger?.info(
          {
            qRunId: ref.runId,
            operation,
            outcome,
            orchestrationVersion: Q_ORCHESTRATION_VERSION,
            durationMs: Date.now() - startedAt,
          },
          "q orchestration returned",
        );
        return handleOf(ref);
      },
    );
  }

  /** Maps the action gate's outcome onto the canonical lifecycle. */
  async function settleAction(
    ref: QRunRef,
    state: QGraphState,
  ): Promise<string> {
    switch (state.action) {
      case "EXECUTED":
      case "ALREADY_EXECUTED":
        await runtime.complete(ref, {
          modelPolicyVersion: state.modelPolicyVersion ?? undefined,
          promptBundleVersion: state.promptBundleVersion ?? undefined,
        });
        return "action_executed";
      case "IN_PROGRESS":
        // Another worker holds the claim and will settle the run.
        return "action_in_progress";
      case "NOT_APPROVED":
        // Declined, expired or withdrawn: the run ended without a side
        // effect (a rejection already completed it; expiry ends it here).
        if (
          state.actionFailure === "APPROVAL_EXPIRED" ||
          state.actionFailure === "EXPIRED"
        ) {
          await runtime.fail(ref, "APPROVAL_EXPIRED");
          return "action_expired";
        }
        await runtime.complete(ref, {
          modelPolicyVersion: state.modelPolicyVersion ?? undefined,
          promptBundleVersion: state.promptBundleVersion ?? undefined,
        });
        return "action_not_approved";
      case "BLOCKED":
        await runtime.fail(ref, "POLICY_DENIED");
        return "action_blocked";
      case "FAILED":
      case "RECONCILIATION_REQUIRED":
        await runtime.fail(ref, "TOOL_FAILED");
        return "action_failed";
      case "NONE":
      case "AWAITING_APPROVAL":
      case null:
        return "unknown";
    }
  }

  return {
    start: async (input: QOrchestrationInput) => {
      const run = await runtime.loadOwnedRun(
        input.actor,
        input.runId,
        input.correlationId,
      );
      if (isTerminal(run.status)) {
        throw new QRunAlreadyTerminalError(run.status);
      }
      if (run.status !== "RECEIVED" || run.orchestrationVersion !== null) {
        throw new QRunAlreadyStartedError();
      }
      requireSameOrganisationContext(run, input.actor);
      const ref = runRef(run);

      // RECEIVED → PREFLIGHT, stamping the version and the real start time.
      // Anything but ADVANCED means another starter or a cancellation got
      // there first; the engine is not touched.
      const begun = await runtime.begin(ref, Q_ORCHESTRATION_VERSION);
      if (begun.kind === "CANCEL_REQUESTED") {
        await runtime.finishCancellation(ref);
        return handleOf(ref);
      }
      if (begun.kind !== "ADVANCED") {
        if (isTerminal(begun.run.status)) {
          return toQRunHandle(begun.run);
        }
        throw new QRunAlreadyStartedError();
      }

      const initial: QGraphState = {
        runId: run.id,
        tenantId: run.tenantId,
        actorUserId: run.actorUserId,
        conversationId: run.conversationId,
        actorOrganisationId: input.actor.organisationId ?? null,
        actorMembershipId: input.actor.membershipId ?? null,
        capability: run.capability,
        subjects: run.subjects,
        orchestrationVersion: Q_ORCHESTRATION_VERSION,
        correlationId: run.correlationId,
        preflight: null,
        context: null,
        contextPlan: null,
        retrieval: null,
        answer: null,
        answerFailure: null,
        modelPolicyVersion: null,
        promptBundleVersion: null,
        action: null,
        actionId: null,
        approvalId: null,
        actionFailure: null,
      };
      return execute(
        ref,
        () => graph.invoke(initial, config(ref, input.signal)),
        "start",
      );
    },

    resume: async (input: QResumeInput) => {
      const run = await runtime.loadOwnedRun(
        input.actor,
        input.runId,
        input.correlationId,
      );
      if (isTerminal(run.status)) {
        throw new QRunAlreadyTerminalError(run.status);
      }
      if (
        run.status !== "AWAITING_INPUT" &&
        run.status !== "AWAITING_APPROVAL"
      ) {
        throw new QRunNotResumableError(run.status);
      }
      // Fail closed on a version this build cannot continue — before the
      // canonical lifecycle moves and before the engine reads a checkpoint.
      assertResumableOrchestrationVersion(run.orchestrationVersion);
      // The organisation context a run was started under does not follow
      // the person into another organisation: a run is resumed only in the
      // context that owns it.
      requireSameOrganisationContext(run, input.actor);
      const ref = runRef(run);

      // AWAITING_INPUT → PLANNING, or AWAITING_APPROVAL → ACTION_EXECUTION.
      // Two concurrent resumes serialise on the row lock; the second finds
      // the run already moved and is refused rather than driving the
      // engine a second time. Moving to ACTION_EXECUTION is a lifecycle
      // fact, not authority: the gate the resumed node calls re-verifies
      // the approval before anything executes.
      const resumed =
        run.status === "AWAITING_APPROVAL"
          ? await runtime.resumeFromApproval(ref)
          : await runtime.resumeFromPause(ref);
      if (resumed.kind !== "ADVANCED") {
        if (isTerminal(resumed.run.status)) {
          throw new QRunAlreadyTerminalError(resumed.run.status);
        }
        throw new QRunNotResumableError(resumed.run.status);
      }

      return execute(
        ref,
        () =>
          graph.invoke(
            // The actor's organisation context is taken from THIS authorised
            // request, never from the checkpoint: whatever the engine
            // remembers, the firewall re-plans on behalf of who is here now.
            new Command({
              resume: { kind: "Q_ORCHESTRATION_RESUME" },
              update: {
                actorOrganisationId: input.actor.organisationId ?? null,
                actorMembershipId: input.actor.membershipId ?? null,
              },
            }),
            config(ref, input.signal),
          ),
        "resume",
      );
    },

    cancel: async (input: QCancelInput) => {
      // The canonical lifecycle is the authority. A running engine sees the
      // result at its next boundary; a suspended one is simply never
      // resumed, because resume checks the canonical status first.
      const result = await cancelRun({
        actor: input.actor,
        runId: input.runId,
        correlationId: input.correlationId,
      });
      return toQRunHandle(result.run);
    },
  };
}
