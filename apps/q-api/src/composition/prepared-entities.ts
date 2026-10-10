import { decide, parseMention, rankCandidates } from "@capital-q/q-core/names";
import type { NameCandidate } from "@capital-q/q-core/names";

/**
 * Prepared public research entities, held hot (W5).
 *
 * A handful of public people and institutions are researched ahead of
 * time (seed `qatar-five.v1`). Naming one of them must not cost a web
 * search or a database trip: the alias index and a compact summary of each
 * are loaded once at process start (one query), served from memory, and
 * rebuilt from the store when the store's version changes.
 *
 * What lives here is identification and a verified fact bundle, never a
 * biography, a portrait of a real person, or a pronunciation: a name in
 * Arabic script is held only when a source printed it, and nothing is
 * transliterated or "pronounced" by this module. These are global public
 * research records, not tenant data, not a profile of record.
 */

export type PreparedEntityKind =
  "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";

export type PreparedFactStatus = "VERIFIED" | "UNVERIFIED" | "CONTRADICTED";

export type PreparedFact = {
  readonly claim: string;
  readonly status: PreparedFactStatus;
  readonly sourceIds: readonly string[];
  readonly note: string | null;
};

/** The compact summary: enough to identify and to start a rehearsal. */
export type PreparedEntity = {
  /** Stable id, the seed's `demo_id`; never reused for another entity. */
  readonly id: string;
  readonly kind: PreparedEntityKind;
  readonly displayName: string;
  /** Latin-script aliases. */
  readonly aliases: readonly string[];
  /** Only names a source printed in Arabic script; never generated. */
  readonly arabicNames: readonly string[];
  readonly organisation: string | null;
  /** One line, for the session prewarm list. */
  readonly oneLine: string;
  readonly facts: readonly PreparedFact[];
  readonly rehearsalTopics: readonly string[];
  /** Own-website logo for an organisation; null means monogram. */
  readonly imageUrl: string | null;
  readonly researchStatus: "PREPARED_PUBLIC_SEED";
  readonly requiresRefresh: boolean;
};

export type PreparedEntitySet = {
  /** Changes whenever the store's prepared entities change. */
  readonly version: string;
  readonly entities: readonly PreparedEntity[];
};

/** The store, seen from the hot cache: one query to load, one to check. */
export type PreparedEntityStorePort = {
  readonly load: () => Promise<PreparedEntitySet>;
  readonly version: () => Promise<string>;
};

export type PreparedLookup =
  | { readonly kind: "FOUND"; readonly entity: PreparedEntity }
  | { readonly kind: "AMBIGUOUS"; readonly entities: readonly PreparedEntity[] }
  | { readonly kind: "NOT_PREPARED" };

/**
 * Lowercased, diacritic-free, punctuation-free key. Arabic script is kept
 * as is (letters survive `\p{L}`), so a printed Arabic name matches itself.
 */
export const aliasKey = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

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

type Index = {
  readonly version: string;
  readonly byId: ReadonlyMap<string, PreparedEntity>;
  readonly byAlias: ReadonlyMap<string, readonly PreparedEntity[]>;
  readonly persons: readonly NameCandidate[];
  readonly institutions: readonly NameCandidate[];
};

function buildIndex(set: PreparedEntitySet): Index {
  const byId = new Map<string, PreparedEntity>();
  const byAlias = new Map<string, PreparedEntity[]>();
  const persons: NameCandidate[] = [];
  const institutions: NameCandidate[] = [];
  for (const entity of set.entities) {
    byId.set(entity.id, entity);
    const names = [
      entity.displayName,
      ...entity.aliases,
      ...entity.arabicNames,
    ];
    for (const name of names) {
      const key = aliasKey(name);
      if (key.length === 0) continue;
      const held = byAlias.get(key) ?? [];
      if (!held.includes(entity)) held.push(entity);
      byAlias.set(key, held);
    }
    const candidate: NameCandidate = {
      id: entity.id,
      name: entity.displayName,
      aliases: [...entity.aliases, ...entity.arabicNames],
    };
    (entity.kind === "PERSON" ? persons : institutions).push(candidate);
  }
  return { version: set.version, byId, byAlias, persons, institutions };
}

export type PreparedEntityCache = {
  /** Loads from the store (one query). Call at process start. */
  readonly start: () => Promise<void>;
  /**
   * Resolves a spoken or typed name against the prepared entities. Pure
   * memory: no web, no database. Before `start` it finds nothing.
   */
  readonly lookup: (text: string) => PreparedLookup;
  readonly byId: (id: string) => PreparedEntity | undefined;
  readonly all: () => readonly PreparedEntity[];
  readonly version: () => string | null;
  /**
   * Checks the store's version and rebuilds on a change. Called from a
   * background timer or after a store write, never from a lookup.
   */
  readonly refreshIfChanged: () => Promise<boolean>;
  /** Drops the index; the next `refreshIfChanged` reloads. */
  readonly invalidate: () => void;
};

