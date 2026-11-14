import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import { ApplicationIdSchema } from "../src/contracts/index.js";
import type {
  ApplicationStatement,
  DisagreementEvent,
  StatementLink,
  TurnReading,
} from "../src/contracts/statements.js";
import {
  createPostgresApplicationFactRepository,
  createPostgresApplicationStatementRepository,
} from "../src/infrastructure/postgres-intake-repositories.js";
import { projectView } from "../src/application/statement-view.js";

/**
 * Real local PostgreSQL (`pnpm test:integration`, run in the gate): the
 * statement repository against migration 20261231540000, and the slice 2
 * atomicity promise. A fault after the statements are inserted and before
 * Q's turn leaves no statement, link, event, reading or fact behind.
 * Everything runs in one transaction that is rolled back (the tables are
 * append-only, so nothing could be cleaned up after a commit).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

async function world(tx: TransactionContext) {
  const { sql } = tx;
  const auth = randomUUID();
  await sql`insert into auth.users (id, email) values (${auth}, ${`gateq-${auth}@example.invalid`})`;
  const [profile] = await sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  const user = profile?.id ?? "";
  const tenant = randomUUID();
  const org = randomUUID();
  const investor = randomUUID();
  const gateway = randomUUID();
  const version = randomUUID();
  const application = randomUUID();
  const suffix = randomUUID().replace(/-/gu, "").slice(0, 8);
  await sql`insert into identity.tenants (id, name) values (${tenant}, 'Synthetic GateQ Tenant')`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${org}, ${tenant}, 'investment_firm', 'Synthetic Fund', ${`gq-fund-${suffix}`})`;
  await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
  await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (${investor}, ${tenant}, ${org}, 'VC', 'Synthetic Fund')`;
  await sql`insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id)
    values (${gateway}, ${tenant}, ${investor}, ${org}, ${`gq_23456789abcdefghjk${suffix.replace(/[^a-z2-9]/gu, "m")}`.slice(0, 31)}, 'Statement programme', ${user})`;
  await sql`insert into gateq.gateway_versions
    (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
     created_by_user_id, published_by_user_id, published_at)
    values (${version}, ${gateway}, ${tenant}, 1, 'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech',
            'gateq-qualification.v1', ${user}, ${user}, now())`;
  await sql`insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference)
    values (${application}, ${tenant}, ${gateway}, ${version}, ${`ga_23456789abcdefghjk${suffix.replace(/[^a-z2-9]/gu, "m")}`.slice(0, 31)})`;
  const personTurn = randomUUID();
  await sql`insert into gateq.application_turns (id, application_id, tenant_id, seq, role, text, client_turn_id)
    values (${personTurn}, ${application}, ${tenant}, 1, 'PERSON', 'About 600 weekly active; actually 1,500.', 'turn-int-0001')`;
  return { tenant, application: ApplicationIdSchema.parse(application), personTurn };
}

function rows(applicationId: string, turnId: string) {
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, 0, ms)).toISOString();
  const s = (id: string, count: string, ms: number): ApplicationStatement => ({
    id: id as ApplicationStatement["id"],
    applicationId: applicationId as ApplicationStatement["applicationId"],
    dimension: "claims.traction",
    quantity: "weekly_active_users",
    value: { kind: "COUNT", count },
    asOf: "2026-11-01",
    words: `${count} weekly active`,
    provenance: "APPLICANT_PROVIDED",
    origin: "TURN",
    sourceTurnId: turnId as ApplicationStatement["sourceTurnId"],
    backfillKey: null,
    statedAt: at(ms),
    recordedAt: at(ms),
  });
  const older = s(randomUUID(), "600", 1);
  const newer = s(randomUUID(), "1500", 2);
  const link: StatementLink = {
    id: randomUUID() as StatementLink["id"],
    applicationId: older.applicationId,
    kind: "DISAGREES",
    fromStatementId: newer.id,
    toStatementId: older.id,
    origin: "CODE_DETECTED",
    sourceTurnId: older.sourceTurnId,
    createdAt: at(3),
  };
  const event: DisagreementEvent = {
    id: randomUUID() as DisagreementEvent["id"],
    applicationId: older.applicationId,
    linkId: link.id,
    state: "LEFT_OPEN",
    resolvedByStatementId: null,
    sourceTurnId: older.sourceTurnId,
    recordedAt: at(4),
  };
  const reading: TurnReading = {
    id: randomUUID() as TurnReading["id"],
    applicationId: older.applicationId,
    turnId: turnId as TurnReading["turnId"],
    outcome: "READ",
    recordedStatementIds: [older.id, newer.id],
    notRecorded: [],
    readingVersion: 2,
    recordedAt: at(5),
  };
  return { statements: [older, newer], links: [link], events: [event], readings: [reading] };
}

describe("gateq statements against local Supabase Postgres", () => {
  let db: RequestDatabase;
  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  const count = async (tx: TransactionContext, table: string, applicationId: string) => {
    const [row] = await tx.sql<{ n: number }[]>`
      select (case ${table}
        when 'application_statements' then (select count(*) from gateq.application_statements where application_id = ${applicationId})
        when 'application_statement_links' then (select count(*) from gateq.application_statement_links where application_id = ${applicationId})
        when 'application_disagreement_events' then (select count(*) from gateq.application_disagreement_events where application_id = ${applicationId})
        when 'application_turn_readings' then (select count(*) from gateq.application_turn_readings where application_id = ${applicationId})
        when 'application_facts' then (select count(*) from gateq.application_facts where application_id = ${applicationId})
      end)::int as n`;
    return row?.n ?? -1;
  };

  it("writes nothing when the turn fails after its statements, and round-trips them when it does not", async () => {
    let completed = false;
    await db.transactions
      .run(async (tx) => {
        const { tenant, application, personTurn } = await world(tx);
        const statements = createPostgresApplicationStatementRepository({ sql: tx.sql });
        const facts = createPostgresApplicationFactRepository({ sql: tx.sql });
        const planned = rows(application, personTurn);
        const tables = [
          "application_statements",
          "application_statement_links",
          "application_disagreement_events",
          "application_turn_readings",
          "application_facts",
        ];

        // The fault: statements, links, events, readings and the legacy
        // projection are in; the Q turn insert fails. The turn's own
        // transaction is a savepoint here, inside the rolled-back world.
        await tx.sql`savepoint turn_write`;
        await statements.appendInTransaction(tx, { applicationId: application, tenantId: tenant, ...planned });
        await facts.record(tx, {
          applicationId: application,
          tenantId: tenant,
          facts: [{ dimension: "claims.traction", value: { kind: "TEXT", text: "600 weekly active\n1500 weekly active" }, provenance: "APPLICANT_PROVIDED" }],
          at: new Date().toISOString(),
        });
        expect(await count(tx, "application_statements", application)).toBe(2);
        await tx.sql`rollback to savepoint turn_write`;
        for (const table of tables) expect(await count(tx, table, application), table).toBe(0);

        // The retry writes the same checkpointed rows.
        await statements.appendInTransaction(tx, { applicationId: application, tenantId: tenant, ...planned });
        const back = await statements.listFor(application);
        expect(back.statements.map((s) => s.id)).toEqual(planned.statements.map((s) => s.id));
        expect(back.statements[1]?.value).toEqual({ kind: "COUNT", count: "1500" });
        expect(back.statements[0]?.asOf).toBe("2026-11-01");
        expect(back.readTurnIds).toEqual([personTurn]);
        const view = projectView(back.statements, back.links, back.events);
        expect(view.dimensions.find((d) => d.dimension === "claims.traction")?.status).toBe(
          "DISAGREEMENT_LEFT_OPEN",
        );
        // Append-only: a second reading of the turn is refused.
        await tx.sql`savepoint again`;
        await expect(
          statements.appendInTransaction(tx, {
            applicationId: application,
            tenantId: tenant,
            statements: [],
            links: [],
            events: [],
            readings: planned.readings.map((r) => ({ ...r, id: randomUUID() as TurnReading["id"] })),
          }),
        ).rejects.toThrow();
        await tx.sql`rollback to savepoint again`;
        completed = true;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(completed).toBe(true);
  });
});
