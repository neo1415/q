import {
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

import type {
  PermittedContextPlan,
  QActionProposalId,
  QRunStatus,
  QVisibleStage,
} from "@capital-q/contracts";

type QActionExecuteId = QActionProposalId;
import type { Logger } from "@capital-q/observability";
import {
  QRunNotFoundError,
  type ContextFirewallPort,
  type QActionPort,
  type QAnswerPort,
  type QLifecycleOutcome,
  type QOrchestrationRuntime,
  type QOrchestrationSubjectContext,
  type QPausePolicy,
  type QRetrievalPort,
  type QRunRecord,
  type QRunRef,
} from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  QGraphAnnotation,
  type QContextPlanDescriptor,
  type QGraphState,
} from "./state.js";
import { assertResumableOrchestrationVersion } from "./version.js";

/**
 * The investigation graph (packet §63; CQ-Q-008 §46-§49):
 *
 *   START → preflight → context firewall → pause → retrieve → answer
 *                            ↓ denied                  ↓ denied      ↓
 *                           END                       END     action prepare
 *                                                                    ↓ proposed
 *                                                            approval gate (interrupt)
 *                                                                    ↓ resumed
 *                                                            execute via gate → END
 *
 * The approval gate interrupts AFTER the Approval Engine has persisted the
 * action, the approval request and the run's AWAITING_APPROVAL status in
 * one transaction. The interrupt is a suspension point, never authority:
 * on resume the same node asks the engine's execution gate, which
 * re-verifies the approval record, the payload hash, the actor's current
 * permission and the idempotent claim. A replayed node cannot execute
 * twice because the action row, not the checkpoint, says what happened.
 *
 * These nodes are orchestration seams, not intelligence. Each begins at a
 * boundary check against the canonical run — the run, not the engine,
 * decides whether work may continue — and each advances the canonical
 * lifecycle through the runtime's replay-idempotent moves.
 *
 * The Context Firewall (CQ-Q-004) owns POLICY_CHECK. It runs before any
 * retrieval, and retrieval runs it AGAIN: a plan is a decision at an
 * instant, so a resumed or long-lived run re-plans against live policy and
 * a checkpoint can never carry permission forward. Nothing here calls a
 * model, retrieves content, or asks a model what may be seen.
 *
 * Node names never leave this file. The person sees `QVisibleStage`
 * values chosen here; nothing carries a node name.
 */

export type QGraphDependencies = {
  readonly runtime: QOrchestrationRuntime;
  readonly firewall: ContextFirewallPort;
  readonly retrieval: QRetrievalPort;
  readonly answer: QAnswerPort;
  /** The Approval Engine seam (CQ-Q-008). */
  readonly actions: QActionPort;
  readonly pausePolicy: QPausePolicy;
  readonly logger?: Logger | undefined;
};

/** The engine is told to stop: the canonical run asked for cancellation. */
export class QCancellationSignal extends Error {
  constructor() {
    super("cancellation requested");
    this.name = "QCancellationSignal";
  }
}

/** The run ended (by someone else) while the engine was between nodes. */
export class QTerminalSignal extends Error {
  readonly status: QRunStatus;

  constructor(status: QRunStatus) {
    super("run already terminal");
    this.name = "QTerminalSignal";
    this.status = status;
  }
}

/** The value the pause node interrupts with. Internal; never a client contract. */
export const Q_INTERNAL_PAUSE = { kind: "Q_ORCHESTRATION_PAUSE" } as const;
/** The value the approval gate interrupts with. Internal; never authority. */
export const Q_APPROVAL_PAUSE = { kind: "Q_APPROVAL_PAUSE" } as const;

function ref(state: QGraphState): QRunRef {
  return {
    runId: state.runId,
    tenantId: state.tenantId,
    actorUserId: state.actorUserId,
  };
}

function subjectContext(state: QGraphState): QOrchestrationSubjectContext {
  return {
    runId: state.runId,
    tenantId: state.tenantId,
    actorUserId: state.actorUserId,
    capability: state.capability,
    subjects: state.subjects,
  };
}

