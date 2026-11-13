// node --test scripts/seed/demo-activate-plan.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildManifest,
  DEMO_DEFAULT_STAGE,
  resolveStage,
  STAGE_CODES,
  NOTE,
  personRefusal,
  planCompany,
  STEP,
  summarise,
} from "./demo-activate-plan.mjs";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const FOUNDER = "00000000-0000-4000-8000-0000000000b1";
const FOUNDER_AUTH = "00000000-0000-4000-8000-0000000000c1";
const now = new Date("2026-11-13T12:00:00Z");

const person = (over = {}) => ({
  profileId: FOUNDER,
  authUserId: FOUNDER_AUTH,
  email: "founder.example@fictional.capitalq.local",
  appSynthetic: true,
  userFictionalDemo: true,
  current: true,
  counted: true,
  isFounder: true,
  ...over,
});
const claim = (type, status, over = {}) => ({
  claim_type: type,
  subject_id: type === "ORGANISATION" ? ORG : FOUNDER,
  status,
  expires_at: null,
  revoked_at: null,
  requester_auth_user_id: FOUNDER_AUTH,
  ...over,
});
const snapshot = (over = {}) => ({
  company: {
    id: "c1",
    canonical_name: "Example (fictional)",
    organisation_id: ORG,
    demonstration_data: false,
    company_status: "active",
    marketplace_visibility: "network_visible",
    marketplace_readiness_state: "marketplace_ready",
    current_stage_code: "seed",
    headquarters_country: "NG",
    short_description: "A fictional company.",
    primary_description: null,
    ...over.company,
  },
  people: over.people ?? [person()],
  claims: over.claims ?? [
    claim("FOUNDER_IDENTITY", "VERIFIED"),
    claim("ORGANISATION", "VERIFIED"),
  ],
});
const entry = { companyId: "c1", name: "Example" };
const plan = (snap, e = entry) => planCompany(e, snap, { now });
const kinds = (p) => p.steps.map((s) => s.kind);

test("a ready, marked company plans nothing (a re-run after success is a no-op)", () => {
  const p = plan(snapshot());
  assert.equal(p.refused, undefined);
  assert.deepEqual(p.steps, []);
  assert.deepEqual(p.notes, []);
  assert.equal(summarise([p]).nothingToDo, 1);
});

test("real demonstration companies and manifest holds are refused", () => {
  assert.ok(plan(snapshot({ company: { demonstration_data: true } })).refused);
  assert.ok(plan(snapshot(), { ...entry, hold: "owner decision" }).refused);
  assert.deepEqual(plan(null).refused, ["company not found"]);
});

test("any genuine person, in any status, refuses the whole company", () => {
  const genuine = person({
    profileId: "p2",
    authUserId: "a2",
    email: "someone@example.com",
    current: false,
    counted: false,
    isFounder: false,
  });
  const p = plan(snapshot({ people: [person(), genuine] }));
  assert.ok(p.refused.some((r) => r.includes("someone@example.com")));
  assert.deepEqual(p.steps, []);
});

test("owner seed aliases count only with the seed's fictional_demo marker", () => {
  const alias = "adedaniel502+cq-tobenna-ledgerline@gmail.com";
  assert.equal(personRefusal({ email: alias, userFictionalDemo: true }), null);
  assert.match(
    personRefusal({ email: alias, userFictionalDemo: false }),
    /alias/,
  );
  assert.match(
    personRefusal({ email: "adedaniel502@gmail.com", userFictionalDemo: true }),
    /not a fictional account/,
  );
  assert.match(
    personRefusal({ email: "x@fictional.capitalq.local.evil.com" }),
    /not a fictional account/,
  );
});

test("unmarked people are marked; pending claims wait for the sweep, no assess yet", () => {
  const p = plan(
    snapshot({
      company: { marketplace_readiness_state: "not_assessed" },
      people: [person({ appSynthetic: false })],
      claims: [
        claim("FOUNDER_IDENTITY", "PENDING"),
        claim("ORGANISATION", "PENDING"),
      ],
    }),
  );
  assert.deepEqual(kinds(p), [STEP.MARK_SYNTHETIC]);
  assert.equal(p.notes.filter((n) => n.kind === NOTE.AWAITING_SWEEP).length, 2);
});

