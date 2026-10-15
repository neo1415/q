/**
 * Lane S 2026-10-15 (lane A: "put those three in a table" ran public web
 * research on "how to put tables side by side in Word"): a request to show
 * what Q has just shown in another form -- a table, a list, side by side,
 * shorter -- is about those records. It re-renders them from the
 * conversation and never reaches the public web. Read by code from the
 * words alone; it grants nothing, only takes the web away for the turn.
 *
 * Only with a pointing word ("those", "them", "the three", "the cards") and
 * an earlier answer to point at; never for a how-to question ("how do I put
 * tables side by side in Word?") or words that ask for the web.
 */

const VERB =
  /\b(?:put|show|lay|set|format|display|arrange|present|give|make|turn|list|organi[sz]e|compare|redo|reformat|re-?render|break|line|stack|rank|sort|summari[sz]e)\b/iu;

const POINTING =
  /\b(?:those|these|them|they|that|this|it|both|all\s+(?:three|four|five|of\s+them)|the\s+(?:(?:first|last|top|other)\s+)?(?:two|three|four|five|six|\d+|results?|cards?|companies|investors|firms|applications|relationships|ones?|same|above|list|options)|the\s+ones?\s+(?:above|you\s+(?:just\s+)?(?:showed|listed|gave|found)))\b/iu;

const FORM =
  /\b(?:table|tabular|list|bullets?|bullet\s+points|columns?|rows?|side\s+by\s+side|grid|chart|spreadsheet|comparison|one\s+line\s+each|shorter|briefer|summary|order)\b/iu;

/** A question about how to do something, not a request to Q to do it. */
const HOW_TO =
  /^\s*(?:how\s+(?:do|can|would|should)\s+(?:i|we|you|one)|what(?:'s| is)\s+the\s+best\s+way\s+to)\b/iu;

/** Words that ask for the web (kept in step with the specialist's S7 list). */
const NAMES_THE_WEB =
  /\b(?:web|online|internet|news|press|google|search(?:\s+for)?|look\s+(?:it|them|this|that)\s+up|word|excel|powerpoint|google\s+docs|sheets)\b/iu;

export function reRenderAskOf(
  text: string,
  hasEarlierAnswer: boolean,
): boolean {
  if (!hasEarlierAnswer) return false;
  const said = text.trim();
  if (said.length === 0 || said.length > 200) return false;
  if (HOW_TO.test(said) || NAMES_THE_WEB.test(said)) return false;
  return VERB.test(said) && POINTING.test(said) && FORM.test(said);
}
