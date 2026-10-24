import type { QResultBlock } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";
import { z } from "zod";

/**
 * Work handed to Q's team (2026-10-12). The turn reader says so from
 * meaning (TURN_READER v49 teamJob: "get your team to investigate
 * Ledgerfold and prepare me for a meeting"); a sentence naming three kinds
 * of work is a deterministic fast path for the same decision. Code asks
 * the lead Q to plan it through propose_q_job under the run's own plan --
 * the same tool the answer's model can call, the one orchestration -- so
 * it is never answered as one in-run brief or read as a hand-over.
 * Nothing runs until the person approves the plan card, and a plan that
 * could not be made is said plainly: never covered by an ordinary answer
 * that looks like the work was done.
 */

export type TeamJobPlan = {
  readonly summary: string;
  readonly steps: readonly { readonly who: string; readonly does: string }[];
  readonly needsYou: readonly string[];
  readonly cannot: readonly string[];
};

export type TeamJobOutcome =
  | { readonly status: "PREPARED" | "ONE_PER_TURN"; readonly plan: TeamJobPlan }
  /** Owner 2026-10-23: their own deep work, under way with no card. */
  | {
      readonly status: "STARTED";
      readonly plan: TeamJobPlan;
      readonly firstRead: string | null;
      /** The started job: the reply's card follows it as it is made. */
      readonly jobId?: string | undefined;
    }
  | { readonly status: "ALREADY_WAITING"; readonly waiting: readonly string[] }
  | { readonly status: "NOT_PLANNED" | "LIMIT_REACHED" }
  /** This run may not hand work to the team (not offered, or not authorised). */
  | { readonly status: "UNAVAILABLE" }
  /** Planning broke: an error, or output that did not validate. */
  | { readonly status: "FAILED" };

export type QTeamJobPort = {
  /** Never throws, except to pass on a cancellation. */
  readonly propose: (
    request: QAnswerRequest,
    goal: string,
    options?: {
      /** They heard what was already waiting and said to go ahead (R5). */
      readonly proceed: boolean;
    },
  ) => Promise<TeamJobOutcome>;
};

// Assessing and naming risks are one kind: "what are the risks? a brief
// assessment" is a question for Q, not a team job.
const KINDS: readonly RegExp[] = [
  /\bresearch/u,
  /\b(assess|evaluat|analy[sz]|risks?\b|missing information|red flags)/u,
  /\b(memo|brief|report|one-pager|write-?up)\b/u,
  /\b(critique|critic|second opinion|review it|second specialist)/u,
  /\b(revise|revision|rewrite)/u,
  /\b(diligence|questions for the founder|founder questions)/u,
];

// The tool's output is checked again here: it crosses a package boundary.
const ProposedSchema = z.object({
  firstRead: z.string().max(700).nullable().optional(),
  jobId: z.string().uuid().optional(),
  status: z.enum([
    "PREPARED",
    "STARTED",
    "ONE_PER_TURN",
    "NOT_PLANNED",
    "LIMIT_REACHED",
    "ALREADY_WAITING",
    "FAILED",
  ]),
  plan: z
    .object({
      summary: z.string(),
      steps: z.array(z.object({ who: z.string(), does: z.string() })),
      cannot: z.array(z.string()),
      needsYou: z.array(z.string()),
    })
    .nullable()
    .optional(),
  waiting: z.array(z.string()).optional(),
});

/** How many distinct kinds of work the words ask for. */
export function workKindsAsked(text: string): number {
  const said = text.toLowerCase();
  return KINDS.filter((kind) => kind.test(said)).length;
}

/**
 * Three kinds or more is a team's job; one brief is not enough for it. A
 * fast path only: the reading (teamJob) decides the rest, in any words.
 */
export const TEAM_JOB_KINDS = 3;

