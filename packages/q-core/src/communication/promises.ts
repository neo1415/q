/**
 * A promise to go and do something, in an answer that is the doing.
 *
 * The most-reported thing about Q was that it says it will check
 * something and then either goes quiet or answers anyway, which reads as
 * a machine talking to itself. The charter tells the model not to do it,
 * and a prompt instruction is a hope: nothing checked, so nothing caught
 * it when the model wrote one anyway.
 *
 * This is the check. An answer is the result of the work, so an opening
 * sentence that announces the work is either redundant (the work is done,
 * the answer follows it) or false (no work was done). Both are removed.
 *
 * Only a LEADING sentence, and only when it is nothing but the promise:
 * "Let me check the filing and come back to you" inside a paragraph about
 * a filing is a real sentence about a real next step, and a rule that
 * mangled it would be worse than the tic it was fixing.
 */

/**
 * Whole-sentence shapes, anchored at both ends. Each is a complete turn
 * that says only "wait".
 */
const PROMISE_SENTENCE =
  /^(?:(?:okay|ok|right|sure|alright|well)[,!.]?\s*)?(?:(?:let me|i(?:'ll| will)|i'm going to|give me a|hold on|one|just a)\b[^.!?]{0,60})[.!?]$/i;

/**
 * The words that make it a promise rather than a sentence that happens to
 * start the same way. "I'll be direct" is not a promise to go away and
 * come back; "I'll look that up" is.
 */
const PROMISE_VERB =
  /\b(?:check|look|see|find|search|confirm|verify|pull|fetch|dig|review)(?:s|ed|ing)?\b|\b(?:moment|second|minute|sec)\b/i;

/** Splits on sentence ends while keeping the punctuation with its sentence. */
function sentencesOf(text: string): readonly string[] {
  return text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [];
}

export type PromiseStripResult = {
  /** The answer with any leading empty promise removed. */
  readonly text: string;
  /** What was removed, for the record. Empty when nothing was. */
  readonly removed: readonly string[];
};

/** Whether a sentence is nothing but a promise to go and do something. */
export function isEmptyPromise(sentence: string): boolean {
  const trimmed = sentence.trim();
  return PROMISE_SENTENCE.test(trimmed) && PROMISE_VERB.test(trimmed);
}

/**
 * Removes leading and trailing sentences that only promise to act.
 *
 * Leading, because the answer that follows is the work. Trailing, because
 * nothing follows at all: an answer that ends "Give me a moment to look
 * that up." was heard live as Q announcing work it then never did, and
 * the person waited. A promise in the middle of an answer stays; it is a
 * sentence about a next step, with the rest of the answer around it.
 *
 * Never removes everything: an answer that is nothing but a promise is
 * left exactly as it is, because the failure there is that no answer was
 * written, and silently deleting it would hide that rather than fix it.
 */
export function stripEmptyPromises(text: string): PromiseStripResult {
  const sentences = sentencesOf(text);
  const removed: string[] = [];
  let start = 0;
  while (start < sentences.length - 1) {
    const sentence = (sentences[start] ?? "").trim();
    if (!isEmptyPromise(sentence)) {
      break;
    }
    removed.push(sentence);
    start += 1;
  }
  let end = sentences.length;
  while (end - 1 > start) {
    const sentence = (sentences[end - 1] ?? "").trim();
    if (!isEmptyPromise(sentence)) {
      break;
    }
    removed.push(sentence);
    end -= 1;
  }
  if (removed.length === 0) {
    return { text, removed: [] };
  }
  return { text: sentences.slice(start, end).join("").trim(), removed };
}
