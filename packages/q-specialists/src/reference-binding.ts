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
 *   - none (the words point back and nothing fits) says so and asks.
 * Binding grants nothing: any read or act on a bound record still goes
 * through its tool's own authorize step.
 */

export type ReaderReference = {
  readonly phrase: string;
  readonly entityIds: readonly string[];
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
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
      /** Refs the reader gave that the ledger does not hold. */
      readonly rejected: readonly string[];
    }
  | {
      readonly kind: "CLARIFY";
      readonly reason: "TWO_READINGS" | "NO_READING";
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
  for (const { phrase, readings } of phrases.values()) {
    if (readings.length === 0) {
      return {
        kind: "CLARIFY",
        reason: "NO_READING",
        phrase,
        question: `I'm not sure who or what you mean by ${quoted(phrase)}. Which one do you mean?`,
        rejected,
      };
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
  return {
    kind: "BOUND",
    bound,
    note: bound.map((one) => noteLine(one, byRef)).join(""),
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
