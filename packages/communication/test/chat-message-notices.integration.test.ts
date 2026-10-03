import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createChatMessageNotices } from "../src/index.js";

/**
 * QA run 8a1d57b9: neither side was told of a new chat message. Against
 * PostgreSQL, inside ONE transaction that is always rolled back (the
 * migration is applied in it), so nothing here outlives the test.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261201090000_chat_message_notices.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

describe("chat message notices against PostgreSQL", () => {
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

  it("tells the other side once per conversation: folded while unread, raised again after reading, replay-safe", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        await tx.file(MIGRATION);
        const ids = {
          tenantCo: randomUUID(),
          tenantInv: randomUUID(),
          orgCo: randomUUID(),
          orgInv: randomUUID(),
          company: randomUUID(),
          investor: randomUUID(),
          relationship: randomUUID(),
          conversation: randomUUID(),
        };
        const users: string[] = [];
        for (const [tenant, org, type] of [
          [ids.tenantCo, ids.orgCo, "company"],
          [ids.tenantInv, ids.orgInv, "investment_firm"],
        ] as const) {
          await tx`insert into identity.tenants (id, name) values (${tenant}, ${`Notice ${type}`})`;
          await tx`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, ${type}, ${`Notice ${type}`}, ${`notice-${org.slice(0, 8)}`})`;
          await tx`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@notice.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          await tx`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
            values (${tenant}, ${org}, ${profile?.id ?? ""}, 'active')`;
          users.push(profile?.id ?? "");
        }
        const [founder = "", investor = ""] = users;
        await tx`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Clinicrest', ${`clinicrest-${ids.company.slice(0, 8)}`})`;
        await tx`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Savanna Seed')`;
        await tx`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
          values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;

        const notices = createChatMessageNotices(tx);
        const at = (minute: number) =>
          new Date(Date.UTC(2026, 9, 7, 9, minute));
        const founderWrites = (minute: number) =>
          notices.notify({
            relationshipId: ids.relationship,
            conversationId: ids.conversation,
            senderSide: "COMPANY",
            at: at(minute),
          });
        const read = async () =>
          (
            await tx<
              {
                user_id: string;
                kind: string;
                title: string;
                body: string;
                link_path: string;
                priority: string;
                read_at: Date | null;
                pushed_at: Date | null;
              }[]
            >`select user_id, kind, title, body, link_path, priority, read_at, pushed_at
                from communication.notifications
               where dedupe_key = ${`chat:${ids.conversation}`}`
          ).map((row) => ({ ...row }));

        // The investor's people are told; the founder (who wrote) is not.
        expect(await founderWrites(0)).toBe(1);
        let rows = await read();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          user_id: investor,
          kind: "CHAT_MESSAGE",
          title: "Clinicrest sent you a message",
          link_path: `/relationships/company/${ids.company}/messages`,
          priority: "NEEDS_YOU",
        });
        expect(rows.some((row) => row.user_id === founder)).toBe(false);

        // The same event again changes nothing.
        expect(await founderWrites(0)).toBe(0);
        // A second message while unread folds in: still one, not pushed again.
        await tx`update communication.notifications set pushed_at = now()
                  where dedupe_key = ${`chat:${ids.conversation}`}`;
        expect(await founderWrites(1)).toBe(1);
        rows = await read();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.body).toContain("New messages");
        expect(rows[0]?.pushed_at).not.toBeNull();

        // Read, then a new message: raised again, and pushed again.
        await tx`update communication.notifications set read_at = now()
                  where dedupe_key = ${`chat:${ids.conversation}`}`;
        expect(await founderWrites(2)).toBe(1);
        rows = await read();
        expect(rows[0]).toMatchObject({ read_at: null, pushed_at: null });

        // The investor writes back: the founder is told, on their own link.
        expect(
          await notices.notify({
            relationshipId: ids.relationship,
            conversationId: ids.conversation,
            senderSide: "INVESTOR",
            at: at(3),
          }),
        ).toBe(1);
        rows = await read();
        expect(rows.find((row) => row.user_id === founder)).toMatchObject({
          title: "Savanna Seed sent you a message",
          link_path: `/relationships/investor/${ids.investor}/messages`,
        });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
