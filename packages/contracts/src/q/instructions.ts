import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Standing instructions (ADR 0043, founder decision 2026-10-03): the person
 * tells Q a goal once ("handle all the work for me"), approves ONE grant in
 * plain words, and Q works toward it over time inside that grant. The grant
 * is the delegation (ADR 0028 generalised): what Q may do on its own (AUTO),
 * what it asks first (ASK), and what it never does without an explicit yes
 * (terms, commitments, signing and money -- enforced in code, whatever the
 * grant says).
 */

export const Q_INSTRUCTION_GRANT = "q.instruction.grant" as const;

/** At most this many messages Q sends one counterpart under one instruction, then it asks. */
export const INSTRUCTION_MESSAGES_PER_COUNTERPART_MAX = 8;

/** Default monthly model budget per instruction, in USD; then it pauses and asks. */
export const INSTRUCTION_BUDGET_USD_MONTH_DEFAULT = "5.00";

/**
 * The declared app actions (ADR 0040 names) Q may ever take on its own
 * under a grant (founder decision 2026-10-03): expressing interest, chat
 * messages within the approved tone and topics, and booking times within
 * working hours. Everything else is ASK at most.
 */
export const INSTRUCTION_AUTO_ELIGIBLE_ACTIONS = [
  "relationship.interest.express",
  "chat.message.send",
  "schedule.meeting.book",
] as const;

export const INSTRUCTION_ACTION_MODES = ["AUTO", "ASK"] as const;
export type InstructionActionMode = (typeof INSTRUCTION_ACTION_MODES)[number];

export const STANDING_INSTRUCTION_STATUSES = [
  /** Prepared; waiting for the grant's approval. */
  "DRAFT",
  "ACTIVE",
  /** Budget used up, or waiting on the person. */
  "PAUSED",
  "STOPPED",
  "DONE",
  "EXPIRED",
] as const;
export type StandingInstructionStatus =
  (typeof STANDING_INSTRUCTION_STATUSES)[number];

const HourMinute = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/u);

export const InstructionWorkingHoursSchema = z
  .object({
    /** IANA time zone the hours are in. */
    timeZone: z.string().min(1).max(64),
    /** ISO weekdays, 1 = Monday. */
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start: HourMinute,
    end: HourMinute,
  })
  .strict();
export type InstructionWorkingHours = z.infer<
  typeof InstructionWorkingHoursSchema
>;

export const InstructionGrantSchema = z
  .object({
    /** Declared app actions (ADR 0040 names) and how each may be taken. */
    actions: z
      .array(
        z
          .object({
            action: z.string().min(1).max(80),
            mode: z.enum(INSTRUCTION_ACTION_MODES),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    /** Who it covers: all of their relationships, or only these. */
    counterparts: z
      .object({
        scope: z.enum(["ALL_MY_RELATIONSHIPS", "LISTED"]),
        relationshipIds: z.array(UuidSchema).max(50).default([]),
      })
      .strict(),
    workingHours: InstructionWorkingHoursSchema,
    /** How Q writes when it writes for them. */
    tone: z.string().min(1).max(300),
    /** What Q may talk about; anything else comes back to them. */
    topics: z.array(z.string().min(1).max(120)).max(12),
    maxMessagesPerCounterpart: z
      .number()
      .int()
      .min(0)
      .max(INSTRUCTION_MESSAGES_PER_COUNTERPART_MAX)
      .default(INSTRUCTION_MESSAGES_PER_COUNTERPART_MAX),
    /** Model spend per month, decimal USD as a string (never a float). */
    budgetUsdMonth: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,2})?$/u)
      .default(INSTRUCTION_BUDGET_USD_MONTH_DEFAULT),
    expiresInDays: z.number().int().min(1).max(365),
  })
  .strict();
export type InstructionGrant = z.infer<typeof InstructionGrantSchema>;

/** The Approval Engine payload: the goal and the exact grant approved. */
export const InstructionGrantPayloadSchema = z
  .object({
    /** The instruction a DRAFT was recorded for; absent on a first proposal. */
    instructionId: UuidSchema.optional(),
    goal: z.string().min(1).max(2_000),
    grant: InstructionGrantSchema,
  })
  .strict();
export type InstructionGrantPayload = z.infer<
  typeof InstructionGrantPayloadSchema
>;

/**
 * "Handle all the work for me": the founder's default grant (2026-10-03).
 * AUTO: express interest, chat messages (bounded), book times in working
 * hours. Everything else listed is ASK; pass, decline and relationship
 * outcomes are always ASK.
 */
export function handleEverythingGrant(input: {
  readonly timeZone: string;
  readonly tone?: string | undefined;
  readonly topics?: readonly string[] | undefined;
}): InstructionGrant {
  return InstructionGrantSchema.parse({
    actions: [
      { action: "relationship.interest.express", mode: "AUTO" },
      { action: "chat.message.send", mode: "AUTO" },
      { action: "schedule.meeting.book", mode: "AUTO" },
      { action: "relationship.connection_request.send", mode: "ASK" },
      { action: "relationship.interest.accept", mode: "ASK" },
      { action: "relationship.interest.decline", mode: "ASK" },
      { action: "relationship.outcome.change", mode: "ASK" },
      { action: "schedule.reminder.create", mode: "ASK" },
      { action: "diligence.change", mode: "ASK" },
    ],
    counterparts: { scope: "ALL_MY_RELATIONSHIPS", relationshipIds: [] },
    workingHours: {
      timeZone: input.timeZone,
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "17:00",
    },
    tone: input.tone ?? "Warm, brief and professional, in their own voice.",
    topics: [
      ...(input.topics ?? ["introductions", "their company", "times to meet"]),
    ],
    expiresInDays: 30,
  });
}

/** One standing instruction as its owner sees it. */
export const StandingInstructionDtoSchema = z
  .object({
    id: UuidSchema,
    goal: z.string().max(2_000),
    status: z.enum(STANDING_INSTRUCTION_STATUSES),
    /** The grant Q works under; null while waiting for its approval. */
    grant: InstructionGrantSchema.nullable(),
    budgetUsdMonth: z.string().max(16),
    spentUsdMonth: z.string().max(24),
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type StandingInstructionDto = z.infer<
  typeof StandingInstructionDtoSchema
>;
