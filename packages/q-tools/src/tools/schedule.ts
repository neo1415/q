import { z } from "zod";

import {
  calendarBlockedLine,
  isCalendarBlock,
  Q_TASK_CLASSES,
  QShowCalendarConnectIntentSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CalendarBlockReason,
  type PermittedContextPlan,
  type RelationshipBrief,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  QToolArgumentError,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { RelationshipIntelligencePort } from "../ports.js";
import { appActionKey, type AppApprovalPort } from "./app-actions.js";
import { closestByName } from "./connection-requests.js";
import { ERRAND_CALL_LEAD_MINUTES } from "./errands.js";
import { admitted } from "./relationships.js";
import {
  ChatProposalOutputSchema,
  ERRAND_START,
  exactlyOne,
  MEETING_CANCEL,
  MEETING_RESCHEDULE,
  MEETING_SCHEDULE,
  ONE_REF,
  PROPOSE_MEETING,
  PROPOSE_REMINDER,
  PURPOSES,
  REMINDER_CREATE,
  RelationshipRef,
  resolveRelationship,
  SCOPES,
  type ChatIntelligencePort,
  type ChatProposalOutput,
} from "./chat.js";
import {
  isKnownTimeZone,
  localLabel as zonedLabel,
  LocalWhenSchema,
  isUncertainDeviceZone,
  localSpanLabel,
  resolveLocalWhen,
  resolveLocalWindow,
  zoneFromWords,
  unresolvedMessage,
  type LocalWhen,
} from "./local-time.js";
import { CardReasonSchema, reasonOf } from "./card-reason.js";

/**
 * Meetings and reminders for Q (BIZ-008; R11, R14, R33: "set up a call with
 * X next week", "remind me Friday to follow up", by text and by voice).
 *
 * - find_meeting_times reads three free times from the person's own
 *   calendar for one relationship Q may discuss this run.
 * - propose_meeting prepares `meeting.schedule` (one exact time) on the
 *   run's board; the invite goes out only when the person approves it.
 * - propose_meeting_change prepares `meeting.reschedule` / `meeting.cancel`
 *   for a call they organised.
 * - propose_reminder prepares `reminder.create`, about a relationship or
 *   about nothing in particular.
 * - list_schedule reads their own calls (with any prep brief that is
 *   ready) and open reminders.
 *
 * Nothing here books, sends or writes. The Approval Engine executes, and
 * its authorize steps check the party and the organiser again.
 */

export const FIND_MEETING_TIMES = "relationship.meeting.find_times" as const;
export const PROPOSE_MEETING_CHANGE = "relationship.meeting.change" as const;
export const LIST_SCHEDULE = "schedule.list" as const;
export const DISMISS_REMINDER = "schedule.reminder.dismiss" as const;

type Refusal =
  | "NOT_A_PARTY"
  | "NOT_CONNECTED"
  | "CALENDAR_NOT_CONNECTED"
  | "CALENDAR_REVOKED"
  | "NO_RECIPIENTS"
  | "NOT_FOUND"
  | "NOT_ORGANISER"
  | "CANCELLED"
  | "INVALID_TIME"
  | "KEY_REUSED"
  | "NOT_A_MEET_LINK"
  | "ALREADY_BOOKED"
  | "UNAVAILABLE";

/** The schedule as Q may see it, for the invoker only. */
export type ScheduleIntelligencePort = {
  readonly findSlots: (
    actor: ActorContext,
    input: {
      readonly relationshipId: string;
      readonly durationMinutes: number;
      readonly from?: Date | undefined;
      readonly to?: Date | undefined;
      readonly timeZone?: string | undefined;
    },
  ) => Promise<
    | {
        readonly status: "OK";
        readonly timeZone: string;
        readonly slots: readonly { readonly start: Date; readonly end: Date }[];
      }
    | {
        readonly status: Refusal;
        /**
         * Q room R5: with their calendar not connected, times from working
         * hours in their zone, never checked against any calendar.
         */
        readonly suggested?:
          | {
              readonly timeZone: string;
              readonly slots: readonly {
                readonly start: Date;
                readonly end: Date;
              }[];
            }
          | undefined;
      }
  >;
  /** Their own upcoming calls and open reminders. */
  /**
   * R1: the Relationship Brief of each of the person's own relationships,
   * from one batched read. Null: they have no side. Absent: not composed.
   */
  readonly relationshipBriefs?:
    | ((actor: ActorContext) => Promise<readonly RelationshipBrief[] | null>)
    | undefined;
  readonly upcoming: (actor: ActorContext) => Promise<{
    readonly meetings: readonly {
      readonly id: string;
      readonly relationshipId: string;
      readonly purpose: string;
      readonly startsAt: string;
      readonly endsAt: string;
      readonly timeZone: string;
      readonly organisedByYou: boolean;
      readonly attendees: readonly string[];
      readonly hasBrief: boolean;
    }[];
    readonly reminders: readonly {
      readonly id: string;
      readonly title: string;
      readonly dueAt: string;
      readonly relationshipId: string | null;
    }[];
  }>;
  /**
   * Dismiss one of their own reminders, exactly as the reminder's Dismiss
   * does (the same service, as the person). False: not theirs, or not open.
   * Absent: no dismiss_reminder tool.
   */
  readonly dismissReminder?: (
    actor: ActorContext,
    reminderId: string,
  ) => Promise<boolean>;
  /** A call they organised, or null. */
  readonly organisedMeeting: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<{
    readonly id: string;
    readonly relationshipId: string;
    readonly purpose: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly status: string;
  } | null>;
  readonly brief: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<string | null>;
  /**
   * The person's zone when their device sent none: their Google
   * Calendar's own setting, or null. Never UTC by default.
   */
  readonly timeZoneOf?: (actor: ActorContext) => Promise<string | null>;
  /** The zone saved on their own profile, when they have given one. */
  readonly profileTimeZoneOf?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** Whether a call could be booked now: party, connection, Calendar. */
  readonly canSchedule?: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<"OK" | Refusal>;
  /**
   * meetfix-57: with the organiser's calendar missing, whether the other
   * side could host the call from their own connected calendar.
   */
  readonly counterpartCanHost?:
    | ((actor: ActorContext, relationshipId: string) => Promise<boolean>)
    | undefined;
  /**
   * Live 15 Nov 2026 (D-Q3): the actor's side on the relationship for a
   * meeting time proposal (only the company side proposes) and whether
   * they may speak for it. Null: not a party. Absent: not composed, so no
   * proposal is prepared and the errand is the vehicle.
   */
  readonly proposalSide?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<{
        readonly side: "FOUNDER" | "INVESTOR";
        readonly binds: boolean;
      } | null>)
    | undefined;
};

/** The approval type of a meeting time proposal (`app.<name>`). */
export const MEETING_PROPOSAL_ACTION = "app.schedule.proposal.propose";

