// node --test scripts/seed/real-companies/plan.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  claimsFor,
  evidenceStatusFor,
  lit,
  planCompany,
  renderCompanySql,
  seedUuid,
  stageCode,
  TAXONOMY,
} from "./plan.mjs";

const companies = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/seed/real-companies/companies.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const nodeIds = new Proxy(
  {},
  { get: (_t, k) => (typeof k === "string" ? seedUuid("node", k) : undefined) },
);
const plan = (c) =>
  planCompany(c, {
    nodeIds,
    authorityUserId: seedUuid("owner"),
    now: "2026-10-06T00:00:00.000Z",
  });

test("ids are deterministic, so a re-run targets the same rows", () => {
  assert.equal(seedUuid("Duplo", "company"), seedUuid("Duplo", "company"));
  assert.notEqual(seedUuid("Duplo", "company"), seedUuid("Bumpa", "company"));
  assert.match(
    seedUuid("x"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("no claim is ever VERIFIED or externally/platform verified", () => {
  for (const c of companies) {
    for (const cl of claimsFor(c)) {
      assert.notEqual(cl.truthClass, "VERIFIED");
      assert.ok(
        !["EXTERNALLY_VERIFIED", "PLATFORM_VERIFIED"].includes(
          cl.evidenceStatus,
        ),
        `${c.name} ${cl.key}`,
      );
      assert.ok(cl.urls.length > 0, `${c.name} ${cl.key} has a source`);
    }
    const sql = renderCompanySql(plan(c));
    assert.ok(
      !/'VERIFIED'|EXTERNALLY_VERIFIED|PLATFORM_VERIFIED/.test(sql),
      c.name,
    );
  }
});

test("company-reported metrics stay self-reported however many outlets repeat them", () => {
  const anchor = companies.find((c) => c.name === "Anchor");
  const metric = claimsFor(anchor).find((cl) => cl.key.startsWith("traction."));
  assert.equal(metric.evidenceStatus, "SELF_REPORTED");
  assert.equal(metric.truthClass, "USER_CLAIM");
});

test("evidence status counts only sources independent of the company", () => {
  const c = { name: "Duplo", website: "https://www.duplo.co" };
  assert.equal(evidenceStatusFor(["https://www.duplo.co"], c), "SELF_REPORTED");
  assert.equal(
    evidenceStatusFor(
      ["https://www.duplo.co", "https://techcabal.com/2022/01/01/x/"],
      c,
    ),
    "DOCUMENT_SUPPORTED",
  );
  assert.equal(
    evidenceStatusFor(
      [
        "https://techcabal.com/2022/01/01/x/",
        "https://techpoint.africa/2022/01/01/y/",
      ],
      c,
    ),
    "MULTI_SOURCE_SUPPORTED",
  );
});

test("unknown stays unknown: no stage outside the vocabulary, no invented city or year", () => {
  assert.equal(stageCode("pre-series_a"), null);
  assert.equal(stageCode(null), null);
  const moneyhash = plan(companies.find((c) => c.name === "MoneyHash"));
  assert.equal(moneyhash.company.city, null);
  assert.equal(moneyhash.company.foundedDate, null);
  assert.equal(moneyhash.company.stage, null);
  assert.equal(
    plan(companies.find((c) => c.name === "ekko")).company.stage,
    null,
  );
});

test("an unclaimed public profile: network visible, not Discover-ready, no members, no logo", () => {
  for (const c of companies) {
    const sql = renderCompanySql(plan(c));
    assert.match(sql, /'network_visible', 'not_assessed'/);
    assert.ok(
      !/organisation_memberships|company_members|founder_profiles|media_assets/.test(
        sql,
      ),
      c.name,
    );
    assert.match(sql, /, null, ('[a-z_]+'|null)\);\ninsert into audit/); // logo_storage_key null
    assert.ok(sql.startsWith("begin;") && sql.endsWith("commit;"));
  }
});

test("public profile text carries no internal research notes", () => {
  for (const c of companies) {
    for (const t of [c.short_description, c.long_description]) {
      assert.ok(
        !/left null|not verified|confirm before|mandate|assumption/i.test(
          t ?? "",
        ),
        c.name,
      );
    }
  }
});

test("every company has curated taxonomy across the four vocabularies", () => {
  for (const c of companies) {
    const t = TAXONOMY[c.name];
    assert.ok(t, c.name);
    for (const v of [
      "industry",
      "business_model",
      "customer_type",
      "geography",
    ])
      assert.ok(t[v]?.length, `${c.name} ${v}`);
  }
});

test("literals are quoted safely", () => {
  assert.equal(lit("O'Brien"), "'O''Brien'");
  assert.equal(lit(null), "null");
  assert.throws(() => lit(Number.NaN));
});
