import type { QRecordPage } from "@capital-q/contracts";
import { spokenNameScore } from "@capital-q/q-tools";

import { PAGE_VERB, pageRequestOf, withoutLeadIn } from "./page-request.js";

/**
 * RECOVERY-2026-10 (C, INC-1 live 2026-10-08 19:20-19:22): navigation by a
 * record's name, read by code before any model.
 *
 * "Take me to Shiftwell relationship" went to the relationships list;
 * "Open Shiftwell" and "Show me the data room for Shiftwell" were answered
 * "Understood." with nothing opened; "I want to see the data room for
 * Shiftwell" got a clarification about documents. Each names ONE record
 * and a part of it. Here code reads the name and the part from the words;
 * the answer resolves the name against the person's own relationships
 * first (then what open_page lets them reach), opens exactly that record
 * through open_page's authorize step, or says in one short line which
 * names it could mean -- never "Understood." with nothing done.
 */

/** Which part of the record they asked for. */
export type NamedRecordFacet =
  "PAGE" | "RELATIONSHIP" | "CHAT" | "DATA_ROOM" | "DECK" | "TEAM" | "ELEVATOR";

export type NamedRecordRequest = {
  /** The name as they said it ("Shiftwell"). */
  readonly name: string;
  readonly facet: NamedRecordFacet;
  /**
   * They plainly meant a record (a part named, or a proper name): an
   * unknown name is then said so, never handed to a model to improvise.
   */
  readonly explicit: boolean;
};

type FacetWords = { readonly facet: NamedRecordFacet; readonly words: string };

const FACETS: readonly FacetWords[] = [
  { facet: "DATA_ROOM", words: "data\\s*room|dataroom|diligence\\s+room" },
  { facet: "DECK", words: "(?:pitch\\s+)?deck" },
  { facet: "ELEVATOR", words: "elevator(?:\\s+pitch)?" },
  { facet: "TEAM", words: "team" },
  { facet: "CHAT", words: "chat|messages|conversation\\s+thread" },
  { facet: "RELATIONSHIP", words: "relationship|deal|pipeline\\s+entry" },
  { facet: "PAGE", words: "company|profile|page|investor\\s+page" },
];

/** Not names: what a pointing word or a page means, never a record. */
const NOT_A_NAME =
  /^(?:it|that|this|them|those|these|one|(?:the\s+)?(?:first|second|third|fourth|fifth|last|next|previous)(?:\s+one)?|everything|anything|something|documents?|files?|my\s+documents?)$/iu;

function clean(text: string): string {
  return text
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, " ")
    .replace(/^(?:the|my|our|a|an)\s+/iu, "")
    .replace(/\s+(?:please|for me|now|again)$/iu, "")
    .replace(/^["“]|["”]$/gu, "")
    .trim();
}

