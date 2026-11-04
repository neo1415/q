import type { QAnswerRequest } from "@capital-q/q-runtime";
import { readApprovalWords } from "@capital-q/q-tools";

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
  /**
   * Live 2026-11-04 ("okay" started a new plan called "okay"): a plain yes
   * straight after Q's own offer runs exactly the offered version, through
   * its waiting execute card (decision 55: a typed or spoken yes may
   * approve q.plan.execute). Absent: words never run a plan here.
   */
  readonly runOffered?:
    | ((
        request: QAnswerRequest,
        input: {
          readonly planId: string;
          readonly version: number;
          /** Their message that is the approval. */
          readonly evidenceRef: string;
          readonly channel: "TEXT" | "VOICE";
        },
      ) => Promise<QPlanRunOutcome>)
    | undefined;
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

/**
 * Live 2026-11-04: what running an offered plan by their words did. STARTED:
 * the waiting execute card for that exact version was approved as them
 * (their message is the evidence) and the plan runs; RUNNING: it already
 * runs; WAITING: approved but not started (it still waits, said so);
 * NONE: not theirs, not the newest version, or no card -- answered as any
 * other turn.
 */
export type QPlanRunOutcome =
  | {
      readonly status: "STARTED" | "RUNNING" | "WAITING";
      readonly line: string;
    }
  | { readonly status: "NONE" };

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

type OfferHistory = readonly {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly blocks?: readonly { readonly kind: string }[] | undefined;
}[];

/**
 * The plan Q's own offer stands for, when Q made it since the person last
 * spoke (the offer is followed by its execute card's own lines), or closed
 * a plan read back by code on it; null otherwise.
 */
function standingPlanOffer(
  history: OfferHistory,
  latest: { readonly id: string },
  options: { readonly withCard?: boolean } = {},
): {
  readonly planId: string;
  readonly version: number;
  readonly title: string;
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
        (options.withCard !== true &&
          message.content.includes(PLAN_OFFER_WITHOUT_CARD))),
  );
  if (offer === undefined) return null;
  const plan = (offer.blocks ?? []).find(
    (
      block,
    ): block is {
      kind: "PLAN";
      planId: string;
      version: number;
      title?: unknown;
    } =>
      block.kind === "PLAN" &&
      typeof (block as { planId?: unknown }).planId === "string" &&
      typeof (block as { version?: unknown }).version === "number",
  );
  return plan === undefined
    ? null
    : {
        planId: plan.planId,
        version: plan.version,
        title: typeof plan.title === "string" ? plan.title : "",
      };
}

/**
 * Live 2026-11-04 (conversation 014faef1): "okay" straight after Q's offer
 * ("…or shall I run it now…? Pick one below, or tell me to go ahead.") was
 * read as handing over new work and started a plan titled "okay"; the
 * waiting execute card was never decided. A plain yes to that offer, by
 * code's own reading of approval words, is the answer to it: the offered
 * plan, by id and version. Anything that asks for a change, declines,
 * picks by number, or is not approval words is left to the readings.
 */
export function offeredPlanAccepted(
  history: OfferHistory,
  latest: { readonly id: string; readonly content: string },
): { readonly planId: string; readonly version: number } | null {
  const said = latest.content.trim();
  if (said.length === 0 || said.length > 160) return null;
  // Only the offer that has a card to decide ("tell me to go ahead").
  const plan = standingPlanOffer(history, latest, { withCard: true });
  if (plan === null) return null;
  // Read against the card's own summary, as the waiting card's path reads
  // it ("Go ahead and run it" names running it).
  const words = readApprovalWords(said, {
    summaries: [`Run your plan: ${plan.title}`],
  });
  if (words.kind !== "APPROVE" || words.ordinal !== null) return null;
  return { planId: plan.planId, version: plan.version };
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
  const plan = standingPlanOffer(history, latest);
  if (plan === null) return null;
  const part = readPlanChoice(latest.content);
  return part === null
    ? null
    : { planId: plan.planId, version: plan.version, part };
}

/**
 * Whether the reading asks for a plan of their OWN: the deliverable is
 * steps to take. An analysis, a review of their documents (F03) or a
 * document is that work, done by the team job that writes documents --
 * never a plan whose first step is the thing asked (live 2026-10-29).
 *
 * live5 (2026-11-04, 390): "Make me a plan to check Ledgerline's unit
 * economics this week" names a company, was read NAMED and became a
 * research job with no plan. An investor's plan for their own work on a
 * company they name (diligence, a follow-up, its numbers) is theirs, made
 * from their mandate and pipeline, so it is offered to the plan job,
 * which decides from the actor's real side (a founder's plan for another
 * company is NOT_OWN there and falls through to the team job as before).
 * Only a reading that says it is a founder's stays with the team job.
 */
export function planAskRoutes(planAsk: QPlanAskReading | null): boolean {
  if (planAsk === null) return false;
  if (planAsk.subject === "NAMED" && planAsk.side === "FOUNDER") return false;
  return planAsk.kind !== "NONE" && planAsk.deliverable === "PLAN";
}
