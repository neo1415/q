/**
 * HQ-6 (conversation audit §2.1 item 2): a streamed sentence the stored
 * answer no longer holds is a retraction: the person saw (or heard) it,
 * then the screen changed. Counted per answer and logged by kind and
 * count only, never the words; the target for a figure is 0. Nothing here
 * changes what is said or stored: no completion check is weakened to cut
 * the count.
 */
export type StreamRetractions = {
  readonly count: number;
  /** FIGURE: it carried a number; TEXT: anything else. */
  readonly kinds: { readonly FIGURE: number; readonly TEXT: number };
};

const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[*_`#>|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

export function streamRetractions(
  streamed: readonly string[],
  stored: string,
): StreamRetractions {
  const kept = plain(stored);
  let figure = 0;
  let text = 0;
  for (const sentence of streamed) {
    const one = plain(sentence);
    if (one.length === 0 || kept.includes(one)) continue;
    if (/\d/u.test(one)) figure += 1;
    else text += 1;
  }
  return { count: figure + text, kinds: { FIGURE: figure, TEXT: text } };
}
