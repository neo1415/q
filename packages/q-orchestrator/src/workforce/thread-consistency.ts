/**
 * Thread consistency (Zino, 2026-10-08): "Tensorgate asked for a meeting
 * almost immediately, then the agent was still asking if it is open to
 * connect... is there not a worker that compares the messages the agent
 * sends to what it is actually replying to?"
 *
 * Code reads what the other side's latest, still-unanswered message left
 * open -- a call or meeting offered or asked for, a document offered, a
 * question -- and checks a draft against it before the reviewer grades it
 * and before anything is sent or offered as a card. Deterministic and
 * cheap; the reviewer's RESPONDS_TO_THREAD rule is the model-checked
 * second layer for what words cannot settle (whether a question was
 * really answered).
 *
 * The asks are described to models in code's own fixed words; nothing
 * here quotes the other side, so the line is trusted where it is used.
 */

export type PendingAskKind = "MEETING" | "DOCUMENT" | "QUESTION";

export type PendingAsk = {
  readonly kind: PendingAskKind;
  /** The thing offered or asked for, by code's vocabulary ("deck"). */
  readonly thing: string | null;
};

// Tensorgate, 8 Oct: Zino's "Would you be open to connecting?" is an ask
// to meet; without "connect" here, a redraft re-asking it passed code.
const MEETING =
  /\b(?:call|calls|meeting|meet|chat|demo|walkthrough|zoom|video call|catch[- ]up|coffee|connect|connecting|\d{1,2}\s?(?:-\s?)?min(?:ute)?s?)\b/iu;
const DOCUMENT =
  /\b(deck|pitch deck|one[- ]pager|memo|data ?room|methodology|materials?|financials|financial model|case stud(?:y|ies))\b/iu;
const OFFER_OR_ASK =
  /\b(?:share|send|happy to|glad to|would you like|want|keen to|find|hop on|grab|set up|arrange|book|schedule|can we|could we|shall we|let'?s|are you free|available|availability|time to)\b/iu;

/** A question asked without a question mark ("I'd be interested to hear how"). */
const INDIRECT_QUESTION =
  /\b(?:(?:interested|keen|curious) to (?:hear|know|learn|understand)|(?:would|'d) (?:love|like) to (?:hear|know|learn|understand)|curious (?:about|how|whether|what)|tell (?:me|us) (?:more|how|what|about)|wondering (?:how|whether|what|if))\b/iu;

/** Their sentences, split on end punctuation and line breaks. */
function sentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

/**
 * What their latest unanswered message(s) leave open. Empty when they
 * wrote nothing, or nothing that asks for a response beyond courtesy.
 */
export function pendingAsks(
  theirLatest: string | null | undefined,
): readonly PendingAsk[] {
  const text = (theirLatest ?? "").trim();
  if (text.length === 0) return [];
  const asks: PendingAsk[] = [];
  const all = sentences(text);
  const offering = (sentence: string) =>
    sentence.includes("?") || OFFER_OR_ASK.test(sentence);
  if (all.some((one) => MEETING.test(one) && offering(one))) {
    asks.push({ kind: "MEETING", thing: null });
  }
  const document = all
    .filter((one) => offering(one))
    .map((one) => DOCUMENT.exec(one)?.[1]?.toLowerCase() ?? null)
    .find((thing) => thing !== null);
  if (document !== undefined && document !== null) {
    asks.push({ kind: "DOCUMENT", thing: document });
  }
  // A question that is not itself the offer ("Want the deck, or 20
  // minutes?" is the offer, already counted).
  // Tensorgate, 8 Oct: "I'd be interested to hear how those firms are
  // evaluating the gateway" asks as surely as a question mark does.
  if (
    all.some(
      (one) =>
        (one.includes("?") && !MEETING.test(one) && !DOCUMENT.test(one)) ||
        INDIRECT_QUESTION.test(one),
    )
  ) {
    asks.push({ kind: "QUESTION", thing: null });
  }
  return asks;
}

/** The asks in code's fixed words, for the reviewer and the writer. */
export function asksLine(asks: readonly PendingAsk[]): string {
  if (asks.length === 0) return "None.";
  return asks
    .map((ask) =>
      ask.kind === "MEETING"
        ? "They offered or asked for a call or a meeting."
        : ask.kind === "DOCUMENT"
          ? `They offered to send a document (${ask.thing ?? "a document"}).`
          : "They asked a question that needs an answer.",
    )
    .join(" ");
}

/** Asking whether they will connect, after they already offered to meet. */
const RE_ASK_CONNECT =
  /\b(?:open to (?:connect(?:ing)?|a (?:call|chat|conversation|meeting)|chat(?:ting)?|speak(?:ing)?|talk(?:ing)?|meet(?:ing)?)|interested in (?:connecting|a call|a chat|meeting)|(?:would|will) you (?:like|be (?:keen|happy|open)) to (?:connect|chat|meet|speak|talk)|(?:could|shall|should|can) we connect|happy to connect|keen to connect|love to connect)\b/iu;

/** Words that take up a call: a time, a day, availability, booking. */
const ADDRESSES_MEETING =
  /\b(?:call|meet|meeting|chat|minutes|time|times|slot|slots|calendar|book|booked|invite|available|availability|schedule|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|this week|next week|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/iu;

const ADDRESSES_DOCUMENT =
  /\b(?:deck|one[- ]pager|memo|data ?room|methodology|materials?|financials|financial model|case stud(?:y|ies)|send (?:it|them|that|this|over)|share (?:it|them|that|this)|document|documents)\b/iu;

/**
 * The fixes a draft needs to respond to the thread, as a list for the
 * writer; empty when it responds (or nothing is open). Code cannot tell
 * whether a question was truly answered: that is the reviewer's rule.
 */
export function threadProblems(
  body: string,
  asks: readonly PendingAsk[],
): readonly string[] {
  if (asks.length === 0) return [];
  const problems: string[] = [];
  const meeting = asks.some((ask) => ask.kind === "MEETING");
  if (meeting && RE_ASK_CONNECT.test(body)) {
    problems.push(
      "They already offered or asked for a call: don't ask whether they are open to connecting. Accept it and ask which time suits (or decline it politely).",
    );
  } else if (meeting && !ADDRESSES_MEETING.test(body)) {
    problems.push(
      "They offered or asked for a call or meeting and the draft doesn't respond to it: accept it and ask for a time, or decline it politely.",
    );
  }
  const document = asks.find((ask) => ask.kind === "DOCUMENT");
  if (document !== undefined && !ADDRESSES_DOCUMENT.test(body)) {
    problems.push(
      `They offered to send the ${document.thing ?? "document"} and the draft ignores it: say yes please (or that it isn't needed yet).`,
    );
  }
  return problems;
}
