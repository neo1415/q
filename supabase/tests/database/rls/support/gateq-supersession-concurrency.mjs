/**
 * Actual PostgreSQL integration proof for the existing GateQ repositories.
 * Build package dist first. Run ONLY against a disposable local PostgreSQL
 * database named cq_gateq_supersession_test, with the reviewed migrations and
 * the synthetic dd31 application / tenant_b fixture seeded and committed.
 * The fixture must have no facts or turns; create a fresh database to rerun.
 *
 * CQ_GATEQ_CONCURRENCY_URL=postgres://.../cq_gateq_supersession_test \
 *   node supabase/tests/database/rls/support/gateq-supersession-concurrency.mjs
 * This is complementary to 923 pgTAP and never substitutes for protected CI.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const repository = new URL("../../../../../", import.meta.url);
const require = createRequire(
  new URL("packages/database/package.json", repository),
);
const postgres = require("postgres");
const { createTransactionManager } = await import(
  new URL("packages/database/dist/index.js", repository)
);
const {
  createPostgresApplicationFactRepository,
  createPostgresApplicationTurnRepository,
} = await import(new URL("packages/gateq-intake/dist/index.js", repository));
const address = process.env["CQ_GATEQ_CONCURRENCY_URL"];
assert.ok(
  address,
  "Set CQ_GATEQ_CONCURRENCY_URL to the disposable local fixture database",
);
const url = new URL(address);
assert.ok(
  ["localhost", "127.0.0.1", "172.17.0.2"].includes(url.hostname),
  "Only the local test PostgreSQL host is allowed",
);
assert.equal(
  url.pathname,
  "/cq_gateq_supersession_test",
  "Never run this synthetic fixture test against a shared application database",
);
const sql = postgres(address, { max: 12, connect_timeout: 10 });
const transactions = createTransactionManager(sql);
const facts = createPostgresApplicationFactRepository({ sql });
const turns = createPostgresApplicationTurnRepository({ sql, transactions });
const applicationId = "00000000-0000-4000-8000-00000000dd31";
const tenantId = "00000000-0000-4000-8000-0000000000b3";
const outcomes = [];
try {
  assert.equal(
    (await facts.historyFor(applicationId, 100)).length,
    0,
    "Use a fresh disposable fixture database",
  );
  assert.equal(
    (await turns.listFor(applicationId)).length,
    0,
    "Fixture turns must be empty",
  );
  for (const [round, text] of [
    [1, "Original applicant claim"],
    [2, "Corrected applicant claim"],
    [3, "Corrected applicant claim again"],
  ]) {
    const input = {
      applicationId,
      tenantId,
      clientTurnId: `correction-retry-${round}`,
      text,
    };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => turns.claimExchange(input)),
    );
    const winners = results.filter((x) => x.status === "fulfilled");
    assert.equal(winners.length, 1);
    assert.equal(
      results.filter(
        (x) =>
          x.status === "rejected" && x.reason.refusal === "TOO_MANY_REQUESTS",
      ).length,
      7,
    );
    const claimId = winners[0].value;
    assert.ok(claimId);
    await transactions.run(async (tx) => {
      assert.equal(await turns.assertClaim(tx, applicationId, claimId), true);
      await facts.record(tx, {
        applicationId,
        tenantId,
        at: new Date().toISOString(),
        sourceTurnSeq: round * 2 - 1,
        facts: [
          {
            dimension: "company.name",
            value: { kind: "TEXT", text },
            provenance: "APPLICANT_PROVIDED",
          },
        ],
      });
      await turns.appendInTransaction(tx, {
        ...input,
        role: "Q",
        text: `Recorded correction ${round}`,
        intent: "ANSWER",
        askingDimension: "company.name",
      });
      await turns.finishExchange(tx, applicationId, claimId);
    });
    const retries = await Promise.all(
      Array.from({ length: 8 }, () => turns.claimExchange(input)),
    );
    assert.ok(retries.every((x) => x === null));
    assert.equal((await facts.currentFor(applicationId)).length, 1);
    assert.equal((await facts.historyFor(applicationId, 100)).length, round);
    outcomes.push({
      round,
      parallelClaims: 8,
      winners: 1,
      busyRetries: 7,
      completedRetries: 8,
      duplicateFacts: 0,
    });
  }
  const before = await facts.historyFor(applicationId, 100);
  await assert.rejects(
    transactions.run(async (tx) => {
      await facts.record(tx, {
        applicationId,
        tenantId,
        at: new Date().toISOString(),
        sourceTurnSeq: 7,
        facts: [
          {
            dimension: "company.name",
            value: { kind: "TEXT", text: "Must rollback" },
            provenance: "APPLICANT_PROVIDED",
          },
        ],
      });
      throw new Error("Intentional enclosing transaction failure");
    }),
    /Intentional enclosing/,
  );
  assert.deepEqual(await facts.historyFor(applicationId, 100), before);
  assert.equal((await turns.listFor(applicationId)).length, 6);
  console.log(
    JSON.stringify({
      passed: true,
      actualRepository: true,
      postgresVersion: 17,
      rounds: outcomes,
      rollbackHistoryUnchanged: true,
      personAndQTurns: 6,
    }),
  );
} finally {
  await sql.end();
}
