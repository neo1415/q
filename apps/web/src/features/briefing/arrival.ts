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
  ArrivalSnapshot,
  BriefingCommandRequest,
  BriefingCommandResultDto,
  NamedPicture,
  QAttentionReport,
  ReadinessFollowUp,
} from "@capital-q/contracts";

import { attentionLines, unreadWords } from "./attention";
import { greetingSeed, warmGreeting } from "./greeting";
import { matchesWords, type ArrivalMatches } from "./matches";

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
  /**
   * Notices still waiting on them ("Zino Aviation is waiting for a
   * reply"), as their titles; absent or empty: none.
   */
  readonly waiting?: readonly string[] | undefined;
  /**
   * RECOVERY-2026-10 E2: everything that needs them, one report (the lead
   * contract), with the sources that could not be read. Absent from an
   * older read; null: the report itself could not be put together.
   */
  readonly attention?: QAttentionReport | null | undefined;
  /**
   * W1: the Arrival Snapshot this briefing was said from (the same object
   * Q's turns and the live voice are given); absent when it could not be
   * read, in which case the attention read or its bridge was used.
   */
  readonly snapshot?: ArrivalSnapshot | undefined;
  /** Where each attention line is acted on, by item key (in-app paths). */
  readonly attentionLinks?: Readonly<Record<string, string>> | undefined;
  /** What their agents finished in the window; null: not read. */
  readonly jobsDone?: ActivityCountLike | null | undefined;
  /** Investors: new companies matching their mandate; null: not read. */
  readonly matches?: ArrivalMatches | null | undefined;
  /**
   * Founders (Q.01): the interview questions Q still has, answerable in
   * place; null: not read; absent: not a founder.
   */
  readonly questions?: readonly ReadinessFollowUp[] | null | undefined;
};

/**
 * The card in focus as a line ready to say as it is (q-core `cardLine`),
 * for the standard voice line, which has no model in the browser to
 * phrase a note (workstream A, E-03). `lead` goes first ("Done.").
 */
export function focusSay(
  cards: readonly ArrivalCard[],
  state: SequenceState,
  lead?: string | null,
): string | null {
  const focused = focusedCard(state);
  if (focused === null) return null;
  const card = cards.find((one) => one.key === focused.key);
  if (card === undefined) return null;
  const line = cardLine(
    decisionFactsOf(card),
    state.focus + 1,
    state.cards.length,
  );
  const first = lead?.trim() ?? "";
  return first.length === 0 ? line : `${first} ${line}`;
}

/** "I still have three questions investors will ask you." (Q.01) */
export function questionsWords(
  questions: readonly ReadinessFollowUp[] | null | undefined,
): string | null {
  if (questions === null || questions === undefined) return null;
  const n = questions.length;
  if (n === 0) return null;
  return n === 1
    ? "I still have one question investors will ask you; it's on the side when you have a minute."
    : `I still have ${String(n)} questions investors will ask you; they're on the side when you have a minute.`;
}

type ActivityCountLike = {
  readonly n: number;
  readonly names: readonly string[];
};

function namesOf(item: ActivityCountLike, max = 2): string {
  const names = item.names.slice(0, max);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * The "What I did" card, a line per kind of work, from recorded facts
 * only (E2). Null when the read failed (the card says it could not
 * check); empty when nothing was done.
 */
export function activityLines(
  activity: ArrivalActivity | null,
  jobs: ActivityCountLike | null | undefined,
): readonly string[] | null {
  if (activity === null && (jobs === null || jobs === undefined)) return null;
  const lines: string[] = [];
  const named = (
    item: ActivityCountLike | undefined,
    one: (names: string) => string,
    many: (n: number) => string,
  ) => {
    if (item === undefined || item.n <= 0) return;
    lines.push(
      item.n <= 2 && item.names.length >= item.n
        ? one(namesOf(item))
        : many(item.n),
    );
  };
  named(
    activity?.sent,
    (names) => `Replied to ${names}`,
    (n) => `Sent ${String(n)} messages for you`,
  );
  named(
    activity?.booked,
    (names) => `Booked your call with ${names}`,
    (n) => `Set up ${String(n)} meetings`,
  );
  named(
    activity?.interest,
    (names) => `Expressed interest in ${names}`,
    (n) => `Expressed interest in ${String(n)} companies`,
  );
  named(
    activity?.held,
    (names) => `Held back a message to ${names} for you to read`,
    (n) => `Held back ${String(n)} messages for you to read`,
  );
  named(
    activity?.replies,
    (names) => `${names} wrote back`,
    (n) => `${String(n)} people wrote back`,
  );
  named(
    activity?.matches,
    (names) => `${names}: a new match`,
    (n) => `${String(n)} new matches`,
  );
  if (jobs !== null && jobs !== undefined && jobs.n > 0) {
    const first = jobs.names[0];
    lines.push(
      jobs.n === 1 && first !== undefined
        ? `Finished: ${first.replace(/[.\s]+$/u, "")}`
        : `My agents finished ${String(jobs.n)} jobs`,
    );
  }
  return lines;
}

/** "My agents finished two jobs: research five fintech investors." */
export function jobsDoneWords(
  jobs: ActivityCountLike | null | undefined,
): string | null {
  if (jobs === null || jobs === undefined || jobs.n <= 0) return null;
  const first = jobs.names[0];
  if (jobs.n === 1) {
    return first === undefined
      ? "One of my agents finished its job."
      : `One of my agents finished: ${first.replace(/[.\s]+$/u, "")}.`;
  }
  return `My agents finished ${String(jobs.n)} jobs.`;
}

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
  /** "Good afternoon, Zino." -- by their clock. */
  readonly greeting: string;
  /** The warm half ("Good to see you."); null late at night. */
  readonly welcome: string | null;
  readonly lowdown: string;
  /** Investors: the new matching companies, all by name; null: none. */
  readonly matches: string | null;
  readonly quiet: boolean;
  /** The first card, put to them; null with none. */
  readonly firstCard: string | null;
  /** Every card in one sentence ("Three things: ..."); null with none. */
  readonly summary: string | null;
  /** Everything Q says first, on voice. */
  readonly spoken: string;
};

