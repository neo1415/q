import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";
import { z } from "zod";

/**
 * A request for several kinds of work at once ("research them, write a
 * memo, have it critiqued, revise it, draft the founder questions") is a
 * job for Q's team (2026-10-12). Code asks the lead Q to plan it through
 * propose_q_job under the run's own plan -- the same tool the answer's
 * model can call -- so it is never answered as one in-run brief or read
 * as a hand-over. Nothing runs until the person approves the plan card.
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
  | { readonly status: "NOT_PLANNED" | "LIMIT_REACHED" };

export type QTeamJobPort = {
  readonly propose: (
    request: QAnswerRequest,
    goal: string,
  ) => Promise<TeamJobOutcome | null>;
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

/** Three kinds or more is a team's job; one brief is not enough for it. */
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
        if (!outcome.result.ok) return null;
        const parsed = ProposedSchema.safeParse(outcome.result.data);
        if (!parsed.success) return null;
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
        return data.status === "LIMIT_REACHED"
          ? { status: "LIMIT_REACHED" }
          : { status: "NOT_PLANNED" };
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId },
          "a team job was not planned",
        );
        return null;
      }
    },
  };
}

/** What Q says about a planned job: the plan in plain words, then what needs them. */
export function teamJobLine(outcome: TeamJobOutcome): string | null {
  if (outcome.status === "ALREADY_WAITING") {
    const first = outcome.waiting[0];
    return first === undefined
      ? null
      : `Something like this is already waiting for you: ${first}. Shall I plan this one anyway?`;
  }
  if (outcome.status !== "PREPARED" && outcome.status !== "ONE_PER_TURN") {
    return null;
  }
  const steps = outcome.plan.steps
    .slice(0, 6)
    .map((step) =>
      `${step.who} ${step.does.charAt(0).toLowerCase()}${step.does.slice(1)}`.replace(
        /\.$/u,
        "",
      ),
    )
    .join("; ");
  const needs =
    outcome.plan.needsYou.length === 0
      ? "Nothing starts until you approve the plan."
      : `Nothing starts until you approve the plan. ${outcome.plan.needsYou.join(" ")}`;
  const cannot =
    outcome.plan.cannot.length === 0
      ? ""
      : ` What the team can't do here: ${outcome.plan.cannot.join("; ")}.`;
  return `I've planned this as a job for my team: ${outcome.plan.summary.replace(/\.$/u, "")}. ${steps}.${cannot} ${needs}`;
}
