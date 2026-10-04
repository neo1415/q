import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createIntegrationsService,
  createNetworkRelationshipActivityWriter,
  createPostgresCounterpartDirectory,
  createPostgresIntegrationsStore,
  createTokenCipher,
} from "../src/index.js";
import {
  createFakeEmailProvider,
  createFakeGoogleOAuth,
  FAKE_REFRESH_TOKEN,
} from "../src/testing/index.js";

/**
 * BIZ-007 against local PostgreSQL, with a fake Google: connect seals the
 * token, the counterpart directory names only the other side's active
 * people, an approved send writes one outbound row and one `outreach_sent`
 * (and a duplicate writes nothing), and a reply found by push and by poll
 * becomes one inbound row and one `reply_received` on the canonical
 * relationship.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CORRELATION = () => `cor_${randomUUID()}`;

describe("@capital-q/integrations against local PostgreSQL", () => {
  let db: RequestDatabase;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
    founderAuth: randomUUID(),
    revokedAuth: randomUUID(),
    investorAuth: randomUUID(),
  };
  let investorUserId = "";

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
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [tenant, org, type] of [
        [ids.tenantCo, ids.orgCo, "company"],
        [ids.tenantInv, ids.orgInv, "investment_firm"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Mail ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Mail ${type}`}, ${`mail-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
      }
      const person = async (
        authId: string,
        email: string,
        tenant: string,
        org: string,
        status: "active" | "revoked",
      ) => {
        await sql`insert into auth.users (id, email) values (${authId}, ${email})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`update identity.user_profiles set display_name = ${email.split("@")[0] ?? ""} where id = ${profile.id}`;
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status, left_at)
          values (${tenant}, ${org}, ${profile.id}, ${status}, ${status === "active" ? null : new Date()})`;
        return profile.id;
      };
      await person(
        ids.founderAuth,
        `ada-${ids.founderAuth.slice(0, 6)}@founder.example.invalid`,
        ids.tenantCo,
        ids.orgCo,
        "active",
      );
      await person(
        ids.revokedAuth,
        `gone-${ids.revokedAuth.slice(0, 6)}@founder.example.invalid`,
        ids.tenantCo,
        ids.orgCo,
        "revoked",
      );
      investorUserId = await person(
        ids.investorAuth,
        `ben-${ids.investorAuth.slice(0, 6)}@fund.example.invalid`,
        ids.tenantInv,
        ids.orgInv,
        "active",
      );
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Mail Co', ${`mail-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Mail Capital')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor})`;
    });
  });

  afterAll(async () => {
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      await sql`delete from integrations.email_messages where relationship_id = ${ids.relationship} and direction = 'INBOUND'`;
      await sql`delete from integrations.email_messages where relationship_id = ${ids.relationship}`;
      await sql`delete from communication.notifications where tenant_id = ${ids.tenantInv}`;
      await sql`delete from integrations.google_accounts where tenant_id = ${ids.tenantInv}`;
      await sql`delete from integrations.oauth_states where tenant_id = ${ids.tenantInv}`;
      await sql`delete from network.relationship_events where relationship_id = ${ids.relationship}`;
      await sql`delete from network.relationships where id = ${ids.relationship}`;
      await sql`delete from core.investor_organisations where id = ${ids.investor}`;
      await sql`delete from core.companies where id = ${ids.company}`;
      await sql`delete from identity.organisation_memberships where tenant_id = any(${[ids.tenantCo, ids.tenantInv]}::uuid[])`;
      await sql`delete from identity.tenant_organisations where tenant_id = any(${[ids.tenantCo, ids.tenantInv]}::uuid[])`;
      await sql`delete from identity.organisations where tenant_id = any(${[ids.tenantCo, ids.tenantInv]}::uuid[])`;
      await sql`delete from identity.tenants where id = any(${[ids.tenantCo, ids.tenantInv]}::uuid[])`;
      for (const auth of [ids.founderAuth, ids.revokedAuth, ids.investorAuth]) {
        await sql`delete from identity.user_profiles where auth_user_id = ${auth}`;
        await sql`delete from auth.users where id = ${auth}`;
      }
    });
    await db.close();
  });

  it("connects, sends once, and records one reply from push and poll", async () => {
    const directory = createPostgresCounterpartDirectory({ sql: db.sql });
    const contacts = await directory.contacts({
      relationshipId: ids.relationship,
      counterpart: "COMPANY",
    });
    // The founder only: a revoked member is never a recipient.
    expect(contacts.map((c) => c.email)).toEqual([
      `ada-${ids.founderAuth.slice(0, 6)}@founder.example.invalid`,
    ]);

    const store = createPostgresIntegrationsStore({
      sql: db.sql,
      transactions: db.transactions,
    });
    const mailbox = createFakeEmailProvider();
    const service = createIntegrationsService({
      store,
      transactions: db.transactions,
      activity: createNetworkRelationshipActivityWriter(),
      google: {
        oauth: createFakeGoogleOAuth({
          email: `ben-${ids.investorAuth.slice(0, 6)}@fund.example.invalid`,
        }),
        cipher: createTokenCipher(randomBytes(32).toString("base64")),
        email: mailbox,
      },
    });
    const { authorizationUrl } = await service.startConnect({
      tenantId: ids.tenantInv,
      userId: investorUserId,
    });
    const connected = await service.completeConnect({
      state: new URL(authorizationUrl).searchParams.get("state") ?? "",
      code: "4/code-0123456789abcdef",
      error: undefined,
    });
    expect(connected.outcome).toBe("CONNECTED");
    const [sealed] = await db.sql<{ refresh_token_ciphertext: Uint8Array }[]>`
      select refresh_token_ciphertext from integrations.google_accounts
       where user_id = ${investorUserId} and status = 'CONNECTED'`;
    expect(
      Buffer.from(sealed?.refresh_token_ciphertext ?? []).toString("latin1"),
    ).not.toContain(FAKE_REFRESH_TOKEN);

    const command = {
      tenantId: ids.tenantInv,
      approverUserId: investorUserId,
      relationshipId: ids.relationship,
      qActionId: randomUUID(),
      idempotencyKey: `q-action:q_action:${randomUUID()}`,
      to: contacts[0]?.email ?? "",
      toName: contacts[0]?.name ?? "",
      subject: "Following up",
      body: "Hi Ada, could we talk this week?",
      correlationId: CORRELATION(),
    };
    expect(await service.sendApprovedEmail(command)).toMatchObject({
      outcome: "SENT",
      alreadySent: false,
    });
    expect(await service.sendApprovedEmail(command)).toMatchObject({
      outcome: "SENT",
      alreadySent: true,
    });
    expect(mailbox.sent).toHaveLength(1);

    const [outbound] = await db.sql<{ rfc822_message_id: string }[]>`
      select rfc822_message_id from integrations.email_messages
       where relationship_id = ${ids.relationship} and direction = 'OUTBOUND'`;
    mailbox.deliver({
      providerMessageId: "reply1",
      providerThreadId: "otherthread",
      labelIds: ["INBOX"],
      from: `Ada <${contacts[0]?.email ?? ""}>`,
      to: "ben@fund.example.invalid",
      subject: "Re: Following up",
      messageId: "<reply1@founder.example.invalid>",
      inReplyTo: outbound?.rfc822_message_id,
      references: undefined,
      receivedAt: new Date(),
    });
    const account = await store.findConnectedByUser(investorUserId);
    await service.pollAll(CORRELATION());
    // Push arrives after the poll with an older cursor: nothing twice.
    if (account !== null) {
      await store.saveCursor(account.id, {
        historyId: "100",
        syncedAt: new Date(),
      });
    }
    await service.handlePush(
      { emailAddress: account?.email ?? "" },
      CORRELATION(),
    );

    const events = await db.sql<
      { event_type: string; visibility_scope: string }[]
    >`
      select event_type, visibility_scope from network.relationship_events
       where relationship_id = ${ids.relationship} order by sequence`;
    expect(events.map((e) => e.event_type)).toEqual([
      "outreach_sent",
      "reply_received",
    ]);
    expect(
      events.every((e) => e.visibility_scope === "relationship_shared"),
    ).toBe(true);
    const mail = await service.listRelationshipMail(
      investorUserId,
      ids.relationship,
    );
    expect(mail.map((m) => m.direction).sort()).toEqual([
      "INBOUND",
      "OUTBOUND",
    ]);

    await service.disconnect(investorUserId);
    expect(await store.findConnectedByUser(investorUserId)).toBeNull();
  });

  it("ends a revoked connection once and tells the person once (meetfix-57)", async () => {
    const store = createPostgresIntegrationsStore({
      sql: db.sql,
      transactions: db.transactions,
    });
    const account = await store.connectAccount({
      tenantId: ids.tenantInv,
      userId: investorUserId,
      googleSubject: "meetfix-57",
      email: `ben-${ids.investorAuth.slice(0, 6)}@fund.example.invalid`,
      scopes: ["openid"],
      refreshTokenCiphertext: randomBytes(64),
      keyVersion: 1,
      historyId: null,
    });
    expect(await store.latestStatus(investorUserId)).toEqual({
      status: "CONNECTED",
      endedAt: null,
    });
    expect(await store.endConnection(account.id, "REVOKED_BY_PROVIDER")).toBe(
      true,
    );
    expect(await store.endConnection(account.id, "REVOKED_BY_PROVIDER")).toBe(
      false,
    );
    expect((await store.latestStatus(investorUserId))?.status).toBe(
      "REVOKED_BY_PROVIDER",
    );
    await store.noticeRevoked(account);
    await store.noticeRevoked(account);
    const notices = await db.sql<{ title: string; link_path: string }[]>`
      select title, link_path from communication.notifications
       where user_id = ${investorUserId}
         and dedupe_key = ${`google-revoked:${account.id}`}`;
    expect(notices).toEqual([
      {
        title:
          "Google disconnected: reconnect to keep calendar, email and Meet working",
        link_path: "/settings/reconnect/google",
      },
    ]);
  });
});
