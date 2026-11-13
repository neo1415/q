// node --test scripts/seed/demo-figures-plan.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  claimKeyFor,
  decimalOf,
  devWorldFigures,
  monthEnd,
  monthlyTail,
  planCompanyFigures,
  READ_FIGURES_MAX,
  renderFiguresPlan,
  renderFiguresSql,
  statedMonth,
  tavusFigures,
} from "./demo-figures-plan.mjs";

const COMPANY = "00000000-0000-4000-8000-0000000000d1";
const OWNER = "00000000-0000-4000-8000-0000000000e1";
const NOW = "2026-11-13T12:00:00.000Z";

const fictional = (over = {}) => ({
  company: {
    id: COMPANY,
    canonical_name: "Ledgerline",
    tenant_id: "00000000-0000-4000-8000-0000000000f1",
    organisation_id: "00000000-0000-4000-8000-0000000000a1",
    demonstration_data: false,
    company_status: "active",
  },
  people: [
    {
      email: "founder.ledgerline@fictional.capitalq.local",
      current: true,
      userFictionalDemo: true,
    },
  ],
  claims: [],
  ...over,
});
const entry = {
  companyId: COMPANY,
  name: "Ledgerline",
  source: "test",
  why: [],
};

const tavus = {
  n: 1,
  company: "Ledgerline",
  metrics: {
    kpis: [
      {
        code: "mrr",
        label: "Monthly recurring revenue",
        unit: "money",
        currency: "NGN",
      },
      { code: "paying_businesses", label: "Paying businesses", unit: "count" },
      { code: "avg_days", label: "Days", unit: "days" },
    ],
    points: [
      {
        period: "2026-04",
        asOf: "2026-04-30",
        values: { mrr: 25000000, paying_businesses: 800 },
      },
      {
        period: "2026-06",
        asOf: "2026-06-30",
        values: { mrr: 31722470, paying_businesses: 953 },
      },
      {
        period: "2026-07",
        asOf: "2026-07-31",
        values: { mrr: 33690377, paying_businesses: 1011 },
      },
      {
        period: "2026-08",
        asOf: "2026-08-31",
        values: { mrr: 35780362, paying_businesses: 1074 },
      },
      {
        period: "2026-09",
        asOf: "2026-09-30",
        values: { mrr: 38000000, paying_businesses: 1140 },
      },
    ],
  },
};

test("decimals move digits exactly and refuse anything else", () => {
  assert.equal(decimalOf(38000000), "38000000");
  assert.equal(decimalOf(94.8), "94.8");
  assert.equal(decimalOf(0.4), "0.4");
  assert.equal(decimalOf(19.5, 9), "19500000000");
  assert.equal(decimalOf(82, 6), "82000000");
  assert.equal(decimalOf(Number.NaN), null);
  assert.equal(decimalOf(-1), null);
  assert.equal(decimalOf("12"), null);
});

test("month ends, including leap February", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.equal(monthEnd("2026-09"), "2026-09-30");
  assert.equal(monthEnd("2026-13"), null);
});

test("the series is the consecutive monthly tail ending at the latest stated value", () => {
  const tail = monthlyTail(tavus.metrics.points, "mrr");
  assert.deepEqual(
    tail.map((p) => p.period),
    ["2026-06", "2026-07", "2026-08", "2026-09"],
  );
  assert.equal(tail.at(-1).value, 38000000);
});

test("a missing value breaks the tail; fewer than 3 points publishes only the latest", () => {
  const points = [
    { period: "2026-07", values: { x: 1 } },
    { period: "2026-08", values: {} },
    { period: "2026-09", values: { x: 3 } },
  ];
  assert.deepEqual(monthlyTail(points, "x"), [
    { period: "2026-09", asOf: undefined, value: 3 },
  ]);
  assert.deepEqual(monthlyTail(points, "absent"), []);
});

test("the tail never exceeds six points", () => {
  const points = Array.from({ length: 9 }, (_, i) => ({
    period: `2026-0${i + 1}`,
    values: { x: i },
  }));
  assert.equal(monthlyTail(points, "x").length, 6);
});

