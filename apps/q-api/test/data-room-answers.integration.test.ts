import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createAttentionSources } from "../src/composition/attention-sources.js";

/**
 * Live audit 2026-11-15 D2: a data-room share or decline is in the account
 * digest's recent events of both sides. Against PostgreSQL: each side reads
 * only requests its own organisation asked or answered, worded for its own
 * side; a third organisation reads nothing. One transaction, rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("data-room answers for the account digest", () => {
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

  it("lists an answered request for the company and the investor, nobody else", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const ids = {
          tenantCo: randomUUID(),
          tenantInv: randomUUID(),
          tenantOther: randomUUID(),
          orgCo: randomUUID(),
          orgInv: randomUUID(),
          orgOther: randomUUID(),
          company: randomUUID(),
          investor: randomUUID(),
          relationship: randomUUID(),
          request: randomUUID(),
        };
        const users: string[] = [];
        for (const [tenant, org, type] of [
          [ids.tenantCo, ids.orgCo, "company"],
          [ids.tenantInv, ids.orgInv, "investment_firm"],
          [ids.tenantOther, ids.orgOther, "investment_firm"],
        ] as const) {
          await tx`insert into identity.tenants (id, name) values (${tenant}, ${`Room ${type}`})`;
          await tx`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, ${type}, ${`Room ${type}`}, ${`room-${org.slice(0, 8)}`})`;
          await tx`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@room.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          users.push(profile?.id ?? "");
        }
        const [founder = "", investor = "", other = ""] = users;
        await tx`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Nsuo Labs (fictional)', ${`nsuo-${ids.company.slice(0, 8)}`})`;
        await tx`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Savanna Seed (fictional)')`;
        await tx`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
          values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
        // Connected: a data-room request goes only through one.
        await tx`insert into network.relationship_events
            (tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type,
             visibility_scope, correlation_id)
          values (${ids.tenantCo}, ${ids.relationship}, 1, 'connection_accepted', 'SYSTEM', ${randomUUID()},
                  'SYSTEM', 'relationship_shared', ${`cor_${randomUUID()}`})`;
        await tx`insert into evidence.data_room_access_requests
            (id, tenant_id, company_id, document_id, relationship_id, investor_organisation_id,
             requested_by_user_id, note, idempotency_key)
          values (${ids.request}, ${ids.tenantCo}, ${ids.company}, null, ${ids.relationship},
                  ${ids.investor}, ${investor}, null, ${`key-${ids.request}`})`;
        await tx`insert into evidence.data_room_request_decisions
            (request_id, tenant_id, decision, expires_at, decided_by_user_id)
          values (${ids.request}, ${ids.tenantCo}, 'DECLINED', null, ${founder})`;

        const port = createAttentionSources({ sql: tx });
        const read = port.dataRoomAnswers;
        if (read === undefined) throw new Error("no dataRoomAnswers");
        const actor = (
          userId: string,
          tenantId: string,
          organisationId: string,
        ) =>
          ({
            userId,
            tenantId,
            organisationId,
            actorType: "HUMAN",
          }) as unknown as ActorContext;
        const since = new Date(Date.now() - 3_600_000);

        const asCompany = await read(actor(founder, ids.tenantCo, ids.orgCo), {
          since,
        });
        expect(asCompany).toEqual([
          expect.objectContaining({
            relationshipId: ids.relationship,
            side: "COMPANY",
            counterpart: "Savanna Seed (fictional)",
            title: null,
            decision: "DECLINED",
          }),
        ]);
        const asInvestor = await read(
          actor(investor, ids.tenantInv, ids.orgInv),
          { since },
        );
        expect(asInvestor).toEqual([
          expect.objectContaining({
            side: "INVESTOR",
            counterpart: "Nsuo Labs (fictional)",
            decision: "DECLINED",
          }),
        ]);
        // Another organisation, or the right organisation id claimed in
        // another tenant, reads nothing.
        expect(
          await read(actor(other, ids.tenantOther, ids.orgOther), { since }),
        ).toEqual([]);
        expect(
          await read(actor(other, ids.tenantOther, ids.orgInv), { since }),
        ).toEqual([]);
        // Outside the window: nothing.
        expect(
          await read(actor(investor, ids.tenantInv, ids.orgInv), {
            since: new Date(Date.now() + 3_600_000),
          }),
        ).toEqual([]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
