import type {
  QConversationLedger,
  QLedgerEntity,
  QRetrievalFocus,
} from "@capital-q/q-runtime";

import {
  RETRIEVAL_QUERY_MAX_CHARACTERS,
  RETRIEVAL_SUB_QUERIES_MAX,
  type RetrievalFocusHint,
  type RetrievalSubQuery,
} from "./contracts.js";

/**
 * Context-aware query rewriting (Q intelligence step 5), by CODE, from the
 * conversation ledger step 2 built and the refs step 3's reader bound.
 *
 *   "and its burn?"  + ledger {E1 Silo Credit, bound}
 *     → "Silo Credit and its burn?"  under subject filter [Silo Credit]
 *
 * No model is called: the reader already read the pointing words by
 * meaning, and this only spells its binding into the search. Nothing here
 * decides what the person meant from keywords; the subjects come from the
 * ledger (records this person was shown, or names they themselves said
 * that the ledger registered) and the reader's checked refs.
 *
 * Authority: a subject filter can only NARROW the envelope
 * (`narrowEnvelopeToSubjects`). A ledger id this envelope does not reach
 * yields no way in, never a new one, so a rewritten query cannot retrieve
 * another tenant's chunk or a founder-private chunk the plan withheld.
 */

/** Where an entity in the plan came from, strongest first. */
export type RetrievalFocusSource = "BOUND" | "NAMED" | "RECENT";

export type PlannedFocusEntity = {
  readonly ref: string;
  readonly kind: QLedgerEntity["kind"];
  readonly name: string | null;
  /** The subject its chunks are filed under (a company), when known. */
  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly documentId: string | null;
  readonly source: RetrievalFocusSource;
};

export type RetrievalQueryPlan = {
  readonly queries: readonly RetrievalSubQuery[];
  readonly focus: RetrievalFocusHint | null;
  readonly entities: readonly PlannedFocusEntity[];
};

/** Kinds whose material retrieval can be narrowed to. */
const SEARCHABLE: ReadonlySet<QLedgerEntity["kind"]> = new Set([
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "PERSON",
  "DOCUMENT",
  "FIGURE",
]);

/** How much the carried previous question counts in the reranker. */
export const PREVIOUS_WEIGHT = 0.5;
/** Earlier messages of theirs carried into a follow-up. */
export const PREVIOUS_MAX = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A ledger id usable as a subject filter (chunks are filed under uuids). */
function subjectIdOf(id: string | null): string | null {
  return id !== null && UUID.test(id) ? id.toLowerCase() : null;
}

/** Whether `name` appears in `text` as whole words (case-insensitive). */
export function namesInText(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return false;
  const haystack = text.toLowerCase();
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    const before = at === 0 ? "" : haystack.charAt(at - 1);
    const after = haystack.charAt(at + needle.length);
    const edge = (ch: string): boolean =>
      ch === "" || !/[\p{L}\p{N}]/u.test(ch);
    if (edge(before) && edge(after)) return true;
    at = haystack.indexOf(needle, at + 1);
  }
  return false;
}

function planned(
  ledger: QConversationLedger,
  entity: QLedgerEntity,
  source: RetrievalFocusSource,
): PlannedFocusEntity {
  const owner =
    entity.of === null
      ? null
      : (ledger.entities.find((other) => other.ref === entity.of) ?? null);
  // A company or an investor is its own subject; a person, a document or
  // a figure is filed under the entity it belongs to.
  const own =
    entity.kind === "COMPANY" || entity.kind === "INVESTOR_ORGANISATION";
  return {
    ref: entity.ref,
    kind: entity.kind,
    name: entity.name,
    subjectId: own ? subjectIdOf(entity.id) : subjectIdOf(owner?.id ?? null),
    subjectName: own ? entity.name : (owner?.name ?? null),
    documentId: entity.kind === "DOCUMENT" ? subjectIdOf(entity.id) : null,
    source,
  };
}

