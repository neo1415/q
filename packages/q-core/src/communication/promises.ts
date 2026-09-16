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

/**
 * Removes leading sentences that only promise to act.
 *
 * Never removes everything: an answer that is nothing but a promise is
 * left exactly as it is, because the failure there is that no answer was
 * written, and silently deleting it would hide that rather than fix it.
 */
export function stripEmptyPromises(text: string): PromiseStripResult {
  const sentences = sentencesOf(text);
  const removed: string[] = [];
  let index = 0;
  while (index < sentences.length - 1) {
    const sentence = (sentences[index] ?? "").trim();
    if (!PROMISE_SENTENCE.test(sentence) || !PROMISE_VERB.test(sentence)) {
      break;
    }
    removed.push(sentence);
    index += 1;
  }
  if (removed.length === 0) {
    return { text, removed: [] };
  }
  return { text: sentences.slice(index).join("").trim(), removed };
}
