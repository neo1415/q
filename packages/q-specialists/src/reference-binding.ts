import type {
  QConversationState,
  QLedgerEntity,
  QLedgerEntityKind,
} from "@capital-q/q-runtime";

/**
 * Q intelligence step 3: binding what the turn's pointing words mean.
 *
 * The turn reader reads "she", "their CFO", "the other deck", "those two"
 * by meaning against CONVERSATION STATE and returns LEDGER refs (E1, E2…).
 * Code decides what that is allowed to mean:
 *   - a ref the ledger shown to this person does not hold is refused, and a
 *     reading that carries one is dropped whole (Context Firewall: the
 *     ledger is built from this person's own conversation and the reads the
 *     firewall kept; a model never adds a record to it);
 *   - one reading of a phrase binds;
 *   - two plausible readings ask one short question naming both;
 *   - none (the words point back and no ledger entry fits) is left OPEN:
 *     the answer reads it from the recent turns, as a person following
 *     the conversation would, and asks only if they do not settle it.
 *     Live 2026-11-06 (QIQ-PRO-001): asking by default made Q ask who
 *     "she" was one line after it had named her, where the bare model
 *     answered; nothing is bound, so nothing is granted either way.
 * Binding grants nothing: any read or act on a bound record still goes
 * through its tool's own authorize step.
 */

export type ReaderReference = {
  readonly phrase: string;
  readonly entityIds: readonly string[];
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  /** v79: a name written in the recent turns (see withNamedReferences). */
  readonly named?:
    | {
        readonly name: string;
        readonly kind:
          "COMPANY" | "INVESTOR_ORGANISATION" | "PERSON" | "DOCUMENT";
      }
    | null
    | undefined;
};

export type BoundReference = {
  readonly phrase: string;
  readonly entities: readonly QLedgerEntity[];
  readonly confidence: ReaderReference["confidence"];
};

export type ReferenceBinding =
  | { readonly kind: "NONE"; readonly rejected: readonly string[] }
  | {
      readonly kind: "BOUND";
      readonly bound: readonly BoundReference[];
      /** For the answer (QAnswerRequest.references). */
      readonly note: string;
      /** Phrases that point back with no ledger entry: read from the turns. */
      readonly open: readonly string[];
      /** Refs the reader gave that the ledger does not hold. */
      readonly rejected: readonly string[];
    }
  | {
      readonly kind: "CLARIFY";
      readonly reason: "TWO_READINGS";
      readonly phrase: string;
      /** The one short question Q asks, naming the readings. */
      readonly question: string;
      readonly rejected: readonly string[];
    };

const KIND_WORD: Readonly<Record<QLedgerEntityKind, string>> = {
  COMPANY: "the company",
  INVESTOR_ORGANISATION: "the investor",
  PERSON: "the person",
  DOCUMENT: "the document",
  PLAN: "the plan",
  FIGURE: "the figure",
};

const phraseKey = (phrase: string): string =>
  phrase.trim().replace(/\s+/gu, " ").toLowerCase();

/** Their own words, quoted back to them: bounded and on one line. */
const quoted = (phrase: string): string =>
  `"${phrase.trim().replace(/\s+/gu, " ").replace(/"/gu, "'").slice(0, 60)}"`;