/**
 * The actor the firewall is asked on behalf of: the person who owns the
 * run, in the organisation context that was authorised when the engine
 * was (re)started. Re-validated as an ActorContext; a malformed checkpoint
 * cannot become an actor.
 */
function actorFor(state: QGraphState): ActorContext {
  return ActorContextSchema.parse({
    userId: state.actorUserId,
    tenantId: state.tenantId,
    ...(state.actorOrganisationId === null
      ? {}
      : { organisationId: state.actorOrganisationId }),
    ...(state.actorMembershipId === null
      ? {}
      : { membershipId: state.actorMembershipId }),
    actorType: "HUMAN",
  });
}

function describe(plan: PermittedContextPlan): QContextPlanDescriptor {
  return {
    planId: plan.planId,
    fingerprint: plan.fingerprint,
    policyVersion: plan.policyVersion,
    taskClass: plan.purpose.taskClass,
    scopeKinds: plan.scopes.map((scope) => scope.kind),
    maxSensitivity: plan.maxSensitivity,
    evaluatedAt: plan.evaluatedAt,
    revalidateAfter: plan.revalidateAfter,
  };
}

function honour(outcome: QLifecycleOutcome): QRunRecord {
  switch (outcome.kind) {
    case "ADVANCED":
    case "UNCHANGED":
      return outcome.run;
    case "CANCEL_REQUESTED":
      throw new QCancellationSignal();
    case "TERMINAL":
      throw new QTerminalSignal(outcome.run.status);
  }
}

