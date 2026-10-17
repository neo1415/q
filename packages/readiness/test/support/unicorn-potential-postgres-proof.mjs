/**
 * Focused REAL PostgreSQL test, using the real Unicorn migration/store but
 * minimal canonical parent shapes. This does not certify the full Supabase
 * schema, its migrations, RLS fixture matrix or protected CI.
 *
 * From the repository root, with local PostgreSQL binaries on PATH:
 *   createdb -h127.0.0.1 -p55439 -Uagent cq_unicorn_potential_proof
 *   psql -h127.0.0.1 -p55439 -Uagent -d cq_unicorn_potential_proof -vON_ERROR_STOP=1 \
 *     -f packages/readiness/test/support/unicorn-potential-bootstrap.sql \
 *     -f supabase/migrations/20261228200000_unicorn_potential.sql
 *   node node_modules/typescript/bin/tsc -p packages/readiness/tsconfig.json
 *   node packages/readiness/test/support/unicorn-potential-postgres-proof.mjs
 *   psql -h127.0.0.1 -p55439 -Uagent -d cq_unicorn_potential_proof -vON_ERROR_STOP=1 \
 *     -c 'create extension pgtap with schema extensions' \
 *     -f packages/readiness/test/support/unicorn-potential-focused-pgtap.sql
 *
 * Recreate the dedicated database to repeat. No hosted target is accepted.
 * Full 130_schema_guard + 981_unicorn_potential remain mandatory in CI.
 */
import assert from "node:assert/strict";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createPrivilegedDatabaseClient } from "@capital-q/database/privileged";
import { createPostgresUnicornPotentialStore } from "../../dist/unicorn-potential/postgres.js";
const databaseUrl =
  process.env["CQ_UNICORN_PROOF_DATABASE_URL"] ??
  "postgresql://agent@127.0.0.1:55439/cq_unicorn_potential_proof";
const target = new URL(databaseUrl);
if (
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/cq_unicorn_potential_proof"
)
  throw Error("Only the dedicated disposable local proof database is accepted");
