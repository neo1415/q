import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import { createPostgresCompanyKnowledge } from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
} from "@capital-q/security";
import { checkContextIsolation } from "@capital-q/security/context-cache";
import {
  createPostgresActorContextResolver,
  createPostgresContextEpochReader,
} from "@capital-q/security/postgres";

import { createOwnMandateReads } from "../src/composition/working-snapshot.js";

/**
 * K Part 4 against the local database: their own mandate read is kept
 * as the tool returned it, served only while D's version for that mandate
 * is current, never kept when it does not match the mandate as it is now,
 * and passes F's isolation check. One rolled-back transaction each.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MARKER = "INVESTOR-OWN-MANDATE-TIER-A-DO-NOT-LEAK";
class Rollback extends Error {}

describe("their own mandate read, kept (K Part 4)", () => {
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

  async function investor(tx: TransactionContext) {
    const { sql } = tx;
    const tenant = randomUUID();
    const org = randomUUID();
    await sql`insert into identity.tenants (id, name) values (${tenant}, 'Mandate A')`;
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${org}, ${tenant}, 'investment_firm', 'Mandate A', ${`mandate-a-${org.slice(0, 8)}`})`;
    await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
    const authUserId = randomUUID();
    await sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenant}, ${org}, ${profile.id})`;
    await sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    await sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    const investorOrg = randomUUID();
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorOrg}, ${tenant}, ${org}, 'VC', 'Mandate A Ventures')`;
    const mandate = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, discovery_mode)
      values (${mandate}, ${tenant}, ${investorOrg}, 'Seed fintech', 'ACTIVE', now(), ${profile.id}, 'BALANCED')`;
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    const [row] = await sql<{ version: number }[]>`
      select version from core.investor_mandates where id = ${mandate}`;
    return {
      actor: resolution.context,
      mandate,
      membershipId,
      canonicalVersion: row?.version ?? 0,
    };
  }

  async function inRollback(
    work: (tx: TransactionContext) => Promise<void>,
  ): Promise<void> {
    let done = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(tx);
        done = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(done).toBe(true);
  }

  const toolRead = (mandateId: string, version: number, note = MARKER) => ({
    displayName: "Mandate A Ventures",
    investorType: "VC",
    deploymentState: null,
    mandates: [{ mandateId, version, status: "ACTIVE", note }],
  });

  it("serves the kept read while current; a changed mandate is read again", async () => {
    await inRollback(async (tx) => {
      const { sql } = tx;
      const a = await investor(tx);
      const reads = createOwnMandateReads({
        knowledge: createPostgresCompanyKnowledge({ sql }),
        epochs: createPostgresContextEpochReader({ sql }),
      });
      expect(await reads.get(a.actor)).toBeNull();
      // A read of another version than the mandate's now is never kept.
      await reads.remember(
        a.actor,
        toolRead(a.mandate, a.canonicalVersion + 1),
      );
      expect(await reads.get(a.actor)).toBeNull();
      const read = toolRead(a.mandate, a.canonicalVersion);
      await reads.remember(a.actor, read);
      expect(await reads.get(a.actor)).toEqual(read);
      await sql`update core.investor_mandates set name = 'Series A fintech' where id = ${a.mandate}`;
      expect(await reads.get(a.actor)).toBeNull();
    });
  });

  it("passes F's isolation check", async () => {
    await inRollback(async (tx) => {
      const { sql } = tx;
      const a = await investor(tx);
      const b = await investor(tx);
      const reads = createOwnMandateReads({
        knowledge: createPostgresCompanyKnowledge({ sql }),
        epochs: createPostgresContextEpochReader({ sql }),
      });
      const violations = await checkContextIsolation(
        {
          name: "tierA.mandateRead",
          warm: async (actor) => {
            if (actor.userId === a.actor.userId) {
              await reads.remember(
                actor,
                toolRead(a.mandate, a.canonicalVersion),
              );
            } else {
              await reads.remember(
                actor,
                toolRead(b.mandate, b.canonicalVersion, "investor B's own"),
              );
            }
          },
          read: async (actor) => JSON.stringify(await reads.get(actor)),
          revokeFounder: async () => {
            await sql`update identity.organisation_memberships
                         set membership_status = 'revoked', left_at = now()
                       where id = ${a.membershipId}`;
          },
        },
        { founder: a.actor, investor: b.actor, marker: MARKER },
      );
      expect(violations).toEqual([]);
    });
  });
});
