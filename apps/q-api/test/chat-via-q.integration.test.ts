import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createChatService,
  createPostgresChatStore,
  type ChatService,
} from "@capital-q/communication";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { CorrelationIdSchema } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "@capital-q/app-actions";

/**
 * Recovery D-07 against PostgreSQL: Q's send through the app action
 * `chat.message.send` -- the path approved cards and instruction sends
 * take -- writes a `communication.messages` row carrying Q's marker, and
 * the other side reads it as sent by Q (viaQ). The person's own screen
 * send carries none. Messages are append-only; this leaves its rows.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("chat.message.send marks Q's sends, in the database (D-07)", () => {
  let db: RequestDatabase;
  let chat: ChatService;
  let founder: ActorContext;
  let investor: ActorContext;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
  };

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    const users: string[] = [];
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [tenant, org, type] of [
        [ids.tenantCo, ids.orgCo, "company"],
        [ids.tenantInv, ids.orgInv, "investment_firm"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`ViaQ ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`ViaQ ${type}`}, ${`viaq-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@viaq.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined) {
          throw new Error("profile trigger did not run");
        }
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'ViaQ Co', ${`viaq-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'ViaQ Capital')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
    });
    const actor = (userId: string, tenantId: string, organisationId: string) =>
      ({
        userId,
        tenantId,
        organisationId,
        membershipId: randomUUID(),
        actorType: "HUMAN",
      }) as ActorContext;
    founder = actor(users[0] ?? "", ids.tenantCo, ids.orgCo);
    investor = actor(users[1] ?? "", ids.tenantInv, ids.orgInv);
    chat = createChatService({
      store: createPostgresChatStore({
        sql: db.sql,
        transactions: db.transactions,
        outbox: { enqueue: () => Promise.resolve() },
      }),
      parties: (who, relationshipId) =>
        Promise.resolve(
          relationshipId !== ids.relationship
            ? null
            : who.organisationId === ids.orgCo
              ? { side: "COMPANY", connected: true }
              : who.organisationId === ids.orgInv
                ? { side: "INVESTOR", connected: true }
                : null,
        ),
      documents: () => Promise.resolve({ outcome: "NOT_FOUND" as const }),
      downloads: () => Promise.reject(new Error("no downloads here")),
      newCorrelationId: () => `cor_${randomUUID()}`,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const send = async (
    context: {
      readonly surface: "Q" | "SCREEN";
      readonly qActionId?: string;
      readonly qDelegationId?: string;
    },
    key: string,
    body: string,
  ) => {
    const action = APP_ACTIONS.find((one) => one.name === "chat.message.send");
    if (action === undefined) throw new Error("no chat.message.send");
    const ports = { chat } as AppActionPorts;
    await action.run(
      ports,
      {
        actor: founder,
        idempotencyKey: key,
        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        ...context,
      },
      {
        relationshipId: ids.relationship,
        idempotencyKey: key,
        input: { kind: "TEXT", body },
      },
    );
  };

  it("an approved card's send: a row with its action id, read by the other side as sent by Q", async () => {
    const qActionId = randomUUID();
    await send({ surface: "Q", qActionId }, "viaq-card-0001", "From Q's card.");
    const [row] = await db.sql<
      {
        q_action_id: string | null;
        q_delegation_id: string | null;
        body: string;
      }[]
    >`select q_action_id, q_delegation_id, body from communication.messages
       where idempotency_key = 'viaq-card-0001' and sender_user_id = ${founder.userId}`;
    expect(row).toEqual({
      q_action_id: qActionId,
      q_delegation_id: null,
      body: "From Q's card.",
    });
    const read = await chat.readForQ({
      actor: investor,
      relationshipId: ids.relationship,
    });
    expect(
      read.messages.find((message) => message.text === "From Q's card.")?.viaQ,
    ).toBe(true);
  });

  it("a delegated or instruction send: a row with the delegation id", async () => {
    const qDelegationId = randomUUID();
    await send(
      { surface: "Q", qDelegationId },
      "viaq-auto-0001",
      "From Q, on its own.",
    );
    const [row] = await db.sql<{ q_delegation_id: string | null }[]>`
      select q_delegation_id from communication.messages
       where idempotency_key = 'viaq-auto-0001' and sender_user_id = ${founder.userId}`;
    expect(row?.q_delegation_id).toBe(qDelegationId);
  });

  it("the person's own send from the screen carries no Q marker", async () => {
    await send(
      { surface: "SCREEN", qActionId: randomUUID() },
      "viaq-mine-0001",
      "From the founder.",
    );
    const [row] = await db.sql<
      { q_action_id: string | null; q_delegation_id: string | null }[]
    >`select q_action_id, q_delegation_id from communication.messages
       where idempotency_key = 'viaq-mine-0001' and sender_user_id = ${founder.userId}`;
    expect(row).toEqual({ q_action_id: null, q_delegation_id: null });
    const read = await chat.readForQ({
      actor: investor,
      relationshipId: ids.relationship,
    });
    expect(
      read.messages.find((message) => message.text === "From the founder.")
        ?.viaQ,
    ).toBe(false);
  });
});
