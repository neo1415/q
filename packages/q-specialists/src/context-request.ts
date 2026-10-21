import { selfCorrected, takenBack, withoutLeadIn } from "./page-request.js";

/**
 * Lane 7 (owner 2026-10-21, binding: "names must NOT be required"): a
 * request that points instead of naming -- "open their deck", "open this
 * one", "show me that", "their stuff", "go back to the other one", "the
 * second one" -- read by code. Which record or document it means is the
 * screen's to decide from what is on it and what Q just talked about
 * (apps/web control/context-set.ts); this file only reads the words.
 *
 * Words only: nothing here knows who may see what. Whatever the pointer
 * lands on is opened through the page's or the viewer's own authorised
 * read, exactly as a click would.
 */

/** What part of a record is asked for; null: the record itself. */
export type ContextPart =
  | "DECK"
  | "DATA_ROOM"
  | "TEAM"
  | "CHAT"
  | "PROFILE"
  | "FINANCIALS"
  | "MEMO"
  | "DOCUMENT"
  /** "their stuff", "their materials": the subject's primary material. */
  | "STUFF";

export type ContextPointer =
  /** "this", "this one", "it", "the one I'm on". */
  | { readonly kind: "THIS" }
  /** "that", "that one": what was just shown or said. */
  | { readonly kind: "THAT" }
  /** "the other one": not the one in front of them. */
  | { readonly kind: "OTHER" }
  /** "the second one", "the last one" (-1). */
  | { readonly kind: "ORDINAL"; readonly position: number };

export type ContextAsk = {
  readonly pointer: ContextPointer | null;
  /** "their", "its", "his", "her": the subject in context owns the part. */
  readonly owned: boolean;
  readonly part: ContextPart | null;
};

const VERB =
  /^(?:(?:can|could|would|will)\s+you\s+|please\s+|q[,\s]+|just\s+)*(?:open(?:\s+up)?|show(?:\s+me)?|pull\s+up|bring\s+up|let\s+me\s+see|let'?s\s+see|view|display|go\s+(?:back\s+)?to|take\s+me\s+(?:back\s+)?to|switch\s+(?:back\s+)?to|jump\s+to|(?:i\s+(?:want|need|would\s+like|'d\s+like)\s+to\s+)?(?:see|open|look\s+at))\s+(.+)$/iu;

const PARTS: readonly (readonly [ContextPart, RegExp])[] = [
  ["DECK", /^(?:pitch\s+)?(?:deck|slides|pitch)$/iu],
  ["DATA_ROOM", /^(?:data\s*room|diligence\s+room)$/iu],
  ["TEAM", /^team$/iu],
  ["CHAT", /^(?:chat|messages|conversation|thread)$/iu],
  ["PROFILE", /^(?:profile|page|overview)$/iu],
  ["FINANCIALS", /^(?:financials?|numbers|financial\s+model|model)$/iu],
  ["MEMO", /^(?:memo|brief|one[\s-]pager|investment\s+memo|write[\s-]?up)$/iu],
  ["DOCUMENT", /^(?:doc|document|file|pdf)$/iu],
  ["STUFF", /^(?:stuff|materials?|things|docs|documents|files)$/iu],
];

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
};

function partOf(words: string): ContextPart | null | undefined {
  const bare = words.trim();
  if (bare.length === 0) return null;
  for (const [part, pattern] of PARTS) if (pattern.test(bare)) return part;
  return undefined;
}

/**
 * The pointing request the words make, or null when they name something
 * instead (a page, a record, a tab by name: other readers), or make none.
 */
export function contextAskOf(text: string): ContextAsk | null {
  const said = text.trim();
  if (said.length === 0 || said.length > 160 || takenBack(said)) return null;
  const words = withoutLeadIn(selfCorrected(said))
    .replace(/[’]/gu, "'")
    .replace(/[.!?…]+$/u, "")
    .replace(/^(?:(?:hey|ok|okay)\s+q\b[,\s]*)/iu, "")
    .replace(/[\s,]+(?:please|for\s+me|now|again|then|too)(?=[\s,]*$)/giu, "")
    .trim();
  const object = VERB.exec(words)?.[1]?.trim().replace(/\s+tab$/iu, "");
  if (object === undefined || object.length === 0) return null;

  // "it", "this", "that", "this one", "that one", "the one I'm on".
  const pointer =
    /^(?:it|this(?:\s+one)?|the\s+one\s+(?:i'?m|i\s+am)\s+(?:on|looking\s+at))$/iu.test(
      object,
    )
      ? ({ kind: "THIS" } as const)
      : /^(?:that(?:\s+one)?|them|those)$/iu.test(object)
        ? ({ kind: "THAT" } as const)
        : /^(?:the\s+)?other(?:\s+one)?$/iu.test(object)
          ? ({ kind: "OTHER" } as const)
          : null;
  if (pointer !== null) return { pointer, owned: false, part: null };

  // "the second one", "the last one", "the third company".
  const ordinal =
    /^(?:the\s+)?(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)(?:\s+(?:one|company|investor|card|result|document|doc))?(?:'s\s+(.+))?$/iu.exec(
      object,
    );
  if (ordinal !== null) {
    const position = ORDINALS[(ordinal[1] ?? "").toLowerCase()];
    const part = partOf(ordinal[2] ?? "");
    if (position === undefined || part === undefined) return null;
    return { pointer: { kind: "ORDINAL", position }, owned: part !== null, part };
  }

  // "their deck", "its data room", "this company's team", "that deck",
  // "the other one's deck".
  const owned =
    /^(?:their|its|his|her|(?:this|that)\s+(?:company|startup|investor|fund|firm)'s|(?:the\s+)?other\s+one'?s)\s+(.+)$/iu.exec(
      object,
    );
  if (owned !== null) {
    const part = partOf(owned[1] ?? "");
    if (part === undefined || part === null) return null;
    return {
      pointer: /\bother\b/iu.test(object) ? { kind: "OTHER" } : null,
      owned: true,
      part,
    };
  }
  const pointed = /^(this|that)\s+(.+)$/iu.exec(object);
  if (pointed !== null) {
    const part = partOf(pointed[2] ?? "");
    if (part === undefined || part === null) return null;
    return {
      pointer: { kind: pointed[1]?.toLowerCase() === "this" ? "THIS" : "THAT" },
      owned: false,
      part,
    };
  }
  // "the deck", "the financials", "the doc": the subject in context.
  const plain = /^the\s+(.+)$/iu.exec(object);
  if (plain !== null) {
    const part = partOf(plain[1] ?? "");
    if (part === undefined || part === null) return null;
    return { pointer: null, owned: false, part };
  }
  return null;
}