/** "Zino Aviation is waiting for a reply" -> "Zino Aviation". */
const WAITING_NAME =
  /^(.+?) (?:is waiting for (?:a|your) reply|sent you a message|wrote back|replied)\b/u;

/**
 * Notices still waiting on them, said once per name (live 2026-10-08:
 * "Zino Aviation wrote back. Zino Aviation is waiting for a reply. Zino
 * Aviation sent you a message."). A name the lowdown already said is
 * "they"; a notice that names no one is said as its title.
 */
export function waitingWords(
  titles: readonly string[],
  lowdown: string,
): string | null {
  const names: string[] = [];
  const others: string[] = [];
  for (const title of titles) {
    const name = WAITING_NAME.exec(title.trim())?.[1]?.trim();
    if (name === undefined) {
      const line = title.trim().replace(/[.!?\s]*$/u, ".");
      if (line.length > 1 && !others.includes(line)) others.push(line);
    } else if (!names.includes(name)) {
      names.push(name);
    }
  }
  const parts: string[] = [];
  if (names.length > 0) {
    const said = names.length === 1 && lowdown.includes(names[0] ?? "");
    const who = said
      ? "They're"
      : names.length === 1
        ? `${names[0] ?? ""} is`
        : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""} are`;
    parts.push(
      `${who} waiting for ${names.length === 1 ? "your reply" : "replies"}.`,
    );
  }
  parts.push(...others.slice(0, 2));
  return parts.length === 0 ? null : parts.join(" ");
}

/** What Q says on arrival, from the data alone. */
export function arrivalWords(
  data: ArrivalData,
  now: Date,
  browserZone: string | null,
): ArrivalWords {
  const zone = zoneFor(data, browserZone);
  const greeting = arrivalGreeting({
    firstName: data.firstName,
    now,
    timeZone: zone,
  });
  // Casual and glad to see them (Zino, 2026-10-08), the same all visit.
  const warm = warmGreeting({
    firstName: data.firstName,
    now,
    timeZone: zone,
    hoursAway: data.hoursAway,
    seed: greetingSeed(`${data.firstName ?? ""}:${now.toDateString()}`),
  });
  const read = lowdownOf({
    activity: data.activity ?? {},
    decisions: data.cards.length,
    hoursAway: data.hoursAway,
  });
  // Live 2026-10-08: "All quiet; nothing needs you" while an investor's
  // message waited for a reply. What waits on them is said, never "quiet".
  const waitingLine = waitingWords(data.waiting ?? [], read.text);
  const jobsLine = jobsDoneWords(data.jobsDone);
  // Unknown is not empty (SPEC §4.4): a source that could not be read is
  // said as such, and never lets the day be called quiet.
  const unread = data.attention?.unread ?? [];
  const unreadLine = unreadWords(unread);
  const told = [
    read.quiet ? null : read.text,
    jobsLine,
    waitingLine,
    unreadLine,
  ].filter((part): part is string => part !== null);
  const lowdown =
    told.length === 0
      ? read
      : read.quiet && unreadLine !== null && told.length === 1
        ? { quiet: false, text: `Quiet on what I could check. ${unreadLine}` }
        : { quiet: false, text: told.join(" ") };
  const matchesLine = matchesWords(data.matches ?? null);
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
  // The attention lines no card decides here (a message to answer, a
  // document requested): named once, after the decisions.
  const lines =
    data.attention === null || data.attention === undefined
      ? []
      : attentionLines(data.attention);
  return {
    greeting,
    welcome: warm.slice(greeting.length).trim() || null,
    lowdown: lowdown.text,
    quiet: lowdown.quiet && matchesLine === null && lines.length === 0,
    firstCard,
    summary,
    matches: matchesLine,
    spoken: [
      warm,
      lowdown.text,
      ...(summary === null
        ? [firstCard]
        : [summary, "Tell me what you'd like done with any of them."]),
      matchesLine,
      questionsWords(data.questions),
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
