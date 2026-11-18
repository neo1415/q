import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPANY_STATEMENTS,
  companyStatementFigures,
  devWorldFigures,
  type FiguresSnapshot,
  planCompanyFigures,
  renderFiguresSql,
  type Sourced,
} from "../../../scripts/seed/demo-figures-plan.mjs";

/**
 * scripts/seed/demo-figures.mjs --company-statements (decision 105):
 * Ajopot's and Watchly's headline revenue published as the company's own
 * statement. The allowlist refuses everyone else, the plan is idempotent,
 * the rows have exactly the shape of the other demo companies' published
 * figures, and nothing names the organisation-private documents. The
 * planned values are the literals
 * packages/model-gateway/test/list-conditions-seeded-revenue.test.ts reads
 * as HAS_REVENUE.
 */
const ROOT = join(import.meta.dirname, "../../..");
const EVIDENCE = join(ROOT, "scripts/seed/evidence");
const load = (kind: string, key: string): unknown =>
  JSON.parse(readFileSync(join(EVIDENCE, kind, `${key}.json`), "utf8"));

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const ORG = "00000000-0000-4000-8000-0000000000b1";
const NOW = "2026-11-18T12:00:00.000Z";

type Allowed = keyof typeof EXPECTED;
const EXPECTED = {
  ajopot: {
    companyId: "91de2a77-fe47-4af0-8534-d9abf9c55949",
    name: "Ajopot",
    value: {
      kind: "MONEY",
      amount: "10183680",
      currency: "NGN",
      asOf: "2026-10-31",
    },
    statement:
      "Ajopot: Monthly revenue: NGN 10,183,680 in October 2026. (Demonstration data, self-reported by the company.)",
  },
  watchly: {
    companyId: "526c2d72-9142-4e48-b106-ee4910f19318",
    name: "Watchly",
    value: {
      kind: "MONEY",
      amount: "8500",
      currency: "USD",
      asOf: "2026-10-31",
    },
    statement:
      "Watchly: Monthly revenue: USD 8,500 in October 2026. (Demonstration data, self-reported by the company.)",
  },
} as const;

function snapshot(
  companyId: string,
  name: string,
  claims: FiguresSnapshot["claims"] = [],
): FiguresSnapshot {
  return {
    company: {
      id: companyId,
      canonical_name: name,
      tenant_id: TENANT,
      organisation_id: ORG,
      demonstration_data: false,
      company_status: "active",
    },
    people: [
      {
        profileId: "00000000-0000-4000-8000-0000000000c1",
        email: "founder@fictional.capitalq.local",
        userFictionalDemo: true,
        current: true,
      },
    ],
    claims,
  };
}

function planFor(key: Allowed, claims: FiguresSnapshot["claims"] = []) {
  const { companyId, name } = EXPECTED[key];
  return planCompanyFigures(
    { companyId, name, source: `company statement ${key} (decision 105)` },
    snapshot(companyId, name, claims),
    companyStatementFigures(key, load("fixtures", key), companyId),
  );
}