/** Capital Q's words for a call blocked on the organiser's calendar. */
async function blockedSays(
  schedule: ScheduleIntelligencePort,
  actor: ActorContext,
  reason: CalendarBlockReason,
  grant: { readonly relationshipId: string; readonly counterpartName: string },
): Promise<string> {
  const counterpartCanHost =
    (await schedule
      .counterpartCanHost?.(actor, grant.relationshipId)
      .catch(() => false)) ?? false;
  return calendarBlockedLine({
    reason,
    counterpartName: grant.counterpartName,
    counterpartCanHost,
  });
}

// An IANA zone, or the place they named for it ("Lagos", "Port
// Harcourt"): resolved to a zone by code before it is used.
const TimeZone = z
  .string()
  .trim()
  .regex(/^[\p{L}][\p{L}0-9 _+'.,/-]*$/u)
  .max(64);
const Duration = z.number().int().min(15).max(180);

const ONE_TIME = { message: "give exactly one of when or startsAt" };
function oneTime(input: {
  readonly when?: unknown;
  readonly startsAt?: unknown;
}): boolean {
  return (input.when === undefined) !== (input.startsAt === undefined);
}

function ownConversation(actor: ActorContext, plan: PermittedContextPlan) {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

function localLabel(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

// --- find_meeting_times ----------------------------------------------------

export const FindMeetingTimesInputSchema = z
  .object({
    ...RelationshipRef,
    durationMinutes: Duration.default(30).describe("Length, 15-180 minutes."),
    from: UtcTimestampSchema.optional().describe(
      "Start of the window to search, ISO 8601 UTC (e.g. next Monday 00:00 in their zone). Default: now.",
    ),
    to: UtcTimestampSchema.optional().describe(
      "End of the window, ISO 8601 UTC. Default: seven days after `from`.",
    ),
    timeZone: TimeZone.optional().describe(
      "Their IANA time zone, if they said one; otherwise their calendar's.",
    ),
  })
  .strict()
  .refine(exactlyOne, ONE_REF);
export type FindMeetingTimesInput = z.input<typeof FindMeetingTimesInputSchema>;

export const FindMeetingTimesOutputSchema = z
  .object({
    status: z.enum([
      "OK",
      "NOT_CONNECTED",
      "CALENDAR_NOT_CONNECTED",
      "CALENDAR_REVOKED",
      "UNAVAILABLE",
    ]),
    counterpartName: z.string(),
    timeZone: z.string().nullable(),
    slots: z
      .array(
        z
          .object({
            startsAt: z.string(),
            endsAt: z.string(),
            local: z.string(),
          })
          .strict(),
      )
      .max(3),
    guidance: z.string(),
    /** CALENDAR_*: Capital Q's own words, said as they are. */
    says: z.string().max(600).optional(),
    /**
     * Q room R5: false when `slots` are suggestions from working hours,
     * not checked against a calendar (theirs is not connected).
     */
    checked: z.boolean().optional(),
    /** Q room R5: the connect card, shown in the room with the answer. */
    clientAction: QShowCalendarConnectIntentSchema.optional(),
  })
  .strict();
export type FindMeetingTimesOutput = z.infer<
  typeof FindMeetingTimesOutputSchema
>;

type RelationshipGrant = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  readonly connected: boolean;
};

/**
 * F-92 (QA 2026-10-24): they asked for a call with someone they have no
 * relationship with. Live, savanna-seed (no relationships at all) asked to
 * schedule a call with a founder; the grant was refused as unavailable and
 * Q said the relationship "isn't available in this conversation's
 * context". The truth, which is about their own relationships only, is
 * that they are not connected yet, and the way there is Express Interest.
 */
type NotConnected = {
  readonly relationshipId: null;
  readonly connected: false;
  /** A company they named by its record, or a name none of theirs has. */
  readonly by: "RECORD" | "NAME";
};

const NOT_CONNECTED_SAYS: Readonly<Record<NotConnected["by"], string>> = {
  RECORD:
    "Not connected with them yet, so no call can be booked and nothing was prepared: calls open once interest is expressed and accepted. Say so plainly, and offer to prepare Express Interest with a note asking for a call (propose_express_interest), for their approval.",
  NAME: "None of their relationships goes by that name, so nothing was prepared. If it is a company they are not connected with yet, calls open once interest is expressed and accepted: offer to prepare Express Interest with a note asking for a call (propose_express_interest), for their approval. Otherwise ask whom they mean.",
};

/**
 * Only for a counterparty this run may see (the plan admits the company or
 * investor, as resolveRelationship requires), or a name matched against
 * their own relationships; a relationship id never comes here.
 */
async function notConnected(
  input: {
    readonly relationshipId?: string | undefined;
    readonly companyId?: string | undefined;
    readonly investorOrganisationId?: string | undefined;
    readonly counterpartName?: string | undefined;
  },
  actor: ActorContext,
  plan: PermittedContextPlan,
  relationships: RelationshipIntelligencePort,
): Promise<NotConnected | null> {
  const none = (by: NotConnected["by"]): NotConnected => ({
    relationshipId: null,
    connected: false,
    by,
  });
  if (input.counterpartName !== undefined) {
    if (relationships.ownRelationships === undefined) return null;
    const own = await relationships.ownRelationships(actor);
    if (own === null) return null;
    const found = closestByName(
      own.items,
      input.counterpartName,
      (item) => item.counterpart.name,
    );
    return found.length === 0 ? none("NAME") : null;
  }
  if (input.companyId !== undefined) {
    if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) return null;
    return (await relationships.withCompany(actor, input.companyId)) === null
      ? none("RECORD")
      : null;
  }
  if (input.investorOrganisationId !== undefined) {
    const id = input.investorOrganisationId;
    if (!admitted(plan, { kind: "INVESTOR_ORGANISATION", id })) return null;
    return (await relationships.withInvestor(actor, id)) === null
      ? none("RECORD")
      : null;
  }
  return null;
}

/** The time zone is what is missing: asked for, not refused. */
class NoTimeZoneError extends QToolArgumentError {}

/** "Monday at 10:00", as they said it, for a question back. */
function whenWords(when: LocalWhen | undefined): string {
  if (when === undefined) return "that time";
  const day =
    when.date ??
    (when.day === undefined
      ? undefined
      : `${when.day.charAt(0).toUpperCase()}${when.day.slice(1)}`);
  if (when.time === undefined) return day ?? "that time";
  return day === undefined ? when.time : `${day} at ${when.time}`;
}

async function relationshipGrant(
  input: {
    readonly relationshipId?: string | undefined;
    readonly companyId?: string | undefined;
    readonly investorOrganisationId?: string | undefined;
  },
  actor: ActorContext,
  plan: PermittedContextPlan,
  chat: ChatIntelligencePort,
  relationships: RelationshipIntelligencePort,
): Promise<RelationshipGrant | null> {
  const relationshipId = await resolveRelationship(
    input,
    actor,
    plan,
    relationships,
  );
  if (relationshipId === null) return null;
  const thread = await chat.thread(actor, relationshipId);
  if (thread === null) return null;
  return {
    relationshipId,
    counterpartName: thread.counterpartName,
    connected: thread.connected,
  };
}

const GUIDANCE: Readonly<Record<string, string>> = {
  OK: "Offer these times in their zone and ask which one; then prepare it with propose_meeting.",
  NOT_CONNECTED:
    "Calls open once they are connected with them: interest expressed and accepted.",
  CALENDAR_NOT_CONNECTED:
    "Their Google Calendar is not connected. Capital Q says why and how to fix it (`says`). It is not a dead end: ask which time suits them (or take the one they named) and prepare it with propose_meeting, which prepares that time as a proposal the other side accepts (or Q's errand when they are the investor). Promise no invite.",
  CALENDAR_REVOKED:
    "Their Google Calendar connection expired. Capital Q says why and how to fix it (`says`). It is not a dead end: ask which time suits them (or take the one they named) and prepare it with propose_meeting, which prepares that time as a proposal the other side accepts (or Q's errand when they are the investor). Promise no invite.",
  UNAVAILABLE: "Their calendar could not be read just now; try again shortly.",
};

function createFindMeetingTimesTool(
  schedule: ScheduleIntelligencePort,
  chat: ChatIntelligencePort,
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    z.output<typeof FindMeetingTimesInputSchema>,
    FindMeetingTimesOutput,
    RelationshipGrant | NotConnected
  >({
    id: FIND_MEETING_TIMES,
    version: 1,
    status: "ACTIVE",
    providerName: "find_meeting_times",
    description:
      "Finds three free times for a call with the other side of one relationship, from the person's own Google Calendar only (the other side's calendar is never read), inside working hours in the person's time zone. Use it first when they ask to set up a call or meeting.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_RELATIONSHIP",
    input: FindMeetingTimesInputSchema,
    output: FindMeetingTimesOutputSchema,
    authorize: async (input, { actor, plan }) => {
      try {
        const grant =
          (await relationshipGrant(input, actor, plan, chat, relationships)) ??
          (await notConnected(input, actor, plan, relationships));
        return grant === null
          ? deny("NOT_AVAILABLE")
          : allow("CONFIDENTIAL", grant);
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: async (input, context, grant) => {
      if (grant.relationshipId === null) {
        return {
          status: "NOT_CONNECTED" as const,
          counterpartName: input.counterpartName ?? "",
          timeZone: null,
          slots: [],
          guidance: NOT_CONNECTED_SAYS[grant.by],
        };
      }
      const found = await schedule.findSlots(context.actor, {
        relationshipId: grant.relationshipId,
        durationMinutes: input.durationMinutes,
        from: input.from === undefined ? undefined : new Date(input.from),
        to: input.to === undefined ? undefined : new Date(input.to),
        timeZone: input.timeZone,
      });
      if (found.status !== "OK") {
        const status =
          found.status === "NOT_CONNECTED" || isCalendarBlock(found.status)
            ? found.status
            : "UNAVAILABLE";
        if (isCalendarBlock(status)) {
          // Q room R5: say so, still suggest times, offer the connect card.
          const suggested = "suggested" in found ? found.suggested : undefined;
          const slots = (suggested?.slots ?? []).slice(0, 3).map((slot) => ({
            startsAt: slot.start.toISOString(),
            endsAt: slot.end.toISOString(),
            local: localLabel(slot.start, suggested?.timeZone ?? "UTC"),
          }));
          return {
            status,
            counterpartName: grant.counterpartName,
            timeZone: suggested?.timeZone ?? null,
            slots,
            checked: false,
            guidance:
              slots.length > 0
                ? `${GUIDANCE[status] ?? ""} Offer these three times as suggestions from their working hours, plainly not checked against their calendar; the connect card is on screen with them.`
                : (GUIDANCE[status] ?? ""),
            says: await blockedSays(schedule, context.actor, status, grant),
            clientAction: {
              kind: "SHOW_CALENDAR_CONNECT",
              reason:
                status === "CALENDAR_REVOKED" ? "REVOKED" : "NOT_CONNECTED",
              counterpartName: grant.counterpartName.slice(0, 120),
              timeZone: suggested?.timeZone ?? null,
              suggested: slots,
            },
          };
        }
        return {
          status,
          counterpartName: grant.counterpartName,
          timeZone: null,
          slots: [],
          guidance: GUIDANCE[status] ?? "",
        };
      }
      return {
        status: "OK",
        counterpartName: grant.counterpartName,
        timeZone: found.timeZone,
        slots: found.slots.map((slot) => ({
          startsAt: slot.start.toISOString(),
          endsAt: slot.end.toISOString(),
          local: localLabel(slot.start, found.timeZone),
        })),
        guidance:
          found.slots.length === 0
            ? "No free time in that window; offer a wider one."
            : (GUIDANCE.OK ?? ""),
      };
    },
  });
}

// --- propose_meeting --------------------------------------------------------

export const ProposeMeetingInputSchema = z
  .object({
    ...RelationshipRef,
    purpose: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("What the call is for; it becomes the invite's title."),
    when: LocalWhenSchema.optional().describe(
      'The time as they said it ("2 PM tomorrow" is day tomorrow, time 14:00). Capital Q resolves it in their time zone. Use this, not startsAt, whenever they named a time.',
    ),
    startsAt: UtcTimestampSchema.optional().describe(
      "Only for a slot find_meeting_times returned: its startsAt exactly as given.",
    ),
    durationMinutes: Duration.default(30).describe(
      "Length, 15-180 minutes; 30 unless they said.",
    ),
    timeZone: TimeZone.optional().describe(
      "Only when they named a zone or city for the time (IANA, e.g. America/New_York); otherwise theirs is known.",
    ),
    reason: CardReasonSchema,
  })
  .strict()
  .refine(exactlyOne, ONE_REF)
  .refine(oneTime, ONE_TIME);
export type ProposeMeetingInput = z.output<typeof ProposeMeetingInputSchema>;

// --- propose_meeting_change ---------------------------------------------------

export const ProposeMeetingChangeInputSchema = z
  .object({
    meetingId: UuidSchema.optional().describe(
      "A call they organised, by id from list_schedule. Or counterpartName instead.",
    ),
    counterpartName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Instead of meetingId: who the call is with, as they said it. Capital Q finds their one upcoming call with them.",
      ),
    change: z.enum(["RESCHEDULE", "CANCEL"]),
    when: LocalWhenSchema.optional().describe(
      "RESCHEDULE only: the new time as they said it; resolved in their time zone.",
    ),
    startsAt: UtcTimestampSchema.optional().describe(
      "RESCHEDULE only, instead of when: a slot find_meeting_times returned, exactly as given.",
    ),
    durationMinutes: Duration.optional(),
    timeZone: TimeZone.optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.change === "RESCHEDULE") ===
      (input.startsAt !== undefined || input.when !== undefined),
    {
      message:
        "a new time (when or startsAt) is required to reschedule and not allowed to cancel",
    },
  )
  .refine((input) => input.startsAt === undefined || input.when === undefined, {
    message: "give when or startsAt, not both",
  })
  .refine(
    (input) =>
      (input.meetingId === undefined) !== (input.counterpartName === undefined),
    { message: "name the call by meetingId or counterpartName, not both" },
  );
export type ProposeMeetingChangeInput = z.infer<
  typeof ProposeMeetingChangeInputSchema
>;

type MeetingGrant = NonNullable<
  Awaited<ReturnType<ScheduleIntelligencePort["organisedMeeting"]>>
> & { readonly counterpartName: string };

// --- propose_reminder ---------------------------------------------------------

export const ProposeReminderInputSchema = z
  .object({
    ...RelationshipRef,
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("What to be reminded of, in their words."),
    when: LocalWhenSchema.optional().describe(
      'When, as they said it ("Friday at 9" is day friday, time 09:00); resolved in their time zone.',
    ),
    remindAt: UtcTimestampSchema.optional().describe(
      "Only instead of when, for an exact instant Capital Q gave you (ISO 8601 with offset).",
    ),
    timeZone: TimeZone.optional().describe(
      "Only when they named a zone or city for the time; otherwise theirs is known.",
    ),
    note: z.string().trim().max(1000).optional(),
    byEmail: z
      .boolean()
      .default(true)
      .describe(
        "Also email it to them when due (it always shows in Needs you).",
      ),
  })
  .strict()
  .refine(
    (input) =>
      [
        input.relationshipId,
        input.companyId,
        input.investorOrganisationId,
        input.counterpartName,
      ].filter((id) => id !== undefined).length <= 1,
    {
      message:
        "name at most one of relationshipId, companyId or investorOrganisationId",
    },
  )
  .refine(
    (input) => (input.when === undefined) !== (input.remindAt === undefined),
    { message: "give exactly one of when or remindAt" },
  );
export type ProposeReminderInput = z.output<typeof ProposeReminderInputSchema>;

type ReminderGrant = {
  readonly relationship: RelationshipGrant | null;
};

// --- list_schedule / get_meeting_brief ------------------------------------------

export const ListScheduleInputSchema = z.object({}).strict();
export const ListScheduleOutputSchema = z
  .object({
    meetings: z.array(
      z
        .object({
          id: z.string(),
          relationshipId: z.string(),
          purpose: z.string(),
          startsAt: z.string(),
          local: z.string(),
          organisedByYou: z.boolean(),
          with: z.array(z.string()),
          brief: z.string().nullable(),
        })
        .strict(),
    ),
    reminders: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          dueAt: z.string(),
          relationshipId: z.string().nullable(),
        })
        .strict(),
    ),
    /**
     * R1: the calls on each of their relationships, from the Relationship
     * Brief -- including calls a colleague booked and calls recorded as
     * not having taken place. UNAVAILABLE: unknown, never "no calls".
     */
    byRelationship: z
      .discriminatedUnion("status", [
        z
          .object({
            status: z.literal("OK"),
            items: z
              .array(
                z
                  .object({
                    relationshipId: z.string(),
                    counterpartName: z.string().nullable(),
                    calls: z.discriminatedUnion("status", [
                      z
                        .object({
                          status: z.literal("OK"),
                          nextScheduledAt: z.string().nullable(),
                          lastPastAt: z.string().nullable(),
                          lastPastDidNotTakePlace: z.boolean(),
                          cancelled: z.number().int().min(0),
                        })
                        .strict(),
                      z.object({ status: z.literal("UNAVAILABLE") }).strict(),
                    ]),
                  })
                  .strict(),
              )
              .max(50),
          })
          .strict(),
        z.object({ status: z.literal("UNAVAILABLE") }).strict(),
      ])
      .optional(),
  })
  .strict();