const db = createPrivilegedDatabaseClient(
  parseDatabaseConfig({
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "local",
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: "16",
    DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
    DATABASE_STATEMENT_TIMEOUT_MS: "10000",
  }),
);
const sql = db.sql;
const store = createPostgresUnicornPotentialStore({
  sql,
  transactions: db.transactions,
});
try {
  const company = "10000000-0000-4000-8000-000000000004",
    tenant = "10000000-0000-4000-8000-000000000001",
    organisation = "10000000-0000-4000-8000-000000000002",
    claim = "10000000-0000-4000-8000-000000000010",
    founder = "10000000-0000-4000-8000-000000000011";
  const method = "unicorn-potential.v1.0.0",
    at = "2026-10-17T00:00:00.000Z";
  await sql`insert into evidence.claims values(${claim}::uuid,${tenant}::uuid,${company}::uuid,'COMPANY','network_visible','CURRENT',${at}::timestamptz)`;
  const source = {
    id: claim,
    revision: at,
    at,
    kind: "CLAIM",
    label: "Dated founder claim",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    visibilityScope: "network_visible",
    lifecycleStatus: "CURRENT",
  };
  const view = {
    status: "SCORED",
    overallScore: 75,
    band: "STRONG_SIGNALS",
    confidence: "LOW",
    coverage: 1,
    stage: "SEED",
    methodVersion: method,
    inputRulesVersion: "inputs.v1",
    pillars: Array.from({ length: 12 }, (_, i) => ({
      id: `P${i + 1}`,
      label: `Pillar ${i + 1}`,
      weight: 100 / 12,
      grade: 3,
      contribution: 75 / 12,
      coverage: 1,
      criteria: ["A", "B"].map((id) => ({
        id,
        label: `Criterion ${id}`,
        state: "OBSERVED",
        grade: 3,
        anchor: "Observed grade",
        sources: [source],
      })),
    })),
    up: [],
    down: [],
    missing: [],
    benchmark: "Comparable benchmark unavailable",
  };
  const input = (hash, patch = {}) => ({
    subject: {
      companyId: company,
      tenantId: tenant,
      organisationId: organisation,
    },
    methodVersion: method,
    basisHash: hash.repeat(64),
    cohortKey: "seed:fintech:geographyUNKNOWN",
    view,
    observations: [{ source }],
    ...patch,
  });
  const proof = [];
  const a = await Promise.all(
    Array.from({ length: 16 }, () => store.record(input("a"))),
  );
  assert.equal(a.filter((r) => r.created).length, 1);
  assert(a.every((r) => r.revision === 1));
  proof.push("16 concurrent identical retries: exactly revision1");
  const b = await Promise.all(
    Array.from({ length: 16 }, () => store.record(input("b"))),
  );
  assert.equal(b.filter((r) => r.created).length, 1);
  assert(b.every((r) => r.revision === 2));
  assert.deepEqual(await store.record(input("a")), {
    revision: 3,
    created: true,
  });
  proof.push("A→B→A retains3 immutable revisions");
  const rollbackStore = createPostgresUnicornPotentialStore({
    sql,
    transactions: {
      run: (work) =>
        db.transactions.run(async (tx) => {
          await work(tx);
          throw Error("forced rollback");
        }),
    },
  });
  await assert.rejects(rollbackStore.record(input("c")), /forced rollback/);
  assert.equal((await store.history(company, method)).length, 3);
  proof.push("forced transaction failure rolls back revision4");
  await assert.rejects(
    store.record(
      input("d", {
        subject: {
          companyId: company,
          tenantId: tenant,
          organisationId: "10000000-0000-4000-8000-000000000003",
        },
      }),
    ),
    /subject mismatch/,
  );
  proof.push("false organisation rejected");
  assert.equal(
    (await store.current([company], method)).get(company)?.overallScore,
    75,
  );
  await sql`update evidence.claims set visibility_scope='founder_private' where id=${claim}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  assert.equal((await store.history(company, method)).length, 0);
  proof.push("claim privacy revoked: current and history omitted immediately");
  await sql`update evidence.claims set visibility_scope='network_visible',lifecycle_status='SUPERSEDED' where id=${claim}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  proof.push("superseded claim withheld");
  await sql`update evidence.claims set lifecycle_status='CURRENT' where id=${claim}::uuid`;
  assert.equal((await store.current([company], method)).size, 1);
  await sql`update evidence.claims set asserted_at=now() where id=${claim}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  proof.push("changed claim revision invalidates old snapshot");
  await sql`update evidence.claims set asserted_at=${at}::timestamptz where id=${claim}::uuid`;
  const sourceF = {
    ...source,
    id: founder,
    kind: "FOUNDER_BACKGROUND",
    revision: "undated",
    at: null,
    label: "Founder background",
  };
  await sql`insert into core.founder_background_entries values(${founder}::uuid,${founder}::uuid,${tenant}::uuid,'network_visible')`;
  await sql`insert into core.company_members values(${founder}::uuid,${tenant}::uuid,${company}::uuid,true,true)`;
  await store.record(input("f", { observations: [{ source: sourceF }] }));
  assert.equal((await store.current([company], method)).size, 1);
  await sql`update core.company_members set is_current=false where user_id=${founder}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  proof.push("founder membership revocation withholds snapshot");
  await sql`update core.company_members set is_current=true where user_id=${founder}::uuid`;
  const document = "10000000-0000-4000-8000-000000000020",
    version = "10000000-0000-4000-8000-000000000021",
    extraction = "10000000-0000-4000-8000-000000000022";
  await sql`insert into evidence.document_versions values(${version}::uuid,${tenant}::uuid,'CLEAN')`;
  await sql`insert into evidence.documents values(${document}::uuid,${company}::uuid,${tenant}::uuid,${version}::uuid,'ORGANISATION','PITCH_DECK','ACTIVE','INVESTORS')`;
  await sql`insert into evidence.deck_extractions values(${extraction}::uuid,${document}::uuid,${company}::uuid,${version}::uuid,${at}::timestamptz)`;
  const sourceD = {
    ...source,
    id: `${extraction}:MARKET:0`,
    kind: "DECK_SECTION",
  };
  await store.record(input("d", { observations: [{ source: sourceD }] }));
  assert.equal((await store.current([company], method)).size, 1);
  await sql`update evidence.documents set download_audience='ORGANISATION' where id=${document}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  proof.push("deck download revocation immediately withholds score");
  await sql`insert into evidence.data_room_entries values(${document}::uuid,'PUBLIC')`;
  assert.equal((await store.current([company], method)).size, 1);
  await sql`insert into evidence.deck_section_reviews values(${extraction}::uuid,'MARKET','DISMISS',now())`;
  assert.equal((await store.current([company], method)).size, 0);
  proof.push("deck latest section dismissal withholds score");
  await store.record(input("1"));
  await store.record(
    input("2", {
      cohortKey: "pre-seed:fintech:geographyUNKNOWN",
      view: { ...view, stage: "PRE_SEED" },
    }),
  );
  await store.record(input("3"));
  assert.equal(
    (await store.current([company], method)).get(company)?.momentum,
    null,
  );
  proof.push("cohort change away/back does not skip intervening snapshot");
  await store.record(input("4", { view: { ...view, overallScore: 76 } }));
  assert.equal(
    (await store.current([company], method)).get(company)?.momentum?.delta,
    1,
  );
  proof.push("comparable immediate prior snapshot yields dated +1 momentum");
  const [corrected] =
    await sql`update evidence.claims set asserted_at=now() where id=${claim}::uuid returning asserted_at`;
  const correctedSource = {
    ...source,
    revision: corrected.asserted_at.toISOString(),
    at: corrected.asserted_at.toISOString(),
  };
  const correctedView = {
    ...view,
    overallScore: 80,
    band: "EXCEPTIONAL_SIGNALS",
    pillars: view.pillars.map((pillar) => ({
      ...pillar,
      criteria: pillar.criteria.map((criterion) => ({
        ...criterion,
        sources: [correctedSource],
      })),
    })),
  };
  await store.record(
    input("5", {
      view: correctedView,
      observations: [{ source: correctedSource }],
    }),
  );
  const correctedCurrent = (await store.current([company], method)).get(
    company,
  );
  assert.equal(correctedCurrent?.momentum?.delta, 4);
  assert((await store.history(company, method)).length >= 2);
  proof.push(
    "public claim correction preserves authorized historical revisions and +4 momentum",
  );
  await sql`update evidence.claims set visibility_scope='founder_private' where id=${claim}::uuid`;
  assert.equal((await store.current([company], method)).size, 0);
  assert.equal((await store.history(company, method)).length, 0);
  proof.push(
    "privacy revocation after correction withholds both current and all historical sources",
  );
  console.log(
    JSON.stringify(
      { postgres: "17.11", checks: proof, status: "PASS" },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
