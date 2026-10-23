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
  /** Summaries of related work already waiting for their approval. */
  readonly waiting: readonly string[];
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
  const first = prep.waiting[0];
  return [
    `**Who they are**\n${sentence(prep.whoTheyAre)}`,
    `**So far**\n${sentence(prep.soFar)}`,
    `**What they'll likely ask**\n${prep.questions
      .map(
        (item, index) =>
          `${index + 1}. ${item.question.trim()}\n   ${sentence(item.answer)}`,
      )
      .join("\n")}`,
    `**Weak spots**\n${prep.weakSpots
      .map((item) => `- ${sentence(item.spot)} ${sentence(item.handle)}`)
      .join("\n")}`,
    `**Your ask**\n${sentence(prep.ask)}`,
    ...(first === undefined || waitingWork(first).length === 0
      ? []
      : [
          `Related work is already waiting for your approval: ${waitingWork(first)}.`,
        ]),
    `Want to rehearse it? I'll play ${prep.counterpartName.trim()}.`,
  ].join("\n\n");
}
