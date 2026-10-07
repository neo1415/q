import { z } from "zod";

import {
  READINESS_ACTION_STATE_PATH,
  READINESS_QUESTION_ANSWER_PATH,
  READINESS_QUESTION_DISMISS_PATH,
  ReadinessActionStateRequestSchema,
  ReadinessActionStateResultSchema,
  ReadinessQuestionAnswerRequestSchema,
  ReadinessQuestionResultSchema,
  type ReadinessDto,
  type ReadinessQuestionResult,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import type { OwnReadItem } from "../reads.js";

/**
 * The founder's readiness (Q.03), action plan (Q.04) and Q's follow-up
 * questions (Q.01), from the Capital page, Home or by asking Q ("what
 * should I do next?", "ask me what you still need to know").
 *
 * All three are the person's own word on their own company, so INSTANT:
 * ticking an action changes no evidence (the pillars move only on
 * evidence), and an answer goes through the interview's own commit (the
 * step's write targets and the Write Gate), exactly as the interview's
 * own answer would. The company is always the actor's own, resolved by
 * the service; nothing in the input names a company.
 */

const readiness = (ports: AppActionPorts) =>
  ports.readiness ?? portMissing("readiness");

/** The founder's own company only; anyone else is refused (the route's 404). */
const ownCompany = async (
  ports: AppActionPorts,
  context: { readonly actor: ActorContext },
) =>
  ports.ownCompanyId === undefined ||
  (await ports.ownCompanyId(context.actor).catch(() => null)) !== null
    ? { ok: true as const }
    : {
        ok: false as const,
        reason: "Readiness is for a founder's own company.",
      };

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** An action by its key, or by the words they used for its title. */
export function actionByWords(
  plan: ReadinessDto,
  said: string,
): ReadinessDto["actions"][number] | null {
  const wanted = norm(said);
  const exact = plan.actions.find(
    (action) => action.key === said.trim() || norm(action.title) === wanted,
  );
  if (exact !== undefined) return exact;
  const words = wanted.split(" ").filter((word) => word.length > 3);
  if (words.length === 0) return null;
  const scored = plan.actions
    .map((action) => {
      const title = norm(`${action.title} ${action.key.replace(/-/g, " ")}`);
      return {
        action,
        hits: words.filter((word) => title.includes(word)).length,
      };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const [best, second] = scored;
  // One clear match only; a tie is asked about, never guessed.
  return best === undefined ||
    (second !== undefined && second.hits === best.hits)
    ? null
    : best.action;
}

const State = z
  .object({
    actionKey: z.string().regex(/^[a-z0-9-]{1,40}$/),
    input: ReadinessActionStateRequestSchema,
  })
  .strict();
type StateInput = z.infer<typeof State>;

const StateTool = z
  .object({
    action: z
      .string()
      .min(1)
      .max(160)
      .describe(
        "The action from their plan: its key from read_my('plan'), or its title as they said it.",
      ),
    done: z
      .boolean()
      .describe("true: they did it; false: reopen it (not done after all)."),
  })
  .strict();

type StateOut = { readonly key: string; readonly state: string } | null;

const SET_STATE = defineAppAction<
  StateInput,
  StateOut,
  z.infer<typeof StateTool>
>({
  name: "readiness.action.state",
  short: "tick an action plan step",
  area: "readiness",
  classification: "INSTANT",
  does: "Marks one step of their own action plan done, or reopens it, as the Capital page's board does. Their readiness moves only when the evidence does.",
  input: State,
  output: z.custom<StateOut>(),
  authorize: ownCompany,
  run: (ports, context, input) =>
    readiness(ports).setActionState(
      context.actor,
      input.actionKey,
      input.input,
    ),
  targets: () => [],
  card: (input) => ({
    summary: input.input.done ? "Mark a plan step done" : "Reopen a plan step",
    preview: input.actionKey,
  }),
  done: (out) =>
    out === null
      ? "That isn't on your action plan."
      : out.state === "DONE_BY_EVIDENCE"
        ? "That one is already closed: Q can see the evidence for it."
        : out.state === "MARKED_DONE"
          ? "Ticked on your plan. Your readiness changes when Q sees the evidence for it."
          : "Reopened on your plan.",
  succeeded: (out) => out !== null,
  http: {
    method: "POST",
    path: READINESS_ACTION_STATE_PATH,
    fromRequest: (params, body) => ({
      actionKey: params["actionKey"],
      input: body,
    }),
    notFound: (out) => out === null,
    respond: (out) => ReadinessActionStateResultSchema.parse(out),
  },
  tool: {
    name: "mark_plan_step",
    purposes: [
      "OWN_COMPANY_QUESTION",
      "GENERAL_QUESTION",
      "ACTION_PREPARATION",
    ],
    description:
      "Ticks one step of the founder's own action plan done (or reopens it) when they say they did it. It does not change their readiness: that moves only when Q sees the evidence.",
    input: StateTool,
    references: {},
    eval: {
      say: [
        "I've uploaded the deck, tick that off my plan.",
        "Mark the use of funds step as done.",
      ],
      orSays: "isn't on your action plan|already closed",
    },
    toCanonical: async (tool, context, ports) => {
      const plan = await readiness(ports).read(context.actor);
      if (plan === null) return null;
      const action = actionByWords(plan, tool.action);
      return action === null
        ? refusal(
            "I couldn't tell which step of your plan you mean. Say its title as it reads on your plan.",
          )
        : { actionKey: action.key, input: { done: tool.done } };
    },
  },
});

const Answer = z
  .object({
    questionId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(200),
    input: ReadinessQuestionAnswerRequestSchema,
  })
  .strict();
type AnswerInput = z.infer<typeof Answer>;

const AnswerTool = z
  .object({
    questionId: z
      .string()
      .uuid()
      .describe("The question's id exactly as read_my('questions') gave it."),
    choice: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "One of the question's quick answers, word for word as listed, when their answer is one of them.",
      ),
    text: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        "Otherwise their answer in their own words (a figure for a number question). Never your own words.",
      ),
  })
  .strict();

type AnswerOut =
  | ReadinessQuestionResult
  | { readonly refused: "NOT_FOUND" | "NOT_ANSWERABLE" | "INVALID" }
  | null;

const REFUSED_WORDS = {
  NOT_FOUND: "That question isn't waiting any more.",
  NOT_ANSWERABLE:
    "That one is changed on its own page now (your profile or Capital), so I've left it as it is.",
  INVALID:
    "I couldn't place that answer. Pick one of the options, or give the figure on its own.",
} as const;

const ANSWER = defineAppAction<
  AnswerInput,
  AnswerOut,
  z.infer<typeof AnswerTool>
>({
  name: "readiness.question.answer",
  short: "answer Q's question",
  area: "readiness",
  classification: "INSTANT",
  does: "Answers one of the questions Q still wants answered about their company, committed exactly as the interview commits an answer (their claim until evidence backs it).",
  input: Answer,
  output: z.custom<AnswerOut>(),
  authorize: ownCompany,
  run: (ports, context, input) =>
    readiness(ports).answerFollowUp(
      context.actor,
      input.questionId,
      input.input,
      input.idempotencyKey,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Answer Q's question", preview: "" }),
  done: (out) =>
    out === null
      ? "That question isn't waiting any more."
      : "refused" in out
        ? REFUSED_WORDS[out.refused]
        : out.remaining === 0
          ? "Got it, saved as your answer. That was the last thing I wanted to ask."
          : `Got it, saved as your answer. ${String(out.remaining)} more when you have a moment.`,
  succeeded: (out) => out !== null && !("refused" in out),
  http: {
    method: "POST",
    path: READINESS_QUESTION_ANSWER_PATH,
    fromRequest: (params, body, headers) => ({
      questionId: params["questionId"],
      idempotencyKey: headers["idempotency-key"],
      input: body,
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    notFound: (out) => out === null,
    problem: (out) =>
      out !== null && "refused" in out
        ? {
            code:
              out.refused === "NOT_FOUND"
                ? "RESOURCE_NOT_FOUND"
                : "VALIDATION_FAILED",
            detail: REFUSED_WORDS[out.refused],
          }
        : null,
    respond: (out) => ReadinessQuestionResultSchema.parse(out),
  },
  tool: {
    name: "answer_q_question",
    purposes: [
      "OWN_COMPANY_QUESTION",
      "GENERAL_QUESTION",
      "ACTION_PREPARATION",
    ],
    description:
      "Records the founder's answer to one of the questions Q still wants answered (read_my('questions') lists them with ids and quick answers). Call it right after they answer: with `choice` when they picked a listed quick answer, else `text` with their own words. A contradiction is settled only by their choice, never yours.",
    input: AnswerTool,
    references: {},
    eval: {
      say: [
        "Ask me what you still need to know.",
        "We have about 40 paying customers.",
      ],
      orSays: "isn't waiting|couldn't place|nothing|no questions",
    },
    toCanonical: async (tool, context, ports) => {
      const plan = await readiness(ports).read(context.actor);
      if (plan === null) return null;
      const question = plan.followUps.find(
        (item) => item.questionId === tool.questionId,
      );
      if (question === undefined) {
        return refusal("That question isn't waiting any more.");
      }
      if (tool.choice !== undefined) {
        const wanted = norm(tool.choice);
        const index = question.quickAnswers.findIndex(
          (label) => norm(label) === wanted,
        );
        if (index >= 0) {
          return {
            questionId: question.questionId,
            idempotencyKey: context.idempotencyKey,
            input: { answer: { kind: "QUICK", index } },
          };
        }
      }
      const text = tool.text ?? tool.choice;
      return text === undefined
        ? refusal("What's your answer?")
        : {
            questionId: question.questionId,
            idempotencyKey: context.idempotencyKey,
            input: { answer: { kind: "TYPED", text } },
          };
    },
  },
});

const Dismiss = z
  .object({
    questionId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
type DismissInput = z.infer<typeof Dismiss>;

const DismissTool = z
  .object({
    questionId: z
      .string()
      .uuid()
      .describe("The question's id as read_my('questions') gave it."),
  })
  .strict();

const DISMISS = defineAppAction<
  DismissInput,
  ReadinessQuestionResult | null,
  z.infer<typeof DismissTool>
>({
  name: "readiness.question.dismiss",
  short: "set Q's question aside",
  area: "readiness",
  classification: "INSTANT",
  does: "Sets one of Q's questions aside for now; nothing about their company is written, and unknown stays unknown.",
  input: Dismiss,
  output: z.custom<ReadinessQuestionResult | null>(),
  authorize: ownCompany,
  run: (ports, context, input) =>
    readiness(ports).dismissFollowUp(
      context.actor,
      input.questionId,
      input.idempotencyKey,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Set Q's question aside", preview: "" }),
  done: (out) =>
    out === null
      ? "That question isn't waiting any more."
      : "Set aside. I won't count it against you; unknown stays unknown.",
  succeeded: (out) => out !== null,
  http: {
    method: "POST",
    path: READINESS_QUESTION_DISMISS_PATH,
    fromRequest: (params, _body, headers) => ({
      questionId: params["questionId"],
      idempotencyKey: headers["idempotency-key"],
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    notFound: (out) => out === null,
    respond: (out) => ReadinessQuestionResultSchema.parse(out),
  },
  tool: {
    name: "set_aside_q_question",
    purposes: [
      "OWN_COMPANY_QUESTION",
      "GENERAL_QUESTION",
      "ACTION_PREPARATION",
    ],
    description:
      "Sets one of Q's questions aside when the founder says they don't know or not now. Nothing is written.",
    input: DismissTool,
    references: {},
    eval: {
      say: ["Skip that question for now.", "I don't know that one yet."],
      orSays: "isn't waiting",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        questionId: tool.questionId,
        idempotencyKey: context.idempotencyKey,
      }),
  },
});

export const READINESS_ACTIONS: readonly AnyAppAction[] = [
  SET_STATE,
  ANSWER,
  DISMISS,
];

// --- read_my("readiness" | "plan" | "questions") ----------------------------

const STATUS_WORDS = {
  STRONG: "strong",
  DEVELOPING: "developing",
  GAP: "gap",
  UNKNOWN: "not shared yet",
} as const;

/**
 * What the Capital page's Readiness section, its Action plan board and
 * Home's "Q still wants to know" show, as read_my items. Founder-private:
 * only ever their own company (null for anyone else).
 */
export async function readinessItems(
  ports: AppActionPorts,
  actor: ActorContext,
  kind: "readiness" | "plan" | "questions",
): Promise<readonly OwnReadItem[] | null> {
  if (ports.readiness === undefined) return null;
  const read = await ports.readiness.read(actor);
  if (read === null) return [];
  if (kind === "readiness") {
    return [
      ...read.blockers.map((blocker, index) => ({
        id: `blocker-${blocker.id}`,
        title: `Could stop the raise: ${blocker.title}`,
        status: blocker.kind.toLowerCase(),
        at: null,
        facts: {
          rank: index + 1,
          why: blocker.why.slice(0, 200),
          planStep: blocker.actionKey,
        },
      })),
      ...read.pillars.map((pillar) => ({
        id: `pillar-${pillar.pillar.toLowerCase()}`,
        title: pillar.label,
        status: STATUS_WORDS[pillar.status],
        at: read.assessedAt,
        facts: {
          summary: pillar.summary.slice(0, 200),
          evidenceOnRecord: pillar.evidence.length,
          wouldMoveIt: (pillar.improve[0] ?? "").slice(0, 200) || null,
        },
      })),
    ];
  }
  if (kind === "plan") {
    return read.actions.slice(0, 30).map((action) => ({
      id: action.key,
      title: action.title,
      status:
        action.state === "OPEN"
          ? `to do (${action.priority.toLowerCase()})`
          : action.state === "MARKED_DONE"
            ? "ticked by them"
            : "done: Q sees the evidence",
      at: action.doneAt,
      facts: {
        why: action.why.slice(0, 200),
        next: action.next.slice(0, 200),
        owner: action.ownerLabel,
        qCanHelp: action.askQ === null ? null : action.askQ.slice(0, 200),
      },
    }));
  }
  return read.followUps.slice(0, 30).map((followUp) => ({
    id: followUp.questionId,
    title: followUp.question.slice(0, 200),
    status: followUp.answerable
      ? "waiting for their answer"
      : "answered on another page",
    at: followUp.askedAt,
    facts: {
      why: followUp.why === null ? null : followUp.why.slice(0, 200),
      reason: followUp.reason.toLowerCase(),
      readings: followUp.readings.join(" | ").slice(0, 200) || null,
      quickAnswers: followUp.quickAnswers.join(" | ").slice(0, 200) || null,
      answerWith:
        followUp.typed === "NUMBER"
          ? "a figure"
          : followUp.typed === "TEXT"
            ? "their own words"
            : "one of the quick answers",
    },
  }));
}
