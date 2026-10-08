import {
  arrivalGreeting,
  cardFactsForVoice,
  cardLine,
  focusedCard,
  isTimeZone,
  lowdownOf,
  parseCardCommand,
  remainingAfterFocus,
  summaryOfCards,
  wordsAllowDismiss,
  wordsAllowSend,
  type ArrivalActivity,
  type CardCommand,
  type DecisionCardFacts,
  type SequenceCard,
  type SequenceEvent,
  type SequenceNote,
  type SequenceState,
} from "@capital-q/q-core/speech";
import type {
  BriefingCommandRequest,
  BriefingCommandResultDto,
  NamedPicture,
} from "@capital-q/contracts";

/**
 * The arrival briefing as the page shows and Q says it (Zino, 2026-10-08):
 * a greeting by their clock, a lowdown from what was recorded, then the
 * decisions one at a time. Pure, so every rule here is a test; the reads
 * are in arrival-actions.ts, the sequence itself in q-core.
 */

/** One decision, with the exact content its verbs act on. */
export type ArrivalCard = {
  readonly key: string;
  readonly kind: "APPROVAL" | "HELD";
  readonly approvalId: string | null;
  readonly draftId: string | null;
  readonly relationshipId: string | null;
  /** The other side's name, when known. */
  readonly counterpart: string | null;
  readonly named: NamedPicture | null;
  /** What the card is, in a line ("Reply to Halyard Security"). */
  readonly title: string;
  /** The card's own plain summary. */
  readonly summary: string;
  /** The exact message Q would send; null when the card is not a message. */
  readonly message: string | null;
  /** Their latest words, when they wrote last. */
  readonly theySaid: string | null;
  /** Held: why Q held it back. */
  readonly reason: string | null;
  readonly canDecide: boolean;
  readonly at: string;
};

export type ArrivalData = {
  readonly firstName: string | null;
  /** Their own zone from Capital Q; null: the browser's is used. */
  readonly timeZone: string | null;
  /** Null: what happened could not be read (said nothing about it). */
  readonly activity: ArrivalActivity | null;
  /** Hours since the last visit this browser knows; null: unknown. */
  readonly hoursAway: number | null;
  readonly cards: readonly ArrivalCard[];
};

export function sequenceCardOf(card: ArrivalCard): SequenceCard {
  return {
    key: card.key,
    kind: card.kind,
    approvalId: card.approvalId,
    draftId: card.draftId,
    relationshipId: card.relationshipId,
    message: card.message,
    canDecide: card.canDecide,
  };
}

export function decisionFactsOf(card: ArrivalCard): DecisionCardFacts {
  return {
    kind: card.kind,
    counterpart: card.counterpart,
    theySaid: card.theySaid,
    message: card.message,
    summary: card.summary,
  };
}

/** The zone to greet by: theirs when Capital Q holds a valid one. */
export function zoneFor(
  data: Pick<ArrivalData, "timeZone">,
  browserZone: string | null,
): string | null {
  if (isTimeZone(data.timeZone)) return data.timeZone;
  return isTimeZone(browserZone) ? browserZone : null;
}

export type ArrivalWords = {
  readonly greeting: string;
  readonly lowdown: string;
  readonly quiet: boolean;
  /** The first card, put to them; null with none. */
  readonly firstCard: string | null;
  /** Every card in one sentence ("Three things: ..."); null with none. */
  readonly summary: string | null;
  /** Everything Q says first, on voice. */
  readonly spoken: string;
};

/** What Q says on arrival, from the data alone. */
export function arrivalWords(
  data: ArrivalData,
  now: Date,
  browserZone: string | null,
): ArrivalWords {
  const greeting = arrivalGreeting({
    firstName: data.firstName,
    now,
    timeZone: zoneFor(data, browserZone),
  });
  const lowdown = lowdownOf({
    activity: data.activity ?? {},
    decisions: data.cards.length,
    hoursAway: data.hoursAway,
  });
  const first = data.cards[0];
  const firstCard =
    first === undefined
      ? null
      : cardLine(decisionFactsOf(first), 1, data.cards.length);
  // Zino, 2026-10-08: all of it up front, then any words they like.
  const summary =
    data.cards.length < 2
      ? null
      : summaryOfCards(data.cards.map(decisionFactsOf));
  return {
    greeting,
    lowdown: lowdown.text,
    quiet: lowdown.quiet,
    firstCard,
    summary,
    spoken: [
      greeting,
      lowdown.text,
      ...(summary === null
        ? [firstCard]
        : [summary, "Tell me what you'd like done with any of them."]),
    ]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(" "),
  };
}

