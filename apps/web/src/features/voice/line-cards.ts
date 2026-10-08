/**
 * The seam between a page's decision cards and an open voice line (arrival
 * briefing, Zino 2026-10-08: "ask me about them in cards and also speaking
 * to me"). Browser-only and per page load:
 *
 * - the card surface registers one decider; the duplex line hands it the
 *   person's reply to the card in focus (`decide_card`), with the
 *   provider's transcript of their own words;
 * - the card surface sends notes to the line ("this card is in focus",
 *   "that one went"), which the voice says in its own words.
 *
 * Nothing here decides anything: the decider is the card sequence's own
 * code, the same one the buttons use.
 */

export type CardDecider = (input: {
  /** What the voice model passed as their words. */
  readonly words: string;
  /** The provider's transcript of their own last turn, when it came. */
  readonly heard: string | null;
}) => Promise<Readonly<Record<string, unknown>>>;

let decider: CardDecider | null = null;

/** E-03: lines that must know when a card comes into or out of focus. */
const focusListeners = new Set<(inFocus: boolean) => void>();
let lastFocus = false;
function focusChanged(): void {
  const now = cardInFocus();
  if (now === lastFocus) return;
  lastFocus = now;
  for (const listener of focusListeners) listener(now);
}

/** Told whenever `cardInFocus()` changes; returns the unsubscribe. */
export function onCardFocus(listener: (inFocus: boolean) => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** The one decider for this page; returns its unregister. */
export function registerCardDecider(next: CardDecider): () => void {
  decider = next;
  focusChanged();
  return () => {
    if (decider === next) decider = null;
    focusChanged();
  };
}

/** The tool's output for a `decide_card` call, or null with no cards. */
export async function decideCardByVoice(
  rawArguments: string,
  heard: string | null,
): Promise<string | null> {
  const current = decider;
  if (current === null) return null;
  let words = "";
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "words" in parsed &&
      typeof parsed.words === "string"
    ) {
      words = parsed.words.slice(0, 700);
    }
  } catch {
    // Not their words: decided from what was heard alone, or not at all.
  }
  return JSON.stringify(await current({ words, heard }));
}

/**
 * A note's listener. `say`: what a voice without a model of its own (the
 * standard line) says for it, when the sender has a ready line.
 */
type NoteListener = (note: string, respond: boolean, say?: string) => void;
const listeners = new Set<NoteListener>();
/** What a line opened now should know about the screen (the card in focus). */
let standing: string | null = null;

/** An open line listens for notes while it is up. */
export function onLineNote(listener: NoteListener): () => void {
  listeners.add(listener);
  // A line opened while a card is in focus is told about it at once.
  if (standing !== null) listener(standing, false);
  return () => {
    listeners.delete(listener);
  };
}

/** The note every newly opened line gets; null when nothing is in focus. */
export function setStandingNote(note: string | null): void {
  standing = note;
  focusChanged();
}

/** VOICE-BRAIN: a decision card is in focus now (its reply is the card's). */
export function cardInFocus(): boolean {
  return decider !== null && standing !== null;
}

/** Whether a line that can take notes is open now. */
export function lineTakesNotes(): boolean {
  return listeners.size > 0;
}

/**
 * A note to the open line, if any; `respond`: Q says something now. `say`
 * (optional): a line ready to speak as it is, for the standard voice,
 * which has no model in the browser to phrase the note.
 */
export function noteToLine(
  note: string,
  respond: boolean,
  say?: string,
): boolean {
  for (const listener of listeners) listener(note, respond, say);
  return listeners.size > 0;
}

/**
 * What the standard line says for a note (E-03): the sender's ready line,
 * else one built from the note's own facts (a card in focus, a briefing
 * that came in late), else nothing. Never the note itself: notes are
 * written for a model ("Put this card to them briefly, then stop").
 */
export function spokenNote(note: string, say?: string): string | null {
  const ready = say?.trim() ?? "";
  if (ready.length > 0) return ready.slice(0, 1_200);
  // A late briefing carries its spoken words in quotes.
  const briefing = /briefing for them just came in: "([\s\S]+)"/u.exec(note);
  if (briefing?.[1] !== undefined) {
    return `Your briefing just came in. ${briefing[1].trim()}`.slice(0, 1_200);
  }
  // A card in focus carries its facts as JSON.
  const start = note.indexOf("{");
  const end = note.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let facts: unknown;
  try {
    facts = JSON.parse(note.slice(start, end + 1));
  } catch {
    return null;
  }
  if (facts === null || typeof facts !== "object") return null;
  const card = facts as Readonly<Record<string, unknown>>;
  const text = (value: unknown, max = 300): string | null =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim().slice(0, max)
      : null;
  const to = text(card.to, 120) ?? "them";
  const position = card.position;
  const of = card.of;
  const lead =
    typeof position === "number" && typeof of === "number" && of > 1
      ? position === 1
        ? "First, "
        : position === of
          ? "Last one: "
          : "Next, "
      : "";
  if (card.kind === "a message Q held back") {
    return `${lead}I held back a message to ${to}. It's on screen: send it as it is, change it, or drop it?`;
  }
  const proposed = text(card.proposed);
  if (proposed !== null) {
    return `${lead}${/[.!?]$/u.test(proposed) ? proposed : `${proposed}.`} Shall I go ahead?`;
  }
  const wrote = text(card.theyWrote, 200);
  if (wrote !== null) {
    return `${lead}${to} wrote: "${wrote}" I've drafted a reply. Send it?`;
  }
  return `${lead}I've drafted a message to ${to}. Send it?`;
}
