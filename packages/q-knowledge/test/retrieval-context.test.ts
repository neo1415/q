import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { QConversationLedger, QLedgerEntity } from "@capital-q/q-runtime";

import {
  createAuthorisedRetrievalService,
  createLocalReranker,
  DEFAULT_RETRIEVAL_CONFIG,
  narrowEnvelopeToSubjects,
  planRetrievalQueries,
  RETRIEVAL_CONFIG_V1,
  type ChunkHydrationPort,
  type HydratedChunk,
  type LexicalSearchPort,
  type LexicalSearchQuery,
  type RetrievalPermissionEnvelope,
  type RetrievalReranker,
  type RetrievalScopeConstraint,
} from "../src/index.js";
import type { SemanticSearchPort } from "../src/application/embedding-ports.js";
import type { ChunkId } from "../src/contracts/index.js";

/**
 * Q intelligence step 5: context-aware retrieval. Query rewriting from the
 * ledger, multi-query, the reranker port -- and the property all of it
 * must keep: authorisation resolves before retrieval and a rewrite never
 * widens scope. The SQL these in-memory ports stand in for is exercised
 * against PostgreSQL in the integration suite.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const OWN_CO = "44444444-4444-4444-8444-444444444444";
const SILO_CREDIT = "55555555-5555-4555-8555-555555555555";
const LEDGERFOLD = "66666666-6666-4666-8666-666666666666";
const OTHER_TENANT_CO = "77777777-7777-4777-8777-777777777777";

const sql = null as unknown as DatabaseExecutor;

const founderOwn = (): RetrievalScopeConstraint => ({
  scopeKind: "EVIDENCE_DOCUMENTS",
  layer: "EVIDENCE_DOCUMENTS",
  subjectIds: [OWN_CO],
  visibilityScopes: ["founder_private"],
  sensitivityCeiling: "HIGHLY_CONFIDENTIAL",
  canDiscloseExistence: true,
  canQuote: true,
  canProvideLink: false,
});
const network = (): RetrievalScopeConstraint => ({
  scopeKind: "NETWORK_VISIBLE_DATA",
  layer: "SEMANTIC_HYBRID",
  subjectIds: null,
  visibilityScopes: ["network_visible"],
  sensitivityCeiling: "NETWORK_VISIBLE",
  canDiscloseExistence: true,
  canQuote: true,
  canProvideLink: true,
});

function envelope(
  constraints: readonly RetrievalScopeConstraint[] = [founderOwn(), network()],
): RetrievalPermissionEnvelope {
  return {
    planId: "88888888-8888-4888-8888-888888888888",
    planFingerprint: "a".repeat(64),
    policyVersion: "context-firewall-v2",
    tenantId: TENANT_A,
    actorUserId: "33333333-3333-4333-8333-333333333333",
    organisationId: null,
    taskClass: "OWN_COMPANY_QUESTION",
    constraints,
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    evaluatedAt: "2026-11-05T10:00:00.000Z",
    revalidateAfter: "2099-01-01T00:00:00.000Z",
  };
}

function entity(
  ref: string,
  partial: Partial<QLedgerEntity> & Pick<QLedgerEntity, "kind" | "name">,
): QLedgerEntity {
  return {
    ref,
    id: null,
    firstTurn: 1,
    lastTurn: 1,
    via: ["SAID_BY_Q"],
    of: null,
    value: null,
    ...partial,
  };
}

const ledger: QConversationLedger = {
  entities: [
    entity("E1", {
      kind: "COMPANY",
      name: "Silo Credit",
      id: SILO_CREDIT,
      lastTurn: 2,
    }),
    entity("E2", {
      kind: "COMPANY",
      name: "Ledgerfold",
      id: LEDGERFOLD,
      lastTurn: 4,
    }),
    entity("E3", {
      kind: "PERSON",
      name: "Ngozi Eze",
      id: "p-ngozi",
      of: "E1",
      lastTurn: 2,
    }),
    entity("E4", { kind: "COMPANY", name: "Quaywise", id: null }),
  ],
  lists: [],
};

describe("query rewriting from the conversation ledger", () => {
  it("spells a bound pronoun into the search and filters to its company", () => {
    const plan = planRetrievalQueries({
      words: "and its burn?",
      focus: { ledger, boundRefs: ["E1"] },
    });
    expect(plan.queries[0]).toEqual({
      text: "Silo Credit and its burn?",
      subjectIds: [SILO_CREDIT],
    });
    expect(plan.focus?.subjectIds).toEqual([SILO_CREDIT]);
  });

  it("files a person under their company and searches with both names", () => {
    const plan = planRetrievalQueries({
      words: "what did she do before?",
      focus: { ledger, boundRefs: ["E3"] },
    });
    expect(plan.queries[0]?.subjectIds).toEqual([SILO_CREDIT]);
    expect(plan.queries[0]?.text).toContain("Silo Credit");
    expect(plan.queries[0]?.text).toContain("Ngozi Eze");
  });

  it("runs one search per subject for a compound ask about two companies", () => {
    const plan = planRetrievalQueries({
      words: "Compare their runway",
      focus: { ledger, boundRefs: ["E1", "E2"] },
    });
    expect(plan.queries.map((query) => query.subjectIds)).toEqual([
      [SILO_CREDIT],
      [LEDGERFOLD],
    ]);
  });

  it("splits a compound ask by its punctuation, one search per part", () => {
    const plan = planRetrievalQueries({
      words: "What's Silo Credit's ARR? And who is their CFO?",
      focus: { ledger, boundRefs: [] },
    });
    expect(plan.queries.map((query) => query.text)).toEqual([
      "What's Silo Credit's ARR?",
      "Silo Credit And who is their CFO?",
    ]);
  });

  it("carries the previous question, filtered and weighted below the turn", () => {
    const plan = planRetrievalQueries({
      words: "Same question for Ledgerfold.",
      previousWords: ["What's Silo Credit's monthly burn?"],
      focus: { ledger, boundRefs: [] },
    });
    expect(plan.queries).toContainEqual({
      text: "Ledgerfold What's Silo Credit's monthly burn?",
      subjectIds: [LEDGERFOLD],
      weight: 0.5,
    });
  });

  it("keeps the unfiltered words when the subject is only a recency guess, and lets the guess steer nothing", () => {
    const plan = planRetrievalQueries({
      words: "what about churn?",
      focus: { ledger, boundRefs: [] },
    });
    expect(plan.queries[0]).toEqual({ text: "what about churn?" });
    expect(plan.queries[1]?.subjectIds).toEqual([LEDGERFOLD]);
    expect(plan.focus).toBeNull();
  });

  it("never filters by an id that is not a record uuid, and a name-only entity searches unfiltered", () => {
    const plan = planRetrievalQueries({
      words: "and Quaywise?",
      focus: { ledger, boundRefs: ["E4"] },
    });
    expect(plan.queries.every((query) => query.subjectIds === undefined)).toBe(
      true,
    );
  });

  it("ignores a bound ref the ledger does not hold", () => {
    const plan = planRetrievalQueries({
      words: "its burn",
      focus: { ledger, boundRefs: ["E99"] },
    });
    expect(plan.queries[0]).toEqual({ text: "its burn" });
  });

  it("is the person's words alone without a ledger", () => {
    expect(planRetrievalQueries({ words: "  ARR?  " })).toEqual({
      queries: [{ text: "ARR?" }],
      focus: null,
      entities: [],
    });
  });
});

describe("a subject filter only narrows the envelope", () => {
  it("drops a founder-private way in that does not cover the subject", () => {
    const narrowed = narrowEnvelopeToSubjects(envelope(), [SILO_CREDIT]);
    expect(narrowed.constraints).toEqual([
      { ...network(), subjectIds: [SILO_CREDIT] },
    ]);
    expect(narrowed.tenantId).toBe(TENANT_A);
    expect(narrowed.maxSensitivity).toBe("HIGHLY_CONFIDENTIAL");
  });

  it("keeps only the overlap of a subject-scoped way in", () => {
    const narrowed = narrowEnvelopeToSubjects(envelope([founderOwn()]), [
      OWN_CO,
      SILO_CREDIT,
    ]);
    expect(narrowed.constraints).toEqual([founderOwn()]);
  });

  it("leaves nothing when no constraint reaches the subject", () => {
    expect(
      narrowEnvelopeToSubjects(envelope([founderOwn()]), [OTHER_TENANT_CO])
        .constraints,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The service, over in-memory ports that apply the envelope as the SQL does
// ---------------------------------------------------------------------------

type Row = {
  readonly id: ChunkId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly visibility: "founder_private" | "network_visible";
  readonly content: string;
};

const id = (n: number): ChunkId =>
  `0000000${String(n)}-0000-4000-8000-000000000000` as ChunkId;

const ROWS: readonly Row[] = [
  {
    id: id(1),
    tenantId: TENANT_A,
    subjectId: SILO_CREDIT,
    visibility: "network_visible",
    content: "Monthly burn. Silo Credit net monthly burn is $180k.",
  },
  {
    id: id(2),
    tenantId: TENANT_A,
    subjectId: SILO_CREDIT,
    visibility: "network_visible",
    content: "Silo Credit team and hiring plan.",
  },
  {
    id: id(3),
    tenantId: TENANT_A,
    subjectId: LEDGERFOLD,
    visibility: "network_visible",
    content: "Monthly burn. Ledgerfold net monthly burn is $240k.",
  },
  // The best match for a rewritten "Silo Credit burn" query, in another
  // tenant: it must never be a candidate.
  {
    id: id(4),
    tenantId: TENANT_B,
    subjectId: SILO_CREDIT,
    visibility: "network_visible",
    content:
      "Silo Credit monthly burn Silo Credit monthly burn RAG-CROSS-TENANT",
  },
  // Founder-private material about a company the actor does not own,
  // also a perfect match: it must never be a candidate either.
  {
    id: id(5),
    tenantId: TENANT_A,
    subjectId: SILO_CREDIT,
    visibility: "founder_private",
    content:
      "Silo Credit monthly burn Silo Credit monthly burn RAG-FOUNDER-PRIVATE",
  },
];

function admitted(
  row: Row,
  tenantId: string,
  constraints: readonly RetrievalScopeConstraint[],
): RetrievalScopeConstraint | undefined {
  if (row.tenantId !== tenantId) return undefined;
  return constraints.find(
    (constraint) =>
      (constraint.subjectIds === null ||
        constraint.subjectIds.includes(row.subjectId)) &&
      constraint.visibilityScopes.includes(row.visibility),
  );
}

function memoryPorts(seen: LexicalSearchQuery[] = []): {
  lexical: LexicalSearchPort;
  hydration: ChunkHydrationPort;
} {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9$]+/u)
        .filter(Boolean),
    );
  return {
    lexical: {
      search: (_executor, query) => {
        seen.push(query);
        const wanted = words(query.text);
        const scored = ROWS.filter(
          (row) =>
            admitted(row, query.tenantId, query.constraints) !== undefined,
        )
          .map((row) => ({
            row,
            score: [...words(row.content)].filter((w) => wanted.has(w)).length,
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score);
        return Promise.resolve(
          scored.map((entry, at) => ({
            chunkId: entry.row.id,
            rank: at + 1,
            lexicalScore: entry.score,
          })),
        );
      },
    },
    hydration: {
      hydrate: (_executor, query) =>
        Promise.resolve(
          query.chunkIds.flatMap((chunk): HydratedChunk[] => {
            const row = ROWS.find((one) => one.id === chunk);
            const constraint =
              row === undefined
                ? undefined
                : admitted(row, query.tenantId, query.constraints);
            if (row === undefined || constraint === undefined) return [];
            return [
              {
                chunkId: row.id,
                chunkSetId:
                  "99999999-9999-4999-8999-999999999999" as HydratedChunk["chunkSetId"],
                documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                documentVersionId:
                  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as HydratedChunk["documentVersionId"],
                documentTitle: "Deck",
                subjectType: "COMPANY",
                subjectId: row.subjectId,
                chunkKind: "slide",
                role: "LEAF",
                locator: { slide: 1 },
                content: row.content,
                visibilityScope: row.visibility,
                sensitivityClass: "NETWORK_VISIBLE",
                parentChunkId: null,
                scopeKind: constraint.scopeKind,
                canDiscloseExistence: true,
                canQuote: true,
                canProvideLink: true,
              },
            ];
          }),
        ),
      parentsOf: () => Promise.resolve(new Map()),
      countAuthorised: () => Promise.resolve(0),
    },
  };
}

const noSemantic: SemanticSearchPort = { search: () => Promise.resolve([]) };

describe("context-aware retrieval keeps the Context Firewall", () => {
  it("a rewritten query cannot reach another tenant's or a founder-private chunk", async () => {
    const seen: LexicalSearchQuery[] = [];
    const ports = memoryPorts(seen);
    const service = createAuthorisedRetrievalService({
      sql,
      ...ports,
      semantic: noSemantic,
    });
    // The actor is a founder of OWN_CO; "its burn" was bound to Silo Credit.
    const plan = planRetrievalQueries({
      words: "and its burn?",
      focus: { ledger, boundRefs: ["E1"] },
    });
    const result = await service.retrieve({
      query: "and its burn?",
      queries: plan.queries,
      ...(plan.focus === null ? {} : { focus: plan.focus }),
      envelope: envelope(),
    });
    const ids = result.hits.map((hit) => hit.chunkId);
    expect(ids).toContain(id(1));
    expect(ids).not.toContain(id(4));
    expect(ids).not.toContain(id(5));
    expect(JSON.stringify(result)).not.toMatch(/RAG-(CROSS-TENANT|FOUNDER)/u);
    // Every search ran in the envelope's tenant under narrowed constraints:
    // the founder-private way in (OWN_CO) was dropped, not opened up.
    for (const query of seen) {
      expect(query.tenantId).toBe(TENANT_A);
      for (const constraint of query.constraints) {
        expect(constraint.visibilityScopes).not.toContain("founder_private");
        expect(constraint.subjectIds).toEqual([SILO_CREDIT]);
      }
    }
  });

  it("a sub-query about a subject the envelope does not reach is not run at all", async () => {
    const seen: LexicalSearchQuery[] = [];
    const service = createAuthorisedRetrievalService({
      sql,
      ...memoryPorts(seen),
      semantic: noSemantic,
    });
    const result = await service.retrieve({
      query: "burn",
      queries: [{ text: "Silo Credit burn", subjectIds: [OTHER_TENANT_CO] }],
      envelope: envelope([founderOwn()]),
    });
    expect(seen).toHaveLength(0);
    expect(result.hits).toEqual([]);
  });

  it("a reranker can only reorder: foreign ids are ignored and omitted candidates keep their place", async () => {
    const hostile: RetrievalReranker = {
      code: "LOCAL_FIELD_OVERLAP_V1",
      rerank: (request) =>
        Promise.resolve([
          id(4),
          id(5),
          ...request.candidates.slice(1).map((candidate) => candidate.chunkId),
        ]),
    };
    const service = createAuthorisedRetrievalService({
      sql,
      ...memoryPorts(),
      semantic: noSemantic,
      reranker: hostile,
    });
    const result = await service.retrieve({
      query: "monthly burn",
      envelope: envelope([network()]),
    });
    const ids = result.hits.map((hit) => hit.chunkId);
    expect(ids).not.toContain(id(4));
    expect(ids).not.toContain(id(5));
    // Both lexical matches survive, including the one the reranker omitted.
    expect(new Set(ids)).toEqual(new Set([id(1), id(3)]));
  });

  it("fuses one search per company so a comparison gets both", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      ...memoryPorts(),
      semantic: noSemantic,
      config: { ...DEFAULT_RETRIEVAL_CONFIG, finalHits: 2 },
    });
    const plan = planRetrievalQueries({
      words: "compare their burn",
      focus: { ledger, boundRefs: ["E1", "E2"] },
    });
    const result = await service.retrieve({
      query: "compare their burn",
      queries: plan.queries,
      ...(plan.focus === null ? {} : { focus: plan.focus }),
      envelope: envelope([network()]),
    });
    expect(result.hits.map((hit) => hit.chunkId).sort()).toEqual(
      [id(1), id(3)].sort(),
    );
    expect(result.diagnostics.queries).toBe(2);
    expect(result.diagnostics.reranker).toBe("LOCAL_FIELD_OVERLAP_V1");
  });

  it("v1 runs one search in fused order, whatever it is handed", async () => {
    const seen: LexicalSearchQuery[] = [];
    const service = createAuthorisedRetrievalService({
      sql,
      ...memoryPorts(seen),
      semantic: noSemantic,
      config: RETRIEVAL_CONFIG_V1,
    });
    const result = await service.retrieve({
      query: "burn",
      queries: [{ text: "Silo Credit burn" }, { text: "Ledgerfold burn" }],
      envelope: envelope([network()]),
    });
    expect(seen).toHaveLength(1);
    expect(result.diagnostics.reranker).toBe("NONE");
  });
});

describe("the local reranker", () => {
  it("puts the chunk carrying the asked field and the bound entity first", async () => {
    const order = await createLocalReranker().rerank({
      queries: [{ text: "Silo Credit and its burn?", weight: 1 }],
      focus: {
        subjectIds: [SILO_CREDIT],
        documentIds: [],
        names: ["Silo Credit"],
      },
      candidates: [
        {
          chunkId: id(3),
          subjectId: LEDGERFOLD,
          documentId: "d",
          documentTitle: "Deck",
          content: "Ledgerfold net monthly burn is $240k.",
          fusedRank: 1,
        },
        {
          chunkId: id(2),
          subjectId: SILO_CREDIT,
          documentId: "d",
          documentTitle: "Deck",
          content: "Silo Credit team and hiring plan.",
          fusedRank: 2,
        },
        {
          chunkId: id(1),
          subjectId: SILO_CREDIT,
          documentId: "d",
          documentTitle: "Deck",
          content: "Silo Credit net monthly burn is $180k.",
          fusedRank: 3,
        },
      ],
    });
    expect(order[0]).toBe(id(1));
  });
});

describe("the reader's parts of a compound ask (TURN_READER v78)", () => {
  it("are the sub-queries, each under the subject it names", () => {
    const plan = planRetrievalQueries({
      words: "How many borrowers does it have, and what's its loan book?",
      parts: [
        "How many borrowers does Ledgerfold have?",
        "What is Ledgerfold's loan book?",
      ],
      focus: { ledger, boundRefs: ["E2"] },
    });
    expect(plan.queries.slice(0, 2)).toEqual([
      {
        text: "How many borrowers does Ledgerfold have?",
        subjectIds: [LEDGERFOLD],
      },
      { text: "What is Ledgerfold's loan book?", subjectIds: [LEDGERFOLD] },
    ]);
  });

  it("search a part under only the company it names when two are bound", () => {
    const plan = planRetrievalQueries({
      words: "Silo Credit's burn and Ledgerfold's runway?",
      parts: ["What is Silo Credit's burn?", "What is Ledgerfold's runway?"],
      focus: { ledger, boundRefs: ["E1", "E2"] },
    });
    expect(plan.queries).toEqual([
      { text: "What is Silo Credit's burn?", subjectIds: [SILO_CREDIT] },
      { text: "What is Ledgerfold's runway?", subjectIds: [LEDGERFOLD] },
    ]);
  });

  it("are the searches with no ledger at all; one part falls back to the words", () => {
    expect(
      planRetrievalQueries({
        words: "ARR and burn for Silo Credit?",
        parts: ["What is Silo Credit's ARR?", "What is Silo Credit's burn?"],
      }).queries,
    ).toEqual([
      { text: "What is Silo Credit's ARR?" },
      { text: "What is Silo Credit's burn?" },
    ]);
    expect(
      planRetrievalQueries({ words: "ARR?", parts: ["What is the ARR?"] })
        .queries,
    ).toEqual([{ text: "ARR?" }]);
  });
});
