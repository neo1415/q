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
   * Live recheck 651a3bd50 T5: the meetings with them as the meetings read
   * model holds them, by status (ISO start times). A cancelled meeting is
   * never presented as booked; a time named in their messages is not a
   * booking. Absent: no relationship to read meetings for.
   */
  readonly meetings?:
    | {
        readonly booked: readonly string[];
        readonly cancelled: readonly string[];
      }
    | undefined;
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

/**
 * RC4 (voice audit 15 Nov 2026, F7-04): "if you were preparing me for an
 * investor meeting…" was briefed as a call with QInvest, an investor with
 * no relationship or meeting on record. A counterpart said only by its role
 * ("an investor", "the VC") is resolved from the person's own meetings and
 * relationships: one is prepared, several are asked about by name, and none
 * is said, never an unrelated record that happens to match the word.
 */
export type CallPrepUnresolved =
  | { readonly kind: "WHICH"; readonly options: readonly string[] }
  | { readonly kind: "NONE"; readonly role: "INVESTOR" | "FOUNDER" };

export function isCallPrepUnresolved(
  value: CallPrep | CallPrepUnresolved,
): value is CallPrepUnresolved {
  return "kind" in value;
}

/** What Q says when the counterpart is not one record. */
export function callPrepUnresolvedLine(unresolved: CallPrepUnresolved): string {
  if (unresolved.kind === "NONE") {
    return unresolved.role === "INVESTOR"
      ? "You have no meeting booked with an investor, and no investor you're connected with yet, so there's no one meeting to brief you on. Here's how I'd prepare in general."
      : "You have no meeting booked with a founder, and no company you're connected with yet, so there's no one meeting to brief you on. Here's how I'd prepare in general.";
  }
  const names = unresolved.options.slice(0, 5);
  const last = names.pop() ?? "";
  const list = names.length === 0 ? last : `${names.join(", ")} or ${last}`;
  return `Which one should I prepare you for: ${list}?`;
}

export type QCallPrepPort = {
  /**
   * Null when the prep could not be had (no founder or investor side, or
   * the writer failed): the turn is then answered the usual way. A name
   * they cannot open is prepared from their own record and the name only.
   * A counterpart said only by its role resolves among their own meetings
   * and relationships, or comes back unresolved (WHICH or NONE).
   * Never throws, except to pass on a cancellation.
   */
  readonly prepare: (
    request: QAnswerRequest,
    input: { readonly counterpart: string; readonly said: string },
  ) => Promise<CallPrep | CallPrepUnresolved | null>;
  /**
   * Decision 98 (live recheck 651a3bd50 T5): whether a meeting with the
   * counterpart they named (or, for a role, any of theirs on that side) is
   * booked -- scheduled, not cancelled -- in the meetings read model. Null
   * when it cannot be told. No model is called.
   */
  readonly bookedWith?:
    | ((
        request: QAnswerRequest,
        counterpart: string,
      ) => Promise<boolean | null>)
    | undefined;
};

const MEETING_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function daysOf(isoTimes: readonly string[]): string[] {
  const days = isoTimes
    .map((iso) => new Date(iso))
    .filter((at) => !Number.isNaN(at.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())
    .map((at) => MEETING_DAY.format(at));
  return [...new Set(days)];
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/**
 * With no meeting booked, what the meetings read model holds, said by code:
 * "No meeting is booked with Watchly; the calls on 17 Nov and 19 Nov were
 * cancelled." Null when a meeting is booked or nothing is known.
 */
export function meetingStatusLine(prep: CallPrep): string | null {
  const meetings = prep.meetings;
  if (meetings === undefined || meetings.booked.length > 0) return null;
  const name = prep.counterpartName.trim();
  const cancelled = daysOf(meetings.cancelled);
  if (cancelled.length === 0) return `No meeting is booked with ${name} yet.`;
  return cancelled.length === 1
    ? `No meeting is booked with ${name}; the call on ${cancelled[0] ?? ""} was cancelled.`
    : `No meeting is booked with ${name}; the calls on ${listed(cancelled)} were cancelled.`;
}

/** A sentence that presents a meeting, call or slot as booked or pending. */
const MEETING_CLAIM =
  /\b(?:call|meeting|slot|session|catch-?up|intro(?:duction)?)s?\b[^.!?\n]*\b(?:booked|scheduled|confirmed|arranged|set\s+(?:up\s+)?for|planned|lined\s+up|proposed|pending|upcoming|coming\s+up)\b|\b(?:booked|scheduled|confirmed|arranged|proposed|upcoming)\b[^.!?\n]*\b(?:call|meeting|slot|session|catch-?up)s?\b/iu;

/**
 * With no meeting booked, every sentence of the writer's text that presents
 * one as booked or pending is left out (the meetings read model is the
 * source of meeting facts, never the correspondence).
 */
export function withoutBookingClaims(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !MEETING_CLAIM.test(sentence))
    .join(" ")
    .trim();
}

export function callPrepLine(prep: CallPrep): string {
  const sentence = (text: string) => {
    const trimmed = text.trim();
    return /[.!?…:]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
  };
  const investor = prep.viewerRole === "INVESTOR";
  const first = prep.waiting[0];
  const theyWant = prep.theyWant?.trim() ?? "";
  // Live recheck 651a3bd50 T5: meeting facts come from the meetings read
  // model with their status, said by code; the writer's own wording of a
  // booking is left out when none is booked.
  const meetingLine = meetingStatusLine(prep);
  const whoTheyAre =
    meetingLine === null
      ? prep.whoTheyAre
      : withoutBookingClaims(prep.whoTheyAre);
  const soFar =
    meetingLine === null ? prep.soFar : withoutBookingClaims(prep.soFar);
  const soFarLines = [
    ...(meetingLine === null ? [] : [meetingLine]),
    ...(soFar.length === 0 ? [] : [sentence(soFar)]),
  ].join(" ");
  return [
    ...(whoTheyAre.length === 0
      ? []
      : [`**Who they are**\n${sentence(whoTheyAre)}`]),
    `**So far**\n${soFarLines.length === 0 ? sentence(prep.soFar) : soFarLines}`,
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