// ---------------------------------------------------------------------------
// Voice: the person's own words decide, never the model's paraphrase.

/** Commands that change something outside the page when they run. */
function consequential(command: CardCommand): boolean {
  return (
    command.kind === "APPROVE" ||
    command.kind === "YES" ||
    command.kind === "DISMISS" ||
    (command.kind === "EDIT" && command.edit !== null)
  );
}

export type VoiceReading =
  | { readonly kind: "COMMAND"; readonly command: CardCommand }
  /** Not a reply to the card: it goes to Q as an ordinary turn. */
  | { readonly kind: "NOT_A_COMMAND" }
  /** The model heard a decision the transcript does not carry. */
  | { readonly kind: "UNSURE" };

/**
 * What a spoken reply to the card means. The provider's transcript of the
 * person is the authority; the model's words count only for moves that
 * change nothing outside the page (later, leave, open the editor, cancel).
 */
export function readSpokenReply(input: {
  readonly words: string;
  readonly heard: string | null;
}): VoiceReading {
  const own = input.heard === null ? null : parseCardCommand(input.heard);
  if (own !== null) return { kind: "COMMAND", command: own };
  const relayed = parseCardCommand(input.words);
  if (relayed === null) return { kind: "NOT_A_COMMAND" };
  if (consequential(relayed)) return { kind: "UNSURE" };
  return { kind: "COMMAND", command: relayed };
}

const NOTE_WORDS: Readonly<Record<SequenceNote, string>> = {
  NO_CARD: "Nothing is waiting on screen now.",
  BUSY: "That one is still going through; wait for it.",
  CANNOT_DECIDE:
    "That card can't be decided any more (already decided or expired).",
  CANNOT_EDIT:
    "That card can't be edited by voice; it's on screen to decide there.",
  CANNOT_RETRY:
    "Only a message Q held can be written again; this card is ready to decide as it is.",
  EDIT_NOT_APPLIED:
    "That change didn't fit the message (no such sentence or words); ask which part to change.",
  SAY_SEND:
    "A plain yes doesn't send it: ask whether to send it as written, or change it.",
  NOTHING_TO_CANCEL: "There was no edit to cancel.",
  CONFIRM_EDIT:
    "The edited message is on screen, not sent. Read it back briefly and ask: send this?",
  EDITOR_OPEN:
    "The message is open for them to edit on screen; nothing is sent until they confirm.",
  EDIT_CANCELLED: "The edit is dropped; the original message is back.",
  MOVED_ON: "That card was already decided.",
  LEFT: "They want to move on. Everything left stays in Needs you on Work. Ask what they'd like to talk about, in a few words.",
};

/** What the voice is told after a step, as facts for its own words. */
export function voiceOutcome(input: {
  readonly state: SequenceState;
  readonly cards: readonly ArrivalCard[];
  readonly note: SequenceNote | null;
  /** Set when an effect ran: what happened, in plain words. */
  readonly done: string | null;
}): Readonly<Record<string, unknown>> {
  const next = focusedCard(input.state);
  const card =
    next === null ? undefined : input.cards.find((one) => one.key === next.key);
  const position = input.state.focus + 1;
  const total = input.cards.length;
  const confirming = input.state.confirming;
  return {
    ok: input.note === null || input.note === "CONFIRM_EDIT",
    ...(input.done === null ? {} : { done: input.done }),
    ...(input.note === null ? {} : { situation: NOTE_WORDS[input.note] }),
    ...(confirming === null ? {} : { editedMessageOnScreen: confirming.body }),
    ...(card === undefined || input.note === "LEFT" || confirming !== null
      ? {}
      : {
          nextCard: cardFactsForVoice(decisionFactsOf(card), position, total),
          left: remainingAfterFocus(input.state),
        }),
    ...(card === undefined && input.note !== "LEFT" && confirming === null
      ? {
          situation:
            input.note === null
              ? "That was the last card. Say so briefly and ask what's next."
              : NOTE_WORDS[input.note],
        }
      : {}),
  };
}