test("verified but not assessed plans exactly one assess", () => {
  const p = plan(
    snapshot({ company: { marketplace_readiness_state: "not_assessed" } }),
  );
  assert.deepEqual(kinds(p), [STEP.ASSESS]);
});

test("a missing stage is set from the manifest, labelled when demo activation chose it", () => {
  const missing = {
    company: {
      current_stage_code: null,
      marketplace_readiness_state: "requirements_outstanding",
    },
  };
  const stated = plan(snapshot(missing), {
    ...entry,
    stage: "pre_seed",
    stageSource: "world",
  });
  assert.deepEqual(kinds(stated), [STEP.SET_STAGE, STEP.ASSESS]);
  assert.equal(stated.steps[0].value, "pre_seed");
  assert.match(stated.steps[0].reason, /world defines pre_seed/);

  const chosen = plan(snapshot(missing), {
    ...entry,
    stage: "seed",
    stageSource: "demo-default",
  });
  assert.deepEqual(kinds(chosen), [STEP.SET_STAGE, STEP.ASSESS]);
  assert.match(
    chosen.steps[0].reason,
    /chosen by demo activation \(demo-default\), not stated by anyone/,
  );

  // A code outside the vocabulary is never written.
  const invalid = plan(snapshot(missing), { ...entry, stage: "pre-series_a" });
  assert.deepEqual(kinds(invalid), []);
  assert.equal(invalid.notes[0].kind, NOTE.NEEDS_VALUE);
});

const BANDS = {
  raiseUsd: {
    pre_seed: [120_000, 1_200_000],
    seed: [500_000, 4_500_000],
    series_a: [3_000_000, 16_000_000],
  },
  teamSize: { pre_seed: [2, 7], seed: [4, 22], series_a: [15, 70] },
};

test("resolveStage: a stated code wins and keeps its source", () => {
  assert.deepEqual(resolveStage({ declared: "series_a", source: "world x" }), {
    stage: "series_a",
    stageSource: "world x",
  });
});

test("resolveStage: recognisable wording is mapped and labelled demo-mapped", () => {
  for (const raw of ["pre-series_a", "Pre-Series A", "pre_series_a"]) {
    const r = resolveStage({ declared: null, source: "seed s", raw });
    assert.equal(r.stage, "seed");
    assert.match(r.stageSource, /^demo-mapped:/);
    assert.match(r.stageRule, /demo activation maps it to seed/);
  }
});

test("resolveStage: world bands derive the earliest matching stage, deterministically", () => {
  const derive = (targetUsd, teamSize) =>
    resolveStage({
      declared: null,
      source: "w",
      raw: "unsure",
      signal: { targetUsd, teamSize },
      bands: BANDS,
    });
  assert.equal(derive(550_000, 3).stage, "pre_seed");
  assert.equal(derive(564_516, 8).stage, "seed");
  assert.equal(derive(1_900_000, 6).stage, "seed");
  assert.equal(derive(1_900_000, 6).stageSource, "demo-derived:world-bands");
  assert.deepEqual(derive(550_000, 3), derive(550_000, 3));
  // No band holds both figures: the demo default.
  assert.equal(derive(50_000_000, 900).stageSource, "demo-default");
  assert.equal(derive(Number.NaN, 3).stageSource, "demo-default");
});

test("resolveStage: no source and no signal is the demo default, seed", () => {
  const r = resolveStage({ declared: null, source: "s" });
  assert.deepEqual(
    { stage: r.stage, stageSource: r.stageSource },
    { stage: DEMO_DEFAULT_STAGE, stageSource: "demo-default" },
  );
  assert.equal(DEMO_DEFAULT_STAGE, "seed");
});

