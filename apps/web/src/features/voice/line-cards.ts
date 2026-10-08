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

/** The one decider for this page; returns its unregister. */
export function registerCardDecider(next: CardDecider): () => void {
  decider = next;
  return () => {
    if (decider === next) decider = null;
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

type NoteListener = (note: string, respond: boolean) => void;
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
}

/** Whether a line that can take notes is open now. */
export function lineTakesNotes(): boolean {
  return listeners.size > 0;
}

/** A note to the open line, if any; `respond`: Q says something now. */
export function noteToLine(note: string, respond: boolean): boolean {
  for (const listener of listeners) listener(note, respond);
  return listeners.size > 0;
}
