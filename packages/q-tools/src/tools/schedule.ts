import { z } from "zod";

import {
  Q_TASK_CLASSES,
  UtcTimestampSchema,
  UuidSchema,
  type PermittedContextPlan,
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
import {
  ChatProposalOutputSchema,
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
  resolveLocalWhen,
  unresolvedMessage,
  type LocalWhen,
} from "./local-time.js";

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
  | "NO_RECIPIENTS"
  | "NOT_FOUND"
  | "NOT_ORGANISER"
  | "CANCELLED"
  | "INVALID_TIME"
  | "KEY_REUSED"
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
    | { readonly status: Refusal }
  >;
  /** Their own upcoming calls and open reminders. */
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
};

const TimeZone = z
  .string()
  .regex(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/)
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
    "Their Google account is not connected with Calendar. Offer to take them to Settings to connect Google.",
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
    RelationshipGrant
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
        const grant = await relationshipGrant(
          input,
          actor,
          plan,
          chat,
          relationships,
        );
        return grant === null
          ? deny("NOT_AVAILABLE")
          : allow("CONFIDENTIAL", grant);
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: async (input, context, grant) => {
      const found = await schedule.findSlots(context.actor, {
        relationshipId: grant.relationshipId,
        durationMinutes: input.durationMinutes,
        from: input.from === undefined ? undefined : new Date(input.from),
        to: input.to === undefined ? undefined : new Date(input.to),
        timeZone: input.timeZone,
      });
      if (found.status !== "OK") {
        const status =
          found.status === "NOT_CONNECTED" ||
          found.status === "CALENDAR_NOT_CONNECTED"
            ? found.status
            : "UNAVAILABLE";
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
  })
  .strict()
  .refine(exactlyOne, ONE_REF)
  .refine(oneTime, ONE_TIME);
export type ProposeMeetingInput = z.output<typeof ProposeMeetingInputSchema>;

// --- propose_meeting_change ---------------------------------------------------

export const ProposeMeetingChangeInputSchema = z
  .object({
    meetingId: UuidSchema.describe(
      "A call they organised, by id from list_schedule.",
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
  });
export type ProposeMeetingChangeInput = z.infer<
  typeof ProposeMeetingChangeInputSchema
>;

type MeetingGrant = NonNullable<
  Awaited<ReturnType<ScheduleIntelligencePort["organisedMeeting"]>>
>;

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
  })
  .strict();
export type ListScheduleOutput = z.infer<typeof ListScheduleOutputSchema>;

type OwnGrant = { readonly actor: ActorContext };

// --- the catalogue ----------------------------------------------------------------

