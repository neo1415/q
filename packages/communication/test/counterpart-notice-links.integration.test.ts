import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  COUNTERPART_NOTICE_TARGETS,
  createCounterpartNotices,
} from "../src/index.js";

/**
 * Live audit 2026-11-15 D1: data-room and document-request notices were
 * refused by communication.notifications' link check and never written.
 * Against PostgreSQL's real constraint, every target from both sides is
 * written; the old links are still refused (the check was not weakened).
 * One transaction, always rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("counterpart notice links against the real constraint", () => {
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

  it("writes every notice kind's link for both sides; a query or fragment is still refused", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const ids = {
          tenantCo: randomUUID(),
          tenantInv: randomUUID(),
          orgCo: randomUUID(),
          orgInv: randomUUID(),
          company: randomUUID(),
          investor: randomUUID(),
          relationship: randomUUID(),
        };
        const users: string[] = [];
        for (const [tenant, org, type] of [
          [ids.tenantCo, ids.orgCo, "company"],
          [ids.tenantInv, ids.orgInv, "investment_firm"],
        ] as const) {
          await tx`insert into identity.tenants (id, name) values (${tenant}, ${`Link ${type}`})`;
          await tx`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, ${type}, ${`Link ${type}`}, ${`link-${org.slice(0, 8)}`})`;
          await tx`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@link.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          await tx`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
            values (${tenant}, ${org}, ${profile?.id ?? ""}, 'active')`;
          users.push(profile?.id ?? "");
        }
        const [founder = "", investor = ""] = users;
        await tx`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Ajopot (fictional)', ${`ajopot-${ids.company.slice(0, 8)}`})`;
        await tx`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Savanna Seed (fictional)')`;
        await tx`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
          values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;

        const notices = createCounterpartNotices(tx);
        const kinds = [
          "INTEREST_RECEIVED",
          "CONNECTION_REQUESTED",
          "INTEREST_ACCEPTED",
          "Q_MESSAGE",
          "TIME_PROPOSED",
          "RELATIONSHIP_OUTCOME",
          "DILIGENCE",
          "COMMITMENT",
        ] as const;
        let n = 0;
        for (const kind of kinds) {
          for (const target of COUNTERPART_NOTICE_TARGETS) {
            for (const actingSide of ["INVESTOR", "COMPANY"] as const) {
              n += 1;
              const written = await notices.notify({
                relationshipId: ids.relationship,
                actingSide,
                kind,
                title: "{actor} did something",
                body: null,
                target,
                key: randomUUID(),
                priority: "UPDATE",
              });
              expect(written, `${kind}/${target}/${actingSide}`).toBe(1);
            }
          }
        }
        const rows = await tx<
          { user_id: string; kind: string; link_path: string }[]
        >`
          select user_id, kind, link_path from communication.notifications
           where user_id in (${founder}, ${investor})
           order by created_at`;
        expect(rows).toHaveLength(n);
        // The data-room and document-request links D1 lost, now written.
        const links = new Set(rows.map((row) => row.link_path));
        expect(
          [...links].some((link) =>
            /^\/documents\/requested\/[0-9a-f-]{36}$/u.test(link),
          ),
        ).toBe(true);
        expect(links.has(`/company/${ids.company}/data-room`)).toBe(true);
        // Each side is told only by the other: the investor's actions go
        // to the founder, and the reverse.
        expect(
          rows.filter((row) => row.user_id === founder).length +
            rows.filter((row) => row.user_id === investor).length,
        ).toBe(n);

        // The constraint still refuses what D1 tried to write.
        for (const bad of [
          `/documents?tab=requested&item=${ids.relationship}`,
          `/company/${ids.company}#data-room`,
          "https://elsewhere.example/x",
        ]) {
          await expect(
            tx.savepoint(
              (sp) => sp`
                insert into communication.notifications
                  (tenant_id, user_id, kind, title, link_path, dedupe_key)
                values (${ids.tenantCo}, ${founder}, 'DILIGENCE', 'x', ${bad},
                        ${`bad:${randomUUID()}`})`,
            ),
            bad,
          ).rejects.toMatchObject({
            code: "23514",
            constraint_name: "notifications_link_path_check",
          });
        }
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
