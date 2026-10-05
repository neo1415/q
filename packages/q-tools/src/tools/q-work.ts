import { z } from "zod";

import {
  INSTRUCTION_HAND_OVER_ACTIONS,
  INSTRUCTION_HAND_OVER_KINDS,
  type InstructionHandOverKind,
  Q_INSTRUCTION_GRANT,
  Q_TASK_CLASSES,
  Q_WORK_OUTREACH_START,
  Q_WORK_STANDIN_START,
  QWorkCallWindowSchema,
  handleEverythingGrant,
  type InstructionGrantPayload,
  type PermittedContextPlan,
  type QWorkDto,
  type QWorkOutreachStartPayload,
  type QWorkStandInStartPayload,
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

/**
 * Q's delegated work, as Q's own tools (AUTO, ADR 0030; founder direction
 * 2026-10-01): "Q, handle it" for an investor's outreach, a founder's
 * stand-in, and following, answering or stopping either -- from any Q
 * surface, because every surface offers the same registry.
 *
 * Starting is Prepare → Approve: the tool writes the exact grant (limits,
 * the words Q may say, the questions, the call windows, the expiry) to this
 * run's proposer and nothing happens until the person approves it. Inside
 * a grant the person's own word acts at once: stopping is always theirs,
 * and a time they name for a call on their own lane is the decision the
 * grant left to them.
 */

export const PROPOSE_Q_OUTREACH = "q.work.outreach.propose" as const;
export const PROPOSE_STAND_IN = "q.work.standin.propose" as const;
export const PROPOSE_STANDING_INSTRUCTION = "q.instruction.propose" as const;
export const LIST_Q_WORK = "q.work.list" as const;
export const STOP_Q_WORK = "q.work.stop" as const;
export const ANSWER_Q_WORK = "q.work.answer" as const;
export const SET_AWAY = "q.work.away" as const;

export type QWorkProposal =
  | {
      readonly actionType: typeof Q_WORK_OUTREACH_START;
      readonly payload: QWorkOutreachStartPayload;
    }
  | {
      readonly actionType: typeof Q_WORK_STANDIN_START;
      readonly payload: QWorkStandInStartPayload;
    }
  | {
      readonly actionType: typeof Q_INSTRUCTION_GRANT;
      readonly payload: InstructionGrantPayload;
    };

/** What the work tools reach, composed by q-api over the work store. */
export type QWorkIntelligencePort = {
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly hasCompany: (actor: ActorContext) => Promise<boolean>;
  /** The person's own work: active first, then the most recent. */
  readonly list: (actor: ActorContext) => Promise<readonly QWorkDto[]>;
  /**
   * Their errands (one-relationship jobs, ADR 0028), as they stand now:
   * what Q is waiting for is the errand's own last step, never a guess.
   */
  readonly errands?:
    | ((actor: ActorContext) => Promise<
        readonly {
          readonly errandId: string;
          readonly counterpartName: string;
          readonly status: string;
          readonly lastStep: string | null;
        }[]
      >)
    | undefined;
  /**
   * WORK-58: pause their own live standing instruction, or resume one they
   * paused themselves; false: not theirs, or not in that state.
   */
  readonly pause?:
    ((actor: ActorContext, id: string) => Promise<boolean>) | undefined;
  readonly resume?:
    ((actor: ActorContext, id: string) => Promise<boolean>) | undefined;
  /** Their own delegation (or one lane of it); false: not theirs / not active. */
  readonly stop: (
    actor: ActorContext,
    delegationId: string,
    laneId: string | null,
  ) => Promise<boolean>;
  readonly answer: (
    actor: ActorContext,
    delegationId: string,
    laneId: string,
    answer:
      | { readonly kind: "BOOK_AT"; readonly at: string }
      | {
          readonly kind: "PASS";
        },
  ) => Promise<"ACCEPTED" | "NOT_FOUND" | "NOT_ACTIVE">;
  readonly setAway: (actor: ActorContext, away: boolean) => Promise<void>;
  /**
   * The people they named to leave out, matched by name against the people
   * a standing instruction could reach (their relationships, feed and
   * saved list): one match each is found, anything else is unknown.
   */
  readonly counterpartsNamed?:
    | ((
        actor: ActorContext,
        names: readonly string[],
      ) => Promise<{
        readonly found: readonly {
          readonly counterpartId: string;
          readonly name: string;
        }[];
        readonly unknown: readonly string[];
      }>)
    | undefined;
  /** The person's own time zone, when known (their working hours are in it). */
  readonly timeZoneOf?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly proposal: QWorkProposal;
  }) => "PREPARED" | "ONE_PER_TURN";
};

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const OWN = {
  version: 1,
  status: "ACTIVE",
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
} as const;