test("STAGE_CODES equal the stage vocabulary seeded by the taxonomy migration", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260904180000_taxonomy_foundation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const codes = [
    ...sql.matchAll(
      /'[0-9a-f-]{36}', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', '([a-z_]+)', '[^']*', [^\n]*'ACTIVE'/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual([...codes].sort(), [...STAGE_CODES].sort());
});

test("absent claims are requested by the founder; decided ones are left alone", () => {
  const none = plan(
    snapshot({
      company: { marketplace_readiness_state: "not_assessed" },
      claims: [],
    }),
  );
  assert.deepEqual(kinds(none), [STEP.REQUEST_VERIFICATION]);
  assert.deepEqual(none.steps[0].claimTypes, [
    "FOUNDER_IDENTITY",
    "ORGANISATION",
  ]);

  const rejected = plan(
    snapshot({
      company: { marketplace_readiness_state: "requirements_outstanding" },
      claims: [
        claim("FOUNDER_IDENTITY", "REJECTED"),
        claim("ORGANISATION", "VERIFIED", { revoked_at: "2026-11-01" }),
      ],
    }),
  );
  assert.deepEqual(kinds(rejected), []);
  assert.equal(
    rejected.notes.filter((n) => n.kind === NOTE.DECIDED_NOT_VERIFIED).length,
    2,
  );
});

test("visibility is never widened: organisation_private blocks assess", () => {
  const p = plan(
    snapshot({
      company: {
        marketplace_visibility: "organisation_private",
        marketplace_readiness_state: "not_assessed",
      },
    }),
  );
  assert.deepEqual(kinds(p), []);
  assert.equal(p.notes[0].kind, NOTE.VISIBILITY_NOT_CHOSEN);
});

test("a pending claim requested by an unmarked outsider blocks instead of looping", () => {
  const p = plan(
    snapshot({
      company: { marketplace_readiness_state: "not_assessed" },
      claims: [
        claim("FOUNDER_IDENTITY", "PENDING", { requester_auth_user_id: "zz" }),
        claim("ORGANISATION", "VERIFIED"),
      ],
    }),
  );
  assert.deepEqual(kinds(p), []);
  assert.match(p.notes[0].reason, /requester is not a marked member/);
});

test("manifest merges sources by id, resolves every stage and a hold wins", () => {
  const m = buildManifest({
    fictionalBulk: [
      {
        key: "fb1",
        name: "A",
        companyId: "id-a",
        stage: null,
        rawStage: "unsure",
        signal: { targetUsd: 300_000, teamSize: 3 },
      },
    ],
    tavus20: [],
    devWorld: [{ key: "b", name: "B", stage: "seed" }],
    devWorldIds: { b: "id-b" },
    demoCompanies: [
      { key: "a", name: "A", companyId: "id-a" },
      { key: "c", name: "C", companyId: "id-c" },
    ],
    curated: [],
    holds: [{ companyId: "id-b", name: "B", why: "held", hold: "owner" }],
    bands: BANDS,
  });
  assert.equal(m.length, 3);
  const a = m.find((x) => x.companyId === "id-a");
  assert.equal(a.why.length, 2);
  assert.equal(a.stage, "pre_seed");
  assert.equal(a.stageSource, "demo-derived:world-bands");
  const b = m.find((x) => x.companyId === "id-b");
  assert.equal(b.hold, "owner");
  assert.equal(
    b.stageSource,
    "apps/q-api/src/dev/fictional-world/companies.ts b",
  );
  assert.equal(
    m.find((x) => x.companyId === "id-c").stageSource,
    "demo-default",
  );
});

test("the checked-in manifest excludes real demonstration companies and e2e release tests", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../docs/seed/demo-activation-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const names = manifest.companies.map((c) => c.name);
  for (const real of ["Capital Q", "KUUZA AI", "SongScribe AI"])
    assert.ok(!names.includes(real), real);
  assert.ok(
    !names.some((n) => /\(fictional\)$/.test(n) && /^Ledgerline /.test(n)),
  );
  assert.ok(names.includes("LedgerBridge"));
  for (const c of manifest.companies) {
    assert.ok(STAGE_CODES.includes(c.stage), `${c.name} stage ${c.stage}`);
    assert.equal(typeof c.stageSource, "string", c.name);
    if (c.stageSource.startsWith("demo-")) assert.ok(c.stageRule, c.name);
  }
  assert.equal(
    new Set(manifest.companies.map((c) => c.companyId)).size,
    names.length,
  );
});
