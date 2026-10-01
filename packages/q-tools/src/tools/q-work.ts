import { z } from "zod";

import {
  Q_TASK_CLASSES,
  Q_WORK_OUTREACH_START,
  Q_WORK_STANDIN_START,
  QWorkCallWindowSchema,
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
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * Q's delegated work, as Q's own tools (AUTO, ADR 0029; founder direction
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
    };

/** What the work tools reach, composed by q-api over the work store. */
export type QWorkIntelligencePort = {
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly hasCompany: (actor: ActorContext) => Promise<boolean>;
  /** The person's own work: active first, then the most recent. */
  readonly list: (actor: ActorContext) => Promise<readonly QWorkDto[]>;
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
  })
  .strict();
type WorkListOutput = z.infer<typeof WorkListOutputSchema>;

const StopInputSchema = z
  .object({
    delegationId: Uuid,
    laneId: Uuid.nullable()
      .default(null)
      .describe("One founder only; null stops the whole job."),
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

export function createQWorkTools(
  port: QWorkIntelligencePort,
): readonly AnyQToolDefinition[] {
  return [
    defineQTool<ProposeQOutreachInput, ProposalOutput, null>({
      ...OWN,
      id: PROPOSE_Q_OUTREACH,
      providerName: "propose_q_outreach",
      description:
        "An investor hands Q their outreach ('Q, handle it', 'find me founders and set up calls'): for ONE approval, Q goes through their own Discover feed (profiles and pitch transcripts), picks the closest fits to their mandate up to a limit, expresses interest, and when each founder accepts sends the opening message, chats to answer from an approved brief and learn the topics, optionally runs a first-stage interview and sends a report, asks which times work (or books inside their windows if allowed), books the call with a Meet link, and tells them at each step. Draft the plan from what they said; they approve it exactly and can stop it any time.",
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

    defineQTool<Record<string, never>, WorkListOutput, null>({
      ...OWN,
      id: LIST_Q_WORK,
      core: true,
      providerName: "list_q_work",
      description:
        "Reads what Q is working on for them: each outreach or stand-in, where it stands, and per founder or investor the stage, the last step, any times waiting for their choice (with ids to answer), and a report's verdict. Call it for 'what are you working on', 'any news', 'who accepted', or before answering or stopping work.",
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
        return {
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
        "Stops Q's work for them at once: a whole outreach or stand-in, or one founder in it (laneId). Stopping is always theirs and needs no approval; nothing further is sent. Use the ids from list_q_work.",
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