const ProposalOutputSchema = z
  .object({
    status: z.enum(["PREPARED", "ONE_PER_TURN"]),
    awaitingApprovalOf: z.string().max(200),
  })
  .strict();
type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

const Uuid = z.string().uuid();

// --- start: investor outreach ---------------------------------------------

export const ProposeQOutreachInputSchema = z
  .object({
    maxCompanies: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("How many founders Q may approach. Default 3; at most 10."),
    openingMessage: z
      .string()
      .trim()
      .min(10)
      .max(1_200)
      .describe(
        "The first message to each founder once they accept, in the investor's voice, posted marked as sent by Q. Drafted from what they told you; they approve it word for word.",
      ),
    brief: z
      .string()
      .trim()
      .min(20)
      .max(2_000)
      .nullable()
      .default(null)
      .describe(
        "Everything Q may tell founders about the investor, as plain statements from what they said or their own profile. Null: Q answers nothing itself and passes questions back.",
      ),
    topics: z
      .array(z.string().trim().min(3).max(200))
      .max(6)
      .default([])
      .describe(
        "What Q should learn from each founder for the investor (e.g. 'Monthly revenue', 'Who the first customers are').",
      ),
    interviewQuestions: z
      .array(z.string().trim().min(5).max(400))
      .max(8)
      .default([])
      .describe(
        "Only when they asked for a first-stage interview: the questions Q asks each founder in the chat, word for word. Empty: no interview.",
      ),
    callPurpose: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .nullable()
      .default(null)
      .describe(
        "When they want calls booked: the invite title. Null: no call.",
      ),
    callMinutes: z.number().int().min(15).max(120).default(30),
    callWindows: z
      .array(QWorkCallWindowSchema)
      .min(1)
      .max(7)
      .default([{ days: [1, 2, 3, 4, 5], startHour: 10, endHour: 16 }])
      .describe(
        "When they take calls, in their calendar's time zone. Default weekdays 10:00-16:00.",
      ),
    mayBookInWindows: z
      .boolean()
      .default(false)
      .describe(
        "True only when they said Q may book the first free time without asking them.",
      ),
    expiresInDays: z.number().int().min(1).max(30).default(14),
  })
  .strict();
type ProposeQOutreachInput = z.output<typeof ProposeQOutreachInputSchema>;

// --- start: founder stand-in ------------------------------------------------

export const ProposeStandInInputSchema = z
  .object({
    brief: z
      .string()
      .trim()
      .min(20)
      .max(3_000)
      .describe(
        "Everything Q may tell investors while the founder is away, as plain statements drafted from what they told you and their own profile as investors already see it. Never private numbers they have not agreed to share. They approve it word for word.",
      ),
    awayAfterMinutes: z
      .number()
      .int()
      .min(10)
      .max(1_440)
      .default(30)
      .describe("Q steps in after they have been away this long."),
    expiresInDays: z.number().int().min(1).max(90).default(30),
  })
  .strict();
type ProposeStandInInput = z.output<typeof ProposeStandInInputSchema>;

// --- follow, answer, stop -----------------------------------------------------

const WorkListOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            delegationId: z.string(),
            kind: z.string(),
            status: z.string(),
            summary: z.string().nullable(),
            expiresAt: z.string(),
            lanes: z.array(
              z
                .object({
                  laneId: z.string(),
                  counterpartName: z.string(),
                  stage: z.string(),
                  lastStep: z.string().nullable(),
                  /** Times waiting for their choice: start (ISO) and label. */
                  offered: z.array(
                    z.object({ start: z.string(), label: z.string() }).strict(),
                  ),
                  report: z.string().nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(20),
    /** One-relationship errands; stop one with its errandId as delegationId. */
    errands: z
      .array(
        z
          .object({
            errandId: z.string(),
            counterpartName: z.string(),
            status: z.string(),
            lastStep: z.string().nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
type WorkListOutput = z.infer<typeof WorkListOutputSchema>;

const StopInputSchema = z
  .object({
    delegationId: Uuid,
    laneId: Uuid.nullable()
      .default(null)
      .describe("One founder only; null stops the whole job."),
    // WORK-58: a standing instruction can also be paused and resumed.
    mode: z
      .enum(["STOP", "PAUSE", "RESUME"])
      .default("STOP")
      .describe(
        "PAUSE: hold a standing instruction until they resume it; RESUME: one they paused themselves.",
      ),
  })
  .strict();
type StopInput = z.output<typeof StopInputSchema>;

const AnswerInputSchema = z
  .object({
    delegationId: Uuid,
    laneId: Uuid,
    kind: z
      .enum(["BOOK_AT", "PASS"])
      .describe(
        "BOOK_AT: book a call (or another call) at `at`; PASS: they do not want to go further with this founder.",
      ),
    at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null)
      .describe(
        "For BOOK_AT: the start time they chose, ISO 8601 with offset -- one of the offered times, or the time they named.",
      ),
  })
  .strict();
type AnswerInput = z.output<typeof AnswerInputSchema>;

const ActedOutputSchema = z
  .object({ done: z.boolean(), note: z.string().max(200) })
  .strict();
type ActedOutput = z.infer<typeof ActedOutputSchema>;

const AwayInputSchema = z
  .object({
    away: z
      .boolean()
      .describe("True: they are away now, Q stands in at once. False: back."),
  })
  .strict();
type AwayInput = z.output<typeof AwayInputSchema>;

// --- start: a standing instruction (ADR 0043) ------------------------------

/** A time of day, 24-hour "HH:MM". */
const WorkingTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/u)
  .describe('A time of day, 24-hour "HH:MM".');

/** The standing-instruction proposal: as any proposal, and how many steps are Q's own. */
export const StandingProposalOutputSchema = ProposalOutputSchema.extend({
  onItsOwn: z.number().int().min(0),
}).strict();
export type StandingProposalOutput = z.infer<
  typeof StandingProposalOutputSchema
>;

/**
 * Live QA (runs 01a6124a, 9f948ed2): "starting right now at any hour" was
 * read once as Mon-Fri 09:00-17:00 and once correctly. Clear round-the-clock
 * wording ("any hour", "24/7", "anytime", "weekends too", "every day") is
 * read by code: every day, 00:00-23:59. It overrides an absent
 * reading or the default; explicit hours the model read still win.
 */
const ALL_HOURS =
  /\b(?:any|all) hours?\b|\bat any time\b|\banytime\b|\bany time of (?:the )?(?:day|night)\b|\b24\s*\/\s*7\b|\b24-7\b|\b24 hours a day\b|\bround[- ]the[- ]clock\b|\baround the clock\b|\bday (?:and|or) night\b|\bweekends? (?:too|as well)\b|\bincluding weekends?\b|\bevery day\b|\b(?:seven|7) days a week\b/iu;

export type ClearHours = {
  readonly days: readonly number[];
  readonly start: string;
  readonly end: string;
};

/** Code's own reading of clear working-hours words in the goal; else null. */
export function clearHoursOf(goal: string): ClearHours | null {
  if (ALL_HOURS.test(goal)) {
    return { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" };
  }
  return null;
}

const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/**
 * The hours a grant carries: the model's explicit reading when it differs
 * from the default; otherwise code's reading of clear words; otherwise the
 * default.
 */
export function workingHoursFor(
  goal: string,
  read: ClearHours | null,
  base: { readonly timeZone: string } & ClearHours,
): { timeZone: string; days: number[]; start: string; end: string } {
  const isDefault =
    read === null ||
    (read.start === base.start &&
      read.end === base.end &&
      [...new Set(read.days)].sort((a, b) => a - b).join(",") ===
        DEFAULT_DAYS.join(","));
  const clear = clearHoursOf(goal);
  const chosen = isDefault ? (clear ?? read) : read;
  if (chosen === null) {
    return { ...base, days: [...base.days] };
  }
  return {
    timeZone: base.timeZone,
    days: [...new Set(chosen.days)].sort((a, b) => a - b),
    start: chosen.start,
    end: chosen.end,
  };
}

/**
 * Live QA (instruction 76d6f281): "a short first message to founders ...
 * who haven't heard from me yet" is a first message only -- the grant then
 * allows no follow-ups. Read by code from the goal, or from the model.
 */
const FIRST_ONLY =
  /\b(?:first|opening|intro(?:ductory)?) (?:message|note|hello)s?\b|\bhaven'?t (?:yet )?heard from (?:me|us)\b|\bhave not (?:yet )?heard from (?:me|us)\b|\bnot (?:yet )?heard from (?:me|us)\b|\bhaven'?t (?:yet )?(?:messaged|contacted|written to)\b/iu;

const FOLLOW_UPS =
  /\bfollow[- ]?ups?\b|\bfollow(?:ing)? up\b|\bkeep (?:the )?\w+ (?:going|moving)\b/iu;

export function firstMessagesOnly(goal: string, read: boolean): boolean {
  if (FOLLOW_UPS.test(goal)) return false;
  return read || FIRST_ONLY.test(goal);
}

/**
 * A model's reading of "do not book calls" arrives in its own words
 * (QA 07a90dd8, 4a2c9bc4: a strict enum failed the whole card as
 * INVALID_ARGUMENTS). Read leniently, in execute: case and
 * separators are ignored, plain synonyms map to their kind, and anything
 * still unknown is read as UNKNOWN -- never dropped, since a dropped "don't"
 * would leave Q doing what they forbade (execute makes every step ask then).
 */
function handOverKindOf(raw: string): InstructionHandOverKind | "UNKNOWN" {
  const word = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if ((INSTRUCTION_HAND_OVER_KINDS as readonly string[]).includes(word)) {
    return word as InstructionHandOverKind;
  }
  if (/INTEREST/u.test(word)) return "EXPRESS_INTEREST";
  if (/BOOK|CALL|MEETING|SCHEDUL/u.test(word)) return "BOOK_CALLS";
  if (/MESSAG|CHAT|REPL|WRITE|OUTREACH/u.test(word)) return "MESSAGES";
  return "UNKNOWN";
}

const HandOverKinds = z.array(z.string().min(1).max(80)).max(10).default([]);

export const ProposeStandingInstructionInputSchema = z
  .object({
    goal: z
      .string()
      .min(1)
      .max(2_000)
      .describe(
        "Their goal in their own words, e.g. 'handle all the work for me'.",
      ),
    askFirst: z
      .boolean()
      .default(false)
      .describe("True when they want Q to ask before every step."),
    handsOverDoing: z
      .boolean()
      .default(false)
      .describe(
        "True only when they hand Q the doing itself ('handle it', 'do it for me', 'just send them', 'reach out to them', 'take it over'): then Q expresses interest, chats and books times on its own. False when they ask Q to find, prepare, draft or line up things for them ('prepare intros', 'draft messages', 'line up meetings'): every step is then a card for their yes.",
      ),
    onItsOwnOnly: HandOverKinds.describe(
      "When they handed over the doing AND named what Q may do on its own ('express interest and send a first message' -> ['EXPRESS_INTEREST', 'MESSAGES']): only those; empty when they named nothing specific ('handle it'). One of EXPRESS_INTEREST, MESSAGES, BOOK_CALLS each.",
    ),
    neverDo: HandOverKinds.describe(
      "What they told Q not to do at all ('do not book calls' -> ['BOOK_CALLS']); empty when they said nothing like that. One of EXPRESS_INTEREST, MESSAGES, BOOK_CALLS each.",
    ),
    tone: z
      .string()
      .min(1)
      .max(300)
      .nullable()
      .default(null)
      .describe(
        "How Q should write for them, if they said; null for the default.",
      ),
    topics: z
      .array(z.string().min(1).max(120))
      .max(12)
      .default([])
      .describe("What Q may talk about, if they said; empty for the default."),
    relationshipIds: z
      .array(Uuid)
      .max(50)
      .default([])
      .describe(
        "Only these relationships, if they named some; empty means all of theirs.",
      ),
    includeNewCompanies: z
      .boolean()
      .default(false)
      .describe(
        "True when the goal reaches companies they are not in touch with yet ('monitor new founders', 'find me companies'): Q may then also act on companies in their own feed and saved list (never ones they passed).",
      ),
    expiresInDays: z.number().int().min(1).max(365).default(30),
    askedTermsOrMoney: z
      .boolean()
      .default(false)
      .describe(
        "True when they also asked Q to negotiate valuation or terms, move money or commit them: Q never does that, the grant leaves it out, and the answer says so.",
      ),
    digest: z
      .enum(["DAILY", "WEEKLY", "OFF"])
      .default("DAILY")
      .describe("How often they want a summary of what Q did, if they said."),
    excludeNames: z
      .array(z.string().min(1).max(120))
      .max(10)
      .default([])
      .describe(
        "Companies or investors they said to leave out, as they named them ('except Nixo' -> ['Nixo']); empty when they named none.",
      ),
    firstMessagesOnly: z
      .boolean()
      .default(false)
      .describe(
        "True when the goal is a first message only ('send a first message to founders who haven't heard from me'): Q then sends no follow-ups.",
      ),
    workingHours: z
      .object({
        days: z
          .array(z.number().int().min(1).max(7))
          .min(1)
          .max(7)
          .describe("ISO weekdays Q may work on, 1 = Monday ... 7 = Sunday."),
        start: WorkingTime,
        end: WorkingTime,
      })
      .strict()
      .refine((hours) => hours.start < hours.end, {
        message: "the working day ends after it starts",
      })
      .nullable()
      .default(null)
      .describe(
        "Only when they said when Q may work ('weekends too, 8am to 10pm' -> days [1,2,3,4,5,6,7], start '08:00', end '22:00'), in their own time zone; null keeps the default, Monday-Friday 09:00-17:00.",
      ),
  })
  .strict();
type ProposeStandingInstructionInput = z.output<
  typeof ProposeStandingInstructionInputSchema
>;

export function createQWorkTools(
  port: QWorkIntelligencePort,
): readonly AnyQToolDefinition[] {
  return [
    defineQTool<ProposeQOutreachInput, ProposalOutput, null>({
      ...OWN,
      id: PROPOSE_Q_OUTREACH,
      providerName: "propose_q_outreach",
      description:
        "An investor hands Q their outreach ('Q, handle it', 'find me founders and set up calls'): for ONE approval, Q goes through their own Discover feed (profiles and pitch transcripts), picks the closest fits to their mandate up to a limit, expresses interest, and when each founder accepts sends the opening message, chats to answer from an approved brief and learn the topics, optionally runs a first-stage interview and sends a report, asks which times work (or books inside their windows if allowed), books the call with a Meet link, and tells them at each step. Choosing the founders is Q's job inside this plan (done after approval, from the feed, each pick quoting its material): call this at once with the number they gave, never ask them which company first. Draft the plan from what they said; they approve it exactly and can stop it any time.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeQOutreachInputSchema,
      output: ProposalOutputSchema,
      authorize: async (_input, { actor, plan }) =>
        ownConversation(actor, plan) && (await port.isInvestor(actor))
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      execute: (input, context) => {
        const status = port.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          proposal: {
            actionType: Q_WORK_OUTREACH_START,
            payload: {
              ownerUserId: context.actor.userId,
              grant: {
                maxCompanies: input.maxCompanies,
                openingMessage: input.openingMessage,
                brief: input.brief,
                topics: input.topics,
                interview:
                  input.interviewQuestions.length === 0
                    ? null
                    : { questions: input.interviewQuestions },
                call:
                  input.callPurpose === null
                    ? null
                    : {
                        purpose: input.callPurpose,
                        durationMinutes: input.callMinutes,
                        windows: input.callWindows,
                        mayBookInWindows: input.mayBookInWindows,
                      },
              },
              expiresInDays: input.expiresInDays,
            },
          },
        });
        return Promise.resolve({
          status,
          awaitingApprovalOf: `Q handles outreach to up to ${String(input.maxCompanies)} founders`,
        });
      },
    }),

    defineQTool<ProposeStandInInput, ProposalOutput, null>({
      ...OWN,
      id: PROPOSE_STAND_IN,
      providerName: "propose_stand_in",
      description:
        "A founder asks Q to stand in while they are offline ('answer investors when I'm away'): for ONE approval, Q answers investors' chat messages only from a brief they approve word for word, labelled as Q, defers everything else to them, and hands each chat back when they return. Draft the brief from what they said and their own profile as investors see it; they can stop it any time.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeStandInInputSchema,
      output: ProposalOutputSchema,
      authorize: async (_input, { actor, plan }) =>
        ownConversation(actor, plan) && (await port.hasCompany(actor))
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      execute: (input, context) => {
        const status = port.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          proposal: {
            actionType: Q_WORK_STANDIN_START,
            payload: {
              ownerUserId: context.actor.userId,
              grant: {
                brief: input.brief,
                awayAfterMinutes: input.awayAfterMinutes,
              },
              expiresInDays: input.expiresInDays,
            },
          },
        });
        return Promise.resolve({
          status,
          awaitingApprovalOf: "Q stands in for you while you're away",
        });
      },
    }),

    defineQTool<ProposeStandingInstructionInput, StandingProposalOutput, null>({
      ...OWN,
      id: PROPOSE_STANDING_INSTRUCTION,
      providerName: "propose_standing_instruction",
      description:
        "The person gives Q a goal to work toward over time ('handle all the work for me', 'keep my investor conversations moving'): for ONE approval, Q works on it inside a grant they see in plain words -- on its own only expressing interest, chat messages within their tone and topics (a few per person, then it asks) and booking times in their working hours (Monday-Friday 09:00-17:00 unless they said otherwise); everything else a card first; terms, money and commitments never without their yes. Call this at once from what they said; they approve it exactly and can stop it any time. For one founder search or one away-message, prefer propose_q_outreach or propose_stand_in.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeStandingInstructionInputSchema,
      output: StandingProposalOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (input, context) => {
        const [timeZone, investor, company] = await Promise.all([
          port.timeZoneOf?.(context.actor) ?? Promise.resolve(null),
          port.isInvestor(context.actor).catch(() => false),
          port.hasCompany(context.actor).catch(() => false),
        ]);
        // Who they said to leave out, by id. A name that matches no one (or
        // several) is asked about, never dropped: a card that silently
        // covered them would act on someone they excluded.
        let exclude: readonly {
          readonly counterpartId: string;
          readonly name: string;
        }[] = [];
        if (input.excludeNames.length > 0) {
          const named = await port.counterpartsNamed?.(
            context.actor,
            input.excludeNames,
          );
          if (named === undefined || named.unknown.length > 0) {
            throw new QToolArgumentError(
              `I couldn't tell who ${
                named === undefined
                  ? input.excludeNames.join(", ")
                  : named.unknown.join(", ")
              } is among your relationships and feed; say the name as it appears there.`,
            );
          }
          exclude = named.found;
        }
        const base = handleEverythingGrant({
          timeZone: timeZone ?? "UTC",
          // Only what their side can do is on their card.
          side: investor ? "INVESTOR" : company ? "COMPANY" : undefined,
          tone: input.tone ?? undefined,
          topics: input.topics.length > 0 ? input.topics : undefined,
          includeNewCompanies: input.includeNewCompanies,
        });
        // The default's AUTO set only when they handed over the doing
        // (weekend test 6ea17898: "find new founders ... and prepare
        // intros" became AUTO interest, chat and booking).
        // QA 2026-10-03 (runs 9a8e8d2a, b4e0db89): "express interest and
        // send a first message ... do not book calls" still granted AUTO
        // booking. What they said not to do leaves the grant (the engine
        // refuses it as NOT_IN_GRANT); when they named what Q may do alone,
        // only those stay AUTO and the rest ask.
        const actionsOf = (kind: InstructionHandOverKind | "UNKNOWN") =>
          kind === "UNKNOWN" ? [] : INSTRUCTION_HAND_OVER_ACTIONS[kind];
        const neverKinds = input.neverDo.map(handOverKindOf);
        const never = new Set(neverKinds.flatMap(actionsOf));
        const named = new Set(
          input.onItsOwnOnly.map(handOverKindOf).flatMap(actionsOf),
        );
        // A "don't" Q could not place: nothing is done alone.
        const unplaced = neverKinds.includes("UNKNOWN");
        const kept = base.actions.filter((entry) => !never.has(entry.action));
        const actions =
          input.askFirst || !input.handsOverDoing || unplaced
            ? kept.map((entry) => ({ ...entry, mode: "ASK" as const }))
            : kept.map((entry) =>
                named.size > 0 &&
                entry.mode === "AUTO" &&
                !named.has(entry.action)
                  ? { ...entry, mode: "ASK" as const }
                  : entry,
              );
        const status = port.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          proposal: {
            actionType: Q_INSTRUCTION_GRANT,
            payload: {
              ownerUserId: context.actor.userId,
              goal: input.goal,
              grant: {
                ...base,
                actions,
                counterparts: {
                  ...(input.relationshipIds.length > 0
                    ? {
                        scope: "LISTED",
                        relationshipIds: input.relationshipIds,
                        includeNewCompanies: false,
                      }
                    : base.counterparts),
                  exclude: exclude.map((entry) => ({ ...entry })),
                },
                expiresInDays: input.expiresInDays,
                digest: input.digest,
                // Their own hours when they gave them, in their own zone;
                // clear words ("any hour", "24/7") read by code; the card
                // says them in plain words before they approve.
                workingHours: workingHoursFor(
                  input.goal,
                  input.workingHours,
                  base.workingHours,
                ),
                ...(firstMessagesOnly(input.goal, input.firstMessagesOnly)
                  ? { followUps: false }
                  : {}),
                // Founder 2026-10-05: not every message needs a yes. Routine
                // replies go on their own unless they asked to approve all.
                routineReplies: !input.askFirst,
              },
            },
          },
        });
        return {
          status,
          awaitingApprovalOf: "Q works on this for you, inside these limits",
          // How many steps the card lets Q take on its own: the reply's
          // words are drawn from this grant, never assumed.
          onItsOwn: actions.filter((entry) => entry.mode === "AUTO").length,
        };
      },
    }),

    defineQTool<Record<string, never>, WorkListOutput, null>({
      ...OWN,
      id: LIST_Q_WORK,
      core: true,
      providerName: "list_q_work",
      description:
        "Reads what Q is working on for them, as it really stands: each standing instruction, outreach or stand-in (per founder or investor the stage, the last step -- e.g. who Q is still waiting on to accept -- any times waiting for their choice, with ids to answer, and a report's verdict), and each errand on one relationship with its last step. Call it for 'what are you working on', 'any news', 'did they accept', 'is my meeting set', or before answering or stopping work. Say only what this returns.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      approval: "NONE",
      visibleStage: null,
      input: z.object({}).strict(),
      output: WorkListOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (_input, context) => {
        const items = await port.list(context.actor);
        const errands = (await port.errands?.(context.actor)) ?? [];
        return {
          errands: errands.slice(0, 10).map((errand) => ({ ...errand })),
          items: items.slice(0, 20).map((item) => ({
            delegationId: item.id,
            kind: item.kind,
            status: item.status,
            summary: item.summary,
            expiresAt: item.expiresAt,
            lanes: item.lanes.map((lane) => ({
              laneId: lane.id,
              counterpartName: lane.counterpartName,
              stage: lane.stage,
              lastStep: lane.lastStep,
              offered: lane.offered.map((slot) => ({ ...slot })),
              report:
                lane.report === null
                  ? null
                  : `${lane.report.recommendation}: ${lane.report.headline}`,
            })),
          })),
        };
      },
    }),

    defineQTool<StopInput, ActedOutput, null>({
      ...OWN,
      id: STOP_Q_WORK,
      core: true,
      providerName: "stop_q_work",
      description:
        "Stops Q's work for them at once: a whole outreach or stand-in, one founder in it (laneId), or an errand (its errandId as delegationId). mode PAUSE holds a standing instruction until they resume it; RESUME restarts one they paused (a budget pause is resumed by approving its card). Always theirs, no approval needed; nothing further is sent. Use the ids from list_q_work.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: null,
      input: StopInputSchema,
      output: ActedOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (input, context) => {
        if (input.mode !== "STOP") {
          const resume = input.mode === "RESUME";
          const acted =
            input.laneId === null &&
            ((resume
              ? await port.resume?.(context.actor, input.delegationId)
              : await port.pause?.(context.actor, input.delegationId)) ??
              false);
          return {
            done: acted,
            note: acted
              ? resume
                ? "Resumed."
                : "Paused."
              : resume
                ? "Nothing you paused there to resume."
                : "Nothing running there to pause.",
          };
        }
        const stopped = await port.stop(
          context.actor,
          input.delegationId,
          input.laneId,
        );
        return {
          done: stopped,
          note: stopped ? "Stopped." : "Nothing active to stop there.",
        };
      },
    }),

    defineQTool<AnswerInput, ActedOutput, null>({
      ...OWN,
      id: ANSWER_Q_WORK,
      providerName: "answer_q_work",
      description:
        "Gives Q their decision on one founder in their outreach: book the call (or another call) at a time they chose or named ('book it Tuesday at 3', 'book another meeting for this time'), or pass. Q then books with a Meet link and tells both sides. Use ids from list_q_work; the time must be one they said.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: null,
      input: AnswerInputSchema,
      output: ActedOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (input, context) => {
        if (input.kind === "BOOK_AT" && input.at === null) {
          return { done: false, note: "A time is needed to book." };
        }
        const outcome = await port.answer(
          context.actor,
          input.delegationId,
          input.laneId,
          input.kind === "BOOK_AT" && input.at !== null
            ? { kind: "BOOK_AT", at: new Date(input.at).toISOString() }
            : { kind: "PASS" },
        );
        return {
          done: outcome === "ACCEPTED",
          note:
            outcome === "ACCEPTED"
              ? input.kind === "PASS"
                ? "Q will stop with them."
                : "Q is booking it now and will send the Meet link."
              : outcome === "NOT_ACTIVE"
                ? "That work has finished or was stopped."
                : "Not found among their work.",
        };
      },
    }),

    defineQTool<AwayInput, ActedOutput, null>({
      ...OWN,
      id: SET_AWAY,
      providerName: "set_away",
      description:
        "Tells Q the founder is away now (Q's approved stand-in answers investors at once) or back (Q hands the chats back). Only matters when they have a stand-in running.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: null,
      input: AwayInputSchema,
      output: ActedOutputSchema,
      authorize: async (_input, { actor, plan }) =>
        ownConversation(actor, plan) && (await port.hasCompany(actor))
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      execute: async (input, context) => {
        await port.setAway(context.actor, input.away);
        return {
          done: true,
          note: input.away ? "Marked away." : "Marked back.",
        };
      },
    }),
  ];
}
