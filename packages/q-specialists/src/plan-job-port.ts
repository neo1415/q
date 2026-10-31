import type { QAnswerRequest } from "@capital-q/q-runtime";

/**
 * Situation-first planning (S5, S6): the answer's port to the plan job.
 *
 * The turn reader decides meaning (TURN_READER v70 planAsk, directsWork);
 * this port only carries the decision. A plan of the person's own starts
 * at once and the reply says so with the card that follows it; their
 * words to running work are filed as direction. The subject (their
 * company or mandate) is resolved by the composition from the actor,
 * never asked.
 */

/** TURN_READER v70's planAsk, as the answer reads it. */
export type QPlanAskReading = {
  readonly kind: "IMPROVE" | "GOAL" | "UPLOADED" | "NONE";
  readonly research: "NONE" | "MARKET" | "SELF" | "BOTH";
  readonly side: "FOUNDER" | "INVESTOR" | null;
  readonly subject: "OWN" | "NAMED";
  readonly deliverable: "PLAN" | "DOCUMENT_REVIEW" | "ANALYSIS" | "DOCUMENT";
};

export type QPlanStartOutcome =
  | {
      readonly status: "STARTED";
      readonly jobId: string;
      readonly title: string;
      /** What Q is starting, in one line (code's words). */
      readonly line: string;
    }
  /** Not their own to plan (a company they named, no company or mandate). */
  | { readonly status: "NOT_OWN" }
  | { readonly status: "PLAN_LIMIT"; readonly message: string | null }
  | { readonly status: "FAILED" };

export type QPlanJobPort = {
  readonly start: (
    request: QAnswerRequest,
    input: {
      readonly ask: string;
      readonly planAsk: QPlanAskReading;
      /**
       * The words the plan's title quotes ("Your plan: …"); absent: the
       * ask; null: none ("Your plan"). Live 2026-10-31: a reply to Q's
       * plan offer is never what the title quotes.
       */
      readonly quote?: string | null | undefined;
    },
  ) => Promise<QPlanStartOutcome>;
  /** Their words to work under way; NONE when nothing of theirs runs. */
  readonly direct?:
    | ((
        request: QAnswerRequest,
        text: string,
      ) => Promise<{ readonly status: "NOTED" | "NONE" }>)
    | undefined;
};

/**
 * Whether the reading asks for a plan of their OWN: the deliverable is
 * steps to take. An analysis, a review of their documents (F03) or a
 * document is that work, done by the team job that writes documents --
 * never a plan whose first step is the thing asked (live 2026-10-29). Work
 * for someone they named stays with the team job too.
 */
export function planAskRoutes(planAsk: QPlanAskReading | null): boolean {
  if (planAsk === null) return false;
  if (planAsk.subject === "NAMED") return false;
  return planAsk.kind !== "NONE" && planAsk.deliverable === "PLAN";
}