export function buildQGraph(
  dependencies: QGraphDependencies,
  saver: BaseCheckpointSaver,
) {
  const { runtime, firewall, retrieval, answer, actions, pausePolicy, logger } =
    dependencies;

  /**
   * The current plan per run, in process memory only. Never checkpointed:
   * a pause or a restart empties it, and the next node re-plans against
   * live policy. It exists so a straight run asks the firewall twice
   * (decision, then pre-retrieval revalidation) rather than three times.
   */
  const livePlans = new Map<string, PermittedContextPlan>();

  async function boundary(state: QGraphState): Promise<QRunRecord> {
    const run = await runtime.readRun(ref(state));
    if (run === null) {
      throw new QRunNotFoundError();
    }
    if (run.status === "CANCEL_REQUESTED") {
      throw new QCancellationSignal();
    }
    if (
      run.status === "COMPLETED" ||
      run.status === "FAILED" ||
      run.status === "CANCELLED" ||
      run.status === "EXPIRED"
    ) {
      throw new QTerminalSignal(run.status);
    }
    return run;
  }

  async function advance(
    state: QGraphState,
    to: QRunStatus,
    stage?: QVisibleStage,
  ): Promise<QRunRecord> {
    return honour(await runtime.advance(ref(state), to, stage));
  }

  /** Ask the firewall for this run, now. */
  async function plan(state: QGraphState) {
    return firewall.plan({
      actor: actorFor(state),
      runId: state.runId,
      correlationId: state.correlationId,
      capability: state.capability,
      subjects: state.subjects,
    });
  }

  // Deterministic checks only: the run exists, is executable, carries a
  // conversation, and was stamped with a version this build understands.
  const preflight = async (
    state: QGraphState,
  ): Promise<Partial<QGraphState>> => {
    const run = await boundary(state);
    if (run.conversationId === null) {
      throw new Error("q run has no conversation");
    }
    assertResumableOrchestrationVersion(run.orchestrationVersion);
    await advance(state, "CONTEXT_RESOLUTION");
    return { preflight: "PASSED" };
  };

  // The Context Firewall: POLICY_CHECK. Deterministic policy over the
  // authorization and disclosure layers decides what Q may reason over;
  // a denial ends the run through the orchestrator's POLICY_DENIED path
  // and nothing further is retrieved or asked.
  const contextFirewall = async (
    state: QGraphState,
  ): Promise<Partial<QGraphState>> => {
    await boundary(state);
    await advance(state, "POLICY_CHECK");
    const decision = await plan(state);
    if (decision.outcome === "DENIED") {
      livePlans.delete(state.runId);
      return { context: "DENIED", contextPlan: null };
    }
    livePlans.set(state.runId, decision.plan);
    await advance(state, "PLANNING");
    return { context: "AUTHORISED", contextPlan: describe(decision.plan) };
  };

  // The only node that may interrupt, and it does nothing else.
  const pause = async (state: QGraphState): Promise<Partial<QGraphState>> => {
    if (!(await pausePolicy.shouldPause(subjectContext(state)))) {
      return {};
    }
    interrupt(Q_INTERNAL_PAUSE);
    return {};
  };

  // Retrieval, behind a fresh plan. Whatever the checkpoint remembers, the
  // allowlist handed to retrieval is what policy says NOW: a revoked share,
  // a removed membership or a switched organisation since the last
  // checkpoint means less context or none.
  const retrieve = async (
    state: QGraphState,
  ): Promise<Partial<QGraphState>> => {
    await boundary(state);
    await advance(state, "RETRIEVAL");
    const decision = await plan(state);
    if (decision.outcome === "DENIED") {
      livePlans.delete(state.runId);
      return { context: "DENIED", contextPlan: null, retrieval: null };
    }
    if (
      state.contextPlan !== null &&
      state.contextPlan.fingerprint !== decision.plan.fingerprint
    ) {
      logger?.info(
        {
          qRunId: state.runId,
          previousPlanId: state.contextPlan.planId,
          planId: decision.plan.planId,
        },
        "context plan changed on revalidation",
      );
    }
    livePlans.set(state.runId, decision.plan);
    const outcome = await retrieval.retrieve(
      subjectContext(state),
      decision.plan,
    );
    return {
      context: "AUTHORISED",
      contextPlan: describe(decision.plan),
      retrieval: outcome.kind,
    };
  };

  // The answer seam. The plan it hands the (future) model gateway is the
  // one retrieval just used, or a fresh one if the process no longer holds
  // it. No model is chosen or called here.
  const answerNode = async (
    state: QGraphState,
    config: RunnableConfig,
  ): Promise<Partial<QGraphState>> => {
    await boundary(state);
    await advance(state, "SYNTHESIS", "PREPARING_ANALYSIS");
    let current = livePlans.get(state.runId);
    if (current === undefined) {
      const decision = await plan(state);
      if (decision.outcome === "DENIED") {
        return { context: "DENIED", contextPlan: null, answer: null };
      }
      current = decision.plan;
    }
    livePlans.delete(state.runId);
    // The engine's signal reaches the model call: a cancelled invocation
    // stops waiting on the provider instead of finishing an answer nobody
    // asked for.
    const outcome = await answer.answer({
      ...subjectContext(state),
      actor: actorFor(state),
      correlationId: state.correlationId,
      retrieval:
        state.retrieval === "AUTHORISED_REFERENCES"
          ? { kind: "AUTHORISED_REFERENCES", referenceCount: 0 }
          : { kind: "NOT_CONFIGURED" },
      plan: current,
      signal: config.signal,
    });
    switch (outcome.kind) {
      case "ANSWERED":
        return {
          answer: "ANSWERED",
          answerFailure: null,
          modelPolicyVersion: outcome.modelPolicyVersion,
          promptBundleVersion: outcome.promptBundleVersion,
        };
      case "FAILED":
        return { answer: "FAILED", answerFailure: outcome.diagnosticCode };
      case "NOT_CONFIGURED":
        return { answer: "NOT_CONFIGURED", answerFailure: null };
    }
  };

  // The action seam, first half: does this run have something consequential
  // to prepare? The engine proposes nothing itself; the port's proposer
  // does, and the Approval Engine decides whether it may be proposed. A
  // proposal is persisted together with its approval request and the
  // run's AWAITING_APPROVAL status before this node returns.
  const actionPrepare = async (
    state: QGraphState,
  ): Promise<Partial<QGraphState>> => {
    await boundary(state);
    if (state.answer !== "ANSWERED") {
      return { action: "NONE" };
    }
    let current = livePlans.get(state.runId);
    if (current === undefined) {
      const decision = await plan(state);
      if (decision.outcome === "DENIED") {
        return { action: "NONE" };
      }
      current = decision.plan;
    }
    const outcome = await actions.prepare({
      ...subjectContext(state),
      actor: actorFor(state),
      correlationId: state.correlationId,
      plan: current,
    });
    if (outcome.kind === "NONE") {
      return { action: "NONE", actionId: null, approvalId: null };
    }
    return {
      action: "AWAITING_APPROVAL",
      actionId: outcome.actionId,
      approvalId: outcome.approvalId,
    };
  };

  // Second half: suspend for the person, and on resume execute through
  // the gate. LangGraph re-runs this node from its start on resume, which
  // is why nothing before `interrupt` has an effect and nothing after it
  // is trusted from memory: the gate reads the action row.
  const approvalGate = async (
    state: QGraphState,
    config: RunnableConfig,
  ): Promise<Partial<QGraphState>> => {
    if (state.actionId === null) {
      return {};
    }
    interrupt(Q_APPROVAL_PAUSE);
    await boundary(state);
    const outcome = await actions.executeApproved({
      actor: actorFor(state),
      runId: state.runId,
      tenantId: state.tenantId,
      correlationId: state.correlationId,
      actionId: state.actionId as QActionExecuteId,
      signal: config.signal,
    });
    switch (outcome.kind) {
      case "EXECUTED":
      case "ALREADY_EXECUTED":
      case "IN_PROGRESS":
        return { action: outcome.kind, actionFailure: null };
      case "FAILED":
      case "RECONCILIATION_REQUIRED":
        return { action: outcome.kind, actionFailure: outcome.failureCode };
      case "NOT_APPROVED":
      case "BLOCKED":
        return { action: outcome.kind, actionFailure: outcome.reason };
    }
  };

  const afterContext = (state: QGraphState) =>
    state.context === "DENIED" ? END : "pause_seam";
  const afterRetrieval = (state: QGraphState) =>
    state.context === "DENIED" ? END : "answer_seam";
  const afterAnswer = (state: QGraphState) =>
    state.answer === "ANSWERED" ? "action_prepare" : END;
  const afterPrepare = (state: QGraphState) =>
    state.action === "AWAITING_APPROVAL" ? "approval_gate" : END;

  // Node names are internal (never emitted) and must differ from the state
  // channel names, which the engine reserves.
  return new StateGraph(QGraphAnnotation)
    .addNode("preflight_gate", preflight)
    .addNode("context_firewall", contextFirewall)
    .addNode("pause_seam", pause)
    .addNode("retrieval_seam", retrieve)
    .addNode("answer_seam", answerNode)
    .addNode("action_prepare", actionPrepare)
    .addNode("approval_gate", approvalGate)
    .addEdge(START, "preflight_gate")
    .addEdge("preflight_gate", "context_firewall")
    .addConditionalEdges("context_firewall", afterContext, {
      pause_seam: "pause_seam",
      [END]: END,
    })
    .addEdge("pause_seam", "retrieval_seam")
    .addConditionalEdges("retrieval_seam", afterRetrieval, {
      answer_seam: "answer_seam",
      [END]: END,
    })
    .addConditionalEdges("answer_seam", afterAnswer, {
      action_prepare: "action_prepare",
      [END]: END,
    })
    .addConditionalEdges("action_prepare", afterPrepare, {
      approval_gate: "approval_gate",
      [END]: END,
    })
    .addEdge("approval_gate", END)
    .compile({ checkpointer: saver });
}

export type QCompiledGraph = ReturnType<typeof buildQGraph>;
