import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ApplicationFact, ApplicationId } from "../src/contracts/index.js";
import type { ApplicationStatement } from "../src/contracts/statements.js";
import {
  runStatementBackfill,
  type BackfillStore,
} from "../src/application/statement-backfill.js";
import {
  backfillStatementId,
  legacyCarry,
} from "../src/application/statement-plan.js";
import { effectiveStatementView } from "../src/application/statement-words.js";

/** Slice 3: the backfill, against an in-memory store with the same rules. */

const AT = "2026-11-01T10:00:00.000Z";

function fact(
  applicationId: string,
  dimension: ApplicationFact["dimension"],
  value: ApplicationFact["value"],
  provenance: ApplicationFact["provenance"] = "APPLICANT_PROVIDED",
): ApplicationFact {
  return {
    id: randomUUID() as ApplicationFact["id"],
    applicationId: applicationId as ApplicationId,
    dimension,
    value,
    provenance,
    recordedAt: AT,
    supersededAt: null,
    sourceTurnSeq: null,
  };
}

function memoryStore(input: {
  readonly applications: readonly {
    id: string;
    status: string;
    facts: ApplicationFact[];
  }[];
}) {
  const statements: (ApplicationStatement & { tenantId: string })[] = [];
  let failNext = false;
  const store: BackfillStore = {
    applications: () =>
      Promise.resolve(
        input.applications.map((a) => ({
          id: a.id as ApplicationId,
          tenantId: "tenant-1",
        })),
      ),
    inTransaction: async (application, work) => {
      const before = statements.length;
      try {
        return await work({
          lockStatus: () =>
            Promise.resolve(
              input.applications.find((a) => a.id === application.id)?.status ??
                null,
            ),
          context: () =>
            Promise.resolve({
              statements: statements.filter(
                (s) => s.applicationId === application.id,
              ),
              links: [],
              events: [],
            }),
          currentFacts: () =>
            Promise.resolve(
              input.applications.find((a) => a.id === application.id)?.facts ??
                [],
            ),
          append: (rows) => {
            for (const row of rows) {
              if (statements.some((s) => s.id === row.id))
                throw new Error("duplicate id");
              if (statements.some((s) => s.backfillKey === row.backfillKey))
                throw new Error("duplicate backfill key");
              statements.push({ ...row, tenantId: application.tenantId });
            }
            if (failNext) {
              failNext = false;
              throw new Error("injected");
            }
            return Promise.resolve();
          },
        });
      } catch (error) {
        statements.splice(before);
        throw error;
      }
    },
  };
  return {
    store,
    statements,
    failOnce: () => {
      failNext = true;
    },
  };
}

describe("the statements backfill", () => {
  const draft = randomUUID();
  const submitted = randomUUID();
  const facts = [
    fact(draft, "company.name", { kind: "TEXT", text: "Ledgerly" }),
    fact(draft, "raise.amount", {
      kind: "AMOUNT",
      amount: "2000000",
      currency: "USD",
    }),
    fact(draft, "claims.revenue", {
      kind: "AMOUNT",
      amount: "0",
      currency: "USD",
    }),
    fact(draft, "company.market", { kind: "NONE" }, "UNKNOWN"),
    fact(draft, "company.sector_phrases", {
      kind: "PHRASES",
      phrases: ["fintech", "payments"],
    }),
  ];
  const world = () =>
    memoryStore({
      applications: [
        { id: draft, status: "DRAFT", facts },
        {
          id: submitted,
          status: "SUBMITTED",
          facts: [fact(submitted, "company.name", { kind: "TEXT", text: "X" })],
        },
      ],
    });

  it("is a dry run by default: reports what it would write and writes nothing", async () => {
    const { store, statements } = world();
    const report = await runStatementBackfill({ store });
    expect(report.apply).toBe(false);
    expect(statements).toHaveLength(0);
    expect(report.statementsPlanned).toBe(6);
    expect(report.statementsWritten).toBe(0);
    expect(
      report.applications.map((a) => [a.applicationId, a.outcome]),
    ).toEqual([
      [draft, "WOULD_WRITE"],
      [submitted, "SKIPPED_SUBMITTED"],
    ]);
  });

  it("writes honest BACKFILL rows with the write path's keys and ids, and a second run writes nothing", async () => {
    const { store, statements } = world();
    const first = await runStatementBackfill({ store, apply: true });
    expect(first.statementsWritten).toBe(6);
    for (const s of statements) {
      expect(s.origin).toBe("BACKFILL");
      expect(s.sourceTurnId).toBeNull();
      expect(s.backfillKey).toMatch(/^legacy-fact:/u);
      expect(s.id).toBe(backfillStatementId(draft, s.backfillKey ?? ""));
    }
    // The stated zero stays a zero, the unknown stays unknown.
    expect(
      statements.find((s) => s.dimension === "claims.revenue")?.value,
    ).toEqual({ kind: "ZERO", currency: "USD" });
    expect(
      statements.find((s) => s.dimension === "company.market")?.value,
    ).toEqual({ kind: "UNKNOWN" });
    // Never a submitted application.
    expect(statements.some((s) => s.applicationId === submitted)).toBe(false);

    const second = await runStatementBackfill({ store, apply: true });
    expect(second.statementsWritten).toBe(0);
    expect(second.applications[0]?.outcome).toBe("NOTHING_TO_CARRY");
    expect(statements).toHaveLength(6);
  });

  it("the readers' view before the backfill names the same statements as after it", async () => {
    const { store, statements } = world();
    const before = effectiveStatementView({
      applicationId: draft as ApplicationId,
      context: { statements: [], links: [], events: [] },
      legacyFacts: facts,
    }).view;
    await runStatementBackfill({ store, apply: true });
    const after = effectiveStatementView({
      applicationId: draft as ApplicationId,
      context: { statements, links: [], events: [] },
      legacyFacts: facts,
    }).view;
    const ids = (view: typeof before) =>
      view.dimensions.flatMap((d) => d.items.map((i) => i.statementId)).sort();
    expect(ids(after)).toEqual(ids(before));
    expect(
      legacyCarry({
        applicationId: draft as ApplicationId,
        context: { statements, links: [], events: [] },
        legacyFacts: facts,
      }),
    ).toHaveLength(0);
  });

  it("rolls one application back whole when its transaction fails", async () => {
    const { store, statements, failOnce } = world();
    failOnce();
    await expect(runStatementBackfill({ store, apply: true })).rejects.toThrow(
      "injected",
    );
    expect(statements).toHaveLength(0);
  });

  it("limits itself to the applications named", async () => {
    const { store } = world();
    const report = await runStatementBackfill({ store, only: [submitted] });
    expect(report.applications.map((a) => a.applicationId)).toEqual([
      submitted,
    ]);
  });
});
