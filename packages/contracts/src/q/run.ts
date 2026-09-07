import { z } from "zod";

import { CorrelationIdSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { QCapabilitySchema } from "./capability.js";
import { QPublicFailureSchema } from "./failure.js";
import { QConversationIdSchema, QRunIdSchema } from "./ids.js";
import { QMessageSchema } from "./message.js";
import { QResultBlocksSchema } from "./result-block.js";
import { QVisibleStageSchema } from "./stage.js";
import { QSubjectRefsSchema } from "./subject.js";

/**
 * The deterministic machine lifecycle of a Q run (doc 12 §9.1; doc 22 §78).
 *
 * This is runtime state, set by the orchestrator, never by a model. Not
 * every run visits every state; a quick answer may go RECEIVED → SYNTHESIS
 * → COMPLETED. It is distinct from QVisibleStage, the approved progress
 * vocabulary a person sees: status answers "where is the runtime", stage
 * answers "what may the person be told", and one status can be shown as
 * several stages or none.
 *
 * A run status is not relationship state, not an approval outcome and not
 * a judgement about the subject. COMPLETED means Q finished; it says
 * nothing about what it found.
 */
export const Q_RUN_STATUSES = [
  "RECEIVED",
  "PREFLIGHT",
  "CONTEXT_RESOLUTION",
  "POLICY_CHECK",
  "PLANNING",
  "RETRIEVAL",
  "SPECIALIST_EXECUTION",
  "SYNTHESIS",
  "VERIFICATION",
  /** Paused for the person's reply to a clarification (doc 22 §77). */
  "AWAITING_INPUT",
  /** Paused for a human approval of a prepared action. */
  "AWAITING_APPROVAL",
  "ACTION_EXECUTION",
  /** Cancellation asked for; in-flight work stops cooperatively (doc 22 §78). */
  "CANCEL_REQUESTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type QRunStatus = (typeof Q_RUN_STATUSES)[number];

export const QRunStatusSchema = z.enum(Q_RUN_STATUSES);

/** Once here, a run never changes status again. */
export const Q_RUN_TERMINAL_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly QRunStatus[];

export type QRunTerminalStatus = (typeof Q_RUN_TERMINAL_STATUSES)[number];

export const QRunTerminalStatusSchema = z.enum(Q_RUN_TERMINAL_STATUSES);

const TERMINAL: ReadonlySet<QRunStatus> = new Set(Q_RUN_TERMINAL_STATUSES);

export function isTerminalQRunStatus(
  status: QRunStatus,
): status is QRunTerminalStatus {
  return TERMINAL.has(status);
}

/** The two waiting states, where nothing happens until a person acts. */
export const Q_RUN_WAITING_STATUSES = [
  "AWAITING_INPUT",
  "AWAITING_APPROVAL",
] as const satisfies readonly QRunStatus[];

/**
 * PUBLIC. What a caller gets back when Q accepts work (doc 22 §68):
 * enough to identify the run and follow it, nothing about its content.
 * Not a promise of completion. The event stream location is added by
 * CQ-Q-009 as an additive field once a stream exists.
 */
export const QRunHandleSchema = z
  .object({
    runId: QRunIdSchema,
    /** The conversation the run belongs to, so a client can continue it. */
    conversationId: QConversationIdSchema.optional(),
    status: QRunStatusSchema,
    createdAt: UtcTimestampSchema,
  })
  .strict();

export type QRunHandle = z.infer<typeof QRunHandleSchema>;

/** Messages returned inline with a run. A V1 technical bound. */
export const Q_RUN_MESSAGES_MAX = 200;

/**
 * PUBLIC. A run as a client may read it back (doc 12 §9.3, projected).
 *
 * This schema is the allowlist for GET /v1/q/runs/:runId. What is absent is
 * the point: no graph state, no checkpoint, no prompt or prompt version, no
 * provider request or response, no model name, no tool payloads, no
 * specialist output, no reasoning. Orchestration, prompt and model policy
 * versions are run-record fields for the runtime and evaluation, and they
 * stay there.
 */
export const QRunSummarySchema = z
  .object({
    runId: QRunIdSchema,
    conversationId: QConversationIdSchema.optional(),
    capability: QCapabilitySchema,
    status: QRunStatusSchema,
    /** Null when there is nothing to show -- a run that has not started, or has ended. */
    visibleStage: QVisibleStageSchema.nullable(),
    subjects: QSubjectRefsSchema,
    /** The turns exchanged in this run, oldest first. */
    messages: z.array(QMessageSchema).max(Q_RUN_MESSAGES_MAX).optional(),
    /** Results available so far. May be partial while the run is live. */
    results: QResultBlocksSchema.optional(),
    /** Present only when the run failed. Public projection only. */
    failure: QPublicFailureSchema.optional(),
    correlationId: CorrelationIdSchema.optional(),
    createdAt: UtcTimestampSchema,
    startedAt: UtcTimestampSchema.optional(),
    completedAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .refine((run) => run.failure === undefined || run.status === "FAILED", {
    message: "a failure is reported only on a failed run",
    path: ["failure"],
  })
  .refine(
    (run) => run.completedAt === undefined || isTerminalQRunStatus(run.status),
    {
      message: "only a terminal run has a completion time",
      path: ["completedAt"],
    },
  );

export type QRunSummary = z.infer<typeof QRunSummarySchema>;
