import { bounded, sentences, speakable, SPOKEN_MAX_CHARS } from "./speech.js";

/**
 * A reply spoken while it is still being written (voice lane, latency).
 *
 * The interview loop hands over each complete sentence of its final reply
 * as the model writes it (`onSentence`, CQ-QX-008 P0-3). Waiting for the
 * whole turn before speaking put every reasoning second in front of the
 * first sound; live, 8 to 11 s of silence after the person stopped. This
 * is the queue between the two: sentences go in as they are written and
 * come out to the speaker as it can take them, in order, once each.
 *
 * What was voiced is recorded, so that the whole reply, when it settles,
 * adds only what the stream did not already say.
 */
export type LiveReply = {
  /** A sentence of the reply as written; made speakable here. */
  readonly push: (sentence: string) => void;
  /** No more sentences will come. */
  readonly close: () => void;
  /** What the speaker reads from. */
  readonly spoken: AsyncIterable<string>;
  /** The sentences handed to the speaker so far, as spoken. */
  readonly said: () => readonly string[];
  /**
   * What of the settled reply was not voiced: its sentences after the
   * ones the stream already said. When the streamed sentences are not the
   * start of the settled reply (the model's text was refused and written
   * again), nothing is added: the person has heard one version and a
   * second, different one would be Q contradicting itself mid-breath.
   */
  readonly remainderOf: (reply: string) => string;
};

const same = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export function createLiveReply(): LiveReply {
  const queued: string[] = [];
  const said: string[] = [];
  let closed = false;
  let characters = 0;
  let wake: (() => void) | null = null;
  const nudge = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };

  async function* spoken(): AsyncGenerator<string> {
    for (;;) {
      const next = queued.shift();
      if (next !== undefined) {
        said.push(next);
        yield next;
        continue;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    push: (sentence) => {
      if (closed) return;
      for (const part of sentences(speakable(sentence))) {
        // The spoken cap holds for a streamed reply as for a whole one.
        if (characters >= SPOKEN_MAX_CHARS) break;
        characters += part.length + 1;
        queued.push(part);
      }
      nudge();
    },
    close: () => {
      closed = true;
      nudge();
    },
    spoken: { [Symbol.asyncIterator]: spoken },
    said: () => [...said],
    remainderOf: (reply) => {
      const whole = sentences(bounded(speakable(reply)));
      if (said.length === 0) return whole.join(" ");
      const heard = said.length;
      const prefix = whole.slice(0, heard);
      if (
        prefix.length < heard ||
        !prefix.every((part, index) => same(part, said[index] ?? ""))
      ) {
        return "";
      }
      return whole.slice(heard).join(" ");
    },
  };
}