function asName(raw: string): string | null {
  const name = clean(raw)
    .replace(/'s$/u, "")
    .replace(/\s+(?:page|profile)$/iu, "")
    .trim();
  if (name.length < 2 || name.length > 60) return null;
  if (!/\p{L}/u.test(name)) return null;
  if (NOT_A_NAME.test(name)) return null;
  // A part's own name ("the data room", "the deck") names no record.
  if (
    FACETS.some(({ words }) => new RegExp(`^(?:${words})$`, "iu").test(name))
  ) {
    return null;
  }
  return name;
}

/** One sentence's object, read for a name and a part. */
function fromObject(object: string): NamedRecordRequest | null {
  const said = clean(object);
  for (const { facet, words } of FACETS) {
    // "the data room for Shiftwell", "my relationship with Shiftwell",
    // "the chat with Shiftwell".
    const after = new RegExp(
      // "the pitch deck tab for ...": the screen's own word may sit between.
      `^(?:${words})(?:\\s+(?:tab|page|section))?\\s+(?:for|of|with|from|at)\\s+(.+)$`,
      "iu",
    ).exec(said);
    // "Shiftwell's data room", "Shiftwell relationship", "Shiftwell deck".
    const before = new RegExp(`^(.+?)(?:'s)?\\s+(?:${words})$`, "iu").exec(
      said,
    );
    const raw = after?.[1] ?? before?.[1];
    if (raw === undefined) continue;
    const name = asName(raw);
    if (name === null) continue;
    return { name, facet, explicit: true };
  }
  const name = asName(said);
  if (name === null) return null;
  // A bare name: a record when it is a proper name (spoken transcripts and
  // typed names carry the capital), or two words or fewer of plain text.
  const proper = /\p{Lu}/u.test(name);
  if (!proper && name.split(" ").length > 2) return null;
  return { name, facet: "PAGE", explicit: proper };
}

/**
 * The record a navigation request names, or null when the words are not
 * one (a page Capital Q has by name, a question, a pointing word). The last
 * sentence that asks to go somewhere decides ("You open documents. I want
 * to see the data room for Shiftwell." is the data room).
 */
export function namedRecordRequestOf(text: string): NamedRecordRequest | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => withoutLeadIn(sentence).replace(/[.!?]+$/u, ""))
    .filter((sentence) => sentence.length > 0 && sentence.length <= 160);
  for (const sentence of [...sentences].reverse()) {
    // A page Capital Q has by that name is the page, not a record.
    if (pageRequestOf(sentence)?.kind === "PAGE") return null;
    const object = PAGE_VERB.exec(sentence)?.[1]?.trim();
    if (object === undefined || object.length === 0) continue;
    const found = fromObject(object);
    if (found !== null) return found;
  }
  return null;
}

/** Below this a spoken name is not taken to mean a counterpart. */
const MATCH_FLOOR = 0.45;
/** The best must lead the next by this much, or it is ambiguous. */
const MATCH_LEAD = 0.1;

export type CounterpartMatch =
  | { readonly kind: "ONE"; readonly name: string }
  | { readonly kind: "SEVERAL"; readonly names: readonly string[] }
  | { readonly kind: "NONE"; readonly near: readonly string[] };

/**
 * Which of their own relationships' counterparts a spoken name means: one,
 * several too close to tell apart (never guessed between), or none (with
 * the closest few, to name in the clarification).
 */
