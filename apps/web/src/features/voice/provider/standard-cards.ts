import type { QVoiceCardUpdate } from "@capital-q/contracts";

import {
  cardInFocus,
  decideCardByVoice,
  onCardFocus,
  onLineNote,
  spokenNote,
} from "../line-cards";

/**
 * The standard voice line's decision cards (RECOVERY A, audit E-03), the
 * same seam the duplex line uses (line-cards.ts):
 *
 * - the server is told when a card is in focus, so its think route holds
 *   a turn that reads as a reply about the card for this line's verdict;
 * - a reply about the card is decided here, by the card's own code (the
 *   decider the buttons use), from the provider's transcript of the
 *   person; the verdict goes to the server, which says the outcome;
 * - notes from the page that ask Q to speak (a card put to them, a
 *   briefing that came in late) are said with a ready line, when the line
 *   is quiet: the standard line has no model in the browser to phrase a
 *   note, so only a line built from the note's facts is said.
 *
 * Nothing here decides anything itself.
 */

export type StandardLineCards = {
  /** The provider's final transcript of one of the person's turns. */
  readonly heard: (words: string) => void;
  /** The line is quiet now: a held note may be said. */
  readonly quiet: () => void;
  readonly stop: () => void;
};

/** The decider's way of saying "not about the cards" (arrival-briefing). */
function notAboutCards(outcome: Readonly<Record<string, unknown>>): boolean {
  if (outcome.notAboutCards === true) return true;
  const situation = outcome.situation;
  return typeof situation === "string" && /ask_q/u.test(situation);
}

export function standardLineCards(input: {
  /** POST the card update to the Q API for this line. */
  readonly post: (update: QVoiceCardUpdate) => Promise<void>;
  /** Q says this line now (Deepgram's InjectAgentMessage). */
  readonly speak: (line: string) => void;
  /** Q is neither speaking nor working, and the person is not talking. */
  readonly canSpeak: () => boolean;
  /**
   * The shared reading of a card reply (`isQVoiceCardReply`), from the
   * wire's contracts so nothing of them loads with the first paint (W7).
   */
  readonly isCardReply: (words: string) => boolean;
}): StandardLineCards {
  let held: string | null = null;
  let stopped = false;
  const say = (line: string) => {
    if (input.canSpeak()) input.speak(line);
    else held = line;
  };
  void input
    .post({ kind: "FOCUS", inFocus: cardInFocus() })
    .catch(() => undefined);
  const stopFocus = onCardFocus((inFocus) => {
    if (!stopped) {
      void input.post({ kind: "FOCUS", inFocus }).catch(() => undefined);
    }
  });
  const stopNotes = onLineNote((note, respond, ready) => {
    if (stopped || !respond) return;
    const line = spokenNote(note, ready);
    if (line !== null) say(line);
  });
  return {
    heard: (words) => {
      const said = words.trim().slice(0, 700);
      if (stopped || said.length === 0) return;
      if (!cardInFocus() || !input.isCardReply(said)) return;
      void (async () => {
        let outcome: Readonly<Record<string, unknown>> | null;
        try {
          const raw = await decideCardByVoice(
            JSON.stringify({ words: said }),
            said,
          );
          const parsed: unknown = raw === null ? null : JSON.parse(raw);
          outcome =
            parsed !== null && typeof parsed === "object"
              ? (parsed as Readonly<Record<string, unknown>>)
              : null;
        } catch {
          outcome = null;
        }
        const handled = outcome !== null && !notAboutCards(outcome);
        await input
          .post({
            kind: "VERDICT",
            words: said,
            handled,
            ...(handled && outcome !== null ? { outcome } : {}),
          })
          .catch(() => undefined);
      })();
    },
    quiet: () => {
      const line = held;
      if (line === null || stopped || !input.canSpeak()) return;
      held = null;
      input.speak(line);
    },
    stop: () => {
      stopped = true;
      held = null;
      stopFocus();
      stopNotes();
    },
  };
}
