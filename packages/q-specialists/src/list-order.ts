import type { QConversationMessage } from "@capital-q/q-runtime";

import {
  listsFromHistory,
  type ConversationEntity,
  type ReferenceAsk,
  type ResolvedReference,
  type ShownList,
} from "./conversation-entities.js";

/**
 * RC4 (voice audit 15 Nov 2026, founder F7-20..F7-23): "back to the first
 * company" became the first card of the newest list without saying which
 * list; asked again, Q said it was "the first company from that earlier
 * shortlist" (false); offered "Zino first, Chidi second", Q agreed (Chidi
 * was third), and later reported that guess as the person's correction.
 *
 * The lists Q showed are stored with its turns (ANSWER_CARDS blocks on its
 * messages), so the order is a fact code holds, never the model's memory:
 *   - a place ("the first one") is bound to the last list shown, and when
 *     another list Q showed has a different record at that place, the
 *     answer says which list it counted in and what the other one had;
 *   - an order the person states ("Zino was first and Chidi second") is
 *     checked against those lists, and where it differs, Q says the order
 *     as shown instead of agreeing.
 * Deterministic: no model, no read; only what this person was shown.
 */

const PLACE_WORDS: readonly string[] = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

function placeWord(position: number): string {
  if (position === -1) return "last";
  return PLACE_WORDS[position - 1] ?? `number ${String(position)}`;
}

/** A name as said aloud: without "(fictional)" and similar notes. */
function spokenName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameEntity(a: ConversationEntity, b: ConversationEntity): boolean {
  return a.kind === b.kind && a.id.toLowerCase() === b.id.toLowerCase();
}

function heading(list: ShownList): string {
  const title = list.title?.trim() ?? "";
  return title.length === 0 ? "" : ` ("${title}")`;
}

/** One list Q showed, as a sentence: "1. A, 2. B and 3. C". */
function orderOf(list: ShownList, max = 5): string {
  const named = list.items
    .slice(0, max)
    .map(
      (item, index) => `${String(index + 1)}. ${spokenName(item.name ?? "")}`,
    );
  const more = list.items.length - named.length;
  const last = named.pop() ?? "";
  const joined = named.length === 0 ? last : `${named.join(", ")} and ${last}`;
  return more > 0 ? `${joined}, and ${String(more)} more` : joined;
}

