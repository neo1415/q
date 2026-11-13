import {
  Q_NAVIGATION_OFFER_LABEL_MAX,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import { waitingWork } from "./team-job.js";

/**
 * Owner 2026-10-23 (live founder.maji-loop): "help me prepare for a first
 * call with Savanna Seed Partners" was answered with a question about a
 * plan. Getting ready for a call with one named counterpart (TURN_READER
 * v58 meetingPrep, by meaning) is prepared in the answer: who they are,
 * where things stand, the questions they are likely to ask with answers
 * from the person's own record, the weak spots and the ask, then an offer
 * to rehearse it. Related work already waiting is one plain line; the
 * prep is given regardless. The port gathers only what this person may
 * see of the counterpart (their declared profile, never a private
 * mandate) before any model is called.
 */

export type CallPrep = {
  /**
   * Whose side the prep is from (owner QA O-I12): a founder meeting an
   * investor, or an investor meeting a founder. It decides the headings.
   */
  readonly viewerRole: "FOUNDER" | "INVESTOR";
  /** The counterpart as Capital Q holds the name. */
  readonly counterpartName: string;
  readonly whoTheyAre: string;
  readonly soFar: string;
  readonly questions: readonly {
    readonly question: string;
    readonly answer: string;
  }[];
  readonly weakSpots: readonly {
    readonly spot: string;
    readonly handle: string;
  }[];
  readonly ask: string;
  /** An investor's prep: what the founder will want from them. */
  readonly theyWant?: string | null | undefined;
  /** Summaries of related work already waiting for their approval. */
  readonly waiting: readonly string[];
  /**
   * The counterpart's record, when they could open it: the rehearsal is
   * offered only then, as a page they can open (live 2026-11-13: "Want to
   * rehearse it? I'll play Clinicrest." then, on "yes", "A rehearsal with
   * Clinicrest isn't available as an action here").
   */
  readonly counterpart?:
    | {
        readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
        readonly id: string;
      }
    | null
    | undefined;
};

export type QCallPrepPort = {
  /**
   * Null when the prep could not be had (no founder or investor side, or
   * the writer failed): the turn is then answered the usual way. A name
   * they cannot open is prepared from their own record and the name only.
   * Never throws, except to pass on a cancellation.
   */
  readonly prepare: (
    request: QAnswerRequest,
    input: { readonly counterpart: string; readonly said: string },
  ) => Promise<CallPrep | null>;
};

export function callPrepLine(prep: CallPrep): string {
  const sentence = (text: string) => {
    const trimmed = text.trim();
    return /[.!?…:]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
  };
  const investor = prep.viewerRole === "INVESTOR";
  const first = prep.waiting[0];
  const theyWant = prep.theyWant?.trim() ?? "";
  return [
    `**Who they are**\n${sentence(prep.whoTheyAre)}`,
    `**So far**\n${sentence(prep.soFar)}`,
    `**${investor ? "What to ask them" : "What they'll likely ask"}**\n${prep.questions
      .map(
        (item, index) =>
          `${index + 1}. ${item.question.trim()}\n   ${investor ? "Listen for: " : ""}${sentence(item.answer)}`,
      )
      .join("\n")}`,
    `**${investor ? "Red flags to test" : "Weak spots"}**\n${prep.weakSpots
      .map((item) => `- ${sentence(item.spot)} ${sentence(item.handle)}`)
      .join("\n")}`,
    ...(investor && theyWant.length > 0
      ? [`**What they'll want from you**\n${sentence(theyWant)}`]
      : []),
    `**Your ask**\n${sentence(prep.ask)}`,
    ...(first === undefined || waitingWork(first).length === 0
      ? []
      : [
          `Related work is already waiting for your approval: ${waitingWork(first)}.`,
        ]),
    ...(rehearsalOffer(prep) === null
      ? []
      : [`Want to rehearse it? I'll play ${prep.counterpartName.trim()}.`]),
  ].join("\n\n");
}

/**
 * The rehearsal offered as the page that holds it (the rehearsal lobby for
 * that company or investor), so "yes" opens it through the offer-reply
 * path (N1) like any other offered page, and the Open button works on its
 * own. Null when the counterpart is not a record they can open: then no
 * rehearsal is offered at all, since one could not be started.
 */
export function rehearsalOffer(prep: CallPrep): QResultBlock | null {
  const counterpart = prep.counterpart ?? null;
  if (counterpart === null) return null;
  const name = prep.counterpartName.trim();
  const fit = (prefix: string) =>
    `${prefix}${name}`.length <= Q_NAVIGATION_OFFER_LABEL_MAX
      ? `${prefix}${name}`
      : `${prefix}${name.slice(0, Q_NAVIGATION_OFFER_LABEL_MAX - prefix.length - 1)}…`;
  return {
    kind: "NAVIGATION_OFFER",
    intent: {
      kind: "OPEN_RECORD_PAGE",
      page:
        counterpart.kind === "COMPANY"
          ? "COMPANY_REHEARSAL"
          : "INVESTOR_REHEARSAL",
      id: counterpart.id,
    },
    place: fit("a rehearsal with "),
    openLabel: fit("Rehearse with "),
  };
}