export function matchOwnCounterpart(
  spoken: string,
  names: readonly string[],
): CounterpartMatch {
  const scored = [...new Set(names)]
    .map((name) => ({ name, score: spokenNameScore(spoken, name) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best === undefined || best.score < MATCH_FLOOR) {
    return {
      kind: "NONE",
      near: scored
        .filter((entry) => entry.score >= 0.25)
        .slice(0, 3)
        .map((entry) => entry.name),
    };
  }
  const close = scored.filter(
    (entry) =>
      entry.score >= MATCH_FLOOR && best.score - entry.score < MATCH_LEAD,
  );
  if (close.length > 1) {
    return { kind: "SEVERAL", names: close.slice(0, 4).map((e) => e.name) };
  }
  return { kind: "ONE", name: best.name };
}

/** Letters and digits only: "Tensor Gate", "tensor-gate" and "Tensorgate" are one name. */
function compact(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * RECOVERY-2026-10 (C, live 2026-10-09): one of their own counterparts
 * written inside the words, spacing and punctuation aside ("the pitch deck
 * tab for that Yes Tensor gate Tensor gate" holds Tensorgate). Only their
 * own, closed and authorised set; never a guess between two.
 */
export function ownCounterpartWithin(
  words: string,
  names: readonly string[],
): string | null {
  const said = compact(words);
  const found = [...new Set(names)].filter((name) => {
    const key = compact(name);
    return key.length >= 4 && said.includes(key);
  });
  return found.length === 1 ? (found[0] ?? null) : null;
}

/** Words no company or investor name is made of. */
const NOT_NAME_WORD = new Set([
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "us",
  "it",
  "its",
  "that",
  "this",
  "these",
  "those",
  "then",
  "there",
  "here",
  "where",
  "what",
  "which",
  "who",
  "when",
  "how",
  "why",
  "can",
  "could",
  "would",
  "should",
  "will",
  "review",
  "see",
  "look",
  "yes",
  "no",
  "yeah",
  "okay",
  "ok",
  "please",
  "for",
  "tab",
  "about",
  "is",
  "are",
  "was",
  "be",
  "do",
  "did",
  "if",
  "so",
  "but",
  "just",
  "maybe",
  "guess",
  "think",
  "want",
  "need",
  "them",
  "they",
  "him",
  "her",
]);

/**
 * Whether words could be a record's name: a few words, none of them the
 * words a sentence is made of, none repeated. Live 2026-10-09 Q answered
 * `I can't find "where I can review it then"`: a phrase that is not a
 * name is left to Q silently, never quoted back as one.
 */
export function plausibleName(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/u, "")
    .split(/[^\p{L}\p{N}&'-]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 4) return false;
  if (new Set(words).size !== words.length) return false;
  return words.every((word) => !NOT_NAME_WORD.has(word.replace(/'s$/u, "")));
}

/**
 * The pages to try for a part, in order: the person's side decides which
 * kind of record their counterparts are (an investor's are companies, a
 * founder's investors); the other kind is tried after, since the network
 * reaches both. open_page authorises each.
 */
export function pagesFor(
  facet: NamedRecordFacet,
  side: "INVESTOR" | "FOUNDER",
): readonly QRecordPage[] {
  const company: Readonly<Record<NamedRecordFacet, readonly QRecordPage[]>> = {
    PAGE: ["COMPANY", "RELATIONSHIP_COMPANY"],
    RELATIONSHIP: ["RELATIONSHIP_COMPANY", "COMPANY"],
    CHAT: ["RELATIONSHIP_COMPANY_MESSAGES"],
    DATA_ROOM: ["COMPANY_DATA_ROOM"],
    DECK: ["COMPANY_DECK"],
    TEAM: ["COMPANY_TEAM"],
    ELEVATOR: ["COMPANY_ELEVATOR"],
  };
  // An investor organisation has no data room, deck or team tabs of its
  // own: the relationship (where diligence is shared) is its page for them.
  const investor: Readonly<Record<NamedRecordFacet, readonly QRecordPage[]>> = {
    PAGE: ["RELATIONSHIP_INVESTOR", "INVESTOR"],
    RELATIONSHIP: ["RELATIONSHIP_INVESTOR", "INVESTOR"],
    CHAT: ["RELATIONSHIP_INVESTOR_MESSAGES"],
    DATA_ROOM: ["RELATIONSHIP_INVESTOR"],
    DECK: [],
    TEAM: [],
    ELEVATOR: [],
  };
  return side === "INVESTOR"
    ? [...company[facet], ...investor[facet]]
    : [...investor[facet], ...company[facet]];
}

const PART_WORDS: Readonly<Record<NamedRecordFacet, string>> = {
  PAGE: "",
  RELATIONSHIP: " relationship",
  CHAT: " chat",
  DATA_ROOM: " data room",
  DECK: " deck",
  TEAM: " team",
  ELEVATOR: " elevator pitch",
};

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

/** One short, truthful line when the name means several of theirs. */
export function whichOneLine(names: readonly string[]): string {
  return `Which one do you mean: ${listed(names)}?`;
}

/** Theirs, but that part of it is not one they can open. */
export function cannotOpenPartLine(
  request: NamedRecordRequest,
  name: string,
): string {
  return request.facet === "PAGE" || request.facet === "RELATIONSHIP"
    ? `I can't open "${name.slice(0, 60)}" from here right now.`
    : `"${name.slice(0, 60)}" has no${PART_WORDS[request.facet]} I can open for you.`;
}

/** One short, truthful line when nothing of theirs is called that. */
export function notFoundLine(
  request: NamedRecordRequest,
  near: readonly string[],
): string {
  const asked = `"${request.name.slice(0, 60)}"${PART_WORDS[request.facet]}`;
  return near.length === 0
    ? `I can't find ${asked} among your relationships or anything you can open. Who do you mean?`
    : `I can't find ${asked}. Did you mean ${listed(near)}?`;
}
