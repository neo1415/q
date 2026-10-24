/**
 * A caption is the end of what Q is saying, at most two lines' worth,
 * starting on a whole word (QA QO-19, WCAG 1.2.4: the voice room showed
 * no words for what Q said).
 */
export function captionTail(text: string, max = 160): string {
  const plain = text.replace(/\s+/gu, " ").trim();
  if (plain.length <= max) return plain;
  const tail = plain.slice(plain.length - max);
  const space = tail.indexOf(" ");
  return `…${space < 0 ? tail : tail.slice(space + 1)}`;
}