export type ListScheduleOutput = z.infer<typeof ListScheduleOutputSchema>;

/** One relationship's calls, by code, from its brief (R1). */
type RelationshipCalls = Extract<
  NonNullable<ListScheduleOutput["byRelationship"]>,
  { status: "OK" }
>["items"][number];

function callsOf(brief: RelationshipBrief): RelationshipCalls {
  const meetings = brief.meetings;
  if (meetings.status !== "OK") {
    return {
      relationshipId: brief.relationshipId,
      counterpartName: brief.counterparty.name,
      calls: { status: "UNAVAILABLE" },
    };
  }
  const past = meetings.items
    .filter((m) => m.status === "SCHEDULED" && m.timing === "PAST")
    .at(-1);
  return {
    relationshipId: brief.relationshipId,
    counterpartName: brief.counterparty.name,
    calls: {
      status: "OK",
      nextScheduledAt: meetings.nextScheduled?.startsAt ?? null,
      lastPastAt: past?.startsAt ?? null,
      lastPastDidNotTakePlace: past?.noShow === true,
      cancelled: meetings.items.filter((m) => m.status === "CANCELLED").length,
    },
  };
}

type OwnGrant = { readonly actor: ActorContext };

// --- the catalogue ----------------------------------------------------------------

export function createScheduleTools(
  schedule: ScheduleIntelligencePort,
  chat: ChatIntelligencePort,
  relationships: RelationshipIntelligencePort,
  options: {
    readonly now?: (() => Date) | undefined;
    /** The app action board: a meeting time proposal is prepared on it. */
    readonly appApprovals?: AppApprovalPort | undefined;
  } = {},
): readonly AnyQToolDefinition[] {
  const now = options.now ?? (() => new Date());

  /**
   * The one instant the person named, and the zone it was named in.
   * Precedence for the zone: one they named, their device's (sent with
   * the turn), their calendar's. Never UTC by accident: with none known
   * the model is told to ask.
   */
  const instantOf = async (
    input: {
      readonly when?: LocalWhen | undefined;
      readonly startsAt?: string | undefined;
      readonly timeZone?: string | undefined;
    },
    context: {
      readonly actor: ActorContext;
      readonly plan: PermittedContextPlan;
    },
    /**
     * QA F-21: a call asked for in a part of the day is booked at the first
     * free time inside it (their own calendar, or their working hours when
     * none is connected). Without it (a reminder) the window's start.
     */
    slotIn?: {
      readonly relationshipId: string;
      readonly durationMinutes: number;
    },
  ): Promise<{
    readonly iso: string;
    readonly timeZone: string | undefined;
    /** The part of the day they asked for, said back plainly. */
    readonly asked?: string | undefined;
    /**
     * The zone they named themselves when their profile has none: offered
     * on the card to be kept as theirs, so Q never asks again (owner
     * 2026-10-16). Undefined otherwise.
     */
    readonly toRemember?: string | undefined;
  }> => {
    // Precedence: the zone they named, the one saved on their profile,
    // their device's (unless it only says UTC, which privacy browsers and
    // VMs report whatever the place), their calendar's. None: Q asks once.
    // A zone, or the place they named for it ("Lagos" -> Africa/Lagos):
    // the city they gave when asked is never taken as a missing zone
    // (QA runs a87ca38f, 2e053864: "Lagos" was asked about again).
    const named =
      input.timeZone === undefined
        ? undefined
        : isKnownTimeZone(input.timeZone) && input.timeZone.includes("/")
          ? input.timeZone
          : (zoneFromWords(input.timeZone) ??
            (isKnownTimeZone(input.timeZone) ? input.timeZone : undefined));
    let zone = named;
    let saved: string | null | undefined;
    if (schedule.profileTimeZoneOf !== undefined) {
      saved = await schedule
        .profileTimeZoneOf(context.actor)
        .catch(() => undefined);
      if (zone === undefined && saved != null && isKnownTimeZone(saved)) {
        zone = saved;
      }
    }
    // Known to have none saved (read, and empty): theirs to keep.
    const toRemember =
      named !== undefined && saved === null && named.includes("/")
        ? named
        : undefined;
    const device = context.plan.screen?.timeZone;
    if (
      zone === undefined &&
      device !== undefined &&
      isKnownTimeZone(device) &&
      !isUncertainDeviceZone(device)
    ) {
      zone = device;
    }
    if (zone === undefined && schedule.timeZoneOf !== undefined) {
      zone =
        (await schedule.timeZoneOf(context.actor).catch(() => null)) ??
        undefined;
    }
    if (input.when === undefined) {
      if (input.startsAt === undefined) {
        throw new QToolArgumentError(
          "Give the time: when (their day and HH:MM) or startsAt (a slot find_meeting_times returned).",
        );
      }
      return {
        iso: new Date(input.startsAt).toISOString(),
        timeZone: zone,
        ...(toRemember === undefined ? {} : { toRemember }),
      };
    }
    if (input.when.part !== undefined && input.when.time === undefined) {
      const window = resolveLocalWindow(input.when, zone, now());
      if (window.kind === "NO_TIME_ZONE") {
        throw new NoTimeZoneError(unresolvedMessage(window.kind));
      }
      if (window.kind !== "OK") {
        throw new QToolArgumentError(unresolvedMessage(window.kind));
      }
      const part = input.when.part.toLowerCase();
      let start = window.from;
      let minutes = slotIn?.durationMinutes ?? 30;
      if (slotIn !== undefined) {
        const found = await schedule
          .findSlots(context.actor, {
            relationshipId: slotIn.relationshipId,
            durationMinutes: slotIn.durationMinutes,
            from: window.from,
            to: window.to,
            timeZone: window.timeZone,
          })
          .catch(() => null);
        const slots =
          found === null
            ? []
            : found.status === "OK"
              ? found.slots
              : (("suggested" in found ? found.suggested?.slots : undefined) ??
                []);
        const first = slots.find(
          (slot) =>
            slot.start.getTime() >= window.from.getTime() &&
            slot.start.getTime() + slotIn.durationMinutes * 60_000 <=
              window.to.getTime(),
        );
        if (first === undefined && found?.status === "OK") {
          throw new QToolArgumentError(
            `Their calendar has no free ${String(slotIn.durationMinutes)} minutes in that ${part}. Say so plainly and offer another time (find_meeting_times).`,
          );
        }
        if (first !== undefined) start = first.start;
        minutes = slotIn.durationMinutes;
      }
      const end = new Date(start.getTime() + minutes * 60_000);
      return {
        iso: start.toISOString(),
        timeZone: window.timeZone,
        asked: `${localSpanLabel(start, end, window.timeZone)}, in the ${part} you asked for`,
        ...(toRemember === undefined || toRemember !== window.timeZone
          ? {}
          : { toRemember }),
      };
    }
    const resolved = resolveLocalWhen(input.when, zone, now());
    if (resolved.kind === "NO_TIME_ZONE") {
      throw new NoTimeZoneError(unresolvedMessage(resolved.kind));
    }
    if (resolved.kind !== "OK") {
      throw new QToolArgumentError(unresolvedMessage(resolved.kind));
    }
    return {
      iso: resolved.instant.toISOString(),
      timeZone: resolved.timeZone,
      ...(toRemember === undefined || toRemember !== resolved.timeZone
        ? {}
        : { toRemember }),
    };
  };
  const labelled = (summary: string, iso: string, zone: string | undefined) =>
    zone === undefined
      ? summary
      : `${summary}, ${zonedLabel(new Date(iso), zone)}`;

  const proposal = {
    version: 1,
    status: "ACTIVE",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    output: ChatProposalOutputSchema,
  } as const;

  const prepare = (
    context: { readonly runId: string; readonly actor: ActorContext },
    entry: Parameters<
      ChatIntelligencePort["prepareForApproval"]
    >[0]["proposal"],
    summary: string,
    reason?: string,
  ): ChatProposalOutput => ({
    status: chat.prepareForApproval({
      runId: context.runId,
      tenantId: context.actor.tenantId,
      actorUserId: context.actor.userId,
      proposal: entry,
      reason,
    }),
    awaitingApprovalOf: summary,
  });

  /**
   * D-Q3 (live 15 Nov 2026): with no calendar invite possible, the vehicle
   * is code's choice, never a chat message promising an invite. The
   * company side, by someone who may speak for it, proposes the time as a
   * meeting time proposal (`schedule.proposal.propose`): nothing is booked
   * until the other side accepts it. Anyone else hands it to Q's errand,
   * which offers times in the chat and books only on an answer read by
   * meaning. A move of a booked call goes only as a proposal. Every time
   * is at least ERRAND_CALL_LEAD_MINUTES ahead and labelled in the zone it
   * was named in (UTC said as UTC when none is known).
   */
  const noCalendarVehicle = async (
    context: { readonly runId: string; readonly actor: ActorContext },
    reason: CalendarBlockReason,
    grant: {
      readonly relationshipId: string;
      readonly counterpartName: string;
    },
    call: {
      readonly purpose: string;
      readonly durationMinutes: number;
      readonly iso: string;
      readonly timeZone: string | undefined;
      readonly rescheduleOfMeetingId?: string | undefined;
      readonly reason?: string | undefined;
    },
  ): Promise<ChatProposalOutput> => {
    const zone = call.timeZone ?? "UTC";
    const start = new Date(call.iso);
    const when = zonedLabel(start, zone);
    const name = grant.counterpartName;
    const moving = call.rescheduleOfMeetingId !== undefined;
    if (start.getTime() < now().getTime() + ERRAND_CALL_LEAD_MINUTES * 60_000) {
      return {
        status: "TOO_SOON",
        awaitingApprovalOf: "",
        says: `${when} is less than 18 hours away. Call times go to ${name} at least 18 hours ahead, so they have time to answer. Which later time should I propose?`.slice(
          0,
          600,
        ),
        guidance:
          "Nothing was prepared. Ask for a time at least 18 hours from now (or offer one), then call again with it.",
      };
    }
    const fix = await blockedSays(schedule, context.actor, reason, grant);
    const party = await schedule
      .proposalSide?.(context.actor, grant.relationshipId)
      .catch(() => null);
    if (
      party?.side === "FOUNDER" &&
      party.binds &&
      options.appApprovals !== undefined
    ) {
      const input = {
        purpose: call.purpose,
        options: [
          {
            startsAt: start.toISOString(),
            endsAt: new Date(
              start.getTime() + call.durationMinutes * 60_000,
            ).toISOString(),
            timeZone: zone,
          },
        ],
        ...(moving
          ? { rescheduleOfMeetingId: call.rescheduleOfMeetingId }
          : {}),
      };
      const status = options.appApprovals.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: MEETING_PROPOSAL_ACTION,
        payload: {
          relationshipId: grant.relationshipId,
          idempotencyKey: appActionKey(
            context.runId,
            "schedule.proposal.propose",
            { relationshipId: grant.relationshipId, input },
          ),
          input,
        },
        reason: call.reason,
      });
      return {
        // The calendar's status, said in Capital Q's words by the answer
        // seam; the card, when one was made, is the proposal.
        status: status === "PREPARED" ? reason : status,
        awaitingApprovalOf: moving
          ? `Propose moving the call with ${name} to ${when}`
          : `Propose a call to ${name}: ${when}`,
        says:
          status === "PREPARED"
            ? `${fix} Meanwhile I've prepared ${when} as a proposed time for ${name}${moving ? " to move the call" : ""}: ${moving ? "the call stays as booked" : "nothing is booked"} until they accept it, and no calendar invite is sent.`.slice(
                0,
                600,
              )
            : fix,
      };
    }
    if (moving) {
      return {
        status: reason,
        awaitingApprovalOf: "",
        says: `${fix} Only the company side proposes a new time for a booked call, so ask ${name} in the chat to propose one.`.slice(
          0,
          600,
        ),
      };
    }
    const running =
      chat.activeErrand === undefined
        ? null
        : await chat
            .activeErrand(context.actor, {
              relationshipId: grant.relationshipId,
              companyId: null,
            })
            .catch(() => null);
    if (running !== null) {
      return {
        status: "ALREADY_ACTIVE",
        awaitingApprovalOf: `Q is already looking after ${running.counterpartName} for you, including the call.`,
      };
    }
    const status = chat.prepareForApproval({
      runId: context.runId,
      tenantId: context.actor.tenantId,
      actorUserId: context.actor.userId,
      proposal: {
        actionType: ERRAND_START,
        payload: {
          relationshipId: grant.relationshipId,
          counterpartName: name,
          expressInterest: false,
          openingMessage: null,
          brief: null,
          bookCall: {
            purpose: call.purpose,
            durationMinutes: call.durationMinutes,
            notBefore: start.toISOString(),
          },
        },
      },
      reason: call.reason,
    });
    return {
      status: status === "PREPARED" ? reason : status,
      awaitingApprovalOf: `Book a call with ${name}, then Q looks after the rest`,
      says:
        status === "PREPARED"
          ? `${fix} Meanwhile I've prepared it as an errand: Q offers ${name} times in the chat from ${when} and books one only when they accept it. No calendar invite is sent.`.slice(
              0,
              600,
            )
          : fix,
    };
  };

  return [
    createFindMeetingTimesTool(schedule, chat, relationships),

    defineQTool<
      ProposeMeetingInput,
      ChatProposalOutput,
      RelationshipGrant | NotConnected
    >({
      ...proposal,
      id: PROPOSE_MEETING,
      providerName: "propose_meeting",
      description:
        "Prepares a call with the other side of one connected relationship at one exact time, for the person to approve. On approval it becomes a Google Calendar invite with a Meet link, sent from their calendar to the other side's people. Without their Google Calendar connected, Capital Q prepares that time as a meeting time proposal the other side must accept (the company side), or as Q's errand that agrees a time in the chat (the investor side); nothing is booked and no invite is promised until they accept. Use this, never a chat message, whenever they ask to set up, book or propose a call. Use find_meeting_times first unless they named a time.",
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: [...SCOPES],
      input: ProposeMeetingInputSchema,
      authorize: async (input, { actor, plan }) => {
        try {
          const grant =
            (await relationshipGrant(
              input,
              actor,
              plan,
              chat,
              relationships,
            )) ?? (await notConnected(input, actor, plan, relationships));
          return grant === null
            ? deny("NOT_AVAILABLE")
            : allow("CONFIDENTIAL", grant);
        } catch {
          return deny("NOT_AVAILABLE");
        }
      },
      execute: async (input, context, grant) => {
        if (grant.relationshipId === null) {
          return {
            status: "NOT_CONNECTED" as const,
            awaitingApprovalOf: NOT_CONNECTED_SAYS[grant.by],
          };
        }
        if (!grant.connected) {
          return {
            status: "NOT_CONNECTED" as const,
            awaitingApprovalOf:
              "Calls open once you're connected with them: interest expressed and accepted.",
          };
        }
        // Said now, not after they approve something that cannot run.
        const bookable =
          schedule.canSchedule === undefined
            ? "OK"
            : await schedule
                .canSchedule(context.actor, grant.relationshipId)
                .catch(() => "OK" as const);
        let at: Awaited<ReturnType<typeof instantOf>>;
        try {
          at = await instantOf(input, context, {
            relationshipId: grant.relationshipId,
            durationMinutes: input.durationMinutes,
          });
        } catch (error: unknown) {
          // One short question, never a profile card in its place.
          if (!(error instanceof NoTimeZoneError)) throw error;
          return {
            status: "NEEDS_TIME_ZONE" as const,
            awaitingApprovalOf: "",
            says: `Which city are you in, so ${whenWords(input.when)} is right? Then I'll prepare the call.`,
            guidance: error.safeMessage,
          };
        }
        if (isCalendarBlock(bookable)) {
          // Autopilot P1: a missing calendar is never a dead end. D-Q3
          // (live 15 Nov 2026): nor is it a chat message promising "I'll
          // send an invite". Code chooses the vehicle that books only on
          // the other side's explicit yes.
          return noCalendarVehicle(context, bookable, grant, {
            purpose: input.purpose,
            durationMinutes: input.durationMinutes,
            iso: at.iso,
            timeZone: at.timeZone,
            reason: reasonOf(input),
          });
        }
        return prepare(
          context,
          {
            actionType: MEETING_SCHEDULE,
            payload: {
              relationshipId: grant.relationshipId,
              counterpartName: grant.counterpartName,
              purpose: input.purpose,
              startsAt: at.iso,
              durationMinutes: input.durationMinutes,
              ...(at.timeZone === undefined ? {} : { timeZone: at.timeZone }),
            },
          },
          at.asked === undefined
            ? labelled(
                `Call with ${grant.counterpartName}`,
                at.iso,
                at.timeZone,
              )
            : `Call with ${grant.counterpartName}, ${at.asked}`,
          reasonOf(input),
        );
      },
    }),

    defineQTool<ProposeMeetingChangeInput, ChatProposalOutput, MeetingGrant>({
      ...proposal,
      id: PROPOSE_MEETING_CHANGE,
      providerName: "propose_meeting_change",
      description:
        "Prepares moving (RESCHEDULE, with the new start) or cancelling (CANCEL) a call the person organised, for them to approve; name the call by meetingId or by whom it is with (counterpartName). With their Google Calendar connected, on approval the event is updated or deleted and everyone invited is told. Without it, a move is proposed to the other side and the call stays as booked until they accept. Use this, never a chat message or a profile change, when they ask to move a call.",
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      input: ProposeMeetingChangeInputSchema,
      authorize: async (input, { actor, plan }) => {
        if (!ownConversation(actor, plan)) return deny("NOT_AVAILABLE");
        // Live 15 Nov 2026 (D-Q3): "move the call with Savanna to Thursday
        // afternoon" names the call by whom it is with. Their one upcoming
        // call with them that they organised; several are asked about.
        let meetingId = input.meetingId;
        if (meetingId === undefined) {
          const relationshipId = await resolveRelationship(
            { counterpartName: input.counterpartName },
            actor,
            plan,
            relationships,
          ).catch(() => null);
          if (relationshipId === null) return deny("NOT_AVAILABLE");
          const upcoming = await schedule.upcoming(actor).catch(() => null);
          const theirs = (upcoming?.meetings ?? []).filter(
            (meeting) =>
              meeting.relationshipId === relationshipId &&
              meeting.organisedByYou &&
              Date.parse(meeting.startsAt) > now().getTime(),
          );
          const [only] = theirs;
          if (only === undefined) {
            return deny(
              "NOT_AVAILABLE",
              `No upcoming call you organised with ${input.counterpartName ?? "them"} is on record.`,
            );
          }
          if (theirs.length > 1) {
            return deny(
              "NOT_AVAILABLE",
              `More than one upcoming call with ${input.counterpartName ?? "them"}: ${theirs
                .slice(0, 5)
                .map((meeting) => `${meeting.purpose} [${meeting.id}]`)
                .join(", ")}. Ask which one.`,
            );
          }
          meetingId = only.id;
        }
        const meeting = await schedule
          .organisedMeeting(actor, meetingId)
          .catch(() => null);
        if (meeting === null || meeting.status !== "SCHEDULED") {
          return deny("NOT_AVAILABLE");
        }
        const thread = await chat
          .thread(actor, meeting.relationshipId)
          .catch(() => null);
        return allow("CONFIDENTIAL", {
          ...meeting,
          counterpartName: thread?.counterpartName ?? "the other side",
        });
      },
      execute: async (input, context, meeting) => {
        if (input.change === "CANCEL") {
          return prepare(
            context,
            {
              actionType: MEETING_CANCEL,
              payload: {
                meetingId: meeting.id,
                relationshipId: meeting.relationshipId,
                purpose: meeting.purpose,
                startsAt: meeting.startsAt,
              },
            },
            `Cancel: ${meeting.purpose}`,
          );
        }
        const durationMinutes =
          input.durationMinutes ??
          Math.round(
            (Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) /
              60_000,
          );
        let at: Awaited<ReturnType<typeof instantOf>>;
        try {
          at = await instantOf(input, context, {
            relationshipId: meeting.relationshipId,
            durationMinutes,
          });
        } catch (error: unknown) {
          // Live 15 Nov 2026: an unknown zone is one question, never a
          // profile card in place of the move they asked for.
          if (!(error instanceof NoTimeZoneError)) throw error;
          return {
            status: "NEEDS_TIME_ZONE" as const,
            awaitingApprovalOf: "",
            says: `Which city are you in, so ${whenWords(input.when)} is right? Then I'll prepare the move.`,
            guidance: error.safeMessage,
          };
        }
        const bookable =
          schedule.canSchedule === undefined
            ? "OK"
            : await schedule
                .canSchedule(context.actor, meeting.relationshipId)
                .catch(() => "OK" as const);
        if (isCalendarBlock(bookable)) {
          // No calendar event to move: the move is proposed to the other
          // side and the call stays as booked until they accept.
          return noCalendarVehicle(
            context,
            bookable,
            {
              relationshipId: meeting.relationshipId,
              counterpartName: meeting.counterpartName,
            },
            {
              purpose: meeting.purpose,
              durationMinutes,
              iso: at.iso,
              timeZone: at.timeZone,
              rescheduleOfMeetingId: meeting.id,
            },
          );
        }
        return prepare(
          context,
          {
            actionType: MEETING_RESCHEDULE,
            payload: {
              meetingId: meeting.id,
              relationshipId: meeting.relationshipId,
              purpose: meeting.purpose,
              startsAt: at.iso,
              durationMinutes,
            },
          },
          labelled(`Move: ${meeting.purpose}`, at.iso, at.timeZone),
        );
      },
    }),

    defineQTool<ProposeReminderInput, ChatProposalOutput, ReminderGrant>({
      ...proposal,
      id: PROPOSE_REMINDER,
      providerName: "propose_reminder",
      description:
        "Prepares a reminder for the person (optionally about one relationship), for them to approve. When due it shows in Needs you and, unless they say not to, arrives by email.",
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION", ...SCOPES],
      input: ProposeReminderInputSchema,
      authorize: async (input, { actor, plan }) => {
        if (actor.actorType !== "HUMAN") return deny("NOT_AVAILABLE");
        const named =
          input.relationshipId !== undefined ||
          input.companyId !== undefined ||
          input.investorOrganisationId !== undefined ||
          input.counterpartName !== undefined;
        if (!named) {
          return ownConversation(actor, plan)
            ? allow("INTERNAL", { relationship: null })
            : deny("NOT_AVAILABLE");
        }
        // A reminder about someone they are not in a relationship with
        // ("review Tallyloom's deck", QA run f99e507c) is still theirs to
        // set: a personal reminder, the name kept in its title. Only a
        // relationship they share links it.
        const grant = await relationshipGrant(
          input,
          actor,
          plan,
          chat,
          relationships,
        ).catch(() => null);
        if (grant !== null)
          return allow("CONFIDENTIAL", { relationship: grant });
        return ownConversation(actor, plan)
          ? allow("INTERNAL", { relationship: null })
          : deny("NOT_AVAILABLE");
      },
      execute: async (input, context, grant) => {
        let at: Awaited<ReturnType<typeof instantOf>>;
        try {
          at = await instantOf(
            {
              when: input.when,
              startsAt: input.remindAt,
              timeZone: input.timeZone,
            },
            context,
          );
        } catch (error: unknown) {
          // Their time zone is not known: one short question, never "I
          // can't" (QA run f99e507c). Their answer comes back as timeZone.
          if (!(error instanceof NoTimeZoneError)) throw error;
          return {
            status: "NEEDS_TIME_ZONE" as const,
            awaitingApprovalOf: "",
            says: `Which city are you in, so ${whenWords(input.when)} is right? Then I'll set the reminder.`,
            guidance: error.safeMessage,
          };
        }
        return prepare(
          context,
          {
            actionType: REMINDER_CREATE,
            payload: {
              // Whose reminder it is: the target of a personal one, and
              // checked against the approver again at every authorize.
              ownerUserId: context.actor.userId,
              ...(grant.relationship === null
                ? {}
                : {
                    relationshipId: grant.relationship.relationshipId,
                    counterpartName: grant.relationship.counterpartName,
                  }),
              title: input.title,
              remindAt: at.iso,
              ...(at.timeZone === undefined ? {} : { timeZone: at.timeZone }),
              // Kept as their time zone on approval: part of the card.
              ...(at.toRemember === undefined
                ? {}
                : { saveTimeZone: at.toRemember }),
              ...(input.note === undefined ? {} : { note: input.note }),
              channel: input.byEmail ? "EMAIL" : "IN_APP",
            },
          },
          labelled(`Reminder: ${input.title}`, at.iso, at.timeZone),
        );
      },
    }),

    defineQTool<
      z.infer<typeof ListScheduleInputSchema>,
      ListScheduleOutput,
      OwnGrant
    >({
      id: LIST_SCHEDULE,
      version: 1,
      status: "ACTIVE",
      providerName: "list_schedule",
      description:
        "Reads the person's own upcoming calls (with whom, when, whether they organised it, and the prep brief once it is ready, 24 hours before) and their open reminders; the result is also shown to them as their schedule card, so call it whenever they ask what is on their day, their schedule, their calls or their reminders, even when their day is already in your context. Plus byRelationship: the calls on each of their relationships, including ones a colleague booked and past calls that did not take place. A relationship whose calls are UNAVAILABLE is unknown right now: never say no call was booked for it.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      requiredCapabilities: [],
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      visibleStage: null,
      input: ListScheduleInputSchema,
      output: ListScheduleOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<OwnGrant>("CONFIDENTIAL", { actor })
            : deny<OwnGrant>("NOT_AVAILABLE"),
        ),
      execute: async (_input, _context, grant) => {
        const [own, relationshipBriefs] = await Promise.all([
          schedule.upcoming(grant.actor),
          schedule.relationshipBriefs === undefined
            ? Promise.resolve(undefined)
            : schedule
                .relationshipBriefs(grant.actor)
                .catch(() => "FAILED" as const),
        ]);
        const meetings = own.meetings.slice(0, 20);
        const briefs = await Promise.all(
          meetings.map((meeting, index) =>
            meeting.hasBrief && index < 3
              ? schedule.brief(grant.actor, meeting.id)
              : Promise.resolve(null),
          ),
        );
        return {
          meetings: meetings.map((meeting, index) => ({
            id: meeting.id,
            relationshipId: meeting.relationshipId,
            purpose: meeting.purpose,
            startsAt: meeting.startsAt,
            local: localLabel(new Date(meeting.startsAt), meeting.timeZone),
            organisedByYou: meeting.organisedByYou,
            with: [...meeting.attendees],
            brief: briefs[index] ?? null,
          })),
          reminders: own.reminders.slice(0, 30).map((reminder) => ({
            ...reminder,
          })),
          ...(relationshipBriefs === undefined || relationshipBriefs === null
            ? {}
            : {
                byRelationship:
                  relationshipBriefs === "FAILED"
                    ? { status: "UNAVAILABLE" as const }
                    : {
                        status: "OK" as const,
                        items: relationshipBriefs.slice(0, 50).map(callsOf),
                      },
              }),
        };
      },
    }),
    ...(schedule.dismissReminder === undefined
      ? []
      : [createDismissReminderTool(schedule, schedule.dismissReminder)]),
  ];
}