describe("decision 105 allowlist", () => {
  it("is exactly Ajopot and Watchly", () => {
    expect(Object.keys(COMPANY_STATEMENTS).toSorted()).toEqual([
      "ajopot",
      "watchly",
    ]);
  });

  it.each(["ajopot", "watchly"] as const)(
    "%s: one company-stated monthly revenue, the fixture's latest actual month",
    (key) => {
      const plan = planFor(key);
      expect(plan.refused).toBeUndefined();
      expect(plan.claims).toHaveLength(1);
      const [cp] = plan.claims ?? [];
      expect(cp?.key).toBe("financial.monthly_revenue");
      expect(cp?.type).toBe("financial");
      expect(cp?.value).toEqual(EXPECTED[key].value);
      expect(cp?.validFrom).toBe("2026-10-31");
      expect(cp?.statement).toBe(EXPECTED[key].statement);
    },
  );

  it("refuses Nixo, even with its own fixture", () => {
    const sourced = companyStatementFigures(
      "nixo",
      load("fixtures", "nixo"),
      "00000000-0000-4000-8000-0000000000e9",
    );
    expect(sourced.figures).toEqual([]);
    expect(sourced.refused?.[0]).toMatch(/not in .*decision 105.*allowlist/u);
  });

  it.each(["halyard", "maji-loop", "medtrail", "mizan", "tensorgate"])(
    "refuses %s (an evidence-fixture company outside the allowlist)",
    (key) => {
      const sourced = companyStatementFigures(
        key,
        load("fixtures", key),
        EXPECTED.ajopot.companyId,
      );
      expect(sourced.figures).toEqual([]);
      expect(sourced.refused).toHaveLength(1);
    },
  );

  it("refuses an allowlisted key bound to a different company or fixture", () => {
    expect(
      companyStatementFigures(
        "ajopot",
        load("fixtures", "ajopot"),
        EXPECTED.watchly.companyId,
      ).refused,
    ).toEqual([expect.stringMatching(/is not ajopot's/u)]);
    expect(
      companyStatementFigures(
        "ajopot",
        load("fixtures", "watchly"),
        EXPECTED.ajopot.companyId,
      ).refused?.length,
    ).toBeGreaterThan(0);
  });

  it("refuses when the fixture no longer states decision 105's figure", () => {
    const fixture = load("fixtures", "watchly") as {
      actuals: { month: string; revenue: { total: number } }[];
    };
    const changed = {
      ...fixture,
      actuals: [
        ...fixture.actuals,
        { month: "2026-11", revenue: { total: 9000 } },
      ],
    };
    const sourced = companyStatementFigures(
      "watchly",
      changed,
      EXPECTED.watchly.companyId,
    );
    expect(sourced.figures).toEqual([]);
    expect(sourced.refused?.[0]).toMatch(/not decision 105's USD 8500/u);
  });

  it("refuses at plan level and writes nothing for a refused source", () => {
    const refused: Sourced = companyStatementFigures(
      "nixo",
      load("fixtures", "nixo"),
      EXPECTED.ajopot.companyId,
    );
    const plan = planCompanyFigures(
      { companyId: EXPECTED.ajopot.companyId, name: "Ajopot", source: "x" },
      snapshot(EXPECTED.ajopot.companyId, "Ajopot"),
      refused,
    );
    expect(plan.refused?.length).toBeGreaterThan(0);
    expect(renderFiguresSql(plan, { now: NOW })).toBeNull();
  });
});

describe("idempotency", () => {
  it.each(["ajopot", "watchly"] as const)(
    "%s: deterministic ids; a second run plans nothing",
    (key) => {
      const first = planFor(key);
      expect(planFor(key).claims).toEqual(first.claims);
      const [cp] = first.claims ?? [];
      if (cp === undefined) throw new Error("no planned claim");
      const again = planFor(key, [
        {
          id: cp.id,
          claim_key: cp.key,
          structured_value: cp.value,
          valid_from: "2026-10-31T00:00:00+00:00",
          visibility_scope: "network_visible",
          lifecycle_status: "CURRENT",
        },
      ]);
      expect(again.claims).toEqual([]);
      expect(renderFiguresSql(again, { now: NOW })).toBeNull();
    },
  );

  it("never overwrites a different published value for the same date", () => {
    const plan = planFor("watchly", [
      {
        id: "00000000-0000-4000-8000-0000000000f1",
        claim_key: "financial.monthly_revenue",
        structured_value: { kind: "MONEY", amount: "9999", currency: "USD" },
        valid_from: "2026-10-31T00:00:00+00:00",
        visibility_scope: "network_visible",
        lifecycle_status: "CURRENT",
      },
    ]);
    expect(plan.claims).toEqual([]);
    expect(plan.notes).toContainEqual(
      expect.stringMatching(/^NOT published financial\.monthly_revenue/u),
    );
  });

  it("every insert is on-conflict-do-nothing", () => {
    const sql = renderFiguresSql(planFor("ajopot"), { now: NOW }) ?? "";
    const inserts = sql.split("\n").filter((l) => l.startsWith("insert"));
    expect(inserts).toHaveLength(7);
    for (const line of inserts)
      expect(line).toMatch(/on conflict.*do nothing;$/u);
  });
});

describe("the same shape as the other demo companies' published figures", () => {
  // A dev-world company's stated monthly revenue, through the same path.
  const devWorld = (): string => {
    const companyId = "00000000-0000-4000-8000-0000000000d1";
    const plan = planCompanyFigures(
      { companyId, name: "Demo", source: "dev world demo" },
      snapshot(companyId, "Demo"),
      devWorldFigures({
        key: "demo",
        claims: [
          {
            claimKey: "financial.monthly_revenue",
            claimType: "financial",
            statement: "Monthly revenue of USD 100 in October 2026.",
            structuredValue: {
              kind: "MONEY",
              amount: "100",
              currency: "USD",
              asOf: "2026-10-31",
            },
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
        ],
      }),
    );
    return renderFiguresSql(plan, { now: NOW }) ?? "";
  };
  // The statement prefix and fixed literals of each row, values aside.
  const skeleton = (sql: string) =>
    sql
      .split("\n")
      .map((l) => l.split(" values (")[0])
      .join("\n");
  const fixed = (sql: string) =>
    [
      ...sql.matchAll(
        /'(USER_STATEMENT|USER_CLAIM|SELF_REPORTED|CURRENT|network_visible|NETWORK_VISIBLE|COMPANY|SOURCE|SUPPORTS|capital_q_system|claim\.created|evidence\.claim\.changed|user_statement\.reported_fact|demo_seed)'/gu,
      ),
    ].map((m) => m[1]);

  it.each(["ajopot", "watchly"] as const)(
    "%s: same tables, columns and fixed values as a dev-world figure",
    (key) => {
      const sql = renderFiguresSql(planFor(key), { now: NOW }) ?? "";
      const reference = devWorld();
      expect(skeleton(sql)).toBe(skeleton(reference));
      expect(fixed(sql)).toEqual(fixed(reference));
      expect(sql).toContain('"seed":"demo-figures.v1"');
    },
  );

  it.each(["ajopot", "watchly"] as const)(
    "%s: names no document, version or file of the private evidence pack",
    (key) => {
      const sql = renderFiguresSql(planFor(key), { now: NOW }) ?? "";
      expect(sql).not.toMatch(
        /'DOCUMENT'|DOCUMENT_SUPPORTED|document_id|version_id/u,
      );
      const manifest = load("manifests", key) as {
        documents: { id: string; fileName: string; title: string }[];
      };
      for (const doc of manifest.documents) {
        expect(sql).not.toContain(doc.fileName);
        expect(sql).not.toContain(doc.title);
        expect(sql).not.toContain(`"${doc.id}"`);
      }
    },
  );
});
