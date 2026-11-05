import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  createAuthorisedRetrievalService,
  DEFAULT_RETRIEVAL_CONFIG,
  planRetrievalQueries,
  RETRIEVAL_CONFIG_V1,
  searchTerms,
  type ChunkHydrationPort,
  type HydratedChunk,
  type LexicalSearchPort,
  type RetrievalConfig,
  type RetrievalPermissionEnvelope,
  type RetrievalScopeConstraint,
} from "@capital-q/q-knowledge";
import type {
  QConversationLedger,
  QLedgerEntity,
  QRetrievalFocus,
} from "@capital-q/q-runtime";

import {
  Q_IQ_COMPANIES,
  Q_IQ_CONTRADICTIONS,
  Q_IQ_DATASET,
  Q_IQ_DOCUMENTS,
  Q_IQ_ENTITIES,
  Q_IQ_FACTS,
  Q_IQ_PEOPLE,
  type QIqCase,
  type QIqCategory,
  type QIqDataset,
  type QIqFact,
  type QIqTurn,
} from "../datasets/q-iq/index.js";

/**
 * Q intelligence step 5 bar: the share of Q-IQ evidence questions whose
 * needed fact is in the final 8 retrieval hits.
 *
 * "Needed" comes from the dataset's own expectations, by code: for an
 * ANSWER turn, the facts of the expected entities whose figures the reply
 * must state, or (for a turn with no required figure) whose statement
 * carries a required term. A turn with no such fact (UNKNOWN, CLARIFY,
 * talk) is not an evidence question and is not counted. A turn passes
 * only when EVERY needed fact is in the hits (a compound ask needs all of
 * its parts).
 *
 * The corpus is the Q-IQ world as chunks: one chunk per fact, plus six
 * figure-free deck chunks per company that share the facts' vocabulary
 * ("monthly", "revenue", "cash", "customers"), so ranking has to work.
 * Retrieval is the real service (fusion, hydration, expansion, reranker)
 * over in-memory ports that apply the envelope the way the SQL does and
 * rank lexically by OR-ed lexemes as `ts_rank` does; no embedding runtime,
 * as on production today. The integration test runs the same measurement
 * over the real Postgres FTS.
 *
 * The conversation ledger for each turn is built from the case's earlier
 * turns (the entities Q's replies were about, and names said), with ids.
 * Two step-5 readings are measured: LEDGER (no reader binding, names and
 * recency only) and READER (the reader bound the turn's pointing words to
 * the expected entities that the ledger holds -- the step-3 reader's job,
 * taken as given here; it is measured by the live Q-IQ, not by this).
 */

export const Q_IQ_RETRIEVAL_MODES = [
  "V1_WORDS",
  "V2_LEDGER",
  "V2_READER",
] as const;
export type QIqRetrievalMode = (typeof Q_IQ_RETRIEVAL_MODES)[number];