// --- dismiss_reminder --------------------------------------------------------

export const DismissReminderInputSchema = z
  .object({
    reminderId: UuidSchema.describe(
      "One of their open reminders, by id from list_schedule.",
    ),
  })
  .strict();

export const DismissReminderOutputSchema = z
  .object({ done: z.boolean(), note: z.string().max(200) })
  .strict();

/**
 * Action parity (2026-10-02): "dismiss that reminder" does what the
 * reminder's own Dismiss does, at once: the person's word is the decision
 * (Q never decides on its own that something was dealt with). Only an open
 * reminder of theirs, as list_schedule reads it.
 */
function createDismissReminderTool(
  schedule: ScheduleIntelligencePort,
  dismiss: NonNullable<ScheduleIntelligencePort["dismissReminder"]>,
): AnyQToolDefinition {
  return defineQTool<
    z.infer<typeof DismissReminderInputSchema>,
    z.infer<typeof DismissReminderOutputSchema>,
    { readonly reminderId: string; readonly title: string }
  >({
    id: DISMISS_REMINDER,
    version: 1,
    status: "ACTIVE",
    providerName: "dismiss_reminder",
    description:
      "Dismisses one of the person's own open reminders when they say they have dealt with it or no longer want it, exactly as Dismiss on the reminder does. Use the id from list_schedule; never dismiss one they did not ask about.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: DismissReminderInputSchema,
    output: DismissReminderOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!ownConversation(actor, plan)) return deny("NOT_AVAILABLE");
      const own = await schedule.upcoming(actor).catch(() => null);
      const reminder = own?.reminders.find(
        (entry) => entry.id === input.reminderId,
      );
      return reminder === undefined
        ? deny("NOT_AVAILABLE")
        : allow("CONFIDENTIAL", {
            reminderId: reminder.id,
            title: reminder.title,
          });
    },
    execute: async (_input, context, grant) => {
      const dismissed = await dismiss(context.actor, grant.reminderId);
      return {
        done: dismissed,
        note: dismissed
          ? `Dismissed: ${grant.title}.`
          : "That reminder was already dismissed.",
      };
    },
  });
}