export function createToolTeamJobPort(dependencies: {
  readonly tools: QToolPort;
  readonly logger?: Logger | undefined;
}): QTeamJobPort {
  return {
    propose: async (request, goal, options) => {
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: "q-team-job",
            name: "propose_q_job",
            arguments: {
              goal: goal.trim().slice(0, 1_000),
              proceed: options?.proceed === true,
            },
          },
          {
            actor: request.actor,
            runId: request.runId,
            correlationId: request.correlationId,
            capability: request.capability,
            plan: request.plan,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (!outcome.result.ok) {
          dependencies.logger?.warn(
            { qRunId: request.runId, code: outcome.failureCode },
            "a team job was not planned",
          );
          return {
            status: outcome.status === "DENIED" ? "UNAVAILABLE" : "FAILED",
          };
        }
        const parsed = ProposedSchema.safeParse(outcome.result.data);
        if (!parsed.success) return { status: "FAILED" };
        const data = parsed.data;
        if (data.status === "STARTED" && data.plan != null) {
          return {
            status: "STARTED",
            plan: data.plan,
            firstRead: data.firstRead ?? null,
            ...(data.jobId === undefined ? {} : { jobId: data.jobId }),
          };
        }
        if (
          (data.status === "PREPARED" || data.status === "ONE_PER_TURN") &&
          data.plan != null
        ) {
          return { status: data.status, plan: data.plan };
        }
        if (data.status === "ALREADY_WAITING") {
          return { status: "ALREADY_WAITING", waiting: data.waiting ?? [] };
        }
        return data.status === "LIMIT_REACHED" || data.status === "FAILED"
          ? { status: data.status }
          : { status: "NOT_PLANNED" };
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId },
          "a team job was not planned",
        );
        return { status: "FAILED" };
      }
    },
  };
}

/**
 * The question Q ends an ALREADY_WAITING line with. The next turn's reply
 * is matched against Q's own earlier line by this exact text, so a
 * go-ahead re-plans the goal they first gave (see goAheadGoal).
 */
export const PLAN_ANYWAY_QUESTION = "Shall I plan this one anyway?";

/**
 * Live 2026-10-12: Q asked "Shall I plan this one anyway?", the investor
 * said "Yes, plan this one anyway." and Q tried to plan those words, so
 * nothing could be planned. When Q's last turn asked that question and
 * this turn, read as work for the team, names no work of its own, it is
 * the go-ahead for the goal they gave just before: that goal is planned
 * with proceed. A turn that names work of its own is a new goal; one not
 * read as team work (a no, a question) is answered as any other turn.
 * Deterministic: Q's own stored line and their stored words, no model.
 */
export function goAheadGoal(
  history: readonly { readonly role: string; readonly content: string }[],
  latest: string,
): string | null {
  if (workKindsAsked(latest) > 0) return null;
  const before = history.at(-2);
  const asked = history.at(-3);
  if (before === undefined || asked === undefined) return null;
  if (before.role === "USER" || !before.content.endsWith(PLAN_ANYWAY_QUESTION))
    return null;
  if (asked.role !== "USER") return null;
  const goal = asked.content.trim();
  return goal.length >= 3 ? goal : null;
}

/**
 * A waiting job's card summary in a sentence of Q's: never an internal
 * name ("Q's team:" is how the card labels it, live 2026-10-23), and never
 * its own end punctuation, so the line has one full stop.
 */
export function waitingWork(summary: string): string {
  return summary
    .trim()
    .replace(/^Q['’]s team:\s*/iu, "")
    .replace(/[.!?…]+$/u, "")
    .trim();
}

/**
 * QO-07 (owner QA 2026-10-23): "Write me a 12-month plan" ... "yes". When
 * the reader says this turn hands over work asked for or offered just
 * before (TURN_READER v61 workFromEarlier), the job's goal is the person's
 * own last request before Q's reply, with this turn after it: their words
 * only, so nothing a model wrote becomes the job (or a research query).
 */
export function earlierRequestGoal(
  history: readonly { readonly role: string; readonly content: string }[],
  latest: string,
): string | null {
  // history ends with this turn; look before it for their last request.
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== "USER") continue;
    const asked = turn.content.trim();
    if (asked.length < 3) return null;
    return `${asked}\n${latest.trim()}`.slice(0, 1_000);
  }
  return null;
}

const ANSWER_HERE =
  "I can answer it here from what Capital Q holds instead, if that helps.";

/**
 * Which outcome a line of Q's own came from, when teamJobLine wrote it:
 * read back from the openings this file writes (a round trip the tests
 * hold for every status), never from what a person said. The board reads
 * it (F-78b, live 9ff4a1118): after a plan that failed or never started,
 * "save that plan to my board" saves nothing.
 */
