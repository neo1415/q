import {
  nameKeyOf,
  scoreOrgNames,
  scorePersonNames,
} from "@capital-q/q-core/names";
import {
  type ExternalEntityImage,
  type ExternalEntityKind,
  type ExternalEntityQuote,
  type ExternalPersonConfidence,
  type ExternalResearchStatus,
  type IdentityCard,
  type PersonSearchResult,
} from "@capital-q/contracts/q";

import { externalPersonIdFor } from "./person-search.js";

/**
 * Known (prepared) research entities (W2, 2026-10-10; Qatar demo pack).
 *
 * Entities researched in advance from public sources are stored once and
 * answered from a warm in-memory index: resolving one makes no web call
 * and, once warm, no database round trip. A web search happens only when
 * the member explicitly asks for a fresh one. The index is only a read
 * cache over the store; the store is the owner of the rows.
 */

export type EntitySourceRecord = {
  /** The entity's own reference to the source ("S01"). */
  readonly sourceId: string;
  readonly url: string;
  readonly description: string | null;
  readonly publishedAt: string | null;
  /** How the source stands as evidence, in words ("publicly documented"). */
  readonly evidenceClass: string | null;
};

export type EntityFactRecord = {
  readonly claim: string;
  readonly sourceIds: readonly string[];
  readonly evidenceClass: string | null;
};

export type KnownEntityRecord = {
  readonly externalPersonId: string;
  readonly profileKey: string;
  readonly entityKind: ExternalEntityKind;
  readonly researchStatus: ExternalResearchStatus;
  readonly requiresRefresh: boolean;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly profileUrl: string | null;
  /** A person's role only; null for an organisation or agency. */
  readonly role: string | null;
  readonly organization: string | null;
  readonly location: string | null;
  readonly confidence: ExternalPersonConfidence;
  readonly facts: readonly EntityFactRecord[];
  readonly sources: readonly EntitySourceRecord[];
  readonly quotes: readonly ExternalEntityQuote[];
  readonly image: ExternalEntityImage;
  /** Bounded extras the loader keeps (rehearsal topics and questions). */
  readonly profile: Readonly<Record<string, unknown>>;
  readonly lastResearchedAt: string;
};

/** What a loader (W5) supplies; the id is derived from the profile key. */
export type PreparedEntityUpsert = Omit<
  KnownEntityRecord,
  "externalPersonId" | "researchStatus"
> & { readonly researchStatus?: "PREPARED_PUBLIC_SEED" | undefined };

/** The platform "owner" of a seed in the derived id (seeds have no tenant). */
const SEED_OWNER = "00000000-0000-4000-8000-000000000000";

export function preparedEntityIdFor(profileKey: string): string {
  return externalPersonIdFor(SEED_OWNER, SEED_OWNER, profileKey);
}

/**
 * The store a loader and the Q API call. One implementation (Postgres, in
 * the Q API composition) owns the rows; this package never touches a table.
 */
export type KnownEntityStore = {
  /** Idempotent by profile key: entity, aliases, facts and sources together. */
  readonly upsertPrepared: (
    entity: PreparedEntityUpsert,
  ) => Promise<{ readonly externalPersonId: string }>;
  readonly listPrepared: () => Promise<readonly KnownEntityRecord[]>;
  /** By the multilingual alias key (`aliasKeyOf`); one round trip. */
  readonly findByAlias: (
    aliasKey: string,
  ) => Promise<readonly KnownEntityRecord[]>;
};

/** The normalised key every alias is stored and looked up under. */
export function aliasKeyOf(text: string): string {
  return nameKeyOf(text).slice(0, 200);
}

export type KnownLookup =
  | { readonly kind: "FOUND"; readonly record: KnownEntityRecord }
  | { readonly kind: "SEVERAL"; readonly records: readonly KnownEntityRecord[] }
  | { readonly kind: "NONE" };

