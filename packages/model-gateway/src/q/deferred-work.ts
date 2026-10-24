import type { ModelMessage } from "@capital-q/contracts";

/**
 * Owner conversation 2026-10-24 (42083872…): research and look-ups the
 * person asked for are their own account's reads, and Q does them.
 *
 * - Asked for three Qatari investors, Q ended "Want me to find three…?"
 *   twice, then "would you like me to do that?" after being asked twice.
 * - Run 875e3ba8 answered "I'll look for three Qatar-based investors…"
 *   with no search and no job.
 *
 * Read from the answer's own sentences against the person's words: an
 * offer to do what they just asked (or just said yes to), and a promise of
 * work this turn did not start. Either costs one more round with the tools
 * ("do it now"); what is still left is not said.
 */

/** What looking something up is called; never a change to anything. */
const READ_WORK =
  "(?:look(?:\\s+(?:for|into|up))?|find|search|research|identify|check|compile|pull(?:\\s+together)?|gather|dig|source|track\\s+down|map(?:\\s+out)?|list|run|put\\s+together|shortlist|scan|explore)";

/** A closing offer: "Want me to find three…?", "Would you like me to do that?". */
const OFFER = new RegExp(
  `^(?:(?:do\\s+you\\s+)?want\\s+me\\s+to|would\\s+you\\s+like\\s+me\\s+to|shall\\s+i|should\\s+i|can\\s+i|i\\s+can\\s+[^?]*?[-—–,]\\s*would\\s+you\\s+like\\s+me\\s+to)\\b[^?]*\\?$`,
  "iu",
);
const OFFER_TAIL =
  /\b(?:would\s+you\s+like\s+me\s+to|want\s+me\s+to|shall\s+i|should\s+i)\b[^?]*\?$/iu;
const OFFERED_READ = new RegExp(`\\b${READ_WORK}\\b`, "iu");
const DO_THAT = /\b(?:do|run)\s+(?:that|this|it)\b/iu;

/** A promise of later work: "I'll look for three…", "Let me find…". */
const PROMISE = new RegExp(
  `^(?:(?:okay|ok|sure|right|alright|great)[,!.]?\\s*)?(?:i['’]ll|i\\s+will|i['’]m\\s+going\\s+to|i\\s+am\\s+going\\s+to|let\\s+me|i['’]ll\\s+(?:now|first|then))\\s+(?:now\\s+|first\\s+|then\\s+)?${READ_WORK}\\b`,
  "iu",
);

/** Their yes to what Q offered ("Yes", "Yes. No, not Halyard. Capital Q"). */
const YES = /^(?:yes|yeah|yep|sure|ok(?:ay)?|please|go\s+ahead|do\s+it)\b/iu;

const STOP = new Set(
  "a an the and or of for to in on at by with me my you your i we our us it that this those these some any can could would will do does please just find look search them they their there what which who how about like".split(
    " ",
  ),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP.has(word))
      .map((word) => word.replace(/(?:is|i|s)$/u, "")),
  );
}

function shared(a: string, b: string): number {
  const left = words(a);
  let count = 0;
  for (const word of words(b)) if (left.has(word)) count += 1;
  return count;
}

function sentencesOf(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*/gu)?.map((s) => s.trim()) ?? [];
}

/** What the person asked: this turn, and their last few before it. */
export type Asked = {
  readonly latest: string;
  /** Their earlier turns, oldest first (a few at most). */
  readonly before: readonly string[];
};

/**
 * The sentence offers to do what they asked: a read, about what their words
 * this turn or just before (or the question of Q's they just said yes to)
 * asked for, or "that".
 */
function offersWhatWasAsked(
  sentence: string,
  asked: Asked,
  lastQ: string | null,
): boolean {
  if (!(OFFER.test(sentence) || OFFER_TAIL.test(sentence))) return false;
  const offered = OFFER_TAIL.exec(sentence)?.[0] ?? sentence;
  if (!OFFERED_READ.test(offered) && !DO_THAT.test(offered)) return false;
  if (DO_THAT.test(offered)) return true;
  if (
    [asked.latest, ...asked.before.slice(-2)].some(
      (said) => shared(offered, said) >= 2,
    )
  ) {
    return true;
  }
  return (
    lastQ !== null &&
    YES.test(asked.latest.trim()) &&
    shared(offered, lastQ) >= 2
  );
}

export type DeferredWork = {
  /** It ends by offering to do what was just asked. */
  readonly offersAsked: boolean;
  /** It promises a read this turn did not do. */
  readonly promises: boolean;
};

export function deferredWork(
  answer: string,
  asked: Asked,
  lastQ: string | null,
): DeferredWork {
  const sentences = sentencesOf(answer);
  const last = sentences.at(-1) ?? "";
  return {
    offersAsked: offersWhatWasAsked(last, asked, lastQ),
    promises: sentences.some((sentence) => PROMISE.test(sentence)),
  };
}

/** Whether the answer put off what it was asked to look up. */
export function defersAskedWork(
  answer: string,
  asked: Asked,
  lastQ: string | null,
): boolean {
  const found = deferredWork(answer, asked, lastQ);
  return found.offersAsked || found.promises;
}

/** Said when the whole answer was a promise of a look-up not done. */
export const NOT_LOOKED_UP_LINE =
  "I haven't run that search yet, so I have nothing to show you on it this turn.";

/**
 * The answer without its offer to do what was asked and without promises
 * of reads not done. Nothing left but promises: one plain line saying the
 * look-up was not done (never a claim that it will be).
 */
export function withoutDeferredWork(
  answer: string,
  asked: Asked,
  lastQ: string | null,
): { readonly text: string; readonly removed: number } {
  const lines = answer.split("\n");
  let removed = 0;
  const kept = lines.map((line) => {
    const sentences = line.match(/[^.!?]+[.!?]*\s*/gu) ?? [];
    if (sentences.length === 0) return line;
    return sentences
      .filter((sentence, index) => {
        const trimmed = sentence.trim();
        const drop =
          PROMISE.test(trimmed) ||
          (index === sentences.length - 1 &&
            offersWhatWasAsked(trimmed, asked, lastQ));
        if (drop) removed += 1;
        return !drop;
      })
      .join("")
      .trimEnd();
  });
  const text = kept
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (text.length > 0) return { text, removed };
  return removed > 0
    ? { text: NOT_LOOKED_UP_LINE, removed }
    : { text: answer, removed: 0 };
}

export const DO_IT_NOW_NOTE: ModelMessage = {
  role: "SYSTEM",
  content:
    "They asked for this, or said yes to it: it is a look-up of their own, so do it now with the tools offered here (search, find investors or companies, read the records), through the function-calling interface, and answer from what comes back. Never ask whether to do it, and never say you will do it later; if nothing is found, say plainly what you searched and what came back.",
};