export function createScheduleTools(
  schedule: ScheduleIntelligencePort,
  chat: ChatIntelligencePort,
  relationships: RelationshipIntelligencePort,
  options: { readonly now?: (() => Date) | undefined } = {},
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
  ): Promise<{
    readonly iso: string;
    readonly timeZone: string | undefined;
  }> => {
    // Precedence: the zone they named, the one saved on their profile,
    // their device's (unless it only says UTC, which privacy browsers and
    // VMs report whatever the place), their calendar's. None: Q asks once.
    const named =
      input.timeZone !== undefined && isKnownTimeZone(input.timeZone)
        ? input.timeZone
        : undefined;
    let zone = named;
    if (zone === undefined && schedule.profileTimeZoneOf !== undefined) {
      const saved = await schedule
        .profileTimeZoneOf(context.actor)
        .catch(() => null);
      if (saved !== null && isKnownTimeZone(saved)) zone = saved;
    }
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
      return { iso: new Date(input.startsAt).toISOString(), timeZone: zone };
    }
    const resolved = resolveLocalWhen(input.when, zone, now());
    if (resolved.kind !== "OK") {
      throw new QToolArgumentError(unresolvedMessage(resolved.kind));
    }
    return {
      iso: resolved.instant.toISOString(),
      timeZone: resolved.timeZone,
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
  ): ChatProposalOutput => ({
    status: chat.prepareForApproval({
      runId: context.runId,
      tenantId: context.actor.tenantId,
      actorUserId: context.actor.userId,
      proposal: entry,
    }),
    awaitingApprovalOf: summary,
  });

  return [
    createFindMeetingTimesTool(schedule, chat, relationships),

    defineQTool<ProposeMeetingInput, ChatProposalOutput, RelationshipGrant>({
      ...proposal,
      id: PROPOSE_MEETING,
      providerName: "propose_meeting",
      description:
        "Prepares a call with the other side of one connected relationship at one exact time, for the person to approve. On approval it becomes a Google Calendar invite with a Meet link, sent from their calendar to the other side's people. Use find_meeting_times first unless they named a time.",
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: [...SCOPES],
      input: ProposeMeetingInputSchema,
      authorize: async (input, { actor, plan }) => {
        try {
          const grant = await relationshipGrant(
            input,
            actor,
            plan,
            chat,
            relationships,
          );
          return grant === null
            ? deny("NOT_AVAILABLE")
            : allow("CONFIDENTIAL", grant);
        } catch {
          return deny("NOT_AVAILABLE");
        }
      },
      execute: async (input, context, grant) => {
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
        if (bookable === "CALENDAR_NOT_CONNECTED") {
          return {
            status: "CALENDAR_NOT_CONNECTED" as const,
            awaitingApprovalOf:
              "Nothing prepared: their Google account is not connected with Calendar, so no invite can be sent. Offer to take them to Settings to connect Google, then prepare it again.",
          };
        }
        const at = await instantOf(input, context);
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
          labelled(`Call with ${grant.counterpartName}`, at.iso, at.timeZone),
        );
      },
    }),

    defineQTool<ProposeMeetingChangeInput, ChatProposalOutput, MeetingGrant>({
      ...proposal,
      id: PROPOSE_MEETING_CHANGE,
      providerName: "propose_meeting_change",
      description:
        "Prepares moving (RESCHEDULE, with the new start) or cancelling (CANCEL) a call the person organised, for them to approve. On approval the Google Calendar event is updated or deleted and everyone invited is told.",
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      input: ProposeMeetingChangeInputSchema,
      authorize: async (input, { actor, plan }) => {
        if (!ownConversation(actor, plan)) return deny("NOT_AVAILABLE");
        const meeting = await schedule
          .organisedMeeting(actor, input.meetingId)
          .catch(() => null);
        return meeting === null || meeting.status !== "SCHEDULED"
          ? deny("NOT_AVAILABLE")
          : allow("CONFIDENTIAL", meeting);
      },
      execute: async (input, context, meeting) => {
        const at =
          input.change === "CANCEL" ? null : await instantOf(input, context);
        return at === null
          ? prepare(
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
            )
          : prepare(
              context,
              {
                actionType: MEETING_RESCHEDULE,
                payload: {
                  meetingId: meeting.id,
                  relationshipId: meeting.relationshipId,
                  purpose: meeting.purpose,
                  startsAt: at.iso,
                  durationMinutes:
                    input.durationMinutes ??
                    Math.round(
                      (Date.parse(meeting.endsAt) -
                        Date.parse(meeting.startsAt)) /
                        60_000,
                    ),
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
        try {
          const grant = await relationshipGrant(
            input,
            actor,
            plan,
            chat,
            relationships,
          );
          return grant === null
            ? deny("NOT_AVAILABLE")
            : allow("CONFIDENTIAL", { relationship: grant });
        } catch {
          return deny("NOT_AVAILABLE");
        }
      },
      execute: async (input, context, grant) => {
        const at = await instantOf(
          {
            when: input.when,
            startsAt: input.remindAt,
            timeZone: input.timeZone,
          },
          context,
        );
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
        "Reads the person's own upcoming calls (with whom, when, whether they organised it, and the prep brief once it is ready, 24 hours before) and their open reminders.",
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
        const own = await schedule.upcoming(grant.actor);
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
