/**
 * One spoken utterance, one turn in the conversation (founder live test
 * 2026-09-27, failure 9).
 *
 * The voice provider ends a turn at a pause, so one utterance can reach Q
 * as several requests, each carrying the utterance as it had grown
 * ("Okay." then "Okay. That makes sense."). Each request starts a run and
 * stores the person's words, because waiting to be sure the person has
 * finished would slow every answer. The voice channel names the utterance
 * a message belongs to (`utteranceRef`, from the conversation's position,
 * never from the words), and a newer message of the same utterance
 * supersedes the older one.
 *
 * Nothing is overwritten: every message stays stored, history intact. What
 * the conversation is read as -- by the person reopening it and by Q
 * taking it as context -- is the utterance's latest form, and a run that
 * answered a superseded fragment is not part of it: Q never answers a
 * fragment the person went on to extend.
 */
export const UTTERANCE_REF_PATTERN = /^[A-Za-z0-9._:-]{1,255}$/;

/** The conversation as it reads once superseded fragments are set aside. */
export function withoutSupersededUtterances<
  T extends {
    readonly runId: string;
    readonly role: string;
    readonly utteranceRef?: string | undefined;
  },
>(messages: readonly T[]): T[] {
  const latest = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === "USER" && message.utteranceRef !== undefined) {
      latest.set(message.utteranceRef, index);
    }
  });
  const superseded = new Set<string>();
  messages.forEach((message, index) => {
    if (
      message.role === "USER" &&
      message.utteranceRef !== undefined &&
      latest.get(message.utteranceRef) !== index
    ) {
      superseded.add(message.runId);
    }
  });
  return superseded.size === 0
    ? [...messages]
    : messages.filter((message) => !superseded.has(message.runId));
}
