import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { VersionSchema } from "../common/version.js";
import { QRunIdSchema, QToolCallIdSchema } from "./ids.js";

/**
 * The shape of a tool call as the runtime records it (doc 12 §28-29, §33;
 * doc 22 §83-84). Shapes only: no tool is registered, named or executed
 * here, and no tool-specific input or output schema exists yet. Those are
 * CQ-Q-007's, declared per tool with Zod in and Zod out.
 *
 * There is deliberately no `arguments`, `input`, `output` or `result` field
 * on either contract. An untyped payload on a shared envelope is how a model
 * ends up choosing a recipient, and how a browser ends up submitting a
 * "tool result" the runtime then trusts. Per-tool payloads travel under
 * per-tool schemas, validated at the tool boundary, and never on this
 * envelope.
 *
 * Neither shape is accepted from a client. A tool call is a runtime fact.
 */

/**
 * A registered tool's stable name: dotted lower_snake_case, at least two
 * segments, e.g. `company.profile.read`, `message.draft`. Same shape as a
 * capability so the two vocabularies stay parallel, but a tool name is not a
 * capability and never implies one.
 */
export const QToolNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "expected a dotted lower_snake_case tool name",
  )
  .max(128);

export type QToolName = z.infer<typeof QToolNameSchema>;

/** Tool categories (doc 12 §28.1). Policy keys on this; it is never inferred from a name. */
export const Q_TOOL_CLASSIFICATIONS = [
  "READ_ONLY",
  "ANALYTICAL",
  "PREPARE",
  "SIDE_EFFECT",
] as const;

export type QToolClassification = (typeof Q_TOOL_CLASSIFICATIONS)[number];

export const QToolClassificationSchema = z.enum(Q_TOOL_CLASSIFICATIONS);

/**
 * Where a tool call is in the execution pipeline. PROPOSED is the model
 * asking; AUTHORIZED is the deterministic authorize step agreeing; nothing
 * runs before that step and DENIED is a normal, terminal outcome.
 */
export const Q_TOOL_CALL_STATUSES = [
  "PROPOSED",
  "AUTHORIZED",
  "DENIED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type QToolCallStatus = (typeof Q_TOOL_CALL_STATUSES)[number];

export const QToolCallStatusSchema = z.enum(Q_TOOL_CALL_STATUSES);

export const Q_TOOL_CALL_TERMINAL_STATUSES = [
  "DENIED",
  "SUCCEEDED",
  "FAILED",
] as const satisfies readonly QToolCallStatus[];

const TERMINAL: ReadonlySet<QToolCallStatus> = new Set(
  Q_TOOL_CALL_TERMINAL_STATUSES,
);

export function isTerminalQToolCallStatus(status: QToolCallStatus): boolean {
  return TERMINAL.has(status);
}

/** A stable, bounded tool failure category. Never a provider message. */
export const QToolFailureCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "expected an UPPER_SNAKE_CASE failure code")
  .max(64);

/**
 * INTERNAL. One tool call in a run's history: which tool, at which version,
 * of which class, and how far it got. Payloads live with the tool.
 */
export const QToolCallRecordSchema = z
  .object({
    toolCallId: QToolCallIdSchema,
    runId: QRunIdSchema,
    toolName: QToolNameSchema,
    toolVersion: VersionSchema,
    classification: QToolClassificationSchema,
    status: QToolCallStatusSchema,
    requestedAt: UtcTimestampSchema,
    completedAt: UtcTimestampSchema.optional(),
    failureCode: QToolFailureCodeSchema.optional(),
  })
  .strict();

export type QToolCallRecord = z.infer<typeof QToolCallRecordSchema>;

/**
 * PUBLIC. What a person may learn about a tool call: that Q is doing
 * something of a given class, and whether it finished. The tool's name is
 * withheld -- it names internal capability the UI has no need for and a
 * curious client no business enumerating. The stream carries this only when
 * a later packet decides it is useful; it is not a stream event today.
 */
export const QToolProgressSchema = z
  .object({
    toolCallId: QToolCallIdSchema,
    classification: QToolClassificationSchema,
    status: QToolCallStatusSchema,
    occurredAt: UtcTimestampSchema,
  })
  .strict();

export type QToolProgress = z.infer<typeof QToolProgressSchema>;
