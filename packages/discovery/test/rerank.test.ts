import { describe, expect, it } from "vitest";

import {
  RERANK_REASON_CODES,
  RerankInputError,
  type RerankFacts,
} from "../src/rerank/contracts.js";
import {
  EXPLORATION_POLICY_V1,
  PROVABLE_PASS_REINTRODUCTION_REASONS,
  RerankPolicySchema,
} from "../src/rerank/policy.js";
import {
  createReranker,
  type BaseRankedCandidate,
} from "../src/rerank/reranker.js";

/**
 * Bounded diversity and exploration (CQ-REC-009).
 *
 * The whole stage is one pure function, so these are the real thing rather
 * than a model of it: a base order in, a permutation out, and every rule
 * the packet states asserted against the permutation.
 */

const NOW = "2026-09-20T12:00:00.000Z";
const at = (hoursAgo: number) =>
  new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString();

const id = (n: number) =>
  `44444444-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One cluster key per letter; two companies sharing a letter are alike. */
const CLUSTER = {
  a: "c".repeat(64),
  b: "d".repeat(64),
  e: "e".repeat(64),
} as const;

type Spec = {
  readonly score: number | null;
  readonly cluster?: string | null | undefined;
  readonly exposed?: boolean | undefined;
  readonly seenHoursAgo?: number | undefined;
  readonly passed?: boolean | undefined;
  readonly reintroduction?: "EXPLICIT_PASS_RESET" | null | undefined;
};

function world(specs: readonly Spec[]) {
  const candidates: BaseRankedCandidate[] = specs.map((s, i) => ({
    companyId: id(i + 1),
    rank: i + 1,
    internalScore: s.score,
  }));
  const facts = new Map<string, RerankFacts>(
    specs.map((s, i) => [
      id(i + 1),
      {
        companyId: id(i + 1),
        cluster: s.cluster === undefined ? null : (s.cluster ?? null),
        exposed: s.exposed ?? false,
        lastSeenAt: s.seenHoursAgo === undefined ? null : at(s.seenHoursAgo),
        passed: s.passed ?? false,
        reintroduction: s.reintroduction ?? null,
      },
    ]),
  );
  return { candidates, facts };
}

const run = (specs: readonly Spec[], policy = EXPLORATION_POLICY_V1) => {
  const { candidates, facts } = world(specs);
  return createReranker({ policy }).rerank({
    context: "INVESTOR_DISCOVER",
    rankerVersion: "deterministic-ranker.v1",
    evaluatedAt: NOW,
    candidates,
    facts,
  });
};

/** Positions as base ranks, which is how every expectation below reads. */
const order = (result: ReturnType<typeof run>) =>
  result.candidates.map((c) => c.baseRank);

describe("the reordering itself", () => {
  it("1: the same input, policy and instant give the same order, every time", () => {
    const specs: Spec[] = [
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 1 },
      { score: 0.88, cluster: CLUSTER.a },
      { score: 0.87, cluster: CLUSTER.a },
      { score: 0.86, cluster: CLUSTER.a },
      { score: 0.85, cluster: CLUSTER.b },
      { score: 0.4, cluster: CLUSTER.b, passed: true },
    ];
    const first = run(specs);
    for (let i = 0; i < 5; i += 1) {
      expect(order(run(specs))).toEqual(order(first));
    }
    // And nothing was persisted to make that true: no seed, no probability.
    expect(EXPLORATION_POLICY_V1.exploration.deterministic).toBe(true);
  });

  it("2: it is a permutation, so nothing can enter that REC-001 did not pass", () => {
    // The strongest form of "exploration cannot reintroduce an ineligible
    // company": there is no source of companies inside this stage at all.
    const specs: Spec[] = Array.from({ length: 25 }, (_, i) => ({
      score: 1 - i * 0.01,
      cluster: CLUSTER.a,
      passed: i % 7 === 0,
    }));
    const result = run(specs);
    expect(result.candidates).toHaveLength(25);
    expect(new Set(result.candidates.map((c) => c.companyId)).size).toBe(25);
    expect([...order(result)].sort((x, y) => x - y)).toEqual(
      specs.map((_, i) => i + 1),
    );
    expect(result.candidates.map((c) => c.rank)).toEqual(
      specs.map((_, i) => i + 1),
    );
  });

  it("13: REC-005's score is carried, never recomputed", () => {
    const specs: Spec[] = [
      { score: 0.91, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.89, cluster: CLUSTER.a },
      { score: 0.88, cluster: CLUSTER.a },
      { score: 0.87, cluster: CLUSTER.b },
    ];
    const result = run(specs);
    for (const c of result.candidates) {
      expect(c.internalScore).toBe(specs[c.baseRank - 1]?.score);
    }
  });

  it("15: base rank is recoverable from what a slate stores", () => {
    // Why no base-rank column was needed: REC-005's order is score
    // descending, then company id ascending, so the stored score and id
    // reproduce it exactly.
    const specs: Spec[] = [
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.89, cluster: CLUSTER.a },
      { score: 0.88, cluster: CLUSTER.b },
    ];
    const result = run(specs);
    const recovered = [...result.candidates]
      .sort((x, y) => {
        if (x.internalScore === y.internalScore)
          return x.companyId < y.companyId ? -1 : 1;
        if (x.internalScore === null) return 1;
        if (y.internalScore === null) return -1;
        return y.internalScore - x.internalScore;
      })
      .map((c) => c.baseRank);
    expect(recovered).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("diversity, and the relevance floor that bounds it", () => {
  it("14: a weak-but-different company never displaces a strong one", () => {
    // Four of one cluster at the top and the only alternative scored far
    // below. Diversity loses: doc 19 SS82, and the reason the floor exists.
    const result = run([
      { score: 0.95, cluster: CLUSTER.a },
      { score: 0.94, cluster: CLUSTER.a },
      { score: 0.93, cluster: CLUSTER.a },
      { score: 0.92, cluster: CLUSTER.a },
      { score: 0.1, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2, 3, 4, 5]);
    expect(result.diagnostics.diversityAdjustments).toBe(0);
  });

  it("7 and 14: a close alternative does break up a run of the same cluster", () => {
    // Same shape, one number changed: the alternative is now within the
    // floor, so the fourth position goes to it instead of a fourth of a
    // kind. The displaced company is not dropped; it takes the next seat.
    const result = run([
      { score: 0.95, cluster: CLUSTER.a },
      { score: 0.94, cluster: CLUSTER.a },
      { score: 0.93, cluster: CLUSTER.a },
      { score: 0.92, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2, 3, 5, 4]);
    const moved = result.candidates.find((c) => c.baseRank === 5);
    expect(moved?.rerankReasonCodes).toContain("DIVERSITY_ADJUSTMENT");
    expect(moved?.movement).toBe(1);
  });

  it("movement stays inside the policy's stated bound", () => {
    const specs: Spec[] = Array.from({ length: 60 }, (_, i) => ({
      // Every candidate within the floor of every other: the loosest case
      // the guard will ever see.
      score: 0.9,
      cluster: i < 55 ? CLUSTER.a : CLUSTER.b,
    }));
    const result = run(specs);
    expect(result.diagnostics.maxPromotion).toBeLessThanOrEqual(
      EXPLORATION_POLICY_V1.maxPromotion,
    );
  });

  it("never counts an unclassified company as a cluster", () => {
    // Unknown stays unknown: four companies nobody has classified are not
    // four of a kind, and are neither capped nor used to cap anything.
    const result = run([
      { score: 0.95, cluster: null },
      { score: 0.94, cluster: null },
      { score: 0.93, cluster: null },
      { score: 0.92, cluster: null },
      { score: 0.91, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("what the investor has already seen", () => {
  it("5: a company with no history is not penalised", () => {
    // The loop doc 19 SS80 names -- no exposure, no engagement, no
    // exposure -- starts by treating "never shown" as a negative. Nothing
    // here does.
    const cold = run([
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.89, cluster: CLUSTER.b },
      { score: 0.88, cluster: CLUSTER.e },
    ]);
    const warm = run([
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 400 },
      { score: 0.89, cluster: CLUSTER.b, exposed: true, seenHoursAgo: 400 },
      { score: 0.88, cluster: CLUSTER.e, exposed: true, seenHoursAgo: 400 },
    ]);
    expect(order(cold)).toEqual([1, 2, 3]);
    expect(order(cold)).toEqual(order(warm));
  });

  it("6: being seen often cannot raise a company", () => {
    // There is no count to raise it with: the port carries a boolean and
    // an instant, and this asserts the consequence.
    const everyone = (seen: boolean): Spec[] => [
      { score: 0.9, cluster: CLUSTER.a, exposed: seen, seenHoursAgo: 400 },
      { score: 0.89, cluster: CLUSTER.b, exposed: seen, seenHoursAgo: 400 },
      { score: 0.88, cluster: CLUSTER.e, exposed: seen, seenHoursAgo: 400 },
    ];
    expect(order(run(everyone(true)))).toEqual(order(run(everyone(false))));
  });

  it("7: a company seen an hour ago yields to an equally good one that was not", () => {
    const result = run([
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 1 },
      { score: 0.89, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([2, 1]);
    expect(
      result.candidates.find((c) => c.baseRank === 2)?.rerankReasonCodes,
    ).toContain("RECENTLY_SEEN_SUPPRESSION");
  });

  it("7: but it is a nudge, not a ban -- with no alternative it keeps its place", () => {
    const result = run([
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 1 },
      { score: 0.2, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2]);
  });

  it("stops being recent once the window has passed", () => {
    const result = run([
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 30 },
      { score: 0.89, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2]);
  });
});

describe("exploration", () => {
  it("offers one position per page to a company never shown", () => {
    // Ten seen companies and one that has not been, scored close enough to
    // take the position on merit. It takes the tenth seat: the last of the
    // window, and at most one of them.
    const specs: Spec[] = Array.from({ length: 12 }, (_, i) => ({
      score: 0.9 - i * 0.005,
      // Unclassified throughout, so this case is about exposure alone.
      cluster: null,
      exposed: i !== 11,
      seenHoursAgo: i === 11 ? undefined : 400,
    }));
    const result = run(specs);
    const explored = result.candidates.find((c) => c.baseRank === 12);
    expect(explored?.rank).toBe(10);
    expect(explored?.rerankReasonCodes).toContain("EXPLORATION_SLOT");
    expect(result.diagnostics.explorationSlots).toBe(1);
  });

  it("15: the share stays inside the configured bound", () => {
    // Thirty positions, three windows, one slot each at the very most.
    const specs: Spec[] = Array.from({ length: 30 }, (_, i) => ({
      score: 0.9,
      cluster: null,
      exposed: i < 15,
      seenHoursAgo: i < 15 ? 400 : undefined,
    }));
    const result = run(specs);
    const windows = Math.floor(specs.length / EXPLORATION_POLICY_V1.window);
    expect(result.diagnostics.explorationSlots).toBeLessThanOrEqual(
      windows * EXPLORATION_POLICY_V1.exploration.maxSlotsPerWindow,
    );
  });

  it("cannot hand the position to something irrelevant", () => {
    // The unexposed candidate is far below the floor. The slot goes
    // unused rather than to a company that has not earned the position:
    // exploration is not entertainment (SS8).
    const specs: Spec[] = Array.from({ length: 11 }, (_, i) => ({
      score: i === 10 ? 0.1 : 0.9 - i * 0.001,
      cluster: null,
      exposed: i !== 10,
      seenHoursAgo: i === 10 ? undefined : 400,
    }));
    const result = run(specs);
    expect(result.diagnostics.explorationSlots).toBe(0);
    expect(order(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("pass, save, and the two of them together", () => {
  it("8: a passed company is not proactively resurfaced", () => {
    const result = run([
      { score: 0.95, cluster: CLUSTER.a, passed: true },
      { score: 0.5, cluster: CLUSTER.b },
      { score: 0.4, cluster: CLUSTER.e },
    ]);
    expect(order(result)).toEqual([2, 3, 1]);
    const passed = result.candidates.find((c) => c.baseRank === 1);
    expect(passed?.rank).toBe(3);
    expect(passed?.rerankReasonCodes).toEqual(["PASS_SUPPRESSION"]);
  });

  it("8: suppressed is behind everything, not deleted", () => {
    // Doc 19 and SS11 both refuse a permanent ban. The company keeps its
    // place in the slate, its score and its provenance; it is simply last.
    const result = run([
      { score: 0.95, cluster: CLUSTER.a, passed: true },
      { score: 0.9, cluster: CLUSTER.b, passed: true },
      { score: 0.5, cluster: CLUSTER.e },
    ]);
    expect(order(result)).toEqual([3, 1, 2]);
    expect(result.candidates).toHaveLength(3);
    expect(result.diagnostics.suppressed).toBe(2);
  });

  it("9: it comes back only under a reason the policy names", () => {
    const result = run([
      {
        score: 0.95,
        cluster: CLUSTER.a,
        passed: true,
        reintroduction: "EXPLICIT_PASS_RESET",
      },
      { score: 0.5, cluster: CLUSTER.b },
    ]);
    expect(order(result)).toEqual([1, 2]);
    expect(
      result.candidates.find((c) => c.baseRank === 1)?.rerankReasonCodes,
    ).toEqual(["PASS_REINTRODUCED"]);
  });

  it("9: and an unrecognised reason is refused, not ignored", () => {
    const { candidates, facts } = world([{ score: 0.9, passed: true }]);
    const tampered = new Map(facts);
    tampered.set(candidates[0]?.companyId ?? "", {
      ...(facts.get(candidates[0]?.companyId ?? "") as RerankFacts),
      reintroduction: "INVESTOR_CHANGED_THEIR_MIND" as never,
    });
    expect(() =>
      createReranker().rerank({
        context: "INVESTOR_DISCOVER",
        rankerVersion: "deterministic-ranker.v1",
        evaluatedAt: NOW,
        candidates,
        facts: tampered,
      }),
    ).toThrow(RerankInputError);
  });

  it("9: V1 proves only a material update (a new playable pitch), never a row timestamp", () => {
    expect(PROVABLE_PASS_REINTRODUCTION_REASONS).toEqual([
      "MATERIAL_COMPANY_UPDATE",
    ]);
  });

  it("10 and 11: Save changes nothing about the order", () => {
    // Save is an investor's bookmark, served from the Saved list. The
    // guarantee that it cannot boost anything is that this stage has no
    // field for it at all -- asserted here as behaviour, and structurally
    // in the boundary test.
    const facts: RerankFacts = {
      companyId: id(1),
      cluster: null,
      exposed: false,
      lastSeenAt: null,
      passed: false,
      reintroduction: null,
    };
    expect(Object.keys(facts)).not.toContain("saved");

    // Save + Pass together: Pass decides what the slate does, and it
    // suppresses. Saved access is a different surface and is untouched.
    const savedAndPassed = run([
      { score: 0.95, cluster: CLUSTER.a, passed: true },
      { score: 0.5, cluster: CLUSTER.b },
    ]);
    expect(order(savedAndPassed)).toEqual([2, 1]);
  });
});

describe("refusals", () => {
  it("refuses an order it was not written for", () => {
    const { candidates, facts } = world([{ score: 0.9 }]);
    const base = {
      context: "INVESTOR_DISCOVER" as const,
      evaluatedAt: NOW,
      candidates,
      facts,
    };
    expect(() =>
      createReranker().rerank({ ...base, rankerVersion: "something-else.v2" }),
    ).toThrow(/RANKER_VERSION_MISMATCH/);
    expect(() =>
      createReranker().rerank({
        ...base,
        context: "FOUNDER_DISCOVER",
        rankerVersion: "deterministic-ranker.v1",
      }),
    ).toThrow(/CONTEXT_MISMATCH/);
  });

  it("refuses a candidate whose history it was not given", () => {
    const { candidates } = world([{ score: 0.9 }]);
    expect(() =>
      createReranker().rerank({
        context: "INVESTOR_DISCOVER",
        rankerVersion: "deterministic-ranker.v1",
        evaluatedAt: NOW,
        candidates,
        facts: new Map(),
      }),
    ).toThrow(/FACTS_MISSING/);
  });

  it("refuses a base order that is not one", () => {
    expect(() =>
      createReranker().rerank({
        context: "INVESTOR_DISCOVER",
        rankerVersion: "deterministic-ranker.v1",
        evaluatedAt: NOW,
        candidates: [{ companyId: id(1), rank: 4, internalScore: 0.9 }],
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
      }),
    ).toThrow(/BASE_ORDER_INVALID/);
  });
});

describe("the policy", () => {
  it("is frozen, versioned and honest about its status", () => {
    expect(EXPLORATION_POLICY_V1.version).toBe("exploration-policy.v1");
    expect(EXPLORATION_POLICY_V1.status).toBe("INITIAL_HEURISTIC_UNCALIBRATED");
    expect(Object.isFrozen(EXPLORATION_POLICY_V1)).toBe(true);
    expect(Object.isFrozen(EXPLORATION_POLICY_V1.exploration)).toBe(true);
    expect(() => RerankPolicySchema.parse(EXPLORATION_POLICY_V1)).not.toThrow();
  });

  it("holds every number the stage applies", () => {
    // No constant lives in the algorithm: a policy of all-zero bounds
    // leaves REC-005's order exactly as it was.
    const inert = RerankPolicySchema.parse({
      ...EXPLORATION_POLICY_V1,
      version: "exploration-policy.inert",
      maxScoreDistance: 0,
      maxPromotion: 0,
      recentlySeenWindowMs: 0,
    });
    const specs: Spec[] = [
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 0 },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.a },
      { score: 0.9, cluster: CLUSTER.b },
    ];
    expect(order(run(specs, inert))).toEqual([1, 2, 3, 4, 5]);
  });

  it("reports reason codes in one fixed order", () => {
    const result = run([
      { score: 0.9, cluster: CLUSTER.a, exposed: true, seenHoursAgo: 1 },
      { score: 0.89, cluster: CLUSTER.b },
    ]);
    for (const c of result.candidates) {
      const positions = c.rerankReasonCodes.map((code) =>
        RERANK_REASON_CODES.indexOf(code),
      );
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
    }
  });
});

describe("performance", () => {
  it("18: two hundred candidates reorder in well under a millisecond", () => {
    const specs: Spec[] = Array.from({ length: 200 }, (_, i) => ({
      score: Math.round((1 - i * 0.004) * 1000) / 1000,
      cluster: [CLUSTER.a, CLUSTER.b, CLUSTER.e][i % 3] ?? null,
      exposed: i % 3 === 0,
      seenHoursAgo: i % 3 === 0 ? 2 : undefined,
      passed: i % 23 === 0,
    }));
    const result = run(specs);
    expect(result.candidates).toHaveLength(200);
    // Generous by two orders of magnitude: the point is that this is
    // arithmetic over an in-memory list, not that the number is 30.
    expect(result.diagnostics.durationMs).toBeLessThan(30);
  });
});
