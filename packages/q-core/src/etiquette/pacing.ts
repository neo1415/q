/**
 * Q's "consider" step before an outward message (ADR 0050 §4).
 *
 * Before Q sends (or prepares) a first message, a reply or a follow-up for
 * a person, code -- not a model -- weighs the moment: what the other side
 * has said and done, how long it has been, and how many of the person's
 * messages are still unanswered. The answer is one of four, each with a
 * code the person's work page turns into plain words:
 *
 *   PROCEED    nothing about the moment argues against it;
 *   WAIT       not now: Q holds the message and says why (and until when);
 *   ASK_OWNER  a human should look first: the step becomes the person's card;
 *   SOFTEN     the wording is wrong for the moment: Q writes it again.
 *
 * A model only ever chooses words, inside the existing planner prompt with
 * the etiquette guides; whether to write at all is decided here.
 */

/** The house pacing, in one place (and quoted in the built-in guide). */
export const ETIQUETTE_PACING = {
  /** No follow-up sooner than this after the person's side last wrote. */
  followUpAfterDays: 5,
  /** Unanswered messages from the person's side before Q stops and asks. */
  maxUnanswered: 2,
} as const;

const DAY_MS = 86_400_000;

export type OutreachKind = "FIRST" | "FOLLOW_UP" | "REPLY";

export type OutreachMoment = {
  readonly now: Date;
  readonly kind: OutreachKind;
  /** The message asks for a call, a meeting or their time. */
  readonly asksMeeting: boolean;
  /** Whether the other side has ever written in this conversation. */
  readonly theyHaveWritten: boolean;
  /** When the person's side last wrote; null when never or unknown. */
  readonly lastFromUsAt: Date | null;
  /** The person's side's messages since the other side last wrote. */
  readonly unansweredFromUs: number;
  /** They said no, not now, or to stop. */
  readonly declined: boolean;
  /** Their latest message read as unhappy. */
  readonly negativeTone: boolean;
  /** The person allowed follow-ups. */
  readonly followUpsAllowed: boolean;
  /** Messages to them already passed in this sitting (batching). */
  readonly alreadyThisSitting: number;
};

export type OutreachConsideration =
  | { readonly decision: "PROCEED" }
  | {
      readonly decision: "WAIT";
      readonly code: "ONE_AT_A_TIME" | "TOO_SOON_TO_FOLLOW_UP";
      /** When the moment comes; null when it is their reply that unlocks it. */
      readonly until: Date | null;
    }
  | {
      readonly decision: "ASK_OWNER";
      readonly code: "AFTER_DECLINE" | "UNANSWERED" | "THEY_SOUND_UNHAPPY";
    }
  | { readonly decision: "SOFTEN"; readonly code: "MEETING_BEFORE_RAPPORT" };

export function considerOutreach(
  moment: OutreachMoment,
): OutreachConsideration {
  // One message to a person per sitting: a second one in the same breath
  // reads as a machine.
  if (moment.alreadyThisSitting > 0) {
    return { decision: "WAIT", code: "ONE_AT_A_TIME", until: null };
  }
  // "No" and "not now" are respected: nothing goes without the person.
  if (moment.declined) {
    return { decision: "ASK_OWNER", code: "AFTER_DECLINE" };
  }
  if (moment.kind === "FOLLOW_UP") {
    if (moment.unansweredFromUs >= ETIQUETTE_PACING.maxUnanswered) {
      return { decision: "ASK_OWNER", code: "UNANSWERED" };
    }
    if (moment.lastFromUsAt !== null) {
      const until = new Date(
        moment.lastFromUsAt.getTime() +
          ETIQUETTE_PACING.followUpAfterDays * DAY_MS,
      );
      if (moment.now.getTime() < until.getTime()) {
        return { decision: "WAIT", code: "TOO_SOON_TO_FOLLOW_UP", until };
      }
    }
  }
  if (moment.kind === "REPLY" && moment.negativeTone) {
    return { decision: "ASK_OWNER", code: "THEY_SOUND_UNHAPPY" };
  }
  // Warmth before asks: no meeting request before they have written back.
  if (moment.asksMeeting && !moment.theyHaveWritten) {
    return { decision: "SOFTEN", code: "MEETING_BEFORE_RAPPORT" };
  }
  return { decision: "PROCEED" };
}

function day(at: Date, timeZone: string | undefined): string {
  try {
    return at.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(timeZone === undefined ? {} : { timeZone }),
    });
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Why Q held back, in the person's words: the reason the work page shows
 * beside the step. Fixed sentences filled by code; never a model's words.
 */
export function considerationReason(
  consideration: Exclude<OutreachConsideration, { decision: "PROCEED" }>,
  options: {
    readonly lastFromUsAt?: Date | null | undefined;
    readonly timeZone?: string | undefined;
  } = {},
): string {
  switch (consideration.code) {
    case "ONE_AT_A_TIME":
      return "one message to them at a time; the next waits for their reply";
    case "TOO_SOON_TO_FOLLOW_UP": {
      const since =
        options.lastFromUsAt === null || options.lastFromUsAt === undefined
          ? "recently"
          : `on ${day(options.lastFromUsAt, options.timeZone)}`;
      const from =
        consideration.until === null
          ? "after a few days"
          : `from ${day(consideration.until, options.timeZone)}`;
      return `your side wrote ${since} and they haven't replied yet; a gentle follow-up can go ${from}`;
    }
    case "AFTER_DECLINE":
      return "they said no or not now, so nothing goes to them unless you say so";
    case "UNANSWERED":
      return `they haven't answered ${String(ETIQUETTE_PACING.maxUnanswered)} messages; another would feel like pressure`;
    case "THEY_SOUND_UNHAPPY":
      return "they sounded unhappy, so you should see the reply before it goes";
    case "MEETING_BEFORE_RAPPORT":
      return "it asked for a meeting before they've written back";
  }
}
