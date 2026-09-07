import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { QActionProposalSchema } from "./action.js";
import { QCapabilitySchema } from "./capability.js";
import { QPublicFailureSchema } from "./failure.js";
import { QPublicFindingSchema } from "./finding.js";
import {
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QConversationIdSchema,
  QMessageIdSchema,
  QRunIdSchema,
  QStreamEventIdSchema,
} from "./ids.js";
import { QResponseMessageSchema } from "./message.js";
import { QClarificationRequestBlockSchema } from "./result-block.js";
import { QRunStatusSchema } from "./run.js";
import { QVisibleStageSchema } from "./stage.js";
import { QContractVersionSchema } from "./version.js";

/**
 * Progressive run events, q-api → client (doc 12 §37; doc 22 §69-77).
 *
 * These are transport for a live UI and a run's history. They are NOT
 * domain events: a token delta is not a business fact, is never registered
 * in the event registry, and never enters the transactional outbox. They
 * are not audit records either -- "Checking evidence" is a status indicator,
 * and a materially consequential Q action is audited by the execution
 * packet, not by this stream.
 *
 * Every event carries the run it belongs to, a per-run monotonic sequence
 * and its own identity. The sequence is what makes the stream resumable:
 * CQ-Q-009 persists material events, a client reconnects with the last
 * sequence it saw, and the server replays from there (doc 22 §73-74).
 * Sequence, not occurredAt, is the order; two events can share a
 * millisecond and cannot share a sequence.
 *
 * The union is closed and exhaustively discriminated on `type`. There is no
 * reasoning event, no scratchpad event, no specialist event and no free-text
 * activity event, and the vocabulary is extended only by adding a typed
 * member (doc 22 §72; TM-Q-12).
 */
export const Q_STREAM_EVENT_TYPES = [
  "q.run.started",
  "q.stage.changed",
  "q.message.delta",
  "q.message.completed",
  "q.finding.available",
  "q.action.proposed",
  "q.approval.required",
  "q.input.required",
  "q.run.completed",
  "q.run.failed",
] as const;

export type QStreamEventType = (typeof Q_STREAM_EVENT_TYPES)[number];

export const QStreamEventTypeSchema = z.enum(Q_STREAM_EVENT_TYPES);

/** After one of these the stream for that run ends. */
export const Q_STREAM_TERMINAL_EVENT_TYPES = [
  "q.run.completed",
  "q.run.failed",
] as const satisfies readonly QStreamEventType[];

/**
 * Durable events are persisted run history (CQ-Q-009 §15-§16): they carry
 * the per-run sequence as their SSE `id`, they replay after a reconnect,
 * and they survive a process restart. A delta is the one ephemeral event
 * (§17): live presentation between two durable boundaries, never stored,
 * never replayed, and never the client's resume cursor (§20).
 */
export const Q_STREAM_EPHEMERAL_EVENT_TYPES = [
  "q.message.delta",
] as const satisfies readonly QStreamEventType[];

export const Q_STREAM_DURABLE_EVENT_TYPES = [
  "q.run.started",
  "q.stage.changed",
  "q.message.completed",
  "q.finding.available",
  "q.action.proposed",
  "q.approval.required",
  "q.input.required",
  "q.run.completed",
  "q.run.failed",
] as const satisfies readonly QStreamEventType[];

const DURABLE: ReadonlySet<QStreamEventType> = new Set(
  Q_STREAM_DURABLE_EVENT_TYPES,
);

export function isDurableQStreamEventType(type: QStreamEventType): boolean {
  return DURABLE.has(type);
}

/**
 * Per-run ordering. Starts at 1 and increases by exactly one per event the
 * server emits, so a gap on the client side means a missed event, not a
 * quirk.
 */
export const QStreamSequenceSchema = z.number().int().min(1);

/**
 * A delta is ephemeral presentation (doc 22 §76). Bounded so a single
 * frame cannot carry a whole document, and so a client's buffer is
 * predictable.
 */
export const Q_STREAM_DELTA_MAX_LENGTH = 4000;

const eventShape = {
  contractVersion: QContractVersionSchema,
  eventId: QStreamEventIdSchema,
  runId: QRunIdSchema,
  sequence: QStreamSequenceSchema,
  occurredAt: UtcTimestampSchema,
};

const event = <TType extends QStreamEventType, TData extends z.ZodRawShape>(
  type: TType,
  data: TData,
) =>
  z
    .object({
      ...eventShape,
      type: z.literal(type),
      data: z.object(data).strict(),
    })
    .strict();

export const QRunStartedEventSchema = event("q.run.started", {
  capability: QCapabilitySchema,
  status: QRunStatusSchema,
  conversationId: QConversationIdSchema.optional(),
});

export const QStageChangedEventSchema = event("q.stage.changed", {
  stage: QVisibleStageSchema,
});

export const QMessageDeltaEventSchema = event("q.message.delta", {
  messageId: QMessageIdSchema,
  text: z.string().min(1).max(Q_STREAM_DELTA_MAX_LENGTH),
});

/** The durable form of what the deltas built. This, not the deltas, is history. */
export const QMessageCompletedEventSchema = event("q.message.completed", {
  message: QResponseMessageSchema,
});

export const QFindingAvailableEventSchema = event("q.finding.available", {
  finding: QPublicFindingSchema,
});

export const QActionProposedEventSchema = event("q.action.proposed", {
  proposal: QActionProposalSchema,
});

/**
 * A prepared action is waiting for a person. Carries references only: the
 * client fetches the approval under its own authority and approves through
 * the approval endpoint, never through the stream.
 */
export const QApprovalRequiredEventSchema = event("q.approval.required", {
  proposalId: QActionProposalIdSchema,
  approvalId: QApprovalIdSchema,
  expiresAt: UtcTimestampSchema.optional(),
});

export const QInputRequiredEventSchema = event("q.input.required", {
  clarification: QClarificationRequestBlockSchema,
});

export const QRunCompletedEventSchema = event("q.run.completed", {
  status: z.literal("COMPLETED"),
  completedAt: UtcTimestampSchema,
});

/**
 * The run ended without completing. Carries the PUBLIC failure projection
 * and only that; the internal diagnostic never rides the stream.
 */
export const QRunFailedEventSchema = event("q.run.failed", {
  status: z.enum(["FAILED", "CANCELLED", "EXPIRED"]),
  failure: QPublicFailureSchema,
});

export const QStreamEventSchema = z.discriminatedUnion("type", [
  QRunStartedEventSchema,
  QStageChangedEventSchema,
  QMessageDeltaEventSchema,
  QMessageCompletedEventSchema,
  QFindingAvailableEventSchema,
  QActionProposedEventSchema,
  QApprovalRequiredEventSchema,
  QInputRequiredEventSchema,
  QRunCompletedEventSchema,
  QRunFailedEventSchema,
]);

export type QStreamEvent = z.infer<typeof QStreamEventSchema>;

const TERMINAL: ReadonlySet<QStreamEventType> = new Set(
  Q_STREAM_TERMINAL_EVENT_TYPES,
);

export function isTerminalQStreamEvent(event: QStreamEvent): boolean {
  return TERMINAL.has(event.type);
}

export function isDurableQStreamEvent(event: QStreamEvent): boolean {
  return DURABLE.has(event.type);
}
