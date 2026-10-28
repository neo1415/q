import type { OnboardingInterviewTurn } from "@capital-q/contracts";

/**
 * Q's streamed reply, kept idempotent (live typed run 2026-10-28, D2).
 *
 * On four of twelve founder turns the streamed reply printed its opening
 * sentence twice and the composer then stayed closed for up to 100 s. The
 * sentences carry no id or offset, so the only thing the screen can hold
 * them to is their own text: a sentence that is already on screen is the
 * stream starting over (a retry, a replay after a reconnect), never a new
 * sentence, and it is dropped. Q does not repeat itself word for word
 * within one reply, so an exact repeat is the one case this hides.
 */
export function appendReplySentence(
  shown: readonly string[] | null,
  sentence: string,
): readonly string[] | null {
  const trimmed = sentence.trim();
  if (trimmed.length === 0) return shown;
  if (shown === null) return [trimmed];
  if (shown.includes(trimmed)) return shown;
  return [...shown, trimmed];
}

/** The streamed sentences as one line of Q's. */
export function replyStreamText(shown: readonly string[] | null): string {
  return shown === null ? "" : shown.join(" ");
}

/**
 * Q's reply to what the person just said, read from the interview thread
 * the server keeps (D2's bounded fallback). The turn ran on the server
 * whether or not its `result` event reached the browser, and the thread
 * holds Q's line within seconds of it; when the stream has gone quiet, the
 * thread settles the turn.
 *
 * The person's line is found by its exact text, latest first (a line said
 * twice is the latest one); Q's reply is every Q line after it. Null when
 * the thread does not yet carry an answer, so the caller keeps waiting.
 */
export function settledReplyFromThread(
  turns: readonly OnboardingInterviewTurn[],
  said: string,
): string | null {
  const wanted = said.trim();
  if (wanted.length === 0) return null;
  let at = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn !== undefined && turn.role === "PERSON" && turn.text === wanted) {
      at = i;
      break;
    }
  }
  if (at === -1) return null;
  const replies = turns
    .slice(at + 1)
    .filter((turn) => turn.role === "Q")
    .map((turn) => turn.text.trim())
    .filter((text) => text.length > 0);
  return replies.length === 0 ? null : replies.join(" ");
}
