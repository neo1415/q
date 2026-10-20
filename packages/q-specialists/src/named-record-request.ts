import type { QRecordPage } from "@capital-q/contracts";
import { scoreOrgNames, scorePersonNames } from "@capital-q/q-core/names";
import { spokenNameScore } from "@capital-q/q-tools";
import { asksForDrawing, isDrawingObject } from "@capital-q/q-core/speech";
import { resolveLanguage } from "@capital-q/q-core/language";

import {
  PAGE_VERB,
  pageRequestOf,
  selfCorrected,
  withoutLeadIn,
} from "./page-request.js";
import { plausibleName } from "./plausible-name.js";

export { plausibleName };

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
  /**
   * Lane S 2026-10-15: read from a part only a company has ("tensorgate's
   * documents") with the name in lower case, as typed. Opened only when the
   * name is one of their own counterparts; anything else is left to Q.
   */
  readonly ownOnly?: true | undefined;
};

type FacetWords = {
  readonly facet: NamedRecordFacet;
  readonly words: string;
  /** Only with a proper name: "documents for my seed round" is not a record. */
  readonly properOnly?: true;
};

const FACETS: readonly FacetWords[] = [
  { facet: "DATA_ROOM", words: "data\\s*room|dataroom|diligence\\s+room" },
  // Owner 2026-10-15: "open Tensorgate's documents" opened the profile. A
  // company's documents are its data room (Q's own documents, "my
  // documents", stay the Documents page: they name no company).
  {
    facet: "DATA_ROOM",
    words: "documents?|docs|files|document\\s+room",
    properOnly: true,
  },
  { facet: "DECK", words: "(?:pitch\\s+)?deck" },
  { facet: "ELEVATOR", words: "elevator(?:\\s+pitch)?" },
  // "Tensorgate's pitch" is its pitch video, the Elevator tab ("pitch
  // deck" is read first, as DECK).
  { facet: "ELEVATOR", words: "pitch(?:\\s+video)?", properOnly: true },
  { facet: "TEAM", words: "team" },
  { facet: "CHAT", words: "chat|messages|conversation\\s+thread" },
  // Lane ov 2026-10-16: a CRM record is the relationship's own page.
  {
    facet: "RELATIONSHIP",
    words:
      "relationship|deal|pipeline\\s+entry|crm\\s+(?:record|entry|page)|record\\s+in\\s+(?:the\\s+|my\\s+)?crm|(?:in|on)\\s+(?:the\\s+|my\\s+)?crm",
  },
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
  // Lane S 2026-10-15 (audit, 10-10: "show me fintech companies in
  // Nigeria" said "I can't find ..." three times): a kind of record in the
  // plural, in lower case, names a search, not a record. A firm's own name
  // ("Kilima Angel Network", "Clearwater Investors") carries its capitals.
  if (CATEGORY_PLURAL.test(name)) return null;
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
  for (const { facet, words, properOnly } of FACETS) {
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
    // Typed in lower case, a part only a company has is still that
    // company's when the name is one of their own (resolveNamedRecord).
    if (properOnly === true && !/\p{Lu}/u.test(name)) {
      if (!/^(?:their|its|his|her|the|my|our|your)\b/iu.test(raw.trim())) {
        return { name, facet, explicit: true, ownOnly: true };
      }
      continue;
    }
    return { name, facet, explicit: true };
  }
  const name = asName(said);
  if (name === null) return null;
  // "their documents", "its files": the record on screen (tab-request.ts).
  if (/^(?:their|its|his|her)\s/iu.test(name)) return null;
  // A bare name: a record when it is a proper name (spoken transcripts and
  // typed names carry the capital), or two words or fewer of plain text.
  const proper = /\p{Lu}/u.test(name);
  if (!proper && name.split(" ").length > 2) return null;
  return { name, facet: "PAGE", explicit: proper };
}

/** Filler a language request carries ("French please", "the Swahili language"). */
const LANGUAGE_FILLER =
  /^(?:the\s+)?(.+?)(?:\s+(?:language|please|now|instead|for\s+me))*$/iu;

/**
 * "French", "Swahili please", "the English language", "العربية": a
 * language by the registry (any language the runtime can name, named in
 * any language), never a record to look up.
 */
function namesLanguage(object: string): boolean {
  const bare =
    LANGUAGE_FILLER.exec(object.trim().replace(/[.!?]+$/u, ""))?.[1] ?? "";
  // A name, not a code: "it", "no", "my", "id" are words before they are
  // Italian, Norwegian, Burmese or Indonesian.
  const aName = bare.length >= 4 || /[^\p{Script=Latin}\s]/u.test(bare);
  return aName && resolveLanguage(bare).ok;
}

/**
 * The record a navigation request names, or null when the words are not
 * one (a page Capital Q has by name, a question, a pointing word). The last
 * sentence that asks to go somewhere decides ("You open documents. I want
 * to see the data room for Shiftwell." is the data room).
 */
