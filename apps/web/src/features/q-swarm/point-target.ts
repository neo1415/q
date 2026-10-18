/**
 * Which thing on the screen a sentence of Q's names, if any.
 *
 * Matched against the labels the page itself shows (a navigation item, a
 * button, a heading), whole words only, longest label first so "Book a
 * call" wins over "call". Q's own sentence, never the person's words.
 */
export type PointCandidate = {
  readonly label: string;
  readonly element: Element;
};

const MIN_LABEL = 4;
const MAX_LABEL = 40;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pointTargetFor(
  sentence: string,
  candidates: readonly PointCandidate[],
): Element | null {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      label: candidate.label.replace(/\s+/g, " ").trim(),
    }))
    .filter(
      (candidate) =>
        candidate.label.length >= MIN_LABEL &&
        candidate.label.length <= MAX_LABEL,
    )
    .toSorted((a, b) => b.label.length - a.label.length);
  for (const candidate of ranked) {
    const pattern = new RegExp(`(^|\\W)${escape(candidate.label)}(\\W|$)`, "i");
    if (pattern.test(sentence)) return candidate.element;
  }
  return null;
}
