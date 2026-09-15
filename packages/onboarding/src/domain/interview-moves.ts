/**
 * The interview's own conversational moves (CQ-PRE-REC-001 §28;
 * CQ-Q-VOICE-001 B §23-§25, C §35).
 *
 * Pure text rules shared by every surface that carries the Q-led
 * interview — the typed thread and the spoken one — so a sentence means
 * the same thing whichever way it arrives: a question for Q, a request to
 * pause, a request to pick the interview back up, or an answer. Nothing
 * here touches a runtime, a model or a store.
 */

/**
 * "Why do you need this?" is the interview's own move (the runtime answers
 * it from the step's own reason); any other question is for Q.
 */
export const INTERVIEW_WHY =
  /^(?:why|why (?:do you (?:need|ask|want)|does (?:this|that|it) matter|is (?:this|that) (?:needed|important|relevant))(?: (?:this|that|it))?|what(?:'s| is) (?:this|that) for)\??[.!]?$/i;

/**
 * A request for Q that does not end in a question mark ("Tell me about
 * Series A rounds in Nigeria", "Can you check what Paystack raised",
 * "Look up Flutterwave") — the shape of a request, not of an answer.
 */
const REQUEST_FOR_Q =
  /^(?:(?:can|could|would|will) you\b|tell me (?:about|what|how|more)\b|(?:please )?(?:look up|search(?: for)?|check|find out|research|compare|explain|summari[sz]e|help me (?:understand|with))\b|what (?:do you know|can you tell me|have you found)\b|how (?:do|does|would|should) (?:i|we|one|a founder|an investor)\b)/i;

/** True when the text reads as a question for Q rather than an answer. */
export function looksLikeQuestionForQ(text: string): boolean {
  const trimmed = text.trim();
  if (INTERVIEW_WHY.test(trimmed)) {
    return false;
  }
  return trimmed.endsWith("?") || REQUEST_FOR_Q.test(trimmed);
}

/**
 * "Let's continue." / "Where were we?" / "Back to onboarding." — the person
 * is returning from a tangent. Q picks the interview up where the session
 * says it is; nothing is sent to the runtime.
 */
const RESUME =
  /^(?:(?:ok(?:ay)?|right|so|anyway)[,.\s]+)?(?:let'?s (?:continue|carry on|finish (?:this|it|up)|get back(?: to it)?|go on|pick (?:it|this) up|resume)|continue(?: (?:the|with the|our) (?:interview|onboarding|setup|questions))?|carry on|where were we|where did we (?:leave off|stop)|back to (?:it|onboarding|the (?:interview|questions|setup))|resume(?: the interview)?|go on|next question|what(?:'s| is) next)[.!?]*$/i;

export function resumeIntent(text: string): boolean {
  return RESUME.test(text.trim());
}

/**
 * "Let's stop here." / "I'll finish this later." / "Pause the interview." —
 * the person is leaving for now. Everything is already persisted; the
 * session stays open, never completed on their behalf.
 */
const PAUSE =
  /^(?:(?:ok(?:ay)?|right|so)[,.\s]+)?(?:let'?s (?:stop|pause|leave it|stop here|pause here|pick this up later|do this later)(?: (?:here|for now|there|for today))?|(?:i'?ll|let'?s|we'?ll|i can|we can) (?:finish|do|continue|complete|pick up) (?:this|it|the rest|this up) (?:later|another time|tomorrow|another day)|pause(?: the (?:interview|onboarding|setup))?|stop(?: the (?:interview|onboarding|setup))?(?: for now| here)?|(?:that'?s (?:enough|all) for (?:now|today))|i (?:need|have) to go|(?:can we|let'?s) (?:stop|pause|finish) (?:here|later|for now))[.!?]*$/i;

export function pauseIntent(text: string): boolean {
  return PAUSE.test(text.trim());
}

/** What Q says when the person pauses. */
export const PAUSED_LINE =
  "Of course. Everything so far is saved. Come back whenever suits you and we'll pick up exactly here.";

/** What Q says after a tangent, before the live question shows again. */
export const BRIDGE_LINE = "Back to where we were.";

/**
 * "Let me think" / "give me a second" — the person wants a moment, not an
 * answer (CQ-Q-VOICE-001 D §55). Q waits; nothing is sent to the runtime.
 */
const THINKING =
  /^(?:(?:hmm+|um+|uh+|erm+|well)[,.\s]*)?(?:let me think(?: about (?:it|that))?|give me a (?:second|sec|moment|minute)|(?:one|a) (?:second|sec|moment|minute)(?: please)?|hold on(?: a (?:second|sec|moment))?|hang on|just a (?:second|sec|moment|minute)|wait(?: a (?:second|sec|moment))?)[.!…]*$/i;

export function thinkingIntent(text: string): boolean {
  return THINKING.test(text.trim());
}

/** What Q says when the person asks for a moment. */
export const TAKE_YOUR_TIME_LINE = "Of course, take your time.";
