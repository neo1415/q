import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type LiveDocument,
  planRevenueClaim,
  renderRevenueSql,
  revenueFigureOf,
  type RevenueSnapshot,
  seedUuid,
} from "../../../scripts/seed/evidence/revenue-claims-plan.mjs";

/**
 * scripts/seed/evidence/revenue-claims.mjs: fixture -> planned revenue
 * claim, the Context Firewall gate on the source document's own scope,
 * idempotency and refusals. The planned value shape is the one
 * packages/model-gateway/test/list-conditions-seeded-revenue.test.ts reads
 * as HAS_REVENUE / PRE_REVENUE.
 */
const DIR = join(import.meta.dirname, "../../../scripts/seed/evidence");
const KEYS = readdirSync(join(DIR, "fixtures"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const load = (kind: string, key: string): unknown =>
  JSON.parse(readFileSync(join(DIR, kind, `${key}.json`), "utf8"));
const source = (key: string) => ({
  key,
  fixture: load("fixtures", key),
  manifest: load("manifests", key),
});

const AJOPOT = "91de2a77-fe47-4af0-8534-d9abf9c55949";
const TENANT = "00000000-0000-4000-8000-0000000000a1";
const ORG = "00000000-0000-4000-8000-0000000000b1";

function doc(file: string, over: Partial<LiveDocument> = {}): LiveDocument {
  return {
    file,
    document_id: seedUuid("doc", file),
    version_id: seedUuid("ver", file),
    title: file,
    visibility_scope: "organisation_private",
    sensitivity_class: "HIGHLY_CONFIDENTIAL",
    status: "ACTIVE",
    level: "SHARED_ONLY",
    ...over,
  };
}

function snapshot(
  documents: readonly LiveDocument[],
  over: Partial<RevenueSnapshot> = {},
): RevenueSnapshot {
  return {
    company: {
      id: AJOPOT,
      tenant_id: TENANT,
      organisation_id: ORG,
      canonical_name: "Ajopot",
      company_status: "active",
    },
    documents,
    claims: [],
    ...over,
  };
}

const NETWORK_DOC = {
  visibility_scope: "network_visible",
  sensitivity_class: "NETWORK_VISIBLE",
  level: "PUBLIC",
};

describe("fixture -> stated revenue figure", () => {
  it.each(KEYS)(
    "%s: the latest actual month's stated total, in its own currency",
    (key) => {
      const fixture = load("fixtures", key) as {
        currency: string;
        actuals: { month: string; revenue: { total: number } }[];
      };
      const latest = fixture.actuals.at(-1);
      const figure = revenueFigureOf(fixture);
      expect(figure?.key).toBe("financial.monthly_revenue");
      expect(figure?.period).toBe(latest?.month);
      expect(figure?.value).toEqual({
        kind: "MONEY",
        amount: String(latest?.revenue.total),
        currency: fixture.currency,
        asOf: figure?.asOf,
      });
    },
  );

  it("Ajopot October 2026 is the model-gateway test's literal", () => {
    expect(revenueFigureOf(load("fixtures", "ajopot"))?.value).toEqual({
      kind: "MONEY",
      amount: "10183680",
      currency: "NGN",
      asOf: "2026-10-31",
    });
  });

  const months = (...totals: number[]) => ({
    currency: "USD",
    actuals: totals.map((total, i) => ({
      month: `2026-0${i + 1}`,
      revenue: { total },
    })),
  });

  it("every month stated as zero is pre-revenue", () => {
    expect(revenueFigureOf(months(0, 0, 0))?.value).toEqual({
      kind: "STATUS",
      code: "PRE_REVENUE",
      asOf: "2026-03-31",
    });
  });

  it("a zero month after revenue, no actuals, or no currency stays unknown", () => {
    expect(revenueFigureOf(months(500, 0))).toBeNull();
    expect(revenueFigureOf({ currency: "USD", actuals: [] })).toBeNull();
    expect(revenueFigureOf({ actuals: months(5).actuals })).toBeNull();
  });
});

describe("the source document's own scope gates the claim", () => {
  it("SHARED_ONLY or organisation-private documents yield no claim at all", () => {
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot([
        doc("aj-management-accounts.pdf"),
        doc("aj-revenue-breakdown.pdf"),
      ]),
    );
    expect(plan.claim).toBeNull();
    expect(plan.skipped).toMatch(/write nothing/u);
    expect(renderRevenueSql(plan, { now: "2026-11-17T00:00:00Z" })).toBeNull();
  });

  it("a PUBLIC data-room level over an organisation-private document never widens it", () => {
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot([doc("aj-management-accounts.pdf", { level: "PUBLIC" })]),
    );
    expect(plan.claim).toBeNull();
  });

  it("a network-scoped but highly confidential document yields nothing", () => {
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot([
        doc("aj-management-accounts.pdf", {
          visibility_scope: "network_visible",
          level: "PUBLIC",
        }),
      ]),
    );
    expect(plan.claim).toBeNull();
  });

  it("a network-readable document yields one DOCUMENT_SUPPORTED network claim linked to its version", () => {
    const accounts = doc("aj-management-accounts.pdf", NETWORK_DOC);
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot([doc("aj-revenue-breakdown.pdf"), accounts]),
    );
    expect(plan.claim).toMatchObject({
      key: "financial.monthly_revenue",
      scope: "network_visible",
      validFrom: "2026-10-31",
      document: {
        file: "aj-management-accounts.pdf",
        documentId: accounts.document_id,
        versionId: accounts.version_id,
      },
    });
    const sql = renderRevenueSql(plan, { now: "2026-11-17T00:00:00Z" }) ?? "";
    expect(sql).toContain(
      "'USER_CLAIM', 'DOCUMENT_SUPPORTED', 'CURRENT', 'network_visible', 'NETWORK_VISIBLE'",
    );
    expect(sql).toContain(`demo-revenue-claims:${accounts.version_id}`);
    expect(sql).toContain('"kind":"document"');
    // Every write is idempotent on its deterministic id.
    const inserts = sql.split("\n").filter((l) => l.startsWith("insert"));
    expect(inserts).toHaveLength(7);
    for (const line of inserts)
      expect(line).toMatch(/on conflict .*do nothing;$/u);
  });

  it("an archived document is never a source", () => {
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot([
        doc("aj-management-accounts.pdf", {
          ...NETWORK_DOC,
          status: "ARCHIVED",
        }),
      ]),
    );
    expect(plan.claim).toBeNull();
    expect(plan.skipped).toMatch(/no uploaded document/u);
  });
});

