/**
 * HQ-3 (conversation audit §2.7, slice 4): patient turn-taking where the
 * person is thinking aloud. In the onboarding interview (and the welcome
 * call that opens it) people pause mid-thought to remember a figure or a
 * name; a turn detector tuned for quick questions took those pauses as
 * the end of their turn and Q spoke over them. Discovery (a vague ask
 * being opened up, slice 5) is the same kind of talk: the flag is here
 * for it.
 *
 * Patient means the provider waits longer before it takes the turn:
 * semantic VAD eagerness `low` on the realtime line, and Deepgram's
 * PATIENT end-of-turn (0.9, 5 s). GPT-Live (the live line) manages
 * turn-taking itself and has no such setting; it is untouched.
 */
export function patientTurnTaking(line: {
  /** An onboarding interview is open on this line. */
  readonly onboarding?: boolean | undefined;
  /** The welcome call that opens onboarding. */
  readonly welcome?: boolean | undefined;
  /** HQ-5: the conversation is opening up a vague ask (discovery). */
  readonly discovery?: boolean | undefined;
}): boolean {
  return (
    line.onboarding === true || line.welcome === true || line.discovery === true
  );
}