test("well-known revenue keys only where the KPI's own label says so", () => {
  assert.equal(
    claimKeyFor({
      code: "mrr",
      label: "Monthly recurring revenue",
      unit: "money",
    }),
    "financial.mrr",
  );
  assert.equal(
    claimKeyFor({ code: "mrr", label: "Monthly revenue", unit: "money" }),
    "financial.monthly_revenue",
  );
  assert.equal(
    claimKeyFor({
      code: "net_revenue",
      label: "Net revenue in month",
      unit: "money",
    }),
    "financial.net_revenue",
  );
  assert.equal(
    claimKeyFor({
      code: "paying_businesses",
      label: "Paying businesses",
      unit: "count",
    }),
    "traction.paying_businesses",
  );
});

test("tavus figures keep the source's values and currency and skip unchartable units", () => {
  const { figures, skipped } = tavusFigures(tavus);
  const mrr = figures.find((f) => f.key === "financial.mrr");
  assert.equal(mrr.currency, "NGN");
  assert.deepEqual(
    mrr.points.map((p) => [p.asOf, p.decimal]),
    [
      ["2026-06-30", "31722470"],
      ["2026-07-31", "33690377"],
      ["2026-08-31", "35780362"],
      ["2026-09-30", "38000000"],
    ],
  );
  assert.match(mrr.provenance, /^demo series stated in docs\/seed\/tavus-20/);
  assert.match(mrr.provenance, /nothing interpolated/);
  assert.deepEqual(skipped, ["avg_days: unit days has no chartable kind"]);
});

test("a stated month dates a dev-world figure; 'since' and two months do not", () => {
  assert.equal(
    statedMonth("Monthly revenue of about USD 95,000 (February 2026)."),
    "2026-02-28",
  );
  assert.equal(
    statedMonth("1,900 contractors signed up since September 2025."),
    null,
  );
  assert.equal(statedMonth("Up from March 2025 to March 2026."), null);
  assert.equal(statedMonth("Gross merchandise value in Q1 2026."), null);
});

test("dev-world figures: one stated point each; contradictions, unknowns and market sizes are skipped", () => {
  const { figures, skipped } = devWorldFigures({
    key: "clinicrest",
    claims: [
      {
        claimKey: "customers.paying_accounts",
        claimType: "customers",
        statement: "212 paying accounts (February 2026).",
        structuredValue: { kind: "COUNT", value: 212, asOf: "2026-02-28" },
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        lifecycleStatus: "CONTRADICTORY",
      },
      {
        claimKey: "financial.monthly_revenue",
        claimType: "financial",
        statement: "Monthly revenue of about USD 95,000 (February 2026).",
        structuredValue: {
          kind: "MONEY",
          amount: "95000",
          currency: "USD",
          period: "month",
        },
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      },
      {
        claimKey: "market.outlets",
        claimType: "market",
        statement: "Around 30,000 outlets.",
        structuredValue: { kind: "COUNT", value: 30000 },
        truthClass: "ESTIMATE",
        evidenceStatus: "SELF_REPORTED",
      },
      {
        claimKey: "financial.gross_margin",
        claimType: "financial",
        statement: "Not disclosed.",
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
      },
    ],
  });
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].points, [
    { period: "2026-02", asOf: "2026-02-28", decimal: "95000" },
  ]);
  assert.equal(skipped.length, 3);
});

test("only fictional companies: a genuine account, a demonstration company or a renamed company is refused", () => {
  const sourced = tavusFigures(tavus);
  const real = planCompanyFigures(
    entry,
    fictional({ people: [{ email: "someone@example.com", current: true }] }),
    sourced,
  );
  assert.ok(real.refused.some((r) => /not a fictional account/.test(r)));
  const demo = planCompanyFigures(
    entry,
    fictional({
      company: { ...fictional().company, demonstration_data: true },
    }),
    sourced,
  );
  assert.ok(demo.refused.some((r) => /demonstration_data/.test(r)));
  const renamed = planCompanyFigures(
    entry,
    fictional({ company: { ...fictional().company, canonical_name: "Other" } }),
    sourced,
  );
  assert.ok(renamed.refused.some((r) => /production name/.test(r)));
  assert.deepEqual(planCompanyFigures(entry, null, sourced).refused, [
    "company not found",
  ]);
  assert.equal(
    renderFiguresSql(real, { authorityUserId: OWNER, now: NOW }),
    null,
  );
});

