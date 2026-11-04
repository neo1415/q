/**
 * Acceptance 2026-11-04 (J3): "Write me a one-page memo on Ledgerline"
 * came back as a two-page brief. A page count is a length the person set,
 * not an interpretation of what they meant, so it is read from their own
 * words: one page (in figures or words, "one-pager", "single page").
 */
const ONE_PAGE =
  /\b(?:one|1|single)[\s-]*pag(?:e|er)s?\b|\bone[\s-]*sheet(?:er)?\b|\bune\s+page\b/iu;

export function asksForOnePage(words: string): boolean {
  return ONE_PAGE.test(words);
}
