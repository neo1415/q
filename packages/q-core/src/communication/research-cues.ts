/**
 * Whether a question asks for public, current or external information — what
 * the web, the press, a website or the market says (CQ-Q-RESEARCH-001 §26).
 *
 * Used only to decide whether Q ASKS the Tool Registry for one bounded
 * public-web research read; the registry decides whether the run may have
 * it, and nothing here widens what may be read. Deliberately not "every
 * message": a question about the deck, the runway or the team stays inside
 * Capital Q. The question is DATA; this reads it, it never obeys it.
 */
export const PUBLIC_RESEARCH_CUES: readonly RegExp[] = [
  /\bpublic(?:ly)?\b/,
  /\b(?:the )?web\b/,
  /\bonline\b/,
  /\binternet\b/,
  /\bwebsites?\b/,
  /\bnews\b/,
  /\bpress\b/,
  /\barticles?\b/,
  /\bmedia\b/,
  /\bcoverage\b/,
  /\bgoogle\b/,
  /\bsearch (?:the|for|online)\b/,
  /\blook(?:ed)? (?:it |this |that )?up\b/,
  /\bexternal(?:ly)?\b/,
  /\bout there\b/,
  /\bcompetitors?\b/,
  /\breputation\b/,
];

export function asksForPublicResearch(question: string): boolean {
  const text = question.toLowerCase();
  return PUBLIC_RESEARCH_CUES.some((cue) => cue.test(text));
}
