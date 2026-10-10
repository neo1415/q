import {
  aliasKeyOf,
  type KnownEntityIndex,
  type KnownEntityRecord,
  type KnownEntityStore,
  type KnownLookup,
} from "@capital-q/q-research";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Prepared public research entities, held hot (W5, on W2's store and index).
 *
 * Known public people and institutions (seed `qatar-five.v1`) are loaded
 * once at process start (one query) into W2's in-memory alias index, and
 * rebuilt from the store when the store's version changes. Naming one costs
 * no web call and no database round trip. The store owns the rows; this is
 * a read cache, a version watcher, a compact session prewarm list and the
 * rule for who a rehearsal is held with.
 *
 * Nothing here transliterates, "pronounces" or portrays a real person.
 */

/**
 * W2's store and its shared in-memory index (composeResearch's
 * `knownEntities`), plus the cheap version read the invalidation uses.
 */
export type PreparedEntitySource = {
  readonly store: KnownEntityStore;
  readonly index: KnownEntityIndex;
  /** Changes whenever a prepared entity is written. One cheap query. */
  readonly version: () => Promise<string>;
};

/**
 * `count:max(updated_at)` over the prepared rows (W2's table): a write
 * anywhere moves it. Read only by the background check, never by a lookup.
 */
export function createPreparedVersionReader(
  sql: DatabaseExecutor,
): () => Promise<string> {
  return async () => {
    const [row] = await sql<{ version: string }[]>`
      select count(*)::text || ':' || coalesce(max(updated_at)::text, '') as version
        from q_runtime.external_persons
       where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'`;
    return row?.version ?? "0:";
  };
}

export type PreparedEntities = {
  /** Loads from the store (one query). Call at process start. */
  readonly start: () => Promise<number>;
  /**
   * A spoken or typed name against the prepared entities. Pure memory: no
   * web, no database. Before `start` it finds nothing.
   */
  readonly lookup: (text: string) => KnownLookup;
  readonly all: () => readonly KnownEntityRecord[];
  readonly version: () => string | null;
  /**
   * Checks the store's version and reloads on a change. Called from a
   * background timer or after a loader run, never from a lookup.
   */
  readonly refreshIfChanged: () => Promise<boolean>;
};

/**
 * Words that name a category, not one of these entities. "Invest" or
 * "Qatar Capital" must not be taken for Invest Qatar or QInvest.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "invest",
  "investment",
  "investments",
  "investor",
  "investors",
  "capital",
  "qatar",
  "qatari",
  "bank",
  "group",
  "fund",
  "funds",
  "llc",
  "agency",
  "ventures",
  "al",
]);

const words = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

export function createPreparedEntities(
  source: PreparedEntitySource,
): PreparedEntities {
  const { store, index } = source;
  let loaded: string | null = null;
  let records: readonly KnownEntityRecord[] = [];
  let names: ReadonlySet<string> = new Set();

  async function load(): Promise<number> {
    // Version first: a write between the reads costs one more reload on
    // the next check, never a stale label.
    const version = await source.version();
    const size = await index.warm();
    records = await store.listPrepared();
    names = new Set(
      records.flatMap((record) =>
        [record.displayName, ...record.aliases].map(aliasKeyOf),
      ),
    );
    loaded = version;
    return size;
  }

  return {
    start: load,
    lookup: (text) => {
      const parts = words(text);
      if (parts.length === 0) return { kind: "NONE" };
      // A generic query passes only as an exact name ("Invest Qatar"); a
      // fuzzy hit on "Invest" alone is a category, not an entity.
      if (
        parts.every((w) => GENERIC_WORDS.has(w)) &&
        !names.has(aliasKeyOf(text))
      ) {
        return { kind: "NONE" };
      }
      return index.lookup(text);
    },
    all: () => records,
    version: () => loaded,
    refreshIfChanged: async () => {
      if ((await source.version()) === loaded) return false;
      await load();
      return true;
    },
  };
}

/** A quiet background check; the timer never keeps the process alive. */
export function watchPreparedEntities(
  entities: Pick<PreparedEntities, "refreshIfChanged">,
  onError: (error: unknown) => void,
  everyMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    entities.refreshIfChanged().catch(onError);
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Who a rehearsal is held with. A person is a source-informed simulation
 * (their face and voice are never cloned). An institution is a labelled
 * role-based representative: a synthetic stand-in, never a real person,
 * and it never carries a personal mandate or personal preferences.
 */
export type RehearsalCounterpart =
  | {
      readonly kind: "SOURCE_INFORMED_SIMULATION";
      readonly entityId: string;
      readonly label: string;
    }
  | {
      readonly kind: "ROLE_REPRESENTATIVE";
      readonly entityId: string;
      readonly label: string;
      readonly personalMandate: null;
    };

export function rehearsalCounterpart(
  record: KnownEntityRecord,
): RehearsalCounterpart {
  if (record.entityKind === "PERSON") {
    return {
      kind: "SOURCE_INFORMED_SIMULATION",
      entityId: record.externalPersonId,
      label: `Simulation informed by public sources about ${record.displayName}; not ${record.displayName}`,
    };
  }
  return {
    kind: "ROLE_REPRESENTATIVE",
    entityId: record.externalPersonId,
    label: `Synthetic representative of ${record.displayName} (a role, not a real person)`,
    personalMandate: null,
  };
}

const KIND_WORD: Record<KnownEntityRecord["entityKind"], string> = {
  PERSON: "person",
  ORGANIZATION: "organisation",
  GOVERNMENT_AGENCY: "government agency",
};

const oneLineOf = (record: KnownEntityRecord): string => {
  const line = record.profile["oneLine"];
  return typeof line === "string" ? line.replace(/\s+/gu, " ").trim() : "";
};

/**
 * The session prewarm list: name, kind, one line and the stable id. Not
 * biographies, no facts. Bounded so it fits the Live context budget.
 */
export function preparedEntityPrewarmLines(
  records: readonly KnownEntityRecord[],
  maxLines = 8,
): string[] {
  return records.slice(0, maxLines).map((record) => {
    const line = oneLineOf(record).slice(0, 90);
    const head = `${record.displayName} (${KIND_WORD[record.entityKind]}, ${record.externalPersonId})`;
    return line.length > 0 ? `${head}: ${line}` : head;
  });
}

export type AnswerFact = {
  readonly claim: string;
  readonly sourceIds: readonly string[];
  /** False when it is public but not independently checked (metadata, not spoken). */
  readonly confirmed: boolean;
};

/**
 * What Q and a persona may state about a prepared entity. Public but
 * unconfirmed facts are included; their claim already opens with the soft
 * wording ("According to their LinkedIn, ...", "Reportedly, ...")
 * and `confirmed` is false so a caller can keep the hedge when it
 * paraphrases; "not independently checked" lives only in that flag. A contradicted claim never reaches this list (the loader
 * does not store it as a fact).
 */
export function answerFacts(record: KnownEntityRecord): readonly AnswerFact[] {
  return record.facts.map((fact) => ({
    claim: fact.claim,
    sourceIds: fact.sourceIds,
    confirmed: fact.evidenceClass === "VERIFIED",
  }));
}

/**
 * Quotes Q may show, each as a source quote with its label ("from their
 * LinkedIn"). A persona is never given
 * these: they are not its words and it must not speak them as its own.
 */
export function shownQuotes(
  record: KnownEntityRecord,
): readonly { readonly line: string; readonly sourceId: string }[] {
  const labels = record.profile["quoteLabels"];
  return record.quotes.map((quote, at) => {
    const label =
      Array.isArray(labels) && typeof labels[at] === "string"
        ? labels[at]
        : "from a public source";
    return {
      line: `${record.displayName}, ${label}: "${quote.text}"`,
      sourceId: quote.sourceId,
    };
  });
}

/**
 * The warm index as the answer path's instant matcher: the one prepared
 * entity a candidate names, with the words that name it and the place
 * words that are valid clues. Several or none is null (normal path).
 */
export function preparedEntityMatcher(
  entities: Pick<PreparedEntities, "lookup">,
): (candidate: string) => {
  readonly displayName: string;
  readonly entityKind: KnownEntityRecord["entityKind"];
  readonly nameWords: readonly string[];
  readonly contextWords: readonly string[];
} | null {
  return (candidate) => {
    const found = entities.lookup(candidate);
    if (found.kind !== "FOUND") return null;
    const record = found.record;
    return {
      displayName: record.displayName,
      entityKind: record.entityKind,
      nameWords: [record.displayName, ...record.aliases].flatMap(words),
      contextWords: [record.location, record.organization, record.role].flatMap(
        (text) => (text === null ? [] : words(text)),
      ),
    };
  };
}

/** The persona's grounding: facts only, never the quotes. */
export function personaGrounding(record: KnownEntityRecord): {
  readonly facts: readonly AnswerFact[];
  readonly rehearsalTopics: readonly string[];
} {
  const topics = record.profile["rehearsalTopics"];
  return {
    facts: answerFacts(record),
    rehearsalTopics: Array.isArray(topics)
      ? topics.filter((one): one is string => typeof one === "string")
      : [],
  };
}