/** Identical lists shown again (the same records in the same order) count once. */
function distinct(lists: readonly ShownList[]): ShownList[] {
  const seen = new Set<string>();
  return lists.filter((list) => {
    const key = list.items.map((item) => `${item.kind}:${item.id}`).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ReferenceLead = {
  /** The line that opens the answer when it must say which one it means. */
  readonly line: string;
  /** The record the place resolved to, as the person saw it named. */
  readonly name: string;
  /** True when another list had a different record at that place. */
  readonly always: boolean;
};

/**
 * Which list a place was counted in, said plainly. Null when the place was
 * not bound to one of Q's own lists or the record has no name.
 */
export function referenceLeadOf(
  ask: ReferenceAsk | null,
  resolved: ResolvedReference | null,
  answers: readonly ShownList[],
): ReferenceLead | null {
  if (ask?.kind !== "ORDINAL" || resolved?.kind !== "ONE") return null;
  if (resolved.via !== "Q_ANSWER") return null;
  const name = spokenName(resolved.entity.name ?? "");
  if (name.length === 0) return null;
  const lists = distinct(answers);
  const at = (list: ShownList): ConversationEntity | undefined => {
    const items = list.items.filter(
      (item) => ask.entityKind === null || item.kind === ask.entityKind,
    );
    return items[ask.position === -1 ? items.length - 1 : ask.position - 1];
  };
  const counted = lists.find((list) => {
    const entity = at(list);
    return entity !== undefined && sameEntity(entity, resolved.entity);
  });
  if (counted === undefined) return null;
  const newest = counted === lists[0];
  const other = lists.find((list) => {
    if (list === counted) return false;
    const entity = at(list);
    return entity !== undefined && !sameEntity(entity, resolved.entity);
  });
  const place = placeWord(ask.position);
  const where = newest
    ? `the last list I showed you${heading(counted)}`
    : `an earlier list I showed you${heading(counted)}`;
  const otherEntity = other === undefined ? undefined : at(other);
  if (other === undefined || otherEntity === undefined) {
    return {
      line: `By the ${place} one I mean ${name}, ${place} in ${where}.`,
      name,
      always: false,
    };
  }
  const otherName = spokenName(otherEntity.name ?? "");
  const otherWhere =
    lists.indexOf(other) < lists.indexOf(counted)
      ? `the newer list${heading(other)}`
      : `the earlier list${heading(other)}`;
  return {
    line: `By the ${place} one I mean ${name}, ${place} in ${where}. In ${otherWhere}, the ${place} was ${otherName}; tell me if you meant that one.`,
    name,
    always: true,
  };
}

/** A stated place for one record: "Zino Aviation was the first". */
type OrderClaim = {
  readonly entity: ConversationEntity;
  readonly position: number;
};

const ORDINAL_IN =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|[4-9]th)\b/giu;
const NUMBERED: Readonly<Record<string, number>> = {
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
};

/**
 * A statement of order, not a request: the record and its place are said
 * together as a fact ("was the first", "is second", "and then Chidi the
 * second"). "Compare Zino with the second" and "open the first one" are not.
 */
const STATES =
  /\b(?:was|is|were|came|comes|ranked|placed|listed)\b|^\s*(?:and\s+)?(?:then\s+)?\S+(?:\s+\S+){0,3}\s+the\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s*$/iu;
const ACTS =
  /^\s*(?:(?:please|q|ok(?:ay)?|so)[,\s]+)*(?:open|compare|show|send|message|email|book|tell\s+me\s+about|draft|prepare|take\s+me|go\s+to)\b/iu;

/** The words a record is said by: its distinctive first word, and its name. */
function sayings(entity: ConversationEntity): RegExp | null {
  const name = spokenName(entity.name ?? "").toLowerCase();
  const first = name
    .split(/[^\p{L}\p{N}]+/u)
    .find(
      (word) => word.length >= 3 && !/^(?:the|and|for|of|ltd|inc)$/u.test(word),
    );
  if (first === undefined) return null;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

function claimsOf(
  text: string,
  entities: readonly ConversationEntity[],
): OrderClaim[] {
  const said = text.replace(/[’]/gu, "'");
  if (ACTS.test(said)) return [];
  const claims: OrderClaim[] = [];
  const clauses = said.split(
    /[.;!?,]|\band then\b|\bthen\b|\bwhile\b|\bbut\b/iu,
  );
  for (const clause of clauses) {
    const named = entities.filter((entity) => sayings(entity)?.test(clause));
    const places = [...clause.matchAll(ORDINAL_IN)].map((match) => {
      const word = (match[1] ?? "").toLowerCase();
      return word === "last"
        ? -1
        : (NUMBERED[word] ??
            (PLACE_WORDS.indexOf(word) >= 0
              ? PLACE_WORDS.indexOf(word) + 1
              : Number.parseInt(word, 10)));
    });
    const [entity] = named;
    const [position] = places;
    if (
      named.length === 1 &&
      places.length === 1 &&
      entity !== undefined &&
      position !== undefined &&
      Number.isInteger(position) &&
      STATES.test(clause)
    ) {
      claims.push({ entity, position });
    }
  }
  return claims;
}

function placeIn(list: ShownList, entity: ConversationEntity): number {
  const index = list.items.findIndex((item) => sameEntity(item, entity));
  return index < 0 ? 0 : index + 1;
}

function holds(list: ShownList, claim: OrderClaim): boolean {
  const place = placeIn(list, claim.entity);
  if (place === 0) return false;
  return claim.position === -1
    ? place === list.items.length
    : place === claim.position;
}

/**
 * When the person states an order of records Q listed and it is not the
 * order Q showed, the order as shown, said by code (never an agreement
 * with a wrong guess). Null when they state no order, when it matches a
 * list Q showed, or when no list Q showed holds what they named.
 */
export function orderCheckLine(
  text: string,
  history: readonly QConversationMessage[],
): string | null {
  const lists = distinct(listsFromHistory(history));
  if (lists.length === 0) return null;
  const entities: ConversationEntity[] = [];
  for (const list of lists) {
    for (const item of list.items) {
      if (!entities.some((one) => sameEntity(one, item))) entities.push(item);
    }
  }
  const claims = claimsOf(text, entities);
  if (claims.length === 0) return null;
  const holding = lists.filter((list) =>
    claims.every((claim) => placeIn(list, claim.entity) > 0),
  );
  // Where what they said is the order of a list Q showed, it stands.
  if (holding.some((list) => claims.every((claim) => holds(list, claim)))) {
    return null;
  }
  const checked = holding[0];
  if (checked === undefined) return null;
  const wrong = claims.filter((claim) => !holds(checked, claim));
  const corrections = wrong.map((claim) => {
    const name = spokenName(claim.entity.name ?? "");
    const place = placeIn(checked, claim.entity);
    return `${name} was ${placeWord(place)}, not ${placeWord(claim.position)}`;
  });
  const isNewest = checked === lists[0];
  const newer = lists[0] !== undefined && !isNewest ? lists[0] : null;
  const newerLead =
    newer === null || newer.items[0] === undefined
      ? null
      : `The last list I showed you${heading(newer)} had ${orderOf(newer)}.`;
  return [
    `I checked the ${isNewest ? "last list" : "list"} I showed you${heading(checked)}: ${orderOf(checked)}.`,
    `So ${corrections.join(", and ")}.`,
    ...(newerLead === null ? [] : [newerLead]),
  ].join(" ");
}