export type KnownEntityIndex = {
  /** Loads every prepared entity; returns how many. Call at start-up. */
  readonly warm: () => Promise<number>;
  /** Synchronous and database-free once warm; NONE before. */
  readonly lookup: (query: string) => KnownLookup;
  /** Warm lookup, else one store round trip by alias key. */
  readonly resolve: (query: string) => Promise<KnownLookup>;
  readonly size: () => number;
  /** Every warm entity (memory only; empty before warm). For discovery by kind and place. */
  readonly list: () => readonly KnownEntityRecord[];
  readonly warmed: () => boolean;
  /** Add or replace one entry (a loader keeps the cache in step). */
  readonly put: (record: KnownEntityRecord) => void;
};

function scoreAgainst(
  record: KnownEntityRecord,
  query: string,
): { readonly score: number; readonly accepted: boolean } {
  let best = 0;
  let accepted = false;
  for (const alias of [record.displayName, ...record.aliases]) {
    const match =
      record.entityKind === "PERSON"
        ? scorePersonNames(query, alias)
        : scoreOrgNames(query, alias);
    if (
      !match.partial &&
      (match.grade === "CANONICAL" || match.grade === "VARIANT")
    ) {
      accepted = true;
      best = Math.max(best, match.score);
    }
  }
  return { score: best, accepted };
}

export function createKnownEntityIndex(dependencies: {
  readonly store: KnownEntityStore;
}): KnownEntityIndex {
  const byKey = new Map<string, KnownEntityRecord[]>();
  const records = new Map<string, KnownEntityRecord>();
  let isWarm = false;

  const put = (record: KnownEntityRecord): void => {
    records.set(record.externalPersonId, record);
    for (const alias of [record.displayName, ...record.aliases]) {
      const key = aliasKeyOf(alias);
      if (key.length === 0) continue;
      const list = byKey.get(key) ?? [];
      const next = list.filter(
        (entry) => entry.externalPersonId !== record.externalPersonId,
      );
      next.push(record);
      byKey.set(key, next);
    }
  };

  const decide = (found: readonly KnownEntityRecord[]): KnownLookup => {
    const unique = [
      ...new Map(found.map((r) => [r.externalPersonId, r])).values(),
    ];
    const [first, ...rest] = unique;
    if (first === undefined) return { kind: "NONE" };
    return rest.length === 0
      ? { kind: "FOUND", record: first }
      : { kind: "SEVERAL", records: unique.slice(0, 4) };
  };

  const lookup = (query: string): KnownLookup => {
    if (!isWarm) return { kind: "NONE" };
    const key = aliasKeyOf(query);
    if (key.length === 0) return { kind: "NONE" };
    const exact = byKey.get(key);
    if (exact !== undefined && exact.length > 0) return decide(exact);
    // A variant spelling or script: the shared name scorer, over a small set.
    const scored = [...records.values()]
      .map((record) => ({ record, ...scoreAgainst(record, query) }))
      .filter((entry) => entry.accepted)
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (top === undefined) return { kind: "NONE" };
    // Entities as good as the best are all shown; a clear leader wins.
    return decide(
      scored
        .filter((entry) => top.score - entry.score < 0.05)
        .map((entry) => entry.record),
    );
  };

  return {
    warm: async () => {
      const prepared = await dependencies.store.listPrepared();
      byKey.clear();
      records.clear();
      for (const record of prepared) put(record);
      isWarm = true;
      return records.size;
    },
    lookup,
    resolve: async (query) => {
      const warm = lookup(query);
      if (warm.kind !== "NONE" || isWarm) return warm;
      // Cold: one round trip by key. Nothing is cached (a loader warms).
      const key = aliasKeyOf(query);
      return key.length === 0
        ? { kind: "NONE" }
        : decide(await dependencies.store.findByAlias(key));
    },
    size: () => records.size,
    list: () => (isWarm ? [...records.values()] : []),
    warmed: () => isWarm,
    put,
  };
}

