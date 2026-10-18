import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createNotificationDelivery,
  createPushSubscriptionStore,
  type PushMessage,
  type WebPushSender,
} from "../src/index.js";
import { createFakeAppEmail } from "../src/testing/index.js";

/**
 * AUTO (ADR 0030): notice delivery against the local database -- push once
 * per notice to each device, "gone" devices revoked, "Needs you" emailed
 * once after ten minutes unread, settings honoured.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("notice delivery against PostgreSQL", () => {
  let db: RequestDatabase;
  const tenant = randomUUID();
  let userId = "";
  let actor = { tenantId: tenant, userId: "" };
  const pushed: { endpoint: string; message: PushMessage }[] = [];
  const push: WebPushSender = {
    available: true,
    publicKey: "test",
    send: (subscription, message) => {
      pushed.push({ endpoint: subscription.endpoint, message });
      return Promise.resolve(
        subscription.endpoint.endsWith("/gone") ? "GONE" : "SENT",
      );
    },
  };
  const email = createFakeAppEmail();
  let clock = new Date();

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
    const authId = randomUUID();
    await db.sql`insert into identity.tenants (id, name) values (${tenant}, 'Push tenant')`;
    await db.sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@push.example.invalid`})`;
    const [profile] = await db.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authId}`;
    userId = profile?.id ?? "";
    actor = { tenantId: tenant, userId };
  });

  afterAll(async () => {
    await db.close();
  });

  it("pushes each notice once, revokes gone devices, emails Needs you after ten minutes", async () => {
    const store = createPushSubscriptionStore(db.sql);
    await store.subscribe(actor, {
      endpoint: `https://push.example.invalid/${userId}/ok`,
      p256dh: "B".repeat(87),
      auth: "k".repeat(22),
      userAgent: "test",
    });
    await store.subscribe(actor, {
      endpoint: `https://push.example.invalid/${userId}/gone`,
      p256dh: "B".repeat(87),
      auth: "k".repeat(22),
      userAgent: null,
    });
    expect((await store.settings(actor)).devices).toBe(2);
    await db.sql`
      insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key, priority, link_path)
      values (${tenant}, ${userId}, 'Q_WORK', ${`Which time works? ${userId.slice(0, 8)}`}, ${`work:${userId}:1`}, 'NEEDS_YOU', '/work'),
             (${tenant}, ${userId}, 'Q_WORK', 'Q expressed interest', ${`work:${userId}:2`}, 'UPDATE', null)`;

    const delivery = createNotificationDelivery({
      sql: db.sql,
      push,
      email,
      emailOf: (id) =>
        Promise.resolve(id === userId ? "person@push.example.invalid" : null),
      appOrigin: "https://app.example.invalid",
      now: () => clock,
    });
    // A shared local database holds other tests' notices too: one pass
    // wide enough to reach this test's own.
    const first = await delivery.tick(1000);
    expect(first.pushed).toBeGreaterThanOrEqual(2);
    const mine = pushed.filter((item) => item.endpoint.includes(userId));
    // Both devices get the first notice; the gone one is then put to rest
    // and never tried again.
    expect(mine).toHaveLength(3);
    expect(mine.filter((item) => item.endpoint.endsWith("/gone"))).toHaveLength(
      1,
    );
    expect(
      mine.find((item) => item.message.title.startsWith("Which time works?"))
        ?.message.urgent,
    ).toBe(true);
    // Nothing is pushed twice.
    expect((await store.settings(actor)).devices).toBe(1);
    await delivery.tick(1000);
    expect(
      pushed.filter((item) => item.endpoint.includes(userId)),
    ).toHaveLength(3);
    expect(
      email.sent.filter((sent) => sent.to === "person@push.example.invalid"),
    ).toHaveLength(0);

    // Ten minutes on, still unread: the Needs you notice is emailed, once.
    clock = new Date(clock.getTime() + 11 * 60_000);
    await delivery.tick(1000);
    await delivery.tick(1000);
    const mails = email.sent.filter(
      (sent) => sent.to === "person@push.example.invalid",
    );
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toContain("Which time works?");
    expect(mails[0]?.text).toContain("https://app.example.invalid/work");

    // Email off: nothing more is emailed.
    await store.saveSettings(actor, { push: false, email: false });
    expect(await store.settings(actor)).toMatchObject({
      push: false,
      email: false,
    });
  });
});
