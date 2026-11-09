/**
 * Q's reply on the live line, as one line (owner report 2026-11-04).
 *
 * The reply used to end each time the player's level dipped below the
 * speaking threshold. Audio arrives in chunks and dips between them, so
 * one reply ended several times mid-sentence, even mid-word: each piece got
 * its own transcript key and its own stored segment, and the conversation
 * mirror (B1) wrote each segment as its own Q message. Chat showed
 * "I don't have a task from" / "you yet." / … / "Tensorg" / "ate" as
 * separate rows.
 *
 * A reply now ends only when Q has been quiet for `settleMs` with no new
 * words, when the person starts speaking, or when the call ends. The words
 * are the provider's deltas concatenated exactly as sent: nothing is
 * inserted between them, so a word split across two deltas stays one word.
 */

export type ReplyTranscript = {
  readonly key: string;
  readonly role: "q";
  readonly text: string;
  readonly final: boolean;
};

export type ReplyLineDependencies = {
  readonly onTranscript: (line: ReplyTranscript) => void;
  /** Q's finished words, once per reply, for the stored transcript. */
  readonly keep: (text: string) => void;
  /** How long Q stays quiet, with no new words, before the reply ends. */
  readonly settleMs: number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
};

export type ReplyLine = {
  /** A transcript delta from the provider. */
  readonly delta: (text: string) => void;
  /** The player's level crossed the speaking threshold. */
  readonly speaking: (on: boolean) => void;
  /** The person spoke over Q: what was said is kept, the reply ends. */
  readonly interrupted: () => void;
  /** The call ended: what was said is kept. */
  readonly end: () => void;
  readonly open: () => boolean;
  /** What Q has said so far in this reply ("" when none is open). */
  readonly saying: () => string;
};

export function createReplyLine(deps: ReplyLineDependencies): ReplyLine {
  const setTimer =
    deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer =
    deps.clearTimer ??
    ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let reply: { key: string; text: string } | null = null;
  let count = 0;
  let timer: unknown = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const settle = () => {
    timer = null;
    const done = reply;
    reply = null;
    if (done === null) return;
    deps.keep(done.text);
    deps.onTranscript({
      key: done.key,
      role: "q",
      text: done.text.trim(),
      final: true,
    });
  };
  const drop = () => {
    cancel();
    if (reply !== null) deps.keep(reply.text);
    reply = null;
  };

  return {
    delta: (text) => {
      cancel();
      if (reply === null) {
        count += 1;
        reply = { key: `live_q${String(count)}`, text: "" };
      }
      reply.text += text;
      deps.onTranscript({
        key: reply.key,
        role: "q",
        text: reply.text.trim(),
        final: false,
      });
    },
    speaking: (on) => {
      if (on) {
        cancel();
        return;
      }
      if (reply === null || timer !== null) return;
      timer = setTimer(settle, deps.settleMs);
    },
    interrupted: drop,
    end: drop,
    open: () => reply !== null,
    saying: () => reply?.text ?? "",
  };
}

/** Words that only keep the speaker going: never a turn of their own. */
const BACKCHANNEL = new Set([
  "mm",
  "mmm",
  "hmm",
  "mhm",
  "mm-hmm",
  "uh-huh",
  "uh",
  "huh",
  "um",
  "ah",
  "oh",
  "yeah",
  "yes",
  "yep",
  "ok",
  "okay",
  "right",
  "sure",
  "got",
  "it",
  "i",
  "see",
]);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .match(/[a-z0-9'-]+/gu) ?? [];

/**
 * Whether what the person has said so far over Q's reply ends it (owner,
 * live voice onboarding 9 Nov: Q's lines were kept cut mid-sentence on a
 * "mm"). A backchannel ("mm", "yeah", "okay, right") keeps the reply
 * going, as does Q's own voice heard back (its words are in what Q is
 * saying). Anything else is the person taking the turn.
 */
export function interruptsReply(heard: string, qSaying: string): boolean {
  const words = wordsOf(heard);
  if (words.length === 0) return false;
  if (words.every((word) => BACKCHANNEL.has(word))) return false;
  const saying = ` ${wordsOf(qSaying).join(" ")} `;
  if (words.length >= 2 && saying.includes(` ${words.join(" ")} `)) {
    return false;
  }
  return true;
}
