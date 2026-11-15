import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { settledChatNotices, settledProposalNotices } from "../src/index.js";

/**
 * Live check 15 Nov 2026 (O1): Watchly was told Savanna "suggested other
 * times" for two proposals already declined, and that Savanna "sent you a
 * message" after Watchly had replied. Whether a NEEDS_YOU notice still
 * asks is read from the subject's current state. Against PostgreSQL,
 * inside ONE transaction that is always rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

const OPTIONS = JSON.stringify([
  {
    startsAt: "2026-11-19T09:00:00.000Z",
    endsAt: "2026-11-19T09:30:00.000Z",
    timeZone: "Africa/Lagos",
  },
]);

describe("whether a NEEDS_YOU notice still asks, against PostgreSQL", () => {
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

  it("settles proposal and chat notices from current state, keeps the ones still waiting", async () => {
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
          conversation: randomUUID(),
        };
        const users: string[] = [];
        for (const [tenant, org, type] of [
          [ids.tenantCo, ids.orgCo, "company"],
          [ids.tenantInv, ids.orgInv, "investment_firm"],
        ] as const) {
          await tx`insert into identity.tenants (id, name) values (${tenant}, ${`Currency ${type}`})`;
          await tx`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, ${type}, ${`Currency ${type}`}, ${`currency-${org.slice(0, 8)}`})`;
          await tx`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@currency.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          await tx`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
            values (${tenant}, ${org}, ${profile?.id ?? ""}, 'active')`;
          users.push(profile?.id ?? "");
        }
        const [founder = "", investor = ""] = users;
        await tx`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Watchly', ${`watchly-${ids.company.slice(0, 8)}`})`;
        await tx`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Savanna Seed')`;
        await tx`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
          values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;

        // --- Proposals -------------------------------------------------
        const proposal = async (
          state: "PROPOSED" | "COUNTERPROPOSED" | "DECLINED",
          revision: number,
        ) => {
          const id = randomUUID();
          await tx`insert into communication.meeting_time_proposals
              (id, tenant_id, relationship_id, purpose, proposed_by_user_id,
               state, options, counter_options, revision, idempotency_key)
            values (${id}, ${ids.tenantCo}, ${ids.relationship}, 'Intro call',
                    ${founder}, ${state}, ${OPTIONS}::jsonb,
                    ${state === "PROPOSED" ? null : OPTIONS}::jsonb,
                    ${revision}, ${`currency-${id}`})`;
          return id;
        };
        const declinedCounter = await proposal("DECLINED", 1);
        const openCounter = await proposal("COUNTERPROPOSED", 1);
        const reProposed = await proposal("PROPOSED", 2);
        const notice = (userId: string, dedupeKey: string) => ({
          id: randomUUID(),
          userId,
          dedupeKey,
        });
        const declinedNotice = notice(
          founder,
          `time_proposed:proposal:${declinedCounter}:r1:counter`,
        );
        const openNotice = notice(
          founder,
          `time_proposed:proposal:${openCounter}:r1:counter`,
        );
        // Revision 1 was superseded by the founder's revision 2.
        const staleRevision = notice(
          investor,
          `time_proposed:proposal:${reProposed}:r1`,
        );
        const currentRevision = notice(
          investor,
          `time_proposed:proposal:${reProposed}:r2`,
        );
        const unknown = notice(
          founder,
          `time_proposed:proposal:${randomUUID()}:r1:counter`,
        );
        const errand = notice(
          founder,
          `time_proposed:errand:${randomUUID()}:slots`,
        );
        const settledProposals = await settledProposalNotices(tx, [
          declinedNotice,
          openNotice,
          staleRevision,
          currentRevision,
          unknown,
          errand,
        ]);
        expect([...settledProposals].sort()).toEqual(
          [declinedNotice.id, staleRevision.id].sort(),
        );

        // A confirmed proposal is settled too.
        await tx`update communication.meeting_time_proposals
                    set state = 'CONFIRMED', accepted_from = 'OPTIONS',
                        accepted_option = 0, accepted_by_user_id = ${investor},
                        accepted_at = clock_timestamp()
                  where id = ${reProposed}`;
        expect(await settledProposalNotices(tx, [currentRevision])).toEqual(
          new Set([currentRevision.id]),
        );

        // --- Chat --------------------------------------------------------
        await tx`insert into communication.conversations (id, tenant_id, relationship_id)
          values (${ids.conversation}, ${ids.tenantCo}, ${ids.relationship})`;
        const write = async (
          sender: string,
          side: "COMPANY" | "INVESTOR",
          minute: number,
        ) => {
          const id = randomUUID();
          await tx`insert into communication.messages
              (id, tenant_id, conversation_id, sender_user_id, sender_side, kind, body,
               idempotency_key, created_at)
            values (${id}, ${ids.tenantCo}, ${ids.conversation},
                    ${sender}, ${side}, 'TEXT', 'Hello there',
                    ${`currency-${id}`}, ${new Date(Date.UTC(2026, 10, 13, 21, minute))})`;
          return id;
        };
        const chat = `chat:${ids.conversation}`;
        const toFounder = notice(founder, chat);
        const toInvestor = notice(investor, chat);

        // Savanna wrote last: the founder's notice still asks.
        await write(investor, "INVESTOR", 0);
        expect(await settledChatNotices(tx, [toFounder])).toEqual(new Set());

        // Watchly replied: the founder's notice is settled; the investor's
        // (told of the reply) still asks.
        const reply = await write(founder, "COMPANY", 5);
        expect(await settledChatNotices(tx, [toFounder, toInvestor])).toEqual(
          new Set([toFounder.id]),
        );

        // The reply unsent: Savanna's message is the latest again.
        const tombstone = randomUUID();
        await tx`insert into communication.messages
            (id, tenant_id, conversation_id, sender_user_id, sender_side, kind,
             revises_message_id, idempotency_key, created_at)
          values (${tombstone}, ${ids.tenantCo}, ${ids.conversation}, ${founder},
                  'COMPANY', 'TOMBSTONE', ${reply}, ${`currency-${tombstone}`},
                  ${new Date(Date.UTC(2026, 10, 13, 21, 6))})`;
        expect(await settledChatNotices(tx, [toFounder, toInvestor])).toEqual(
          new Set([toInvestor.id]),
        );
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
