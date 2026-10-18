import { describe, expect, it, vi } from "vitest";

import type { HybridCandidate } from "../src/hybrid/contracts.js";
import type { RerankSignalsPort } from "../src/rerank/ports.js";
import { createReranker } from "../src/rerank/reranker.js";
import { clusterKeyFor, createRerankService } from "../src/rerank/service.js";
import { createInteractionRerankSignals } from "../src/infrastructure/interaction-rerank-signals.js";

/**
 * What REC-009 is allowed to read (CQ-REC-009 §3, §10, §16, §17).
 *
 * The reranker itself is proved in `rerank.test.ts`. These cases are about
 * the seam above it: which facts reach it, where they come from, and — the
 * part that matters for privacy — which ones cannot reach it at all.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const OTHER_INVESTOR = "11111111-0000-4000-8000-000000000099";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const NOW = "2026-09-20T12:00:00.000Z";

const id = (n: number) =>
  `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;

function poolEntry(
  n: number,
  preferredNodeIds: readonly number[],
): HybridCandidate {
  return {
    companyId: id(n),
    structured:
      preferredNodeIds.length === 0
        ? null
        : {
            generatorId: "STRUCTURED_MANDATE",
            generatorVersion: "structured-mandate.v5",
            matchedDimensions: ["TAXONOMY"],
            reasonCodes: ["TAXONOMY_EXACT"],
            matchedNodes: preferredNodeIds.map((p) => ({
              preferredNodeId: node(p),
              matchedNodeId: node(p + 100),
              vocabularyCode: "sector",
              exact: true,
            })),
            taxonomyVersion: null,
          },
    semantic: null,
    eligibility: { decision: "ELIGIBLE" },
  } as unknown as HybridCandidate;
}

const emptySignals: RerankSignalsPort = {
  forCompanies: () => Promise.resolve(new Map()),
};

const service = (signals: RerankSignalsPort = emptySignals) =>
  createRerankService({ reranker: createReranker(), signals });

const query = (pool: readonly HybridCandidate[]) => ({
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mandateVersion: 3,
  mode: "INVESTOR_DISCOVER",
  ranked: pool.map((c, i) => ({
    companyId: c.companyId,
    rank: i + 1,
    internalScore: 0.9 - i * 0.001,
  })),
  pool,
  evaluatedAt: NOW,
  rankerVersion: "deterministic-ranker.v1",
});

describe("what reaches the reordering", () => {
  it("3 and 4: the only company attribute it sees is the investor's own declared taxonomy", () => {
    // The cluster comes from `preferredNodeId` — a node on the investor's
    // mandate. Nothing about the company itself, private or otherwise,
    // crosses into this stage; there is no other field to carry it.
    const sameMandateNodes = clusterKeyFor(poolEntry(1, [7, 2]));
    expect(sameMandateNodes).toBe(clusterKeyFor(poolEntry(2, [2, 7])));
    expect(sameMandateNodes).not.toBe(clusterKeyFor(poolEntry(3, [2])));
    // Opaque: the key cannot leak a mandate's taxonomy into a log line.
    expect(sameMandateNodes).toMatch(/^[0-9a-f]{64}$/);
    expect(sameMandateNodes).not.toContain(node(7));
  });

  it("5: a company the structured generator did not find has no cluster, not a bad one", () => {
    expect(clusterKeyFor(poolEntry(4, []))).toBeNull();
  });

  it("16: it asks only for its own organisation's history", async () => {
    // Cross-tenant safety here is that there is no query shape in which
    // another organisation's state could be requested: the tenant and the
    // investor organisation are the caller's, server-resolved, and the
    // company set is the pool that was just ranked for them.
    const forCompanies = vi.fn(() => Promise.resolve(new Map()));
    const pool = [poolEntry(1, [1]), poolEntry(2, [1])];
    await service({ forCompanies }).rerankPool(query(pool));
    expect(forCompanies).toHaveBeenCalledTimes(1);
    expect(forCompanies).toHaveBeenCalledWith({
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      companyIds: [id(1), id(2)],
    });
  });

  it("16: another organisation's rows change nothing, because they are never read", async () => {
    // A port that answers for the wrong subject is answering a question it
    // was not asked; the keys do not match the pool, so nothing applies.
    const strangers: RerankSignalsPort = {
      forCompanies: () =>
        Promise.resolve(
          new Map([[id(99), { exposed: true, lastSeenAt: NOW, passed: true }]]),
        ),
    };
    const pool = [poolEntry(1, [1]), poolEntry(2, [1])];
    const result = await service(strangers).rerankPool(query(pool));
    expect(result.candidates.map((c) => c.baseRank)).toEqual([1, 2]);
    expect(result.diagnostics.suppressed).toBe(0);
  });

  it("17 and 18: the reordering is synchronous, so it cannot have called anything", async () => {
    // Not a promise to avoid providers — a shape in which awaiting one is
    // impossible. One batched read happens above it; the decision itself
    // is arithmetic over an in-memory list.
    const reranker = createReranker();
    const result = reranker.rerank({
      context: "INVESTOR_DISCOVER",
      rankerVersion: "deterministic-ranker.v1",
      evaluatedAt: NOW,
      candidates: [{ companyId: id(1), rank: 1, internalScore: 0.5 }],
      facts: new Map([
        [
          id(1),
          {
            companyId: id(1),
            cluster: null,
            exposed: false,
            lastSeenAt: null,
            passed: false,
            reintroduction: null,
          },
        ],
      ]),
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.candidates).toHaveLength(1);

    // And the service makes exactly one read per build, whatever the pool
    // size: no N+1 to find.
    const forCompanies = vi.fn(() => Promise.resolve(new Map()));
    const big = Array.from({ length: 200 }, (_, i) =>
      poolEntry(i + 1, [i % 5]),
    );
    await service({ forCompanies }).rerankPool(query(big));
    expect(forCompanies).toHaveBeenCalledTimes(1);
  });

  it("12: it has no way to write anything, least of all a mandate", async () => {
    // The service holds one port and that port reads. A mandate id and
    // version are passed in so a reintroduction source could one day
    // compare them; nothing here can change either.
    const pool = [poolEntry(1, [1])];
    const result = await service().rerankPool(query(pool));
    expect(Object.keys(result)).toEqual([
      "rerankerId",
      "rerankerVersion",
      "rerankPolicyVersion",
      "candidates",
      "diagnostics",
    ]);
    expect(Object.keys(emptySignals)).toEqual(["forCompanies"]);
  });

  it("refuses a reintroduction reason it does not recognise", async () => {
    const pool = [poolEntry(1, [1])];
    const rogue = createRerankService({
      reranker: createReranker(),
      signals: {
        forCompanies: () =>
          Promise.resolve(
            new Map([
              [id(1), { exposed: false, lastSeenAt: null, passed: true }],
            ]),
          ),
      },
      reintroductions: {
        reasonsFor: () =>
          Promise.resolve(new Map([[id(1), "I_CHANGED_MY_MIND"]])),
      },
    });
    await expect(rogue.rerankPool(query(pool))).rejects.toThrow();
  });
});

describe("the adapter over REC-008's state", () => {
  it("6 and 10: it drops the count and the save flag on the way through", async () => {
    // The one place REC-008's richer state meets REC-009. Whether the
    // organisation has seen a company survives; how many times does not,
    // and neither does Save — which is why no test can make either of them
    // raise a company's position.
    const signals = createInteractionRerankSignals({
      repository: {
        stateForCompanies: () =>
          Promise.resolve(
            new Map([
              [
                id(1),
                {
                  companyId: id(1),
                  saved: true,
                  savedAt: NOW,
                  passed: false,
                  passedAt: null,
                  lastPassReason: null,
                  impressionCount: 47,
                  lastImpressionAt: NOW,
                  lastInteractionAt: NOW,
                },
              ],
            ]),
          ),
      },
    });
    const got = await signals.forCompanies({
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      companyIds: [id(1)],
    });
    expect(got.get(id(1))).toEqual({
      exposed: true,
      lastSeenAt: NOW,
      passed: false,
    });
  });

  it("6: forty-seven impressions and one are the same fact here", async () => {
    const build = (impressionCount: number) =>
      createInteractionRerankSignals({
        repository: {
          stateForCompanies: () =>
            Promise.resolve(
              new Map([
                [
                  id(1),
                  {
                    companyId: id(1),
                    saved: false,
                    savedAt: null,
                    passed: false,
                    passedAt: null,
                    lastPassReason: null,
                    impressionCount,
                    lastImpressionAt: NOW,
                    lastInteractionAt: NOW,
                  },
                ],
              ]),
            ),
        },
      }).forCompanies({
        tenantId: TENANT,
        investorOrganisationId: INVESTOR,
        companyIds: [id(1)],
      });
    expect(await build(47)).toEqual(await build(1));
  });

  it("passes the subject through untouched, so the store's own key decides", async () => {
    const stateForCompanies = vi.fn(() => Promise.resolve(new Map()));
    await createInteractionRerankSignals({
      repository: { stateForCompanies },
    }).forCompanies({
      tenantId: OTHER_TENANT,
      investorOrganisationId: OTHER_INVESTOR,
      companyIds: [id(1)],
    });
    expect(stateForCompanies).toHaveBeenCalledWith({
      tenantId: OTHER_TENANT,
      investorOrganisationId: OTHER_INVESTOR,
      companyIds: [id(1)],
    });
  });
});
