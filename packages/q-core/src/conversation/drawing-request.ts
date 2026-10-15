/**
 * Owner 2026-10-15 ("I asked for a map, it showed the map after a long
 * while but immediately switched to the profile of that company"): a
 * request to SEE something drawn -- a map, a chart, a timeline -- is not a
 * request to go anywhere. Hosted, "show me a map of where Tensorgate is"
 * was read by code as "open Tensorgate" (the words after "show me" taken
 * as a record's name), and a model answer that drew the map also carried
 * an open_page move nobody asked for, so the map was replaced by the
 * profile the moment it landed.
 *
 * Pure code over the person's own words, shared by the readers that open
 * pages and records (q-specialists), the answer's assembly (model gateway)
 * and the browser's follow rule.
 */

const DRAWN =
  "(?:maps?|charts?|graphs?|plots?|timelines?|diagrams?|heat\\s*maps?|visuali[sz]ations?)";
const DRAWN_KIND =
  "(?:world|global|regional|quick|simple|small|interactive|bar|line|pie|scatter)";

/** An object that IS a drawing: "a map of ...", "the chart", "a world map". */
const DRAWING_OBJECT = new RegExp(
  `^(?:(?:a|an|the|my|our|this|that|some|me\\s+a)\\s+)?(?:${DRAWN_KIND}\\s+)?${DRAWN}\\b`,
  "iu",
);

/** A sentence that asks for something drawn: "on a map", "as a chart". */
const DRAWN_AS = new RegExp(
  `\\b(?:on|in|as|into|onto|with)\\s+(?:a|an|the)\\s+(?:${DRAWN_KIND}\\s+)?(?:${DRAWN}|tables?)\\b|\\b(?:map|chart|graph|plot)\\s+(?:out|it|them|where|how)\\b|\\b(?:draw|plot|chart|visuali[sz]e)\\s+(?:me\\s+)?(?:a|an|the|it|them|where|how|my|our)\\b`,
  "iu",
);

/** Whether the object of "show me ..." / "open ..." is itself a drawing. */
export function isDrawingObject(object: string): boolean {
  return DRAWING_OBJECT.test(object.trim());
}

/** Whether the words ask for something drawn (a map, a chart, a timeline). */
export function asksForDrawing(text: string): boolean {
  return text
    .replace(/[’]/gu, "'")
    .split(/(?<=[.!?])\s+/u)
    .some((sentence) => {
      if (DRAWN_AS.test(sentence)) return true;
      const object = SHOW_OR_MOVE.exec(sentence.trim())?.[1];
      return object !== undefined && isDrawingObject(object);
    });
}

const SHOW_OR_MOVE =
  /(?:^|\b)(?:show\s+me|give\s+me|can\s+i\s+see|let\s+me\s+see|i\s+(?:want|need|would\s+like|'d\s+like)\s+to\s+see|open(?:\s+up)?|pull\s+up|bring\s+up|draw(?:\s+me)?|make(?:\s+me)?|put\s+up)\s+(.+)$/iu;

/** A sentence that asks to be taken somewhere ("open X", "take me to X"). */
const MOVE =
  /(?:^|\b)(?:take\s+me\s+(?:back\s+)?(?:to|into)|bring\s+me\s+to|go\s+(?:back\s+)?to|navigate\s+to|switch\s+to|jump\s+to|head\s+to|let'?s\s+go\s+to|open(?:\s+up)?|pull\s+up|bring\s+up)\s+(.+)$/iu;

/** A sentence that says no to a move, or says where they already are. */
const NOT_A_MOVE =
  /\b(?:don'?t|do\s+not|never|instead\s+of|rather\s+than|didn'?t\s+ask|not\s+(?:the|their|its|a)\s+(?:page|profile))\b/iu;

/**
 * Whether the person's own words ask to be taken to a page or a record:
 * a move verb whose object is not a drawing, in a sentence that does not
 * say no ("I asked for a map, not the profile"). "Show me ..." alone is
 * not a move: it is how people ask to see things.
 */
export function asksForMove(text: string): boolean {
  return text
    .replace(/[’]/gu, "'")
    .split(/(?<=[.!?])\s+|\s*[,;]\s*(?:but|so|and|then)\s+/u)
    .some((sentence) => {
      const object = MOVE.exec(sentence.trim())?.[1];
      if (object === undefined) return false;
      if (isDrawingObject(object) || DRAWN_AS.test(sentence)) return false;
      return !NOT_A_MOVE.test(sentence);
    });
}
