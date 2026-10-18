/**
 * The duplex line's plain sentences (RECOVERY A4, A9, A11), in a module
 * of their own so the session can show them without loading the line's
 * code before a call starts (W7).
 */
/**
 * What the person sees (and, for a failure, hears) when a turn ends
 * without an answer. Plain words; never a provider error string.
 */
export const IGNORED_NOTICE =
  "Not answered: that didn't sound meant for me. Say it again if it was.";
export const TIMEOUT_REPAIR =
  "Sorry, that took too long on my side. Ask me again?";
export const DELIVERY_REPAIR = "Sorry, I couldn't say that. Ask me again?";
/** A11: the line was renewed under a request (a Q update, a restart). */
export const LOST_TURN_NOTICE =
  "I lost that last request while reconnecting. Say it again?";
export const RENEWING_NOTICE = "Voice reconnected after an update.";
/** C-10: the line ended itself after a quiet spell. */
export const IDLE_NOTICE =
  "Voice paused after a quiet spell. Start voice again whenever you want to talk.";
/** INC-1: the answer was ready but the voice never said it. */
export const ANSWER_NOT_SPOKEN_NOTICE =
  "I couldn't say that answer aloud in time; it's on your screen.";
/** B-01: the person's words could not be transcribed: asked again, out loud. */
export const MISHEARD_REPAIR = "Sorry, I didn't catch that. Say it again?";
/** The microphone track ended (permission revoked, unplugged): said at once. */
export const MICROPHONE_LOST_NOTICE =
  "Q lost your microphone. Getting it back…";
/** ...and it came back on the same line. */
export const MICROPHONE_BACK_NOTICE = "Microphone back. Q can hear you again.";
/** ...or it could not be had: Q can't hear the person. */
export const MICROPHONE_UNAVAILABLE_NOTICE =
  "Q can't hear you: the microphone isn't available. Check the browser's permission and try again.";