describe("idempotency and contradictions", () => {
  const docs = [doc("aj-management-accounts.pdf", NETWORK_DOC)];

  it("plans the same ids every run, and nothing once written", () => {
    const first = planRevenueClaim(source("ajopot"), snapshot(docs));
    const again = planRevenueClaim(source("ajopot"), snapshot(docs));
    expect(again.claim?.id).toBe(first.claim?.id);
    const written = planRevenueClaim(
      source("ajopot"),
      snapshot(docs, {
        claims: [
          {
            id: first.claim?.id ?? "",
            claim_key: "financial.monthly_revenue",
            structured_value: first.claim?.value,
            valid_from: "2026-10-31T00:00:00+00:00",
            visibility_scope: "network_visible",
            lifecycle_status: "CURRENT",
          },
        ],
      }),
    );
    expect(written.claim).toBeNull();
    expect(written.skipped).toBe("already written");
  });

  it("a different published value for the same date is left for a person", () => {
    const plan = planRevenueClaim(
      source("ajopot"),
      snapshot(docs, {
        claims: [
          {
            id: seedUuid("other"),
            claim_key: "financial.monthly_revenue",
            structured_value: { kind: "MONEY", amount: "1", currency: "NGN" },
            valid_from: "2026-10-31T00:00:00+00:00",
            visibility_scope: "network_visible",
            lifecycle_status: "CURRENT",
          },
        ],
      }),
    );
    expect(plan.claim).toBeNull();
    expect(plan.skipped).toMatch(/contradiction/u);
  });
});

describe("only the fixture's own fictional company", () => {
  const docs = [doc("aj-management-accounts.pdf", NETWORK_DOC)];
  const company = snapshot(docs).company;

  it.each([
    ["missing in production", null],
    [
      "renamed",
      snapshot(docs, { company: { ...company, canonical_name: "Other Co" } }),
    ],
    [
      "another id",
      snapshot(docs, { company: { ...company, id: seedUuid("x") } }),
    ],
    [
      "inactive",
      snapshot(docs, { company: { ...company, company_status: "archived" } }),
    ],
  ])("refuses a company that is %s", (_why, snap) => {
    const plan = planRevenueClaim(source("ajopot"), snap);
    expect(plan.refused?.length).toBeGreaterThan(0);
    expect(renderRevenueSql(plan, { now: "2026-11-17T00:00:00Z" })).toBeNull();
  });

  it("refuses a source without its own evidence manifest", () => {
    const plan = planRevenueClaim(
      { ...source("ajopot"), key: "coreisk" },
      snapshot(docs),
    );
    expect(plan.refused).toContain("no evidence manifest");
  });
});
