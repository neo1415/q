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
  status: z.enum([
    "PREPARED",
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
    propose: async (request, goal) => {
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: "q-team-job",
            name: "propose_q_job",
            arguments: { goal: goal.trim().slice(0, 1_000), proceed: false },
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

const ANSWER_HERE =
  "I can answer it here from what Capital Q holds instead, if that helps.";

/**
 * What Q says about the job: the plan in plain words and what needs them,
 * or, when nothing was planned, that nothing started and what they can do.
 */
export function teamJobLine(outcome: TeamJobOutcome): string {
  switch (outcome.status) {
    case "ALREADY_WAITING": {
      const first = outcome.waiting[0];
      return first === undefined
        ? "Work like this is already waiting for your approval, so I haven't planned another. Shall I plan this one anyway?"
        : `Something like this is already waiting for you: ${first}. Shall I plan this one anyway?`;
    }
    case "NOT_PLANNED":
      return `I couldn't turn that into a plan my team can carry out, so nothing has started. Tell me who it's about and what you want at the end (a memo, a meeting brief, questions for the founder) and I'll plan it. ${ANSWER_HERE}`;
    case "LIMIT_REACHED":
      return `My team has reached its limit of jobs for now, so I haven't started this one. It can be planned once a running job finishes. ${ANSWER_HERE}`;
    case "UNAVAILABLE":
      return `Handing work to my team isn't available on your account here, so nothing has started. ${ANSWER_HERE}`;
    case "FAILED":
      return `I couldn't plan this for my team just now: something failed on my side, and nothing has started. Ask me again in a moment. ${ANSWER_HERE}`;
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
    `I've planned this as a job for my team: ${steps}, ${who.join(" → ")}.`,
    ...needs.map((need) => `${need.replace(/\.$/u, "")}.`),
  ].join(" ");
}
