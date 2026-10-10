import {
  aliasKeyOf,
  createKnownEntityIndex,
  type KnownEntityRecord,
  type KnownEntityStore,
  type KnownLookup,
} from "@capital-q/q-research";

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

export type PreparedEntityStore = KnownEntityStore & {
  /** Every prepared entity with the version it was read at: one query. */
  readonly listWithVersion: () => Promise<{
    readonly version: string;
    readonly records: readonly KnownEntityRecord[];
  }>;
  /** Changes whenever a prepared entity is written. One cheap query. */
  readonly version: () => Promise<string>;
};

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
  store: PreparedEntityStore,
): PreparedEntities {
  let loaded: string | null = null;
  let records: readonly KnownEntityRecord[] = [];
  let names: ReadonlySet<string> = new Set();
  // The index warms through one `listWithVersion` query; the version and
  // the records it saw are kept from that same read.
  const index = createKnownEntityIndex({
    store: {
      ...store,
      listPrepared: async () => {
        const read = await store.listWithVersion();
        loaded = read.version;
        records = read.records;
        names = new Set(
          read.records.flatMap((record) =>
            [record.displayName, ...record.aliases].map(aliasKeyOf),
          ),
        );
        return read.records;
      },
    },
  });

  const load = (): Promise<number> => index.warm();

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
      if ((await store.version()) === loaded) return false;
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