/**
 * The entities this turn is about, by the ledger:
 *   1. BOUND: the refs the reader bound the pointing words to;
 *   2. NAMED: ledger entries whose name is in their words;
 *   3. RECENT: only when neither, the entries the conversation touched
 *      last -- a recall aid, never a filter on its own (see below).
 */
export function focusEntities(
  words: string,
  focus: QRetrievalFocus,
): readonly PlannedFocusEntity[] {
  const { ledger } = focus;
  const usable = ledger.entities.filter((entity) =>
    SEARCHABLE.has(entity.kind),
  );
  const out: PlannedFocusEntity[] = [];
  const seen = new Set<string>();
  const take = (entity: QLedgerEntity, source: RetrievalFocusSource): void => {
    if (seen.has(entity.ref)) return;
    seen.add(entity.ref);
    out.push(planned(ledger, entity, source));
  };
  for (const ref of focus.boundRefs) {
    const entity = usable.find((one) => one.ref === ref);
    if (entity !== undefined) take(entity, "BOUND");
  }
  for (const entity of usable) {
    if (entity.kind === "FIGURE") continue;
    if (entity.name !== null && namesInText(words, entity.name)) {
      take(entity, "NAMED");
    }
  }
  if (out.length === 0 && usable.length > 0) {
    const latest = Math.max(...usable.map((entity) => entity.lastTurn));
    for (const entity of usable) {
      if (entity.kind !== "FIGURE" && entity.lastTurn === latest) {
        take(entity, "RECENT");
      }
    }
  }
  return out.slice(0, RETRIEVAL_SUB_QUERIES_MAX * 2);
}

/**
 * The parts of a compound ask, by its punctuation only (sentences,
 * question marks, semicolons, line breaks). Structure, not meaning: no
 * word decides anything, and a single question stays one part.
 */
export function askParts(words: string): readonly string[] {
  const parts = words
    .split(/(?<=[?;!\n])|(?<=\.)\s+(?=\p{Lu})/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  return parts.length === 0 ? [words.trim()] : parts;
}

function bounded(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, RETRIEVAL_QUERY_MAX_CHARACTERS);
}

/**
 * The searches for one turn.
 *
 * With BOUND or NAMED subjects: one search per subject (and per part of a
 * compound ask), its words prefixed with the subject's name and filtered
 * to that subject. "Compare their burn" over two bound companies is two
 * searches, fused by RRF, rather than one that lets the louder company
 * fill all eight places.
 *
 * With only RECENT subjects: the person's words unfiltered, AND the same
 * words rewritten under the recent subject's filter. Recency is a guess
 * from conversation focus, so it may add a search but never take the
 * unfiltered one away (the reader's "nothing fits" is honoured by the
 * answer, which asks; it is never overruled here).
 *
 * With nothing in the ledger: the person's words, as before step 5.
 */
