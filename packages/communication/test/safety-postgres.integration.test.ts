import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  ChatBlockedError,
  ChatNotFoundError,
  ChatReportReasonError,
  createChatSafetyService,
  createChatService,
  createPostgresChatSafetyStore,
  createPostgresChatStore,
  type ChatParty,
  type ChatSafetyAuditEntry,
  type ChatSafetyService,
  type ChatService,
} from "../src/index.js";

/**
 * R34 safety against PostgreSQL: a block derives both party organisations
 * from the canonical relationship, stops sends in both directions (service
 * check and the block guard trigger), lifts once and lets messages flow; a
 * report is validated against the reference reasons and the thread; each
 * write commits with its audit hook, and a failing audit rolls the write
 * back. Blocks and messages keep their history, so this suite leaves rows
 * behind: run it against a scratch database (CQ_TEST_DATABASE_URL).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/communication chat safety against PostgreSQL", () => {
  let db: RequestDatabase;
  let chat: ChatService;
  let safety: ChatSafetyService;
  let failAudit = false;
  const audits: ChatSafetyAuditEntry[] = [];
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
  };
  let founder: ActorContext;
  let investor: ActorContext;

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
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
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Safety ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Safety ${type}`}, ${`safety-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@safety.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Safety Co', ${`safety-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Safety Capital')`;
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
    const parties = (a: ActorContext, relationshipId: string) => {
      const party: ChatParty | null =
        relationshipId !== ids.relationship
          ? null
          : a.organisationId === ids.orgCo
            ? { side: "COMPANY", connected: true }
            : a.organisationId === ids.orgInv
              ? { side: "INVESTOR", connected: true }
              : null;
      return Promise.resolve(party);
    };
    chat = createChatService({
      store: createPostgresChatStore({
        sql: db.sql,
        transactions: db.transactions,
      }),
      parties,
      documents: () => Promise.resolve({ outcome: "NOT_FOUND" }),
      newCorrelationId: () => `cor_${randomUUID()}`,
    });
    safety = createChatSafetyService({
      store: createPostgresChatSafetyStore({
        sql: db.sql,
        transactions: db.transactions,
      }),
      parties,
      audit: (_tx, entry) => {
        if (failAudit) return Promise.reject(new Error("audit unavailable"));
        audits.push(entry);
        return Promise.resolve();
      },
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const say = (a: ActorContext, body: string) => ({
    actor: a,
    relationshipId: ids.relationship,
    request: { kind: "TEXT" as const, body },
    idempotencyKey: `key-${randomUUID()}`,
  });

  it("blocks both ways, derives the party organisations, and lifts once", async () => {
    const hello = await chat.send(say(investor, "Hello"));

    // A failing audit rolls the block back.
    failAudit = true;
    await expect(
      safety.block({
        actor: founder,
        relationshipId: ids.relationship,
        idempotencyKey: "block-rollback-0001",
      }),
    ).rejects.toThrow("audit unavailable");
    failAudit = false;
    const none = await db.sql<{ n: number }[]>`
      select count(*)::int as n from communication.blocks where relationship_id = ${ids.relationship}`;
    expect(none[0]?.n).toBe(0);

    const first = await safety.block({
      actor: founder,
      relationshipId: ids.relationship,
      idempotencyKey: "block-key-0001",
    });
    const repeat = await safety.block({
      actor: founder,
      relationshipId: ids.relationship,
      idempotencyKey: "block-key-0001",
    });
    expect([first.deduplicated, repeat.deduplicated]).toEqual([false, true]);
    const rows = await db.sql<
      {
        tenant_id: string;
        blocker_organisation_id: string;
        blocked_organisation_id: string;
        blocker_side: string;
      }[]
    >`select tenant_id, blocker_organisation_id, blocked_organisation_id, blocker_side
        from communication.blocks where relationship_id = ${ids.relationship}`;
    expect(rows).toEqual([
      {
        tenant_id: ids.tenantCo,
        blocker_organisation_id: ids.orgCo,
        blocked_organisation_id: ids.orgInv,
        blocker_side: "COMPANY",
      },
    ]);

    await expect(chat.send(say(investor, "Still there?"))).rejects.toBeInstanceOf(
      ChatBlockedError,
    );
    await expect(chat.send(say(founder, "One more"))).rejects.toBeInstanceOf(
      ChatBlockedError,
    );
    const theirs = await chat.thread({
      actor: investor,
      relationshipId: ids.relationship,
    });
    expect(theirs.status).toBe("BLOCKED");
    expect(theirs.blockedByYourSide).toBe(false);
    expect(theirs.messages.map((m) => m.messageId)).toEqual([
      hello.message.messageId,
    ]);

    // The blocked side cannot lift it; the blocking side can, once.
    expect(
      await safety.unblock({ actor: investor, relationshipId: ids.relationship }),
    ).toEqual({ lifted: false });
    expect(
      await safety.unblock({ actor: founder, relationshipId: ids.relationship }),
    ).toEqual({ lifted: true });
    expect(
      await safety.unblock({ actor: founder, relationshipId: ids.relationship }),
    ).toEqual({ lifted: false });
    const back = await chat.send(say(investor, "Back again"));
    expect(back.message.body).toBe("Back again");
    expect(audits.map((a) => a.actionType)).toEqual([
      "chat.blocked",
      "chat.unblocked",
    ]);
  });

  it("reports the other side's message, dedupes by key and refuses bad input", async () => {
    const theirs = await chat.send(say(investor, "Wire me the fee"));
    const mine = await chat.send(say(founder, "No thanks"));
    audits.length = 0;

    const request = {
      reasonCode: "SCAM",
      messageId: theirs.message.messageId,
      note: "Asked for a fee",
    };
    const first = await safety.report({
      actor: founder,
      relationshipId: ids.relationship,
      request,
      idempotencyKey: "report-key-0001",
    });
    const repeat = await safety.report({
      actor: founder,
      relationshipId: ids.relationship,
      request,
      idempotencyKey: "report-key-0001",
    });
    expect(repeat).toEqual({ ...first, deduplicated: true });
    const stored = await db.sql<
      { reporter_organisation_id: string; status: string; note: string }[]
    >`select reporter_organisation_id, status, note from communication.reports
       where id = ${first.reportId}`;
    expect(stored).toEqual([
      { reporter_organisation_id: ids.orgCo, status: "OPEN", note: "Asked for a fee" },
    ]);

    await expect(
      safety.report({
        actor: founder,
        relationshipId: ids.relationship,
        request: { reasonCode: "NOT_A_REASON" },
        idempotencyKey: "report-key-0002",
      }),
    ).rejects.toBeInstanceOf(ChatReportReasonError);
    await expect(
      safety.report({
        actor: founder,
        relationshipId: ids.relationship,
        request: { reasonCode: "SPAM", messageId: mine.message.messageId },
        idempotencyKey: "report-key-0003",
      }),
    ).rejects.toBeInstanceOf(ChatNotFoundError);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actionType: "chat.reported",
      resourceId: first.reportId,
      metadata: { reasonCode: "SCAM", namesMessage: true },
    });
  });
});
