import { z } from "zod";

import {
  CapitalObjectiveClosureReasonSchema,
  CapitalObjectiveStatusSchema,
  CapitalObjectiveTypeSchema,
  CapitalTargetSchema,
  InstrumentCodeSchema,
  LocalDateSchema,
  StageCodeSchema,
  USE_OF_FUNDS_MAX_LENGTH,
  UuidSchema,
} from "@capital-q/contracts";

/**
 * Typed payloads of core.capital_objective_events: the goal-evolution
 * history. Bounded canonical values only -- enough to reconstruct how the
 * objective changed -- never Q text, documents, notes or relationship data.
 * This history is company-private and is neither audit nor outbox.
 */

export const CAPITAL_HISTORY_EVENT_TYPES = [
  "CREATED",
  "RECALIBRATED",
  "CLOSED",
  "REPLACED",
] as const;
export const CapitalHistoryEventTypeSchema = z.enum(
  CAPITAL_HISTORY_EVENT_TYPES,
);
export type CapitalHistoryEventType = z.infer<
  typeof CapitalHistoryEventTypeSchema
>;

/** Safe change categories shared by history, audit and the outbox. */
export const CAPITAL_CHANGE_KINDS = [
  "TARGET_AMOUNT",
  "CURRENCY",
  "TARGET_STAGE",
  "INSTRUMENT",
  "TIMELINE",
  "USE_OF_FUNDS",
] as const;
export const CapitalChangeKindSchema = z.enum(CAPITAL_CHANGE_KINDS);
export type CapitalChangeKind = z.infer<typeof CapitalChangeKindSchema>;

/** The canonical values the history records, in wire shape. */
const CanonicalValuesSchema = z
  .object({
    objectiveType: CapitalObjectiveTypeSchema,
    target: CapitalTargetSchema,
    targetStage: StageCodeSchema.nullable(),
    instrumentCode: InstrumentCodeSchema.nullable(),
    targetCloseDate: LocalDateSchema.nullable(),
    useOfFundsSummary: z.string().max(USE_OF_FUNDS_MAX_LENGTH).nullable(),
  })
  .strict();
export type CapitalCanonicalValues = z.infer<typeof CanonicalValuesSchema>;

const PartialValuesSchema = CanonicalValuesSchema.partial().strict();

export const CapitalCreatedPayloadSchema = z
  .object({
    kind: z.literal("CREATED"),
    status: CapitalObjectiveStatusSchema,
    values: CanonicalValuesSchema,
    /** Present when this objective was created by replacing another. */
    replacedCapitalObjectiveId: UuidSchema.optional(),
  })
  .strict();

export const CapitalRecalibratedPayloadSchema = z
  .object({
    kind: z.literal("RECALIBRATED"),
    changedFields: z.array(z.string().min(1).max(64)).min(1).max(8),
    changeKinds: z.array(CapitalChangeKindSchema).min(1).max(8),
    previous: PartialValuesSchema,
    next: PartialValuesSchema,
    previousVersion: z.number().int().min(1),
    newVersion: z.number().int().min(1),
  })
  .strict();

export const CapitalClosedPayloadSchema = z
  .object({
    kind: z.literal("CLOSED"),
    reason: CapitalObjectiveClosureReasonSchema,
    previousVersion: z.number().int().min(1),
    newVersion: z.number().int().min(1),
  })
  .strict();

export const CapitalReplacedPayloadSchema = z
  .object({
    kind: z.literal("REPLACED"),
    replacementCapitalObjectiveId: UuidSchema,
    previousVersion: z.number().int().min(1),
    newVersion: z.number().int().min(1),
  })
  .strict();

export const CapitalHistoryPayloadSchema = z.discriminatedUnion("kind", [
  CapitalCreatedPayloadSchema,
  CapitalRecalibratedPayloadSchema,
  CapitalClosedPayloadSchema,
  CapitalReplacedPayloadSchema,
]);
export type CapitalHistoryPayload = z.infer<typeof CapitalHistoryPayloadSchema>;

/** Serialized bound enforced in code before the database check. */
export const CAPITAL_HISTORY_PAYLOAD_MAX_BYTES = 8192;

export function serializeHistoryPayload(
  payload: CapitalHistoryPayload,
): string {
  const parsed = CapitalHistoryPayloadSchema.parse(payload);
  const json = JSON.stringify(parsed);
  if (Buffer.byteLength(json, "utf8") > CAPITAL_HISTORY_PAYLOAD_MAX_BYTES) {
    throw new RangeError("capital objective history payload exceeds its bound");
  }
  return json;
}