export function planRetrievalQueries(input: {
  readonly words: string;
  /**
   * The person's previous message in this conversation, if any. A
   * follow-up ("same for Silo Health", "and theirs?", "I meant
   * Ledgerfold") carries the field from it, so it is searched again under
   * this turn's subjects, counting for less than the turn's own words.
   */
  readonly previousWords?: string | readonly string[] | undefined;
  readonly focus?: QRetrievalFocus | undefined;
  readonly maxQueries?: number | undefined;
}): RetrievalQueryPlan {
  const words = bounded(input.words);
  // Newest first; at most three, each counting half the one after it.
  const previous = (
    input.previousWords === undefined
      ? []
      : typeof input.previousWords === "string"
        ? [input.previousWords]
        : input.previousWords
  )
    .slice(0, PREVIOUS_MAX)
    .map(bounded)
    .filter((text) => text.length > 0);
  const max = Math.max(1, input.maxQueries ?? RETRIEVAL_SUB_QUERIES_MAX);
  if (input.focus === undefined) {
    return { queries: [{ text: words }], focus: null, entities: [] };
  }
  const entities = focusEntities(words, input.focus);
  if (entities.length === 0) {
    return { queries: [{ text: words }], focus: null, entities };
  }

  const firm = entities.filter((entity) => entity.source !== "RECENT");
  const queries: RetrievalSubQuery[] = [];
  const add = (query: RetrievalSubQuery): void => {
    if (query.text.length === 0) return;
    const key = `${query.text.toLowerCase()}|${(query.subjectIds ?? []).join(",")}`;
    if (
      queries.length < max &&
      !queries.some(
        (have) =>
          `${have.text.toLowerCase()}|${(have.subjectIds ?? []).join(",")}` ===
          key,
      )
    ) {
      queries.push(query);
    }
  };

  // One group per subject: a person and their company search together.
  type Group = { subjectId: string | null; names: string[] };
  const groupsOf = (list: readonly PlannedFocusEntity[]): Group[] => {
    const groups: Group[] = [];
    for (const entity of list) {
      const names = [
        ...new Set(
          [entity.subjectName, entity.name].filter(
            (name): name is string => name !== null,
          ),
        ),
      ].filter(
        // "Silo Credit ARR" already says "Silo Credit".
        (name, _at, all) =>
          !all.some((other) => other !== name && namesInText(other, name)),
      );
      const group =
        entity.subjectId === null
          ? undefined
          : groups.find((one) => one.subjectId === entity.subjectId);
      if (group === undefined) {
        groups.push({ subjectId: entity.subjectId, names });
      } else {
        for (const name of names) {
          if (!group.names.includes(name)) group.names.push(name);
        }
      }
    }
    return groups;
  };

  // The previous questions under this turn's subjects (one search per
  // subject and message, as many as the bound leaves room for), weighted
  // below the turn's own words. Filtered where the subject has a record;
  // an entity known by name only gets its name in front instead. Up to
  // three back ("remind me of the first figure"),
  // because a clarify in between ("Silo Credit.") carries no field.
  function carryPrevious(
    groups: readonly { subjectId: string | null; names: string[] }[],
  ): void {
    previous.forEach((text, back) => {
      for (const group of groups) {
        add({
          text: bounded([...group.names, text].join(" ")),
          ...(group.subjectId === null
            ? {}
            : { subjectIds: [group.subjectId] }),
          weight: PREVIOUS_WEIGHT / 2 ** back,
        });
      }
    });
  }

  const parts = askParts(words);
  if (firm.length > 0) {
    const groups = groupsOf(firm);
    // Subjects first, then parts, so a compound ask about two companies
    // keeps one search per company within the bound.
    for (const part of parts) {
      for (const group of groups) {
        const named = group.names.filter((name) => !namesInText(part, name));
        add({
          text: bounded([...named, part].join(" ")),
          ...(group.subjectId === null
            ? {}
            : { subjectIds: [group.subjectId] }),
        });
      }
    }
    // A named entity with no record behind it cannot be filtered to; its
    // name is already in the words, which search unfiltered.
    if (groups.some((group) => group.subjectId === null)) {
      add({ text: words });
    }
    carryPrevious(groups);
  } else {
    add({ text: words });
    const groups = groupsOf(entities).filter(
      (group) => group.subjectId !== null,
    );
    for (const group of groups) {
      const named = group.names.filter((name) => !namesInText(words, name));
      add({
        text: bounded([...named, words].join(" ")),
        ...(group.subjectId === null ? {} : { subjectIds: [group.subjectId] }),
      });
    }
    carryPrevious(groups);
  }

  // A RECENT guess may add a search, never steer the ranking.
  const steering = firm;
  const subjectIds = [
    ...new Set(
      steering
        .map((entity) => entity.subjectId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const documentIds = [
    ...new Set(
      steering
        .map((entity) => entity.documentId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const names = [
    ...new Set(
      steering.flatMap((entity) =>
        [entity.name, entity.subjectName].filter(
          (name): name is string => name !== null,
        ),
      ),
    ),
  ];
  return {
    queries: queries.length === 0 ? [{ text: words }] : queries,
    focus: steering.length === 0 ? null : { subjectIds, documentIds, names },
    entities,
  };
}