export function teamJobOutcomeOf(
  content: string,
): TeamJobOutcome["status"] | null {
  const said = content.trimStart();
  if (
    said.startsWith("On it. Starting now") ||
    said.startsWith("On it, starting now")
  ) {
    return "STARTED";
  }
  if (
    said.startsWith("Work like this is already waiting for your approval") ||
    (said.startsWith("Something like this is already waiting for you") &&
      said.includes(PLAN_ANYWAY_QUESTION))
  ) {
    return "ALREADY_WAITING";
  }
  if (said.startsWith("I couldn't turn that into a plan I can carry out")) {
    return "NOT_PLANNED";
  }
  if (said.startsWith("I've reached the limit of work I can take on")) {
    return "LIMIT_REACHED";
  }
  if (said.startsWith("Taking on work like this isn't available")) {
    return "UNAVAILABLE";
  }
  if (said.startsWith("I couldn't plan this just now")) return "FAILED";
  return null;
}

/**
 * What Q says about the job: the plan in plain words and what needs them,
 * or, when nothing was planned, that nothing started and what they can do.
 */
export function teamJobLine(outcome: TeamJobOutcome): string {
  switch (outcome.status) {
    case "ALREADY_WAITING": {
      const first = outcome.waiting[0];
      return first === undefined
        ? `Work like this is already waiting for your approval, so I haven't planned another. ${PLAN_ANYWAY_QUESTION}`
        : `Something like this is already waiting for you: ${waitingWork(first)}. ${PLAN_ANYWAY_QUESTION}`;
    }
    case "NOT_PLANNED":
      return `I couldn't turn that into a plan I can carry out, so nothing has started. Tell me who it's about and what you want at the end (a memo, a growth plan, questions for the founder) and I'll plan it. ${ANSWER_HERE}`;
    case "LIMIT_REACHED":
      return `I've reached the limit of work I can take on for you right now, so I haven't started this one. It can start once a running piece of work finishes. ${ANSWER_HERE}`;
    case "UNAVAILABLE":
      return `Taking on work like this isn't available on your account here, so nothing has started. ${ANSWER_HERE}`;
    case "FAILED":
      return `I couldn't plan this just now: something failed on my side, and nothing has started. Ask me again in a moment. ${ANSWER_HERE}`;
    case "STARTED":
      return startedLine(outcome.plan, outcome.firstRead);
    case "PREPARED":
    case "ONE_PER_TURN":
      break;
  }
  // The engine narrates the card itself (its summary, and that nothing is
  // saved until approved); this line only leads into it, briefly: who does
  // what, in order. The full plan, its limits and its budget are the card.
  const who: string[] = [];
  for (const step of outcome.plan.steps) {
    if (who.at(-1) !== step.who) who.push(step.who);
  }
  const needs = outcome.plan.needsYou.filter(
    (need) => !/\bapprov(e|al)\b.*\bplan\b|\bplan\b.*\bapprov/iu.test(need),
  );
  const steps = `${String(outcome.plan.steps.length)} ${outcome.plan.steps.length === 1 ? "step" : "steps"}`;
  return [
    `I've planned this in ${steps}: ${who.join(" → ")}.`,
    ...needs.map((need) => `${need.replace(/\.$/u, "")}.`),
  ].join(" ");
}

/**
 * Owner 2026-10-24: own deep work under way is a card that follows the job
 * as the document is made (its stage read from the job as the person), in
 * the plan's own words until the document has a title. Code's, never a
 * model's.
 */
export function teamJobBlocks(
  outcome: TeamJobOutcome,
): readonly QResultBlock[] | undefined {
  if (outcome.status !== "STARTED" || outcome.jobId === undefined)
    return undefined;
  const title = outcome.plan.summary.trim().replace(/[.\s]+$/u, "");
  return [
    {
      kind: "WORK_IN_PROGRESS",
      jobId: outcome.jobId,
      title: title.length === 0 ? "Your document" : title.slice(0, 160),
    },
  ];
}

/**
 * Owner 2026-10-23: own deep work under way. Q says what it is doing in
 * the plan's own words, that the result comes back here, and its first
 * read meanwhile. No card, no internal names: one Q.
 */
function startedLine(plan: TeamJobPlan, firstRead: string | null): string {
  const doing = plan.summary.trim().replace(/[.\s]+$/u, "");
  const lead =
    doing.length === 0
      ? "On it, starting now."
      : `On it. Starting now: ${doing.charAt(0).toLowerCase()}${doing.slice(1)}.`;
  return [
    lead,
    "It will be ready in a few minutes and I'll bring it back to this conversation; you can carry on with anything else meanwhile.",
    ...(firstRead === null || firstRead.trim().length === 0
      ? []
      : [`My first read, before the research is in: ${firstRead.trim()}`]),
  ].join(" ");
}