export function namedRecordRequestOf(text: string): NamedRecordRequest | null {
  // A self-correction names only its last place (page-request.ts).
  const sentences = selfCorrected(text)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => withoutLeadIn(sentence).replace(/[.!?]+$/u, ""))
    .filter((sentence) => sentence.length > 0 && sentence.length <= 160);
  for (const sentence of [...sentences].reverse()) {
    // A page Capital Q has by that name is the page, not a record.
    if (pageRequestOf(sentence)?.kind === "PAGE") return null;
    const object = PAGE_VERB.exec(sentence)?.[1]?.trim();
    if (object === undefined || object.length === 0) continue;
    // Owner 2026-10-15: "show me a map of where Tensorgate is" was opened
    // as Tensorgate's profile. A drawing asked for names no record to open.
    if (isDrawingObject(object) || asksForDrawing(sentence)) continue;
    // Live 2026-10-16: "switch to English" was looked up as a record ("I
    // can't find English among your relationships"). A language named is
    // a language change (set_q_language), never a record.
    if (namesLanguage(object)) continue;
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

/** A misheard name's stem must be at least this long… */
const MISHEARD_STEM_MIN = 5;
/** …and cover at least this share of both the heard and the real name. */
const MISHEARD_STEM_SHARE = 0.5;

/**
 * A consonant skeleton for names heard by speech recognition: the same
 * sounds spelt differently ("Shyftwel", "Shiftwell") share one key.
 */
function phoneticKey(name: string): string {
  const letters = compact(name)
    .replace(/ph/gu, "f")
    .replace(/ck|q/gu, "k")
    .replace(/c(?=[aou]|$)/gu, "k")
    .replace(/c/gu, "s")
    .replace(/z/gu, "s")
    .replace(/x/gu, "ks")
    .replace(/w(?=[^aeiou]|$)/gu, "")
    .replace(/y/gu, "i");
  const head = letters.slice(0, 1);
  const rest = letters.slice(1).replace(/[aeiouh]/gu, "");
  return `${head}${rest}`.replace(/(.)\1+/gu, "$1");
}

function sharedStem(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * R3 (hosted 2026-10-09: "TensorFlow" was heard for the person's own
 * Tensorgate, the fast path left it to Q, and Q's slower answer opened
 * it): one of their OWN counterparts a misheard name plainly means. Only
 * the closed, authorised set passed in -- nothing is searched beyond it --
 * and only at high confidence, else null (Q's answer asks):
 *   - the same sound skeleton as exactly one of theirs, or
 *   - a long shared leading stem (>= 5 letters and half of both names)
 *     with exactly one of theirs, while no other of theirs shares even a
 *     4-letter stem with what was heard.
 */
export function misheardOwnCounterpart(
  spoken: string,
  names: readonly string[],
): string | null {
  return soundMisheard(spoken, names) ?? romanisedOwnCounterpart(spoken, names);
}

/**
 * Proper-name intelligence (W3): the same closed set read through Arabic
 * and alternate romanisations (Qishta/Kishta, Mohammed/Muhammad, Al-/El-,
 * W.L.L. and Co.). One own name must clear a high bar AND lead every other
 * by a margin; name evidence alone never picks between two. Closed set
 * only, so no corroborating clue is needed -- these are their own records.
 */
function romanisedOwnCounterpart(
  spoken: string,
  names: readonly string[],
): string | null {
  const scored = [...new Set(names)]
    .map((name) => ({
      name,
      score: Math.max(
        scorePersonNames(spoken, name).score,
        scoreOrgNames(spoken, name).score,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const [top, next] = scored;
  if (top === undefined || top.score < 0.9) return null;
  return next !== undefined && top.score - next.score < 0.12 ? null : top.name;
}

function soundMisheard(
  spoken: string,
  names: readonly string[],
): string | null {
  const heard = compact(spoken);
  if (heard.length < MISHEARD_STEM_MIN) return null;
  const own = [...new Set(names)].filter(
    (name) => compact(name).length >= MISHEARD_STEM_MIN,
  );
  const key = phoneticKey(spoken);
  const sounding =
    key.length < 4 ? [] : own.filter((name) => phoneticKey(name) === key);
  if (sounding.length === 1) return sounding[0] ?? null;
  if (sounding.length > 1) return null;
  const stems = own.map((name) => ({
    name,
    real: compact(name),
    stem: sharedStem(heard, compact(name)),
  }));
  const strong = stems.filter(
    (one) =>
      one.stem >= MISHEARD_STEM_MIN &&
      one.stem >= MISHEARD_STEM_SHARE * one.real.length &&
      one.stem >= MISHEARD_STEM_SHARE * heard.length,
  );
  if (strong.length !== 1) return null;
  const rivals = stems.filter((one) => one.stem >= 4).length;
  return rivals === 1 ? (strong[0]?.name ?? null) : null;
}

/** Words no company or investor name is made of. */
const CATEGORY_PLURAL =
  /\b(?:companies|startups|start-ups|businesses|investors|funds|firms|founders|deals|opportunities|vcs|angels)\b/u;

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
