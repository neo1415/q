/**
 * Search terms for the deterministic parts of step-5 retrieval: the local
 * reranker's overlap and the query planner's de-duplication.
 *
 * This is text normalisation for ranking, not a reading of what anyone
 * meant: it never decides what a turn is about, which subject it names or
 * what to do. Postgres's own `english` parser remains the only thing that
 * turns words into the lexical search; this mirrors it closely enough
 * (lowercase, stop words out, plural and verb endings folded) for two
 * texts to be compared on the same footing.
 */

// Postgres's `english` stop words, the subset that occurs in questions.
const STOP = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him " +
    "himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other " +
    "our ours ourselves out over own same she should so some such than that the their theirs them themselves then there " +
    "these they this those through to too under until up very was we were what when where which while who whom why will " +
    "with would you your yours yourself yourselves s t don shouldn wasn weren won isn aren didn doesn hasn haven let ll re ve d m"
  ).split(" "),
);

/** A crude English stem: enough to fold "burns"/"burned"/"burning". */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ly") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4 && /(?:ss|x|ch|sh)es$/u.test(word))
    return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The normalised terms of a text, in order, with repeats. */
export function searchTerms(text: string): readonly string[] {
  const words = text
    .toLowerCase()
    .replace(/[’']s\b/gu, "")
    .split(/[^\p{L}\p{N}%$.]+/u)
    .map((word) => word.replace(/^[.]+|[.]+$/gu, ""))
    .filter((word) => word.length > 0);
  const out: string[] = [];
  for (const word of words) {
    if (STOP.has(word)) continue;
    out.push(stem(word));
  }
  return out;
}

/** The distinct normalised terms of a text. */
export function distinctTerms(text: string): ReadonlySet<string> {
  return new Set(searchTerms(text));
}
