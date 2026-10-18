import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import type { RecommendationFeatureSnapshot } from "../src/features/contracts.js";
import {
  FIT_ORDER_CURRENT,
  compareFitOrder,
  createFitOrdering,
  orderByFit,
  type FitOrderKey,
} from "../src/fit/order.js";
import type { DeclaredFitFacts } from "../src/fit/observe.js";
import type { FitCompanyInputs, FitInputSource } from "../src/fit/service.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import type { RerankFacts } from "../src/rerank/contracts.js";
import { createReranker } from "../src/rerank/reranker.js";

/**
 * Q.06 (audit 2026-10-07): Discover's order and the "x/10" an investor
 * reads must never contradict. Only a documented exploration or
 * diversity move may put a lower score above a higher one, and such an
 * item carries a rerank reason code (the feed labels it "exploring").
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-07T12:00:00.000Z";
const ACTOR = {
  tenantId: ID(900),
  userId: ID(901),
  organisationId: ID(902),
} as unknown as ActorContext;

const key = (score: number | null): FitOrderKey => ({
  assessment: null,
  score,
});

/** A tiny deterministic PRNG, so the property test is reproducible. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("fit order (fit-order.v1)", () => {
  it("orders scored candidates by the score shown; unscored keep their base positions", () => {
    const base = [1, 2, 3, 4, 5].map((n) => ({
      companyId: ID(n),
      baseRank: n,
    }));
    const keys = new Map([
      [ID(1), key(6)],
      [ID(2), key(null)],
      [ID(3), key(8)],
      [ID(4), key(7.5)],
      [ID(5), key(null)],
    ]);
    const ordered = orderByFit(base, keys);
    expect(ordered.map((o) => [o.companyId, o.score])).toEqual([
      [ID(3), 8],
      [ID(2), null],
      [ID(4), 7.5],
      [ID(1), 6],
      [ID(5), null],
    ]);
    expect(ordered.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ordered[0]?.internalScore).toBe(0.8);
    expect(ordered[1]?.internalScore).toBeNull();
  });

  it("equal scores keep the base order; nothing is unknown-as-zero", () => {
    const ordered = orderByFit(
      [
        { companyId: ID(1), baseRank: 1 },
        { companyId: ID(2), baseRank: 2 },
      ],
      new Map([
        [ID(1), key(7)],
        [ID(2), key(7)],
      ]),
    );
    expect(ordered.map((o) => o.companyId)).toEqual([ID(1), ID(2)]);
    expect(compareFitOrder(key(null), key(0))).toBeGreaterThan(0);
  });

  it("property: after exploration and diversity, an unlabelled item never shows a lower score above a higher one", () => {
    const reranker = createReranker();
    const random = prng(20261007);
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 3 + Math.floor(random() * 22);
      const base = Array.from({ length: n }, (_, i) => ({
        companyId: ID(i + 1),
        baseRank: i + 1,
      }));
      const keys = new Map<string, FitOrderKey>(
        base.map((b) => [
          b.companyId,
          key(random() < 0.2 ? null : Math.round(random() * 100) / 10),
        ]),
      );
      const ordered = orderByFit(base, keys);
      const facts = new Map<string, RerankFacts>(
        ordered.map((o) => [
          o.companyId,
          {
            companyId: o.companyId,
            cluster: `c${String(Math.floor(random() * 3))}`,
            exposed: random() < 0.7,
            lastSeenAt:
              random() < 0.2
                ? new Date(Date.parse(AT) - 3_600_000).toISOString()
                : null,
            passed: random() < 0.1,
            reintroduction: null,
          },
        ]),
      );
      const result = reranker.rerank({
        context: "INVESTOR_DISCOVER",
        rankerVersion: RANKER_VERSION,
        evaluatedAt: AT,
        candidates: ordered.map((o) => ({
          companyId: o.companyId,
          rank: o.rank,
          internalScore: o.internalScore,
        })),
        facts,
      });
      const shown = result.candidates
        .filter((c) => c.rerankReasonCodes.length === 0)
        .map((c) => keys.get(c.companyId)?.score ?? null)
        .filter((s): s is number => s !== null);
      for (let i = 1; i < shown.length; i += 1) {
        expect(shown[i - 1]).toBeGreaterThanOrEqual(shown[i] ?? 0);
      }
    }
  });

  it("cheque size declared on the mandate moves the order, through the same fit the panel shows", async () => {
    const snapshot = {
      features: [
        ["declared_fit.stage", "MATCH"],
        ["declared_fit.taxonomy", "DESCENDANT_OVERLAP"],
        ["declared_fit.geography", "NO_MATCH"],
      ].map(([featureId, value]) => ({
        featureId,
        featureVersion: "v1",
        status: "PRESENT",
        value,
        missingReason: null,
        sourceClasses: [],
        sensitivity: "NETWORK_VISIBLE",
        provenance: {},
      })),
    } as unknown as RecommendationFeatureSnapshot;
    const cheque = { currency: "USD", typical: "300000" };
    const company = (roundAmount: string): FitCompanyInputs => ({
      snapshot,
      declared: {
        cheque,
        round: {
          amount: roundAmount,
          currency: "USD",
          evidenceStatus: "SELF_REPORTED",
        },
      } satisfies DeclaredFitFacts,
      name: "x",
      line: null,
    });
    const inputs: FitInputSource = {
      read: () =>
        Promise.resolve(
          new Map([
            // Base rank 1: a round far too big for this cheque.
            [ID(1), company("90000000")],
            // Base rank 2: a round this cheque fits.
            [ID(2), company("1500000")],
          ]),
        ),
    };
    const ordering = createFitOrdering({
      inputs,
      clock: () => new Date(AT),
    });
    expect(ordering.version).toBe(FIT_ORDER_CURRENT.version);
    const ordered = await ordering.order({
      actor: ACTOR,
      investorOrganisationId: ID(10),
      mandateId: ID(11),
      candidates: [
        { companyId: ID(1), baseRank: 1, eligibilityReasons: [] },
        { companyId: ID(2), baseRank: 2, eligibilityReasons: [] },
      ],
    });
    expect(ordered.map((o) => o.companyId)).toEqual([ID(2), ID(1)]);
    const [first, second] = ordered;
    expect(first?.score).not.toBeNull();
    expect(second?.score).not.toBeNull();
    expect(first?.score ?? 0).toBeGreaterThan(second?.score ?? 0);

    // Equal fits (same score, value and confidence) keep the base order,
    // whatever their ids: a UUID never decides the feed (step 3).
    const tied = await createFitOrdering({
      inputs: {
        read: () =>
          Promise.resolve(
            new Map([
              [ID(1), company("1500000")],
              [ID(2), company("1500000")],
            ]),
          ),
      },
      clock: () => new Date(AT),
    }).order({
      actor: ACTOR,
      investorOrganisationId: ID(10),
      mandateId: ID(11),
      candidates: [
        { companyId: ID(2), baseRank: 1, eligibilityReasons: [] },
        { companyId: ID(1), baseRank: 2, eligibilityReasons: [] },
      ],
    });
    expect(tied.map((o) => o.companyId)).toEqual([ID(2), ID(1)]);
    expect(tied[0]?.score).not.toBeNull();
    expect(tied[0]?.score).toBe(tied[1]?.score);
  });
});