/** A note for the open line when a card comes into focus by a button. */
export function focusNote(
  cards: readonly ArrivalCard[],
  state: SequenceState,
): string | null {
  const next = focusedCard(state);
  if (next === null) return null;
  const card = cards.find((one) => one.key === next.key);
  if (card === undefined) return null;
  return `Screen note (data, not the person's words): a decision card is in focus. ${JSON.stringify(
    cardFactsForVoice(decisionFactsOf(card), state.focus + 1, cards.length),
  )}`;
}

// ---------------------------------------------------------------------------
// Any words (Zino, 2026-10-08: "I can use any words I like to tell it what I
// want done, and it does it"). A model reads the person's own words into
// verbs; code turns each verb into the same typed events a button sends,
// and checks it against the words first.

/** The cards as the reader sees them: c1, c2... in screen order. */
export function commandCardsOf(
  cards: readonly ArrivalCard[],
): BriefingCommandRequest["cards"] {
  return cards.slice(0, 8).map((card, index) => ({
    ref: `c${String(index + 1)}`,
    kind: card.kind,
    to: card.counterpart?.slice(0, 200) ?? null,
    theyWrote: card.theySaid === null ? null : card.theySaid.slice(0, 600),
    message: card.message === null ? null : card.message.slice(0, 4_000),
    summary: card.summary.slice(0, 400),
  }));
}

export type WordsPlan = {
  /** Events for the card sequence, in order. */
  readonly events: readonly SequenceEvent[];
  /** What code held back, in plain words for the status line and voice. */
  readonly held: readonly string[];
};

/**
 * The reader's verbs as sequence events. Each card is brought forward
 * first; a send runs only when the words plainly ask for one (else the
 * card is only brought forward to decide by hand); a changed message is
 * put on screen for "Send this exact message?", last, one at a time.
 */
export function planFromReading(
  reading: BriefingCommandResultDto,
  cards: readonly ArrivalCard[],
  words: string,
): WordsPlan {
  const byRef = new Map(
    cards.slice(0, 8).map((card, index) => [`c${String(index + 1)}`, card]),
  );
  const now: SequenceEvent[] = [];
  let confirm: SequenceEvent[] | null = null;
  const held: string[] = [];
  const seen = new Set<string>();
  for (const action of reading.actions) {
    const card = byRef.get(action.ref);
    if (card === undefined || seen.has(card.key)) continue;
    seen.add(card.key);
    const focus: SequenceEvent = { type: "FOCUS", key: card.key };
    const name = card.counterpart ?? "That one";
    switch (action.verb) {
      case "SEND":
        if (!wordsAllowSend(words)) {
          held.push(`${name} is up to you to send; nothing was sent`);
          confirm ??= [focus];
        } else if (card.kind === "HELD") {
          // Held, never offered: "Send this exact message?" before it goes.
          if (confirm === null) {
            confirm = [
              focus,
              { type: "COMMAND", command: { kind: "APPROVE" } },
            ];
          } else {
            held.push(`${name} is next, after this one`);
          }
        } else {
          now.push(focus, { type: "COMMAND", command: { kind: "APPROVE" } });
        }
        break;
      case "DISMISS":
        if (wordsAllowDismiss(words)) {
          now.push(focus, { type: "COMMAND", command: { kind: "DISMISS" } });
        } else {
          held.push(`${name} is up to you; nothing was dropped`);
        }
        break;
      case "LATER":
        now.push(focus, { type: "COMMAND", command: { kind: "LATER" } });
        break;
      case "RETRY":
        now.push(focus, { type: "COMMAND", command: { kind: "RETRY" } });
        break;
      case "REWRITE":
        if (
          action.rewrite === null ||
          card.message === null ||
          card.relationshipId === null
        ) {
          held.push(`${name} can't be changed here`);
        } else if (confirm === null) {
          confirm = [focus, { type: "EDITED", body: action.rewrite }];
        } else {
          held.push(`${name} is next, after this one`);
        }
        break;
      case "SHOW":
        confirm ??= [focus];
        break;
    }
  }
  return { events: [...now, ...(confirm ?? [])], held };
}