/** Reads a stored entity as the member sees it: a card, no web call made. */
export function cardFromKnownEntity(
  record: KnownEntityRecord,
): IdentityCard | null {
  const sources = record.sources.slice(0, 8).map((source) => ({
    id: source.sourceId,
    description: source.description,
    evidenceClass: source.evidenceClass,
    url: source.url,
    domain: hostOf(source.url),
    title: source.description,
    publishedAt: source.publishedAt,
    retrievedAt: record.lastResearchedAt,
    provider: "prepared",
  }));
  if (sources.length === 0) return null;
  const uncertainty: string[] = [];
  if (record.researchStatus === "PREPARED_PUBLIC_SEED") {
    uncertainty.push(
      `Prepared from public sources on ${record.lastResearchedAt.slice(0, 10)}; ask for a fresh search to check it is current.`,
    );
  }
  if (record.requiresRefresh) {
    uncertainty.push(
      "Some details are time-sensitive and should be rechecked.",
    );
  }
  if (record.image.status === "NOT_ATTACHED") {
    uncertainty.push("No permitted portrait is attached.");
  }
  return {
    entityKind: record.entityKind,
    subject: {
      externalPersonId: record.externalPersonId,
      entityKind: record.entityKind,
      researchStatus: record.researchStatus,
      requiresRefresh: record.requiresRefresh,
      image: record.image,
      quotes: [...record.quotes],
      displayName: record.displayName,
      nameVariants: [...record.aliases].slice(0, 12),
      profileUrl: record.profileUrl,
      role: record.entityKind === "PERSON" ? record.role : null,
      organization: record.organization,
      location: record.location,
      evidenceBundleId: null,
      briefVersion: 0,
      confidence: record.confidence,
    },
    sources,
    uncertainty: uncertainty.slice(0, 4),
    attributionLine: `According to public sources prepared on ${record.lastResearchedAt.slice(0, 10)}.`,
    summary: oneLineOf(record),
    enriching: false,
    actions: ["RESEARCH_FURTHER", "REHEARSE"],
  };
}

/** The seed's own one-line description, or null when it has none. */
function oneLineOf(record: KnownEntityRecord): string | null {
  const line = record.profile["oneLine"];
  if (typeof line !== "string") return null;
  const clean = line.replace(/\s+/gu, " ").trim().slice(0, 280);
  return clean.length === 0 ? null : clean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

/** A search result for a prepared entity: no web call, zero providers. */
export function knownEntityResult(
  record: KnownEntityRecord,
  elapsedMs: number,
): PersonSearchResult | null {
  const card = cardFromKnownEntity(record);
  if (card === null) return null;
  return {
    outcome: "MATCHED",
    card,
    candidates: [],
    clarifyingQuestion: null,
    elapsedMs,
  };
}

/** An in-memory store for tests and local runs; the Q API uses Postgres. */
export function createInMemoryKnownEntityStore(): KnownEntityStore & {
  readonly all: () => readonly KnownEntityRecord[];
} {
  const rows = new Map<string, KnownEntityRecord>();
  return {
    upsertPrepared: (entity) => {
      const externalPersonId = preparedEntityIdFor(entity.profileKey);
      rows.set(externalPersonId, {
        ...entity,
        externalPersonId,
        researchStatus: "PREPARED_PUBLIC_SEED",
      });
      return Promise.resolve({ externalPersonId });
    },
    listPrepared: () =>
      Promise.resolve(
        [...rows.values()].filter(
          (row) => row.researchStatus === "PREPARED_PUBLIC_SEED",
        ),
      ),
    findByAlias: (aliasKey) =>
      Promise.resolve(
        [...rows.values()].filter((row) =>
          [row.displayName, ...row.aliases].some(
            (alias) => aliasKeyOf(alias) === aliasKey,
          ),
        ),
      ),
    all: () => [...rows.values()],
  };
}
