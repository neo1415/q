import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  createPostgresCompanyKnowledge,
  type CompanyKnowledgePort,
} from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
} from "@capital-q/security";
import { checkContextIsolation } from "@capital-q/security/context-cache";
import {
  createPostgresActorContextResolver,
  createPostgresContextEpochReader,
} from "@capital-q/security/postgres";

import { createWorkingSnapshots } from "../src/composition/working-snapshot.js";

/**
 * K Part 4, Tier A against the local database: the per-actor working
 * snapshot is built once and reused across turns; a changed mandate (D's
 * version) rebuilds it; and F's isolation check (K Test 6) holds -- an
 * investor never obtains the founder's own company facts, and the
 * founder's revoked membership never reaches the warmed copy. One
 * rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MARKER = "FOUNDER-OWN-COMPANY-TIER-A-DO-NOT-LEAK";
class Rollback extends Error {}

describe("the working snapshot (K Part 4, Tier A)", () => {
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

  async function member(
    tx: TransactionContext,
    type: "company" | "investment_firm",
  ) {
    const { sql } = tx;
    const tenant = randomUUID();
    const org = randomUUID();
    await sql`insert into identity.tenants (id, name) values (${tenant}, 'Tier A')`;
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${org}, ${tenant}, ${type}, ${`Tier A ${type}`}, ${`tier-a-${org.slice(0, 8)}`})`;
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
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return {
      tenant,
      org,
      membershipId,
      userId: profile.id,
      actor: resolution.context,
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

  function counting(knowledge: CompanyKnowledgePort) {
    let builds = 0;
    return {
      knowledge: {
        ...knowledge,
        mandateSummary: (actor: ActorContext, id?: string | null) => {
          builds += 1;
          return knowledge.mandateSummary(actor, id);
        },
      } satisfies CompanyKnowledgePort,
      builds: () => builds,
    };
  }

  it("is built once and reused; a changed mandate rebuilds it", async () => {
    await inRollback(async (tx) => {
      const { sql } = tx;
      const investor = await member(tx, "investment_firm");
      const investorOrg = randomUUID();
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${investorOrg}, ${investor.tenant}, ${investor.org}, 'VC', 'Tier A Ventures')`;
      const mandate = randomUUID();
      await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id, discovery_mode)
        values (${mandate}, ${investor.tenant}, ${investorOrg}, 'Seed fintech', 'ACTIVE', now(), ${investor.userId}, 'BALANCED')`;

      const spy = counting(createPostgresCompanyKnowledge({ sql }));
      const snapshots = createWorkingSnapshots({
        sql,
        knowledge: spy.knowledge,
        epochs: createPostgresContextEpochReader({ sql }),
      });
      const first = await snapshots.forActor(investor.actor);
      expect(first?.side).toBe("INVESTOR");
      expect(first?.mandate?.name).toBe("Seed fintech");
      const second = await snapshots.forActor(investor.actor);
      expect(second).toBe(first);
      expect(spy.builds()).toBe(1);

      await sql`update core.investor_mandates set name = 'Series A fintech' where id = ${mandate}`;
      const third = await snapshots.forActor(investor.actor);
      expect(third?.mandate?.name).toBe("Series A fintech");
      expect(spy.builds()).toBe(2);
    });
  });

  it("passes F's isolation check: no cross-actor read, no survival of a revoked membership", async () => {
    await inRollback(async (tx) => {
      const { sql } = tx;
      const founder = await member(tx, "company");
      const investor = await member(tx, "investment_firm");
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description)
        values (${randomUUID()}, ${founder.tenant}, ${founder.org}, 'Tier A Robotics',
                ${`tier-a-co-${founder.org.slice(0, 8)}`}, ${MARKER})`;
      const snapshots = createWorkingSnapshots({
        sql,
        knowledge: createPostgresCompanyKnowledge({ sql }),
        epochs: createPostgresContextEpochReader({ sql }),
      });
      const violations = await checkContextIsolation(
        {
          name: "tierA.snapshot",
          warm: async (actor) => {
            await snapshots.forActor(actor);
          },
          read: async (actor) =>
            JSON.stringify(await snapshots.forActor(actor)),
          revokeFounder: async () => {
            await sql`update identity.organisation_memberships
                         set membership_status = 'revoked', left_at = now()
                       where id = ${founder.membershipId}`;
          },
        },
        { founder: founder.actor, investor: investor.actor, marker: MARKER },
      );
      expect(violations).toEqual([]);
    });
  });
});
