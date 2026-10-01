import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createChatService,
  createPostgresChatStore,
  type ChatService,
} from "../src/index.js";

/**
 * R34 against PostgreSQL: a message, its `message_sent` activity and the
 * thread commit together; a repeat key writes nothing; an unsend is a
 * tombstone row; the read cursor only moves forward; unread counts come
 * from the canonical party rows. Messages are append-only, so this suite
 * leaves its rows behind: run it against a scratch database
 * (CQ_TEST_DATABASE_URL), not a shared one.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/communication against PostgreSQL", () => {
  let db: RequestDatabase;
  let service: ChatService;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
    document: randomUUID(),
    version: randomUUID(),
  };
  const shares: unknown[] = [];
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
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Chat ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Chat ${type}`}, ${`chat-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@chat.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`update identity.user_profiles set display_name = ${type === "company" ? "Ada" : "Ben"} where id = ${profile.id}`;
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Chat Co', ${`chat-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Chat Capital')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
      await sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${ids.document}, ${ids.tenantCo}, ${ids.company}, ${ids.orgCo}, 'PITCH_DECK', 'Seed deck', 'founder_private', 'RESTRICTED', ${users[0] ?? ""})`;
      await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
        values (${ids.version}, ${ids.tenantCo}, ${ids.document}, 1, 'cq-documents-private', ${`raw/${ids.tenantCo}/${ids.version.replaceAll("-", "")}`}, 'deck.pdf', 'application/pdf', 2048, ${"a".repeat(64)}, ${users[0] ?? ""})`;
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
    service = createChatService({
      store: createPostgresChatStore({
        sql: db.sql,
        transactions: db.transactions,
      }),
      parties: (a, relationshipId) =>
        Promise.resolve(
          relationshipId !== ids.relationship
            ? null
            : a.organisationId === ids.orgCo
              ? { side: "COMPANY", connected: true }
              : a.organisationId === ids.orgInv
                ? { side: "INVESTOR", connected: true }
                : null,
        ),
      documents: (_actor, documentId) =>
        Promise.resolve(
          documentId === ids.document
            ? {
                outcome: "READY" as const,
                snapshot: {
                  documentId: ids.document,
                  documentVersionId: ids.version,
                  documentTenantId: ids.tenantCo,
                  title: "Seed deck",
                  mimeType: "application/pdf",
                  sizeBytes: 2048,
                },
              }
            : { outcome: "NOT_FOUND" as const },
        ),
      downloads: (share) => {
        shares.push(share);
        return Promise.resolve({
          url: "https://storage.example.invalid/object/sign/x?token=t",
          expiresAt: "2026-09-27T09:01:00.000Z",
          mimeType: "application/pdf",
        });
      },
      newCorrelationId: () => `cor_${randomUUID()}`,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("sends, dedupes, records activity, folds an unsend and counts unread", async () => {
    const first = await service.send({
      actor: founder,
      relationshipId: ids.relationship,
      request: { kind: "TEXT", body: "Hello Ben" },
      idempotencyKey: "it-key-0001",
    });
    const again = await service.send({
      actor: founder,
      relationshipId: ids.relationship,
      request: { kind: "TEXT", body: "Hello Ben" },
      idempotencyKey: "it-key-0001",
    });
    expect(again.deduplicated).toBe(true);
    expect(again.message.messageId).toBe(first.message.messageId);
    expect(first.message.senderName).toBe("Ada");

    const second = await service.send({
      actor: founder,
      relationshipId: ids.relationship,
      request: { kind: "TEXT", body: "Deck attached soon" },
      idempotencyKey: "it-key-0002",
    });
    const events = await db.sql<
      { event_type: string; visibility_scope: string; payload: unknown }[]
    >`
      select event_type, visibility_scope, payload from network.relationship_events
       where relationship_id = ${ids.relationship} order by sequence`;
    expect(events.map((e) => e.event_type)).toEqual([
      "message_sent",
      "message_sent",
    ]);
    expect(events[0]?.visibility_scope).toBe("relationship_shared");
    expect(JSON.stringify(events)).not.toContain("Hello Ben");

    expect((await service.unread(investor)).items).toEqual([
      { relationshipId: ids.relationship, unread: 2 },
    ]);
    const view = await service.thread({
      actor: investor,
      relationshipId: ids.relationship,
    });
    expect(view.messages.map((m) => m.body)).toEqual([
      "Hello Ben",
      "Deck attached soon",
    ]);
    const cursor = view.cursor ?? "";

    await service.markRead({
      actor: investor,
      relationshipId: ids.relationship,
      lastReadMessageId: second.message.messageId,
    });
    await service.markRead({
      actor: investor,
      relationshipId: ids.relationship,
      lastReadMessageId: first.message.messageId,
    });
    expect((await service.unread(investor)).items).toEqual([]);
    const founderView = await service.thread({
      actor: founder,
      relationshipId: ids.relationship,
    });
    expect(founderView.counterpartLastReadMessageId).toBe(
      second.message.messageId,
    );

    await service.unsend({
      actor: founder,
      relationshipId: ids.relationship,
      messageId: first.message.messageId,
      idempotencyKey: "it-key-0003",
    });
    const changes = await service.thread({
      actor: investor,
      relationshipId: ids.relationship,
      after: cursor,
    });
    expect(changes.messages).toHaveLength(1);
    expect(changes.messages[0]).toMatchObject({
      messageId: first.message.messageId,
      unsent: true,
      body: null,
    });

    await expect(
      db.sql`update communication.messages set body = 'x' where id = ${second.message.messageId}`,
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("marks Q's messages under a delegation, many per delegation, with the Q-to-Q envelope (ADR 0030)", async () => {
    const delegation = randomUUID();
    for (const key of ["it-q-0001", "it-q-0002"]) {
      await service.send({
        actor: founder,
        relationshipId: ids.relationship,
        request: { kind: "TEXT", body: `From Q ${key}` },
        idempotencyKey: key,
        qDelegationId: delegation,
        qEnvelope: { protocol: "cq.q2q/1", side: "COMPANY", intent: "ANSWER" },
      });
    }
    const read = await service.readForQ({
      actor: investor,
      relationshipId: ids.relationship,
    });
    const fromQ = read.messages.filter((message) => message.viaQ);
    expect(fromQ.map((message) => message.text)).toEqual([
      "From Q it-q-0001",
      "From Q it-q-0002",
    ]);
    expect(fromQ[0]?.envelope).toEqual({
      protocol: "cq.q2q/1",
      side: "COMPANY",
      intent: "ANSWER",
    });
  });

  it("pins the shared version and opens it for the other side", async () => {
    const sent = await service.send({
      actor: founder,
      relationshipId: ids.relationship,
      request: {
        kind: "ATTACHMENT",
        documentId: ids.document,
        body: "Our deck",
      },
      idempotencyKey: "it-key-0010",
    });
    const row = await db.sql<
      { document_version_id: string; document_tenant_id: string }[]
    >`
      select document_version_id, document_tenant_id from communication.messages where id = ${sent.message.messageId}`;
    expect(row[0]).toEqual({
      document_version_id: ids.version,
      document_tenant_id: ids.tenantCo,
    });
    await service.attachment({
      actor: investor,
      relationshipId: ids.relationship,
      messageId: sent.message.messageId,
    });
    expect(shares).toEqual([
      {
        documentTenantId: ids.tenantCo,
        documentId: ids.document,
        documentVersionId: ids.version,
        disposition: "ATTACHMENT",
      },
    ]);
  });
});