function nameOf(
  entity: QLedgerEntity,
  byRef: ReadonlyMap<string, QLedgerEntity>,
) {
  const name = entity.name ?? KIND_WORD[entity.kind];
  const of = entity.of === null ? undefined : byRef.get(entity.of);
  return entity.kind === "PERSON" && of?.name != null
    ? `${name} at ${of.name}`
    : entity.kind === "FIGURE" && of?.name != null && entity.name === null
      ? `${of.name}'s figure`
      : name;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function noteLine(
  bound: BoundReference,
  byRef: ReadonlyMap<string, QLedgerEntity>,
): string {
  const entities = bound.entities.map((entity) => {
    const record =
      entity.id === null
        ? "no record behind it"
        : `${entity.kind} id ${entity.id}`;
    return `${entity.ref} ${JSON.stringify(nameOf(entity, byRef))} (${record})`;
  });
  return ` ${quoted(bound.phrase)} means ${entities.join(" and ")}${bound.confidence === "HIGH" ? "" : ` (${bound.confidence.toLowerCase()} confidence)`}.`;
}

/**
 * Checks the reader's references against the state it was shown and
 * decides: bind, ask (two readings), or say so and ask (none).
 * `state` must be the very state rendered for the reader -- the stored
 * ledger plus only the reads the firewall kept for this run.
 */
export function bindReferences(
  references: readonly ReaderReference[] | undefined,
  state: QConversationState | null,
): ReferenceBinding {
  const rejected: string[] = [];
  if (references === undefined || references.length === 0) {
    return { kind: "NONE", rejected };
  }
  const byRef = new Map(
    (state?.ledger.entities ?? []).map((entity) => [entity.ref, entity]),
  );
  // Readings per phrase, in the order the phrases were said.
  const phrases = new Map<
    string,
    { phrase: string; readings: BoundReference[] }
  >();
  for (const reference of references) {
    const key = phraseKey(reference.phrase);
    if (key.length === 0) continue;
    const entry = phrases.get(key) ?? {
      phrase: reference.phrase,
      readings: [],
    };
    phrases.set(key, entry);
    const refs = [...new Set(reference.entityIds)];
    if (refs.length === 0) continue;
    const unknown = refs.filter((ref) => !byRef.has(ref));
    if (unknown.length > 0) {
      // A reading that names anything outside the ledger is not a reading
      // of this conversation: none of it binds.
      rejected.push(...unknown);
      continue;
    }
    const entities = refs.flatMap((ref) => {
      const entity = byRef.get(ref);
      return entity === undefined ? [] : [entity];
    });
    const sameSet = entry.readings.some(
      (reading) =>
        reading.entities.length === entities.length &&
        reading.entities.every((entity, index) => entity.ref === refs[index]),
    );
    if (!sameSet) {
      entry.readings.push({
        phrase: reference.phrase,
        entities,
        confidence: reference.confidence,
      });
    }
  }
  const bound: BoundReference[] = [];
  const open: string[] = [];
  /** Two readings of people, for the answer to decide (below). */
  const undecided: string[] = [];
  for (const { phrase, readings } of phrases.values()) {
    if (readings.length === 0) {
      open.push(phrase);
      continue;
    }
    // One reading the reader is sure of, among guesses, is that reading.
    const sure = readings.filter((reading) => reading.confidence === "HIGH");
    const chosen =
      readings.length === 1 ? readings[0] : sure.length === 1 ? sure[0] : null;
    if (chosen === null || chosen === undefined) {
      const [first, second] = readings;
      const name = (reading: BoundReference | undefined) =>
        listed(
          (reading?.entities ?? []).map((entity) => nameOf(entity, byRef)),
        );
      // Live Q-IQ run 2 (PRO-002 #1, PRO-006 #1): "When did he join?"
      // after "the CEO and the CTO" -- she and he by their own records --
      // was asked back ("By "he", do you mean Wanjiru Kamau or Peter
      // Otieno?"). What decides between two people (their roles, how each
      // is referred to as their record states it) is in the authorised
      // facts, which the answer reads and the reader never sees. So two
      // readings of people go to the answer, both named, to decide from
      // what it holds, and to ask only if that leaves it open. Two
      // readings of anything else (companies, documents) are told apart
      // by their names, which the reader saw: those are asked here.
      const people = (reading: BoundReference | undefined) =>
        reading !== undefined &&
        reading.entities.length > 0 &&
        reading.entities.every((entity) => entity.kind === "PERSON");
      if (people(first) && people(second)) {
        undecided.push(
          ` ${quoted(phrase)} could mean ${name(first)} or ${name(second)}: decide which from what the facts and the conversation say of each (their roles, and how each is referred to as their own record states it); only if nothing there decides, ask which one in one short question naming both.`,
        );
        continue;
      }
      return {
        kind: "CLARIFY",
        reason: "TWO_READINGS",
        phrase,
        question: `By ${quoted(phrase)}, do you mean ${name(first)} or ${name(second)}?`,
        rejected,
      };
    }
    bound.push(chosen);
  }
  if (bound.length === 0 && open.length === 0 && undecided.length === 0) {
    return { kind: "NONE", rejected };
  }
  const openNote =
    open.length === 0
      ? ""
      : ` ${open.map(quoted).join(", ")}: nothing in the conversation's record fits; read who or what is meant from the recent turns, as a person following the conversation would, and only if they leave it open, say so and ask.`;
  return {
    kind: "BOUND",
    bound,
    note: `${bound.map((one) => noteLine(one, byRef)).join("")}${undecided.join("")}${openNote}`,
    open,
    rejected,
  };
}

/** The companies a binding names, in the order said (comparison sets). */
export function boundCompanyIds(binding: ReferenceBinding): readonly string[] {
  if (binding.kind !== "BOUND") return [];
  const ids: string[] = [];
  for (const one of binding.bound) {
    for (const entity of one.entities) {
      if (
        entity.kind === "COMPANY" &&
        entity.id !== null &&
        !ids.includes(entity.id)
      ) {
        ids.push(entity.id);
      }
    }
  }
  return ids;
}