test("the plan publishes USER_CLAIM / SELF_REPORTED, network_visible, labelled demonstration data", () => {
  const plan = planCompanyFigures(entry, fictional(), tavusFigures(tavus));
  assert.equal(plan.claims.length, 8);
  for (const cp of plan.claims) {
    assert.match(
      cp.statement,
      /\(Demonstration data, self-reported by the company\.\)$/,
    );
  }
  const sql = renderFiguresSql(plan, { authorityUserId: OWNER, now: NOW });
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;$/);
  assert.doesNotMatch(sql, /'VERIFIED'|PLATFORM_VERIFIED|EXTERNALLY_VERIFIED/);
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b/i);
  const claimRows = sql
    .split("\n")
    .filter((l) => l.startsWith("insert into evidence.claims "));
  assert.equal(claimRows.length, 8);
  for (const row of claimRows) {
    assert.match(
      row,
      /'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'network_visible', 'NETWORK_VISIBLE'/,
    );
  }
  assert.match(sql, /demo series stated in docs\/seed\/tavus-20/);
  // The newest point is asserted last, so newest-first readers list it first.
  const sep = plan.claims.find(
    (c) => c.validFrom === "2026-09-30" && c.key === "financial.mrr",
  );
  const jun = plan.claims.find(
    (c) => c.validFrom === "2026-06-30" && c.key === "financial.mrr",
  );
  assert.equal(sep.assertOffsetSeconds, 0);
  assert.equal(jun.assertOffsetSeconds, 3);
  assert.match(renderFiguresPlan([plan]), /2 metrics, 8 claims/);
});

test("idempotent: a re-run with the seed's own rows plans nothing", () => {
  const first = planCompanyFigures(entry, fictional(), tavusFigures(tavus));
  const again = planCompanyFigures(
    entry,
    fictional({
      claims: first.claims.map((c) => ({ id: c.id, claim_key: c.key })),
    }),
    tavusFigures(tavus),
  );
  assert.equal(again.claims.length, 0);
  assert.equal(
    renderFiguresSql(again, { authorityUserId: OWNER, now: NOW }),
    null,
  );
});

test("an already-published figure for the same date: equal is kept, different is reported and never overwritten", () => {
  const published = (amount) => ({
    id: "00000000-0000-4000-8000-000000000099",
    claim_key: "financial.mrr",
    structured_value: {
      kind: "MONEY",
      amount,
      currency: "NGN",
      asOf: "2026-09-30",
    },
    valid_from: "2026-09-30T00:00:00+00:00",
    visibility_scope: "network_visible",
    lifecycle_status: "CURRENT",
  });
  const same = planCompanyFigures(
    entry,
    fictional({ claims: [published("38000000")] }),
    tavusFigures(tavus),
  );
  assert.equal(same.claims.length, 7);
  assert.ok(
    same.notes.some((n) => /already published with the same value/.test(n)),
  );
  const differs = planCompanyFigures(
    entry,
    fictional({ claims: [published("40000000")] }),
    tavusFigures(tavus),
  );
  assert.equal(differs.claims.length, 7);
  assert.ok(
    differs.notes.some((n) => /NOT published financial.mrr 2026-09-30/.test(n)),
  );
});

test("warns when published figures would exceed what read_company_figures reads", () => {
  const many = Array.from({ length: READ_FIGURES_MAX }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    claim_key: `traction.other_${i}`,
    visibility_scope: "network_visible",
    lifecycle_status: "CURRENT",
  }));
  const plan = planCompanyFigures(
    entry,
    fictional({ claims: many }),
    tavusFigures(tavus),
  );
  assert.ok(plan.notes.some((n) => /^WARNING/.test(n)));
});

test("SQL needs an approving owner", () => {
  const plan = planCompanyFigures(entry, fictional(), tavusFigures(tavus));
  assert.throws(() =>
    renderFiguresSql(plan, { authorityUserId: "", now: NOW }),
  );
});

test("every tavus-20 company's latest published value is the source's own latest point", () => {
  const all = JSON.parse(
    readFileSync(
      new URL("../../docs/seed/tavus-20/companies-full.json", import.meta.url),
      "utf8",
    ),
  );
  for (const company of all) {
    const latest = company.metrics.points.at(-1);
    for (const figure of tavusFigures(company).figures) {
      const last = figure.points.at(-1);
      assert.equal(
        last.period,
        latest.period,
        `${company.company} ${figure.key}`,
      );
      assert.ok(figure.points.length === 1 || figure.points.length >= 3);
      assert.ok(figure.points.length <= 6);
    }
  }
});
