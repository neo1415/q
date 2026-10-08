# Evidence: packages/q-orchestrator/src/workforce/thread-consistency.ts lines 1-140

- Original path: `packages/q-orchestrator/src/workforce/thread-consistency.ts`
- Line range: 1-140 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Code's thread-consistency check (pendingAsks/threadProblems). Complete module.

```ts
    1  /**
    2   * Thread consistency (Zino, 2026-10-08): "Tensorgate asked for a meeting
    3   * almost immediately, then the agent was still asking if it is open to
    4   * connect... is there not a worker that compares the messages the agent
    5   * sends to what it is actually replying to?"
    6   *
    7   * Code reads what the other side's latest, still-unanswered message left
    8   * open -- a call or meeting offered or asked for, a document offered, a
    9   * question -- and checks a draft against it before the reviewer grades it
   10   * and before anything is sent or offered as a card. Deterministic and
   11   * cheap; the reviewer's RESPONDS_TO_THREAD rule is the model-checked
   12   * second layer for what words cannot settle (whether a question was
   13   * really answered).
   14   *
   15   * The asks are described to models in code's own fixed words; nothing
   16   * here quotes the other side, so the line is trusted where it is used.
   17   */
   18
   19  export type PendingAskKind = "MEETING" | "DOCUMENT" | "QUESTION";
   20
   21  export type PendingAsk = {
   22    readonly kind: PendingAskKind;
   23    /** The thing offered or asked for, by code's vocabulary ("deck"). */
   24    readonly thing: string | null;
   25  };
   26
   27  // Tensorgate, 8 Oct: Zino's "Would you be open to connecting?" is an ask
   28  // to meet; without "connect" here, a redraft re-asking it passed code.
   29  const MEETING =
   30    /\b(?:call|calls|meeting|meet|chat|demo|walkthrough|zoom|video call|catch[- ]up|coffee|connect|connecting|\d{1,2}\s?(?:-\s?)?min(?:ute)?s?)\b/iu;
   31  const DOCUMENT =
   32    /\b(deck|pitch deck|one[- ]pager|memo|data ?room|methodology|materials?|financials|financial model|case stud(?:y|ies))\b/iu;
   33  const OFFER_OR_ASK =
   34    /\b(?:share|send|happy to|glad to|would you like|want|keen to|find|hop on|grab|set up|arrange|book|schedule|can we|could we|shall we|let'?s|are you free|available|availability|time to)\b/iu;
   35
   36  /** A question asked without a question mark ("I'd be interested to hear how"). */
   37  const INDIRECT_QUESTION =
   38    /\b(?:(?:interested|keen|curious) to (?:hear|know|learn|understand)|(?:would|'d) (?:love|like) to (?:hear|know|learn|understand)|curious (?:about|how|whether|what)|tell (?:me|us) (?:more|how|what|about)|wondering (?:how|whether|what|if))\b/iu;
   39
   40  /** Their sentences, split on end punctuation and line breaks. */
   41  function sentences(text: string): readonly string[] {
   42    return text
   43      .split(/(?<=[.!?])\s+|\n+/u)
   44      .map((one) => one.trim())
   45      .filter((one) => one.length > 0);
   46  }
   47
   48  /**
   49   * What their latest unanswered message(s) leave open. Empty when they
   50   * wrote nothing, or nothing that asks for a response beyond courtesy.
   51   */
   52  export function pendingAsks(
   53    theirLatest: string | null | undefined,
   54  ): readonly PendingAsk[] {
   55    const text = (theirLatest ?? "").trim();
   56    if (text.length === 0) return [];
   57    const asks: PendingAsk[] = [];
   58    const all = sentences(text);
   59    const offering = (sentence: string) =>
   60      sentence.includes("?") || OFFER_OR_ASK.test(sentence);
   61    if (all.some((one) => MEETING.test(one) && offering(one))) {
   62      asks.push({ kind: "MEETING", thing: null });
   63    }
   64    const document = all
   65      .filter((one) => offering(one))
   66      .map((one) => DOCUMENT.exec(one)?.[1]?.toLowerCase() ?? null)
   67      .find((thing) => thing !== null);
   68    if (document !== undefined && document !== null) {
   69      asks.push({ kind: "DOCUMENT", thing: document });
   70    }
   71    // A question that is not itself the offer ("Want the deck, or 20
   72    // minutes?" is the offer, already counted).
   73    // Tensorgate, 8 Oct: "I'd be interested to hear how those firms are
   74    // evaluating the gateway" asks as surely as a question mark does.
   75    if (
   76      all.some(
   77        (one) =>
   78          (one.includes("?") && !MEETING.test(one) && !DOCUMENT.test(one)) ||
   79          INDIRECT_QUESTION.test(one),
   80      )
   81    ) {
   82      asks.push({ kind: "QUESTION", thing: null });
   83    }
   84    return asks;
   85  }
   86
   87  /** The asks in code's fixed words, for the reviewer and the writer. */
   88  export function asksLine(asks: readonly PendingAsk[]): string {
   89    if (asks.length === 0) return "None.";
   90    return asks
   91      .map((ask) =>
   92        ask.kind === "MEETING"
   93          ? "They offered or asked for a call or a meeting."
   94          : ask.kind === "DOCUMENT"
   95            ? `They offered to send a document (${ask.thing ?? "a document"}).`
   96            : "They asked a question that needs an answer.",
   97      )
   98      .join(" ");
   99  }
  100
  101  /** Asking whether they will connect, after they already offered to meet. */
  102  const RE_ASK_CONNECT =
  103    /\b(?:open to (?:connect(?:ing)?|a (?:call|chat|conversation|meeting)|chat(?:ting)?|speak(?:ing)?|talk(?:ing)?|meet(?:ing)?)|interested in (?:connecting|a call|a chat|meeting)|(?:would|will) you (?:like|be (?:keen|happy|open)) to (?:connect|chat|meet|speak|talk)|(?:could|shall|should|can) we connect|happy to connect|keen to connect|love to connect)\b/iu;
  104
  105  /** Words that take up a call: a time, a day, availability, booking. */
  106  const ADDRESSES_MEETING =
  107    /\b(?:call|meet|meeting|chat|minutes|time|times|slot|slots|calendar|book|booked|invite|available|availability|schedule|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|this week|next week|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}:\d{2})\b/iu;
  108
  109  const ADDRESSES_DOCUMENT =
  110    /\b(?:deck|one[- ]pager|memo|data ?room|methodology|materials?|financials|financial model|case stud(?:y|ies)|send (?:it|them|that|this|over)|share (?:it|them|that|this)|document|documents)\b/iu;
  111
  112  /**
  113   * The fixes a draft needs to respond to the thread, as a list for the
  114   * writer; empty when it responds (or nothing is open). Code cannot tell
  115   * whether a question was truly answered: that is the reviewer's rule.
  116   */
  117  export function threadProblems(
  118    body: string,
  119    asks: readonly PendingAsk[],
  120  ): readonly string[] {
  121    if (asks.length === 0) return [];
  122    const problems: string[] = [];
  123    const meeting = asks.some((ask) => ask.kind === "MEETING");
  124    if (meeting && RE_ASK_CONNECT.test(body)) {
  125      problems.push(
  126        "They already offered or asked for a call: don't ask whether they are open to connecting. Accept it and ask which time suits (or decline it politely).",
  127      );
  128    } else if (meeting && !ADDRESSES_MEETING.test(body)) {
  129      problems.push(
  130        "They offered or asked for a call or meeting and the draft doesn't respond to it: accept it and ask for a time, or decline it politely.",
  131      );
  132    }
  133    const document = asks.find((ask) => ask.kind === "DOCUMENT");
  134    if (document !== undefined && !ADDRESSES_DOCUMENT.test(body)) {
  135      problems.push(
  136        `They offered to send the ${document.thing ?? "document"} and the draft ignores it: say yes please (or that it isn't needed yet).`,
  137      );
  138    }
  139    return problems;
  140  }
```
