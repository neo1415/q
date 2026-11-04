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
  /**
   * Owner 2026-11-04: the plan Q just offered, read back in code's words
   * from the stored version (a short summary, or every step), as the
   * person; null when it is not theirs or not there. Absent: not offered.
   */
  readonly readOffered?:
    | ((
        request: QAnswerRequest,
        input: {
          readonly planId: string;
          readonly version: number;
          readonly part: QPlanReadPart;
        },
      ) => Promise<string | null>)
    | undefined;
};

/** What of an offered plan the person asked to hear. */
export type QPlanReadPart = "SUMMARY" | "WHOLE";

/**
 * Owner 2026-11-04: "when the plan finishes ... it should offer a summary,
 * or to read the whole thing, or to just go ahead and execute the whole
 * thing and give updates". Code's own copy closing the plan-ready message
 * (and the choices under it), so the reply to it is read by code: the last
 * choice is plain approval words ("go ahead"), decided by the waiting
 * card's own path (pending-decision.ts), bound to that exact version.
 */
export const PLAN_OFFER_QUESTION =
  "Would you like a short summary, the whole plan read out, or shall I run it now and keep you posted? Pick one below, or tell me to go ahead.";
/**
 * The same offer when no execute card could be prepared: nothing would
 * take a "go ahead", so running it is the plan card's own Execute.
 */
export const PLAN_OFFER_WITHOUT_CARD =
  "Would you like a short summary or the whole plan read out? To run it, press Execute on the plan; you can also put it on your board, or tell me what to change.";

/**
 * The line closing a plan read back by code: still the same offer, so the
 * next choice ("the whole plan", "okay") is read as its answer too.
 */
export const PLAN_READ_CLOSE =
  "Want me to run it? Tell me to go ahead and I'll start, telling you here as each step lands; anything that goes out to someone still comes to you first.";
export const PLAN_OFFER_SUMMARY = "Give me a short summary";
export const PLAN_OFFER_WHOLE = "Read me the whole plan";
export const PLAN_OFFER_RUN = "Go ahead and run it";
export const PLAN_OFFER_OPTIONS = [
  PLAN_OFFER_SUMMARY,
  PLAN_OFFER_WHOLE,
  PLAN_OFFER_RUN,
] as const;

const SUMMARY_WORDS =
  /\b(?:summary|summarise|summarize|summarised|summarized|short version|brief(?:ly)?|overview|gist|highlights)\b/iu;
const WHOLE_WORDS =
  /\b(?:whole|full|entire|every step|all (?:the )?steps|all of it|read (?:it|the plan|me the plan|it out|it all|them))\b/iu;

/**
 * Which part of the offered plan the words ask to hear, by code: only
 * straight after Q's own offer (the caller checks), and only words about
 * hearing the plan. Anything that also decides ("go ahead", "no") or asks
 * for a change is left to the waiting card's path and the readings.
 */
export function readPlanChoice(words: string): QPlanReadPart | null {
  const said = words.trim();
  if (said.length === 0 || said.length > 160) return null;
  if (
    /\b(?:go ahead|run|execute|start|approve|cancel|change|instead|but|don't|no)\b/iu.test(
      said,
    )
  ) {
    return null;
  }
  if (said.toLowerCase() === PLAN_OFFER_SUMMARY.toLowerCase()) return "SUMMARY";
  if (said.toLowerCase() === PLAN_OFFER_WHOLE.toLowerCase()) return "WHOLE";
  if (WHOLE_WORDS.test(said)) return "WHOLE";
  if (SUMMARY_WORDS.test(said)) return "SUMMARY";
  return null;
}

/**
 * The plan Q offered with code's own copy since the person last spoke (the
 * offer is followed by its execute card's own lines), and the part their
 * words ask to hear; null when Q made no such offer since, or the words
 * ask something else.
 */
export function offeredPlanChoice(
  history: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
    readonly blocks?: readonly { readonly kind: string }[] | undefined;
  }[],
  latest: { readonly id: string; readonly content: string },
): {
  readonly planId: string;
  readonly version: number;
  readonly part: QPlanReadPart;
} | null {
  const before = history.filter((message) => message.id !== latest.id);
  const lastQ = before.findLast((message) => message.role === "Q");
  // Straight after the offer (and its card's lines), or after a plan read
  // back by code, which closes on the same offer.
  const readBack = lastQ?.content.includes(PLAN_READ_CLOSE) === true;
  const lastTheirs = before.findLastIndex((message) => message.role === "USER");
  const offer = (readBack ? before : before.slice(lastTheirs + 1)).findLast(
    (message) =>
      message.role === "Q" &&
      (message.content.includes(PLAN_OFFER_QUESTION) ||
        message.content.includes(PLAN_OFFER_WITHOUT_CARD)),
  );
  if (offer === undefined) return null;
  const plan = (offer.blocks ?? []).find(
    (block): block is { kind: "PLAN"; planId: string; version: number } =>
      block.kind === "PLAN" &&
      typeof (block as { planId?: unknown }).planId === "string" &&
      typeof (block as { version?: unknown }).version === "number",
  );
  if (plan === undefined) return null;
  const part = readPlanChoice(latest.content);
  return part === null
    ? null
    : { planId: plan.planId, version: plan.version, part };
}

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
