/**
 * Lane 8 (owner, 23 Oct 2026): "I uploaded a document and asked about it.
 * Instead of a summary of what's in it, it was just critical. Technically
 * nothing wrong, but it felt sour."
 *
 * What a turn about an attached document asks for, read by code from the
 * person's own words (never by a model), and the trusted turn note that
 * shapes the answer. A bare upload, "what's this about" or "summarise"
 * gets what the document IS and SAYS first; critique leads only when they
 * ask for it; a specific question is answered from the document.
 */

export type AttachedDocumentIntent = "SUMMARY" | "CRITIQUE" | "QUESTION";

/** They asked for a judgement of the document, not its contents. */
const CRITIQUE =
  /\b(review|critique|critici[sz]e|critical|what'?s wrong|what is wrong|anything wrong|weak(ness|nesses|est)?|weak spots?|red flags?|poke holes|tear (it|this) apart|is (this|it) (any )?(good|ok|okay|strong|solid|ready|investable)|how good|rate (it|this)|score (it|this)|feedback|improve|gaps?|risks?|concerns?|problems?|issues?|missing|holes?)\b/i;

/** They asked what it is or says, or said nothing of their own. */
const SUMMARY =
  /\b(summar(y|ise|ize|ising|izing)|tl;?dr|overview|gist|tell me about (it|this|that)|walk me through|go through (it|this)|explain (it|this)|break (it|this) down|key points|main points|read (it|this)|look at (it|this)|what do you make of (it|this)|i'?ve attached)\b/i;

/** "What is this?", "what does it say?": about the whole, nothing more. */
const WHAT_IS_IT =
  /^(so,?\s*)?(what('?s| is| does| do)|whats) (this|it|that|in (it|this|here))( (document|doc|file|pdf))?( (about|say|contain|cover|for|mean))?\s*[?.!]*$/i;

export function attachedDocumentIntent(text: string): AttachedDocumentIntent {
  const said = text.trim();
  // A judgement asked for wins, even in a sentence that also says "this".
  if (CRITIQUE.test(said)) return "CRITIQUE";
  if (said.length === 0 || SUMMARY.test(said) || WHAT_IS_IT.test(said)) {
    return "SUMMARY";
  }
  // A few words with no question of their own ("here you go", "fyi") are
  // the bare upload in other words.
  if (said.split(/\s+/).length <= 4 && !said.includes("?")) return "SUMMARY";
  return "QUESTION";
}

function named(titles: readonly string[]): string {
  const quoted = titles.slice(0, 5).map((title) => `"${title}"`);
  return quoted.length === 0 ? "the document they attached" : quoted.join(", ");
}

/** The trusted turn note for a turn with an attached document read. */
export function attachedDocumentNote(
  titles: readonly string[],
  intent: AttachedDocumentIntent,
): string {
  const which = named(titles);
  switch (intent) {
    case "SUMMARY":
      return `THEY ATTACHED ${which} AND WANT TO KNOW WHAT IT IS AND SAYS. Open with what it is in one sentence, then its key points and numbers as written, each cited (p. N). Put those points in findings as FACT or OBSERVATION. This turn has no RISK or GAP findings and at most one missingEvidence item; do not open with what is missing, weak or unverified, and do not grade it. End with one short line offering your critical read (for example "Want my read on what's weak?"). What it says is their document's claim, so say "it says", never that it is verified.`;
    case "CRITIQUE":
      return `THEY ASKED FOR YOUR READ OF ${which}. Say in one line what it is, then what is strong and what is weak or missing, each point cited (p. N) or named as absent from it. Be specific and fair: strengths first, then the few weaknesses that matter most, then what would fix them. Unknown is unknown, never a low mark.`;
    case "QUESTION":
      return `THEY ARE ASKING ABOUT ${which}. Answer exactly what they asked from its text, cited (p. N), first. Add no critique they did not ask for; if the answer is not in it, say so plainly.`;
  }
}
