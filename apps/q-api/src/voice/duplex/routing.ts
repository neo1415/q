/**
 * Who answers a finished turn on a routed duplex line (VOICE-BRAIN,
 * founder live 2026-10-08).
 *
 * On 2026-10-08 09:59-10:01 UTC one duplex call ran a single ask_q: every
 * other thing the founder said was answered by the realtime model on its
 * own, without Q's records, documents or tools. That is where "I can't
 * open files" and the know-nothing answers came from. The realtime model
 * is the voice, never the brain: this code, not the model, decides.
 *
 * Deterministic and deliberately narrow: only an utterance made entirely
 * of greeting, acknowledgement, thanks, farewell or filler words is small
 * talk the voice may answer. Everything else -- any question, any noun,
 * any "can you open my deck" -- goes to Q. A miss costs a little latency
 * (Q answers small talk); the opposite miss costs the person's trust.
 */

import { isQVoiceCardReply, isQVoiceSmallTalk } from "@capital-q/contracts";

export type DuplexTurnRoute = "ASK_Q" | "SMALLTALK" | "MODEL";

/** The routed= value in the per-turn log line and the transcript store. */
export type DuplexRoutedAs = "ask_q" | "smalltalk" | "model_only";

export const routedAs = (route: DuplexTurnRoute): DuplexRoutedAs =>
  route === "ASK_Q"
    ? "ask_q"
    : route === "SMALLTALK"
      ? "smalltalk"
      : "model_only";

/** The one small-talk classifier both voice lines use (contracts). */
export const isSmallTalk = isQVoiceSmallTalk;

/**
 * RECOVERY A3: a reply about the card in focus (shared with the standard
 * line, so both lines read a card reply the same way).
 */
export const isCardReply = isQVoiceCardReply;

export function routeDuplexTurn(
  transcript: string,
  situation: {
    /** Q leads this line (welcome, interview): every word is Q's. */
    readonly guided: boolean;
    /** Q's last answer asked for their yes: the reply is Q's to take. */
    readonly awaitingApproval: boolean;
    /** A decision card is in focus: a reply about it goes to decide_card. */
    readonly cardInFocus: boolean;
    /**
     * Q's last words were a question to them ("want the detail?"): a bare
     * "yes" or "no" answers Q, so it is Q's, never the voice's alone.
     */
    readonly answeringQ?: boolean | undefined;
  },
): DuplexTurnRoute {
  if (situation.guided || situation.awaitingApproval) return "ASK_Q";
  // The card's own code reads the reply (the same typed action a button
  // sends); the voice only passes the words through decide_card.
  if (situation.cardInFocus && isCardReply(transcript)) return "MODEL";
  if (situation.answeringQ === true) return "ASK_Q";
  return isSmallTalk(transcript) ? "SMALLTALK" : "ASK_Q";
}
