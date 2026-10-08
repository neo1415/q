import { speakable } from "./speech.js";

/**
 * Decision cards on the standard voice line (RECOVERY A, audit E-03).
 *
 * The duplex line hands a reply about the card in focus to the card's own
 * code in the browser (`decide_card`). The standard line has no model in
 * the browser: Deepgram sends every turn to the think route. So when a
 * card is in focus and the words read as a reply about it, the think
 * holds briefly for the browser's verdict. The browser reads the words
 * with the card's code (the same one the buttons use); when it decided
 * the card, Q says what happened (built here from its facts) instead of
 * running a Q turn on "send it". When it did not, or no verdict comes in
 * time, the turn goes to Q as any other.
 *
 * Process-local: a verdict on another instance just times out, and the
 * turn goes to Q. Never authority: the browser's card code decided, under
 * the person's own session, exactly as a button tap does.
 */

/** How long a think waits for the browser's verdict. */
export const CARD_VERDICT_WAIT_MS = 3_000;

export type CardVerdict = {
  readonly handled: boolean;
  readonly outcome?: Readonly<Record<string, unknown>> | undefined;
};

export type VoiceCardTurns = {
  readonly setFocus: (voiceSessionId: string, inFocus: boolean) => void;
  readonly inFocus: (voiceSessionId: string) => boolean;
  /** The browser's verdict for these words, or null in time. */
  readonly verdict: (
    voiceSessionId: string,
    words: string,
    signal: AbortSignal,
    waitMs?: number,
  ) => Promise<CardVerdict | null>;
  readonly resolve: (
    voiceSessionId: string,
    words: string,
    verdict: CardVerdict,
  ) => void;
};

/** Words compared loosely: case, spacing and end punctuation aside. */
function key(words: string): string {
  return words
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VERDICT_KEPT_MS = 10_000;

export function createVoiceCardTurns(
  options: { readonly now?: (() => number) | undefined } = {},
): VoiceCardTurns {
  const now = options.now ?? Date.now;
  const focus = new Map<string, number>();
  /** Verdicts that arrived before (or without) a waiting think. */
  const early = new Map<string, { verdict: CardVerdict; at: number }>();
  const waiting = new Map<string, (verdict: CardVerdict) => void>();
  const prune = () => {
    for (const [k, entry] of early) {
      if (now() - entry.at > VERDICT_KEPT_MS) early.delete(k);
    }
  };
  return {
    setFocus: (id, inFocus) => {
      if (inFocus) focus.set(id, now());
      else focus.delete(id);
    },
    inFocus: (id) => focus.has(id),
    verdict: (id, words, signal, waitMs = CARD_VERDICT_WAIT_MS) => {
      prune();
      const k = `${id}|${key(words)}`;
      const ready = early.get(k);
      if (ready !== undefined) {
        early.delete(k);
        return Promise.resolve(ready.verdict);
      }
      return new Promise((resolve) => {
        const done = (verdict: CardVerdict | null) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", aborted);
          if (waiting.get(k) === settle) waiting.delete(k);
          resolve(verdict);
        };
        const settle = (verdict: CardVerdict) => {
          done(verdict);
        };
        const aborted = () => {
          done(null);
        };
        const timer = setTimeout(() => {
          done(null);
        }, waitMs);
        signal.addEventListener("abort", aborted, { once: true });
        waiting.set(k, settle);
      });
    },
    resolve: (id, words, verdict) => {
      const k = `${id}|${key(words)}`;
      const settle = waiting.get(k);
      if (settle !== undefined) settle(verdict);
      else early.set(k, { verdict, at: now() });
    },
  };
}

function plain(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const said = speakable(value).replace(/\s+/g, " ").trim().slice(0, max);
  return said.length === 0 ? null : said;
}

function sentence(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

/** The first words of a long text, for reading back. */
function gist(text: string, words = 18): string {
  const all = text.split(/\s+/);
  return all.length <= words ? text : `${all.slice(0, words).join(" ")}…`;
}

/**
 * What Q says after the card's code decided a spoken reply: what was done,
 * then the next card put to them, or what is still needed. Built from the
 * outcome's facts (the browser's, so bounded and made speakable here),
 * never from a model; the browser's situations are for a model to phrase,
 * so they are mapped to plain lines rather than read out.
 */
export function spokenCardOutcome(
  outcome: Readonly<Record<string, unknown>> | undefined,
): string {
  if (outcome === undefined) return "Done.";
  const parts: string[] = [];
  const done = plain(outcome.done);
  if (done !== null) parts.push(sentence(done));
  const edited = plain(outcome.editedMessageOnScreen, 2_000);
  if (edited !== null) {
    parts.push(`Here's the changed message: "${gist(edited)}" Send this?`);
    return parts.join(" ");
  }
  const next = outcome.nextCard;
  if (next !== null && typeof next === "object") {
    const card = next as Readonly<Record<string, unknown>>;
    const to = plain(card.to, 120) ?? "them";
    const position = card.position;
    const of = card.of;
    const lead =
      typeof position === "number" && typeof of === "number" && of > 1
        ? position === of
          ? "Last one: "
          : "Next, "
        : "";
    const proposed = plain(card.proposed);
    const wrote = plain(card.theyWrote, 200);
    if (card.kind === "a message Q held back") {
      parts.push(
        `${lead}I held back a message to ${to}. It's on screen: send it as it is, change it, or drop it?`,
      );
    } else if (proposed !== null) {
      parts.push(`${lead}${sentence(proposed)} Shall I go ahead?`);
    } else if (wrote !== null) {
      parts.push(
        `${lead}${to} wrote: "${gist(wrote, 14)}" I've drafted a reply. Send it?`,
      );
    } else {
      parts.push(`${lead}I've drafted a message to ${to}. Send it?`);
    }
    return parts.join(" ");
  }
  const situation =
    typeof outcome.situation === "string" ? outcome.situation : "";
  if (/last card/i.test(situation)) {
    parts.push("That was the last one. What's next?");
  } else if (/move on|Needs you on Work/i.test(situation)) {
    parts.push(
      "Fine. Anything left is in Needs you on Work. What would you like to talk about?",
    );
  } else if (outcome.ok === false) {
    parts.push(
      done === null
        ? "That didn't go through. It's still on your screen to decide."
        : "The rest is on your screen.",
    );
  }
  return parts.length === 0 ? "Done." : parts.join(" ");
}
