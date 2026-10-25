import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { assessUnicornPotential } from "../src/unicorn-potential/assess.js";
import {
  createPostgresUnicornPotentialStore,
  unicornObservationsCurrent,
  eligibleUnicornRevisions,
} from "../src/unicorn-potential/postgres.js";

const company = "00000000-0000-4000-8000-000000000001";
const inputs = {
  companyId: company,
  stageCode: "seed",
  sectorCodes: [],
  businessModelCodes: [],
  profile: {
    listed: true,
    description: false,
    website: false,
    updatedAt: null,
  },
  verification: { organisation: false, domain: false, decidedAt: null },
  founders: [],
  claims: [],
  deck: null,
};
const view = assessUnicornPotential(inputs, "2026-10-17T12:00:00Z").view;
function fixture(
  allowed: number[],
  revisions = [2, 1],
  cohorts: Record<number, string> = {},
  scored = false,
) {
  const query = vi.fn(async (parts: TemplateStringsArray) => {
    await Promise.resolve();
    const text = parts.join("?");
    if (
      text.includes("unicorn_potential_eligible_revisions") ||
      text.includes("unicorn_potential_historical_revisions")
    )
      return allowed.map((revision) => ({ company_id: company, revision }));
    return revisions.map((revision) => ({
      company_id: company,
      revision,
      basis_hash: String(revision).repeat(64),
      cohort_key: cohorts[revision] ?? "seed",
      summary: scored
        ? {
            ...view,
            status: "SCORED",
            overallScore: 75,
            band: "STRONG_SIGNALS",
            coverage: 1,
            stage: "SEED",
            pillars: view.pillars.map((pillar) => ({
              ...pillar,
              grade: 3,
              coverage: 1,
              criteria: pillar.criteria.map((criterion) => ({
                ...criterion,
                state: "OBSERVED",
                grade: 3,
                sources: [
                  {
                    id: company,
                    revision: company,
                    at: "2026-10-17T00:00:00Z",
                    kind: "CLAIM",
                    label: "Public dated fact",
                    truthClass: "USER_CLAIM",
                    evidenceStatus: "SELF_REPORTED",
                    visibilityScope: "network_visible",
                    lifecycleStatus: "CURRENT",
                  },
                ],
              })),
            })),
          }
        : view,
      assessed_at: "2026-10-17T12:00:00Z",
      observations: [],
    }));
  });
  const sql = Object.assign(query, {
    json: (value: unknown) => value,
  }) as unknown as DatabaseExecutor;
  const transactions = {
    run: () => Promise.reject(new Error("read must not create a transaction")),
  } as TransactionManager;
  return {
    store: createPostgresUnicornPotentialStore({ sql, transactions }),
    query,
    sql,
  };
}
describe("persisted Unicorn source reauthorization", () => {
  it("does not fall back to an older score when the latest source is revoked", async () => {
    const f = fixture([1]);
    expect(
      (await f.store.current([company], "unicorn-potential.v1.0.0")).size,
    ).toBe(0);
    expect(f.query).toHaveBeenCalledTimes(3);
  });
  it("history omits revoked source labels rather than retaining private old explanations", async () => {
    const f = fixture([2]);
    expect(
      (await f.store.history(company, "unicorn-potential.v1.0.0")).map(
        (item) => item.revision,
      ),
    ).toEqual([2]);
  });
  it("does not construct momentum from an unauthorized prior revision", async () => {
    const f = fixture([2]);
    const current = await f.store.current(
      [company],
      "unicorn-potential.v1.0.0",
    );
    expect(current.get(company)?.momentum).toBeNull();
  });
  it("does not skip an intervening incomparable cohort when computing momentum", async () => {
    const f = fixture(
      [3, 2, 1],
      [3, 2, 1],
      { 3: "seed", 2: "pre-seed", 1: "seed" },
      true,
    );
    expect(
      (await f.store.current([company], view.methodVersion)).get(company)
        ?.momentum,
    ).toBeNull();
  });
  it("retains dated momentum from an authorized immediate comparable historical revision", async () => {
    const f = fixture([2, 1], [2, 1], {}, true);
    expect(
      (await f.store.current([company], view.methodVersion)).get(company)
        ?.momentum,
    ).toEqual(expect.objectContaining({ delta: 0, previousScore: 75 }));
    expect(
      f.query.mock.calls.some(([parts]) =>
        parts.join("").includes("unicorn_potential_historical_revisions"),
      ),
    ).toBe(true);
  });
  it("does not erase authorized historical observations because their freshness window elapsed", async () => {
    const f = fixture([1]);
    const candidate = {
      company_id: company,
      revision: 1,
      assessed_at: "2020-01-01T00:00:00Z",
      observations: [
        {
          pillar: "P4",
          criterion: "A",
          stale: false,
          source: { at: "2019-01-01T00:00:00Z" },
        },
      ],
    };
    expect((await eligibleUnicornRevisions(f.sql, [candidate])).size).toBe(0);
    expect(f.query).not.toHaveBeenCalled();
    expect(
      (await eligibleUnicornRevisions(f.sql, [candidate], true)).has(
        `${company}:1`,
      ),
    ).toBe(true);
  });
  it("reads only the current and the immediately previous revision per company", async () => {
    const f = fixture([2, 1], [2, 1], {}, true);
    await f.store.current([company], view.methodVersion);
    const read = f.query.mock.calls
      .map(([parts]) => parts.join("?"))
      .find((text) => text.includes("company_unicorn_potential_assessments"));
    expect(read).toMatch(/order by revision desc limit 2\) a$/);
  });
  it("does no source query for an empty requested page", async () => {
    const f = fixture([]);
    expect((await f.store.current([], "unicorn-potential.v1.0.0")).size).toBe(
      0,
    );
    expect(f.query).not.toHaveBeenCalled();
  });
});
describe("clock-driven source aging", () => {
  const observation = {
    pillar: "P4",
    criterion: "A",
    stale: false,
    source: { at: "2026-10-01T00:00:00.000Z" },
  };
  it("suppresses a previously current growth score once its measurement year expires without a write", () => {
    expect(
      unicornObservationsCurrent(
        [observation],
        Date.parse("2026-10-17T12:00:00Z"),
      ),
    ).toBe(true);
    expect(
      unicornObservationsCurrent(
        [observation],
        Date.parse("2027-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
  it("suppresses a source passing its criterion freshness window", () => {
    expect(
      unicornObservationsCurrent(
        [{ ...observation, pillar: "P1" }],
        Date.parse("2030-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
  it("does not promote already stale or malformed observations", () => {
    expect(
      unicornObservationsCurrent(
        [{ ...observation, stale: true }],
        Date.parse("2027-01-01T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      unicornObservationsCurrent([{ ...observation, source: { at: null } }]),
    ).toBe(false);
    expect(unicornObservationsCurrent({})).toBe(false);
  });
});

describe("append revisions and source revocation during assessment", () => {
  function writer() {
    const history: { revision: number; basis_hash: string }[] = [];
    let allowed = true;
    const query = vi.fn(
      async (parts: TemplateStringsArray, ...values: unknown[]) => {
        await Promise.resolve();
        const text = parts.join("?");
        if (text.includes("for update")) return [{ id: company }];
        if (
          text.includes("unicorn_potential_eligible_revisions") ||
          text.includes("unicorn_potential_historical_revisions")
        )
          return allowed ? [{ company_id: company, revision: 0 }] : [];
        if (text.startsWith("select revision")) return history.slice(-1);
        if (text.startsWith("insert into")) {
          history.push({
            revision: values[4] as number,
            basis_hash: values[5] as string,
          });
          return [];
        }
        throw new Error("unexpected repository query");
      },
    );
    const sql = Object.assign(query, {
      json: (value: unknown) => value,
    }) as unknown as DatabaseExecutor;
    const transactions = {
      run: async (work: (tx: { sql: DatabaseExecutor }) => Promise<unknown>) =>
        work({ sql }),
    } as TransactionManager;
    const store = createPostgresUnicornPotentialStore({ sql, transactions });
    const record = (basis: string) =>
      store.record({
        subject: {
          companyId: company,
          tenantId: company,
          organisationId: company,
        },
        methodVersion: view.methodVersion,
        basisHash: basis.repeat(64),
        cohortKey: "seed",
        view,
        observations: [],
        sourcesReadAt: new Date().toISOString(),
      });
    return {
      record,
      history,
      revoke: () => {
        allowed = false;
      },
    };
  }
  it("same-basis retries do not append while A to B to A preserves the return revision", async () => {
    const f = writer();
    expect(await f.record("a")).toEqual({ revision: 1, created: true });
    expect(await f.record("a")).toEqual({ revision: 1, created: false });
    expect(await f.record("b")).toEqual({ revision: 2, created: true });
    expect(await f.record("a")).toEqual({ revision: 3, created: true });
    expect(f.history).toHaveLength(3);
  });
  it("revoked eligibility rejects even a same-basis retry before touching history", async () => {
    const f = writer();
    await f.record("a");
    f.revoke();
    await expect(f.record("a")).rejects.toThrow("sources no longer eligible");
    expect(f.history).toHaveLength(1);
  });
});