/** A deterministic uuid for a Q-IQ id (stable across runs and machines). */
export function qIqUuid(key: string): string {
  const hex = createHash("sha256").update(`q-iq:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const Q_IQ_TENANT_ID = qIqUuid("tenant");

export type QIqChunk = {
  readonly chunkId: string;
  readonly subjectId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly content: string;
  /** The fact this chunk carries; null for a figure-free deck chunk. */
  readonly factId: string | null;
};

/** Which company (or investor) a fact's chunk is filed under. */
function subjectKeyOf(fact: QIqFact): string {
  const person = Q_IQ_PEOPLE.find((one) => one.id === fact.entityId);
  if (person !== undefined) return person.companyId;
  const document = Q_IQ_DOCUMENTS.find((one) => one.id === fact.entityId);
  if (document !== undefined) return document.companyId;
  return fact.entityId;
}

function documentKeyOf(fact: QIqFact): { id: string; title: string } {
  const document = Q_IQ_DOCUMENTS.find((one) => one.id === fact.entityId);
  if (document !== undefined) return { id: document.id, title: document.name };
  const subject = subjectKeyOf(fact);
  const name =
    Q_IQ_ENTITIES.find((entity) => entity.id === subject)?.name ?? subject;
  return { id: `${subject}:profile`, title: `${name} company profile` };
}

/**
 * The slide heading a deck or data-room page puts above a figure ("Customers",
 * "Monthly burn"). Chunks carry their headings in production; without one,
 * "customer count" could never reach "38 lending partners" lexically, which
 * is a vocabulary gap only the semantic half bridges (not measured here).
 */
const HEADINGS: Readonly<Record<string, string>> = {
  profile: "Company overview",
  arr: "Revenue (ARR)",
  burn: "Monthly burn",
  runway: "Cash runway",
  customers: "Customers (customer count)",
  margin: "Gross margin",
  raise: "Current raise",
  role: "Team",
  summary: "Deck summary",
  mandate: "Investment mandate",
};

function headingOf(fact: QIqFact): string {
  const key = fact.id.slice(fact.id.lastIndexOf(":") + 1);
  const contradiction = Q_IQ_CONTRADICTIONS.find((x) =>
    fact.id.startsWith(`${x.id}:`),
  );
  if (contradiction !== undefined) {
    return (
      contradiction.metric.charAt(0).toUpperCase() +
      contradiction.metric.slice(1)
    );
  }
  return HEADINGS[key] ?? "Overview";
}

export function buildQIqCorpus(): readonly QIqChunk[] {
  const chunks: QIqChunk[] = Q_IQ_FACTS.map((fact) => {
    const document = documentKeyOf(fact);
    return {
      chunkId: qIqUuid(`chunk:${fact.id}`),
      subjectId: qIqUuid(subjectKeyOf(fact)),
      documentId: qIqUuid(`document:${document.id}`),
      documentTitle: document.title,
      content: `${headingOf(fact)}. ${fact.statement} Source: ${fact.source}.`,
      factId: fact.id,
    };
  });
  for (const c of Q_IQ_COMPANIES) {
    const noise = [
      `${c.name} team and hiring plan: the founders lead product, engineering and sales from ${c.city}.`,
      `${c.name} market overview: demand for ${c.sector} in ${c.city} and neighbouring markets keeps growing.`,
      `${c.name} competition: incumbents and new entrants in ${c.sector}; ${c.name} differentiates on product and distribution.`,
      `${c.name} use of funds: hiring, product and expansion, with monthly reporting to investors after the round.`,
      `${c.name} revenue model: recurring annual contracts with ${c.customerNoun}, billed monthly.`,
      `${c.name} risks: regulation, customer concentration and cash management.`,
    ];
    noise.forEach((content, at) => {
      chunks.push({
        chunkId: qIqUuid(`chunk:${c.id}:deck:${String(at)}`),
        subjectId: qIqUuid(c.id),
        documentId: qIqUuid(`document:${c.id}:deck`),
        documentTitle: `${c.name} pitch deck`,
        content,
        factId: null,
      });
    });
  }
  return chunks;
}

/**
 * The facts a turn needs in its hits, as groups: the turn passes when every
 * group has at least one fact in the hits. Empty when it is not an evidence
 * question.
 *   - required figures: each fact carrying one is its own group (all of
 *     them are needed: a contradiction needs both sides);
 *   - otherwise required terms other than the entities' own names (a
 *     person's background word): the facts carrying one, one group;
 *   - otherwise (an overview, "one line on each"): any fact of each
 *     expected entity, one group per entity.
 */
export function neededFactGroups(
  turn: QIqTurn,
): readonly (readonly string[])[] {
  const expect = turn.expect;
  if (expect.behaviour !== "ANSWER") return [];
  const facts = Q_IQ_FACTS.filter((fact) =>
    expect.entityIds.includes(fact.entityId),
  );
  if (expect.requiredFigures.length > 0) {
    return facts
      .filter((fact) =>
        fact.figures.some((figure) => expect.requiredFigures.includes(figure)),
      )
      .map((fact) => [fact.id]);
  }
  const names = Q_IQ_ENTITIES.filter((entity) =>
    expect.entityIds.includes(entity.id),
  ).flatMap((entity) =>
    [entity.name, ...entity.aliases].map((n) => n.toLowerCase()),
  );
  const terms = expect.requiredTerms.filter(
    (group) =>
      !group.some((term) =>
        names.some((name) => name.includes(term.toLowerCase())),
      ),
  );
  if (terms.length > 0) {
    const carrying = facts
      .filter((fact) =>
        terms.some((group) =>
          group.some((term) =>
            fact.statement.toLowerCase().includes(term.toLowerCase()),
          ),
        ),
      )
      .map((fact) => fact.id);
    if (carrying.length > 0) return [carrying];
  }
  return expect.entityIds
    .map((id) =>
      facts.filter((fact) => fact.entityId === id).map((fact) => fact.id),
    )
    .filter((group) => group.length > 0);
}

/** Every fact id any group names (for reports). */
export function neededFactIds(turn: QIqTurn): readonly string[] {
  return [...new Set(neededFactGroups(turn).flat())];
}

// ---------------------------------------------------------------------------
// In-memory ports with the SQL's authorisation shape
// ---------------------------------------------------------------------------

const SENSITIVITY = ["NETWORK_VISIBLE", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL"];

export type QIqStoredChunk = QIqChunk & {
  readonly tenantId: string;
  readonly visibilityScope: RetrievalScopeConstraint["visibilityScopes"][number];
  readonly sensitivityClass: RetrievalScopeConstraint["sensitivityCeiling"];
};

function admittedBy(
  chunk: QIqStoredChunk,
  tenantId: string,
  constraints: readonly RetrievalScopeConstraint[],
): RetrievalScopeConstraint | null {
  if (chunk.tenantId !== tenantId) return null;
  return (
    constraints.find(
      (constraint) =>
        (constraint.subjectIds === null ||
          constraint.subjectIds.includes(chunk.subjectId)) &&
        constraint.visibilityScopes.includes(chunk.visibilityScope) &&
        SENSITIVITY.indexOf(chunk.sensitivityClass) <=
          SENSITIVITY.indexOf(constraint.sensitivityCeiling),
    ) ?? null
  );
}

/**
 * Lexical search as the Postgres adapter does it: the question's lexemes
 * ORed, the envelope applied before ranking, ranked by how many of the
 * lexemes a chunk carries (ties: more occurrences, then id).
 */
export function memoryLexicalSearch(
  chunks: readonly QIqStoredChunk[],
): LexicalSearchPort {
  const terms = new Map(
    chunks.map((chunk) => [chunk.chunkId, searchTerms(`${chunk.content}`)]),
  );
  return {
    search: (_executor, query) => {
      const wanted = new Set(searchTerms(query.text));
      if (wanted.size === 0 || query.constraints.length === 0) {
        return Promise.resolve([]);
      }
      const scored = chunks.flatMap((chunk) => {
        if (admittedBy(chunk, query.tenantId, query.constraints) === null)
          return [];
        const own = terms.get(chunk.chunkId) ?? [];
        const distinct = new Set(own.filter((term) => wanted.has(term))).size;
        if (distinct === 0) return [];
        const total = own.filter((term) => wanted.has(term)).length;
        return [{ chunk, score: distinct + total / 100 }];
      });
      scored.sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.chunk.chunkId < b.chunk.chunkId
            ? -1
            : 1,
      );
      return Promise.resolve(
        scored.slice(0, query.limit).map((entry, at) => ({
          chunkId: entry.chunk.chunkId as never,
          rank: at + 1,
          lexicalScore: entry.score,
        })),
      );
    },
  };
}

export function memoryHydration(
  chunks: readonly QIqStoredChunk[],
): ChunkHydrationPort {
  const hydrated = (
    chunk: QIqStoredChunk,
    constraint: RetrievalScopeConstraint,
  ): HydratedChunk => ({
    chunkId: chunk.chunkId as never,
    chunkSetId: qIqUuid(`set:${chunk.documentId}`) as never,
    documentId: chunk.documentId,
    documentVersionId: qIqUuid(`version:${chunk.documentId}`) as never,
    documentTitle: chunk.documentTitle,
    subjectType: "COMPANY",
    subjectId: chunk.subjectId,
    chunkKind: "slide" as never,
    role: "LEAF",
    locator: { slide: 1 } as never,
    content: chunk.content,
    visibilityScope: chunk.visibilityScope,
    sensitivityClass: chunk.sensitivityClass,
    scopeKind: constraint.scopeKind,
    canDiscloseExistence: constraint.canDiscloseExistence,
    canQuote: constraint.canQuote,
    canProvideLink: constraint.canProvideLink,
    parentChunkId: null,
  });
  return {
    hydrate: (_executor, query) =>
      Promise.resolve(
        query.chunkIds.flatMap((id) => {
          const chunk = chunks.find((one) => one.chunkId === id);
          const constraint =
            chunk === undefined
              ? null
              : admittedBy(chunk, query.tenantId, query.constraints);
          return chunk === undefined || constraint === null
            ? []
            : [hydrated(chunk, constraint)];
        }),
      ),
    parentsOf: () => Promise.resolve(new Map()),
    countAuthorised: (_executor, scope) =>
      Promise.resolve(
        Math.min(
          scope.limit,
          chunks.filter(
            (chunk) =>
              admittedBy(chunk, scope.tenantId, scope.constraints) !== null,
          ).length,
        ),
      ),
  };
}

/** An investor actor's envelope over the Q-IQ world: network-visible material. */
export function qIqEnvelope(
  constraints?: readonly RetrievalScopeConstraint[],
): RetrievalPermissionEnvelope {
  const now = Date.now();
  return {
    planId: qIqUuid("plan"),
    planFingerprint: "a".repeat(64),
    policyVersion: "context-firewall-v2",
    tenantId: Q_IQ_TENANT_ID,
    actorUserId: qIqUuid("actor"),
    organisationId: qIqUuid("actor-org"),
    taskClass: "COMPANY_RESEARCH" as RetrievalPermissionEnvelope["taskClass"],
    constraints: constraints ?? [
      {
        scopeKind: "NETWORK_VISIBLE_DATA",
        layer: "SEMANTIC_HYBRID",
        subjectIds: null,
        visibilityScopes: ["network_visible"],
        sensitivityCeiling: "NETWORK_VISIBLE",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: true,
      },
    ],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    evaluatedAt: new Date(now).toISOString(),
    revalidateAfter: new Date(now + 3_600_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The conversation ledger each turn sees
// ---------------------------------------------------------------------------

function entityNamesIn(text: string): readonly string[] {
  const lower = text.toLowerCase();
  return Q_IQ_ENTITIES.filter((entity) =>
    [entity.name, ...entity.aliases].some((name) =>
      new RegExp(
        `(^|[^\\p{L}])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^\\p{L}])`,
        "u",
      ).test(lower),
    ),
  ).map((entity) => entity.id);
}

/**
 * The ledger step 2 would hold before turn `index`: every entity Q's
 * earlier replies were about or named, and every name the person said
 * (with the record behind it, as a search or card result gives it). A
 * person or a document carries its company as `of`.
 */
export function qIqLedgerBefore(
  c: QIqCase,
  index: number,
): QConversationLedger {
  const entities: QLedgerEntity[] = [];
  const refOf = new Map<string, string>();
  const put = (
    key: string,
    turnNo: number,
    via: QLedgerEntity["via"][number],
  ): string | null => {
    const known = Q_IQ_ENTITIES.find((entity) => entity.id === key);
    if (known === undefined) return null;
    const existing = refOf.get(key);
    if (existing !== undefined) {
      const at = entities.findIndex((entity) => entity.ref === existing);
      const current = entities[at];
      if (current !== undefined) {
        entities[at] = {
          ...current,
          lastTurn: Math.max(current.lastTurn, turnNo),
        };
      }
      return existing;
    }
    const owner =
      Q_IQ_PEOPLE.find((p) => p.id === key)?.companyId ??
      Q_IQ_DOCUMENTS.find((d) => d.id === key)?.companyId ??
      null;
    const ofRef = owner === null ? null : put(owner, turnNo, via);
    const ref = `E${String(entities.length + 1)}`;
    refOf.set(key, ref);
    entities.push({
      ref,
      kind: known.kind === "INVESTOR" ? "INVESTOR_ORGANISATION" : known.kind,
      id: qIqUuid(key),
      name: known.name,
      firstTurn: turnNo,
      lastTurn: turnNo,
      via: [via],
      of: ofRef,
      value: null,
    });
    return ref;
  };
  c.turns.slice(0, index).forEach((turn, at) => {
    const userNo = at * 2 + 1;
    for (const id of entityNamesIn(turn.user)) put(id, userNo, "SAID_BY_THEM");
    for (const id of [
      ...turn.expect.entityIds,
      ...entityNamesIn(turn.reference),
    ])
      put(id, userNo + 1, "SAID_BY_Q");
  });
  // This turn's own words: a name the ledger already holds binds to its
  // entry; a new name is registered as words only (no record id), as
  // step 2's mention fold does -- nothing turns a name into a record.
  const current = c.turns[index];
  if (current !== undefined) {
    const userNo = index * 2 + 1;
    for (const key of entityNamesIn(current.user)) {
      if (refOf.has(key)) {
        put(key, userNo, "SAID_BY_THEM");
        continue;
      }
      const known = Q_IQ_ENTITIES.find((entity) => entity.id === key);
      if (known === undefined) continue;
      const ref = `E${String(entities.length + 1)}`;
      refOf.set(key, ref);
      entities.push({
        ref,
        kind: known.kind === "INVESTOR" ? "INVESTOR_ORGANISATION" : known.kind,
        id: null,
        name: known.name,
        firstTurn: userNo,
        lastTurn: userNo,
        via: ["SAID_BY_THEM"],
        of: null,
        value: null,
      });
    }
  }
  return { entities, lists: [] };
}

/** The refs the reader would bind this turn's words to (the expected entities the ledger holds). */
export function qIqReaderRefs(
  ledger: QConversationLedger,
  turn: QIqTurn,
): readonly string[] {
  // An expected person or deck the ledger does not hold yet is reached
  // through the entry it belongs to ("who runs the first one?" binds the
  // first company; the answer finds its CEO).
  const byName = (key: string) => {
    const name = Q_IQ_ENTITIES.find((entity) => entity.id === key)?.name;
    return ledger.entities.find(
      (entity) =>
        entity.id === qIqUuid(key) ||
        (entity.id === null && entity.name === name),
    );
  };
  return [
    ...new Set(
      turn.expect.entityIds.flatMap((key) => {
        const found = byName(key);
        if (found !== undefined) return [found.ref];
        const owner =
          Q_IQ_PEOPLE.find((p) => p.id === key)?.companyId ??
          Q_IQ_DOCUMENTS.find((d) => d.id === key)?.companyId;
        const ownerEntry = owner === undefined ? undefined : byName(owner);
        return ownerEntry === undefined ? [] : [ownerEntry.ref];
      }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

export type QIqRetrievalTurnResult = {
  readonly caseId: string;
  readonly turn: number;
  readonly category: QIqCategory;
  readonly needed: readonly string[];
  readonly found: readonly string[];
  readonly pass: boolean;
};

export type QIqRetrievalReport = {
  readonly mode: QIqRetrievalMode;
  readonly configVersion: string;
  readonly evidenceTurns: number;
  readonly passed: number;
  readonly share: number;
  readonly byCategory: Readonly<
    Partial<
      Record<QIqCategory, { readonly turns: number; readonly passed: number }>
    >
  >;
  readonly failures: readonly QIqRetrievalTurnResult[];
};

/** A retrieval over the Q-IQ corpus, returning the fact ids in the final hits. */
export type QIqRetrieve = (input: {
  readonly mode: QIqRetrievalMode;
  readonly words: string;
  /** Their earlier messages in this conversation, newest first. */
  readonly previousWords: readonly string[];
  readonly focus: QRetrievalFocus | undefined;
}) => Promise<readonly string[]>;

export function storedQIqCorpus(): readonly QIqStoredChunk[] {
  return buildQIqCorpus().map((chunk) => ({
    ...chunk,
    tenantId: Q_IQ_TENANT_ID,
    visibilityScope: "network_visible",
    sensitivityClass: "NETWORK_VISIBLE",
  }));
}

export function configFor(mode: QIqRetrievalMode): RetrievalConfig {
  return mode === "V1_WORDS" ? RETRIEVAL_CONFIG_V1 : DEFAULT_RETRIEVAL_CONFIG;
}

/** The in-memory retrieve: the real service over the in-memory ports. */
export function memoryQIqRetrieve(
  chunks: readonly QIqStoredChunk[] = storedQIqCorpus(),
): QIqRetrieve {
  const factOf = new Map(chunks.map((chunk) => [chunk.chunkId, chunk.factId]));
  const lexical = memoryLexicalSearch(chunks);
  const hydration = memoryHydration(chunks);
  const sql = {} as DatabaseExecutor;
  const services = new Map(
    Q_IQ_RETRIEVAL_MODES.map((mode) => [
      mode,
      createAuthorisedRetrievalService({
        sql,
        lexical,
        semantic: { search: () => Promise.resolve([]) },
        hydration,
        config: configFor(mode),
      }),
    ]),
  );
  return async ({ mode, words, previousWords, focus }) => {
    const service = services.get(mode);
    if (service === undefined) throw new Error(`no service for ${mode}`);
    const planned =
      mode === "V1_WORDS"
        ? null
        : planRetrievalQueries({
            words,
            previousWords,
            focus,
            maxQueries: service.config.maxSubQueries,
          });
    const result = await service.retrieve({
      query: words,
      envelope: qIqEnvelope(),
      ...(planned === null
        ? {}
        : {
            queries: planned.queries,
            ...(planned.focus === null ? {} : { focus: planned.focus }),
          }),
    });
    return result.hits.flatMap((hit) => {
      const fact = factOf.get(hit.chunkId);
      return fact === undefined || fact === null ? [] : [fact];
    });
  };
}

export async function measureQIqRetrieval(
  retrieve: QIqRetrieve,
  mode: QIqRetrievalMode,
  dataset: QIqDataset = Q_IQ_DATASET,
): Promise<QIqRetrievalReport> {
  const results: QIqRetrievalTurnResult[] = [];
  for (const c of dataset.cases) {
    for (const [index, turn] of c.turns.entries()) {
      const groups = neededFactGroups(turn);
      if (groups.length === 0) continue;
      const needed = [...new Set(groups.flat())];
      const ledger = qIqLedgerBefore(c, index);
      const focus: QRetrievalFocus | undefined =
        mode === "V1_WORDS"
          ? undefined
          : {
              ledger,
              boundRefs:
                mode === "V2_READER" ? qIqReaderRefs(ledger, turn) : [],
            };
      const previousWords = c.turns
        .slice(0, index)
        .map((earlier) => earlier.user)
        .reverse();
      const hits = await retrieve({
        mode,
        words: turn.user,
        previousWords,
        focus,
      });
      const found = needed.filter((id) => hits.includes(id));
      results.push({
        caseId: c.id,
        turn: index,
        category: c.category,
        needed,
        found,
        pass: groups.every((group) => group.some((id) => hits.includes(id))),
      });
    }
  }
  const byCategory: Partial<
    Record<QIqCategory, { turns: number; passed: number }>
  > = {};
  for (const result of results) {
    const entry = byCategory[result.category] ?? { turns: 0, passed: 0 };
    entry.turns += 1;
    if (result.pass) entry.passed += 1;
    byCategory[result.category] = entry;
  }
  const passed = results.filter((result) => result.pass).length;
  return {
    mode,
    configVersion: configFor(mode).configVersion,
    evidenceTurns: results.length,
    passed,
    share: results.length === 0 ? 0 : passed / results.length,
    byCategory,
    failures: results.filter((result) => !result.pass),
  };
}

export function renderQIqRetrievalReport(report: QIqRetrievalReport): string {
  const lines = [
    `${report.mode} (${report.configVersion}): ${String(report.passed)}/${String(report.evidenceTurns)} evidence turns have every needed fact in the final 8 (${(report.share * 100).toFixed(1)}%)`,
  ];
  for (const [category, entry] of Object.entries(report.byCategory)) {
    lines.push(
      `  ${category.padEnd(26)} ${String(entry.passed)}/${String(entry.turns)}`,
    );
  }
  return lines.join("\n");
}