export function createPreparedEntityCache(
  store: PreparedEntityStorePort,
): PreparedEntityCache {
  let index: Index | null = null;
  let loading: Promise<void> | null = null;

  async function load(): Promise<void> {
    index = buildIndex(await store.load());
  }

  function resolve(text: string): PreparedLookup {
    const held = index;
    if (held === null) return { kind: "NOT_PREPARED" };
    const key = aliasKey(text);
    if (key.length === 0) return { kind: "NOT_PREPARED" };
    const exact = held.byAlias.get(key);
    if (exact !== undefined) {
      const [only] = exact;
      return exact.length === 1 && only !== undefined
        ? { kind: "FOUND", entity: only }
        : { kind: "AMBIGUOUS", entities: exact };
    }
    // Variants (alternate romanisations, word order, "Doha" clue): the
    // shared name scorer. A bare surname or a near miss is never a match
    // on its own: `decide` wants a clear lead.
    // A query made only of generic words ("Invest", "Qatar Capital") names
    // a category, not one of these entities.
    if (key.split(" ").every((word) => GENERIC_WORDS.has(word))) {
      return { kind: "NOT_PREPARED" };
    }
    const mention = parseMention(text);
    const ranked = [
      ...rankCandidates(mention, held.persons, { kind: "person" }),
      ...rankCandidates(mention, held.institutions, { kind: "organisation" }),
    ].sort((a, b) => b.score - a.score);
    const decision = decide(ranked, { withinOwnRecords: true });
    if (decision.kind === "ONE") {
      const entity = held.byId.get(decision.candidate.id);
      return entity === undefined
        ? { kind: "NOT_PREPARED" }
        : { kind: "FOUND", entity };
    }
    if (decision.kind === "SEVERAL") {
      // Several weak name hits are not "ambiguity between prepared
      // entities"; only strong ones are offered.
      const strong = decision.candidates
        .slice(0, 3)
        .filter((one) => one.score >= 0.85)
        .map((one) => held.byId.get(one.id))
        .filter((one): one is PreparedEntity => one !== undefined);
      return strong.length > 1
        ? { kind: "AMBIGUOUS", entities: strong }
        : { kind: "NOT_PREPARED" };
    }
    return { kind: "NOT_PREPARED" };
  }

  return {
    start: () => {
      loading ??= load().finally(() => {
        loading = null;
      });
      return loading;
    },
    lookup: resolve,
    byId: (id) => index?.byId.get(id),
    all: () => (index === null ? [] : [...index.byId.values()]),
    version: () => index?.version ?? null,
    refreshIfChanged: async () => {
      const current = await store.version();
      if (index !== null && index.version === current) return false;
      await load();
      return true;
    },
    invalidate: () => {
      index = null;
    },
  };
}

/** Starts a quiet background check; the timer never keeps the process up. */
export function watchPreparedEntities(
  cache: PreparedEntityCache,
  onError: (error: unknown) => void,
  everyMs = 60_000,
): () => void {
  const timer = setInterval(() => {
    cache.refreshIfChanged().catch(onError);
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Who a rehearsal is held with. A person is a source-informed simulation
 * (their face and voice are never cloned). An institution is a labelled
 * role-based representative: a synthetic stand-in, not a real person, and
 * it never carries a personal mandate or personal preferences.
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
  entity: PreparedEntity,
): RehearsalCounterpart {
  if (entity.kind === "PERSON") {
    return {
      kind: "SOURCE_INFORMED_SIMULATION",
      entityId: entity.id,
      label: `Simulation informed by public sources about ${entity.displayName}; not ${entity.displayName}`,
    };
  }
  return {
    kind: "ROLE_REPRESENTATIVE",
    entityId: entity.id,
    label: `Synthetic representative of ${entity.displayName} (a role, not a real person)`,
    personalMandate: null,
  };
}

const KIND_WORD: Record<PreparedEntityKind, string> = {
  PERSON: "person",
  ORGANIZATION: "organisation",
  GOVERNMENT_AGENCY: "government agency",
};

/**
 * The session prewarm list: names, kind, one line and the stable id. Not
 * biographies, no facts. Bounded so it fits the Live context budget.
 */
export function preparedEntityPrewarmLines(
  entities: readonly PreparedEntity[],
  maxLines = 8,
): string[] {
  return entities.slice(0, maxLines).map((entity) => {
    const line = entity.oneLine.replace(/\s+/gu, " ").trim().slice(0, 90);
    return `${entity.displayName} (${KIND_WORD[entity.kind]}, ${entity.id}): ${line}`;
  });
}
