/**
 * The sounds a person makes while they think (founder direction
 * 2026-09-29: "sometimes it can start with 'hm?'... if it's taking a
 * while, it can start humming").
 *
 * Decided by time, never by the words asked: when Q's first sentence has
 * not arrived by the time a person would say "hm", Q says it; when it is
 * still working a few seconds later, Q hums once. A quick answer gets
 * neither, so the beats come only when there is a pause to fill. They
 * are voiced and never recorded as part of the answer.
 *
 * This supersedes the 2026-09-27 rule against spoken fillers for these
 * two sounds only; progress lines ("Checking the web...") stay silent.
 */

export type ThinkingBeatsOptions = {
  /** When the first beat is due, in milliseconds after the turn begins. */
  readonly hmAfterMs: number;
  /** When the hum is due, if nothing has arrived by then. */
  readonly humAfterMs: number;
  /** The beat's words; varied so it never sounds the same twice running. */
  readonly pick: (choices: readonly string[]) => string;
  readonly signal?: AbortSignal | undefined;
};

export const HM_CHOICES = ["Hmm.", "Hm.", "Mm, okay."] as const;
export const HUM_CHOICES = ["Mmm...", "Hmm-mm..."] as const;

const TIMEOUT = Symbol("timeout");

export async function* withThinkingBeats(
  source: AsyncIterable<string>,
  options: ThinkingBeatsOptions,
): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]();
  const started = Date.now();
  let first = true;
  let hmmed = false;
  let hummed = false;
  let pending = iterator.next();
  for (;;) {
    if (!first || options.signal?.aborted === true) {
      const step = await pending;
      if (step.done === true) return;
      yield step.value;
      pending = iterator.next();
      continue;
    }
    const due = hmmed ? options.humAfterMs : options.hmAfterMs;
    const wait = Math.max(0, due - (Date.now() - started));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      pending,
      hmmed && hummed
        ? new Promise<never>(() => undefined)
        : new Promise<typeof TIMEOUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMEOUT), wait);
          }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (outcome === TIMEOUT) {
      if (!hmmed) {
        hmmed = true;
        yield options.pick(HM_CHOICES);
      } else {
        hummed = true;
        yield options.pick(HUM_CHOICES);
      }
      continue;
    }
    if (outcome.done === true) return;
    first = false;
    yield outcome.value;
    pending = iterator.next();
  }
}
