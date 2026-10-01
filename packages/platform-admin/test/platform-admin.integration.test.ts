import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";

import { createPlatformAdmin, type AdminGrant } from "../src/index.js";

/**
 * The console against local Supabase Postgres (migration
 * 20261115000000). Every case runs in one transaction that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type World = {
  readonly owner: string;
  readonly ts: string;
  readonly analyst: string;
  readonly member: string;
  readonly ownerAuth: string;
  readonly relationshipId: string;
};

async function person(tx: TransactionContext, email: string) {
  const auth = randomUUID();
  await tx.sql`insert into auth.users (id, email) values (${auth}, ${email})`;
  const [row] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (row === undefined) throw new Error("profile trigger missing");
  return { id: row.id, auth };
}

async function world(tx: TransactionContext): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const owner = await person(tx, `owner-${tag}@example.invalid`);
  const ts = await person(tx, `ts-${tag}@example.invalid`);
  const analyst = await person(tx, `analyst-${tag}@example.invalid`);
  const member = await person(tx, `member-${tag}@example.invalid`);
  // Only these admins exist inside this transaction.
  await tx.sql`delete from identity.platform_admins`;
  await tx.sql`insert into identity.platform_admins (user_id, role) values
    (${owner.id}, 'platform_owner'), (${ts.id}, 'trust_and_safety'), (${analyst.id}, 'analyst')`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  await tx.sql`insert into identity.tenants (id, name) values (${tenantA}, 'PA A'), (${tenantB}, 'PA B')`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
    (${orgA}, ${tenantA}, 'company', 'PA Co', ${`pa-co-${tag}`}),
    (${orgB}, ${tenantB}, 'investment_firm', 'PA Capital', ${`pa-cap-${tag}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values
    (${tenantA}, ${orgA}), (${tenantB}, ${orgB})`;
  await tx.sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id) values
    (${tenantA}, ${orgA}, ${member.id})`;
  const companyId = randomUUID();
  const investorId = randomUUID();
  await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
    values (${companyId}, ${tenantA}, ${orgA}, 'PA Co', ${`pa-co-${tag}`})`;
  await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
    values (${investorId}, ${tenantB}, ${orgB}, 'VC', 'PA Capital')`;
  const relationshipId = randomUUID();
  await tx.sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
    values (${relationshipId}, ${tenantA}, ${companyId}, ${investorId}, 'CONNECTED')`;
  const conversation = randomUUID();
  await tx.sql`insert into communication.conversations (id, tenant_id, relationship_id)
    values (${conversation}, ${tenantA}, ${relationshipId})`;
  await tx.sql`insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
    values (${tenantA}, ${conversation}, ${member.id}, 'COMPANY', 'TEXT', 'Private words', ${`pa-${tag}`})`;
  return {
    owner: owner.id,
    ts: ts.id,
    analyst: analyst.id,
    member: member.id,
    ownerAuth: owner.auth,
    relationshipId,
  };
}

function inOne(tx: TransactionContext): TransactionManager {
  return { run: (work) => work(tx) };
}

describe("@capital-q/platform-admin against local Postgres", () => {
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

  async function scenario(
    body: (
      admin: ReturnType<typeof createPlatformAdmin>,
      w: World,
      tx: TransactionContext,
    ) => Promise<void>,
  ) {
    try {
      await db.transactions.run(async (tx) => {
        const w = await world(tx);
        const admin = createPlatformAdmin({
          sql: tx.sql,
          transactions: inOne(tx),
        });
        await body(admin, w, tx);
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  async function stepUp(
    admin: ReturnType<typeof createPlatformAdmin>,
    tx: TransactionContext,
    userId: string,
  ) {
    const [row] = await tx.sql<{ auth_user_id: string }[]>`
      select auth_user_id from identity.user_profiles where id = ${userId}`;
    const outcome = await admin.recordStepUp({
      userId,
      freshAuthUserId: row?.auth_user_id ?? "",
      authentication: { method: "password", at: Math.floor(Date.now() / 1000) },
    });
    expect(outcome.kind).toBe("RECORDED");
  }

  async function granted(
    admin: ReturnType<typeof createPlatformAdmin>,
    userId: string,
    permission: Parameters<typeof admin.authorize>[1],
  ): Promise<AdminGrant> {
    const access = await admin.authorize(userId, permission);
    if (access.kind !== "GRANTED")
      throw new Error(`not granted: ${access.kind}`);
    return access.grant;
  }

  it("refuses non-admins, roles without the permission, and writes without a step-up", async () => {
    await scenario(async (admin, w, tx) => {
      expect((await admin.authorize(w.member, "overview.read")).kind).toBe(
        "NOT_FOUND",
      );
      expect((await admin.authorize(w.analyst, "accounts.read")).kind).toBe(
        "NOT_FOUND",
      );
      expect((await admin.authorize(w.ts, "accounts.suspend")).kind).toBe(
        "STEP_UP_REQUIRED",
      );
      // A stale re-authentication is no step-up.
      const stale = await admin.recordStepUp({
        userId: w.ts,
        freshAuthUserId: randomUUID(),
        authentication: {
          method: "password",
          at: Math.floor(Date.now() / 1000),
        },
      });
      expect(stale.kind).toBe("STALE");
      await stepUp(admin, tx, w.ts);
      expect((await admin.authorize(w.ts, "accounts.suspend")).kind).toBe(
        "GRANTED",
      );
      // A non-admin cannot step up at all.
      expect(
        (
          await admin.recordStepUp({
            userId: w.member,
            freshAuthUserId: randomUUID(),
            authentication: {
              method: "password",
              at: Math.floor(Date.now() / 1000),
            },
          })
        ).kind,
      ).toBe("NOT_FOUND");
    });
  });

  it("suspends with a reason, never oneself, and audits it", async () => {
    await scenario(async (admin, w, tx) => {
      await stepUp(admin, tx, w.ts);
      const grant = await granted(admin, w.ts, "accounts.suspend");
      expect(
        (
          await admin.setSuspension(grant, {
            userId: w.ts,
            suspend: true,
            reason: "x self",
          })
        ).kind,
      ).toBe("SELF");
      expect(
        await admin.setSuspension(grant, {
          userId: w.member,
          suspend: true,
          reason: "Fraud report",
        }),
      ).toEqual({ kind: "DONE", suspended: true });
      expect(await admin.isSuspended(w.member)).toBe(true);
      expect(
        (
          await admin.setSuspension(grant, {
            userId: w.member,
            suspend: true,
            reason: "again",
          })
        ).kind,
      ).toBe("UNCHANGED");
      const audit = await admin.searchAudit(grant, {
        source: "PLATFORM",
        actionPrefix: "account.",
      });
      expect(audit.rows[0]).toMatchObject({
        actionType: "account.suspend",
        resourceId: w.member,
        actorRole: "trust_and_safety",
        reason: "Fraud report",
      });
    });
  });

  it("break-glass needs a second person while one exists; only the requester reads, and reads are logged", async () => {
    await scenario(async (admin, w, tx) => {
      await stepUp(admin, tx, w.owner);
      await stepUp(admin, tx, w.ts);
      const ownerGrant = await granted(admin, w.owner, "breakglass.request");
      const requested = await admin.requestBreakGlass(ownerGrant, {
        targetType: "RELATIONSHIP_CHAT",
        targetId: w.relationshipId,
        reason: "A harassment report names this conversation",
      });
      if (requested === null) throw new Error("not requested");
      const ownerApprove = await granted(admin, w.owner, "breakglass.approve");
      expect(
        await admin.decideBreakGlass(ownerApprove, {
          requestId: requested.requestId,
          approve: true,
          note: "self",
        }),
      ).toEqual({ kind: "SECOND_PERSON_REQUIRED" });
      expect(
        await admin.readChatUnderBreakGlass(ownerGrant, requested.requestId),
      ).toBeNull();
      const tsApprove = await granted(admin, w.ts, "breakglass.approve");
      expect(
        await admin.decideBreakGlass(tsApprove, {
          requestId: requested.requestId,
          approve: true,
          note: "Report checked",
        }),
      ).toEqual({ kind: "DECIDED", status: "APPROVED" });
      const tsRead = await granted(admin, w.ts, "breakglass.request");
      expect(
        await admin.readChatUnderBreakGlass(tsRead, requested.requestId),
      ).toBeNull();
      const chat = await admin.readChatUnderBreakGlass(
        ownerGrant,
        requested.requestId,
      );
      expect(chat?.messages.map((m) => m.body)).toEqual(["Private words"]);
      const [reads] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from platform_ops.break_glass_reads where request_id = ${requested.requestId}`;
      expect(reads?.n).toBe(1);
    });
  });

  it("allows SOLO approval only when no other approver exists", async () => {
    await scenario(async (admin, w, tx) => {
      await tx.sql`delete from identity.platform_admins where user_id = ${w.ts}`;
      await stepUp(admin, tx, w.owner);
      const grant = await granted(admin, w.owner, "breakglass.approve");
      const requested = await admin.requestBreakGlass(grant, {
        targetType: "RELATIONSHIP_CHAT",
        targetId: w.relationshipId,
        reason: "Solo founder checking a report today",
      });
      if (requested === null) throw new Error("not requested");
      expect(
        await admin.decideBreakGlass(grant, {
          requestId: requested.requestId,
          approve: true,
          note: "solo",
        }),
      ).toEqual({ kind: "DECIDED", status: "APPROVED" });
      const [row] = await tx.sql<{ approval_kind: string }[]>`
        select approval_kind from platform_ops.break_glass_requests where id = ${requested.requestId}`;
      expect(row?.approval_kind).toBe("SOLO");
    });
  });

  it("guards the team: never oneself, never the last owner", async () => {
    await scenario(async (admin, w, tx) => {
      await stepUp(admin, tx, w.owner);
      const grant = await granted(admin, w.owner, "roles.manage");
      const [email] = await tx.sql<{ email: string }[]>`
        select u.email::text as email from auth.users u
          join identity.user_profiles p on p.auth_user_id = u.id where p.id = ${w.member}`;
      const added = await admin.setTeamRole(grant, {
        email: email?.email ?? "",
        role: "support",
        reason: "New support hire",
      });
      expect(added.kind).toBe("DONE");
      expect((await admin.authorize(w.member, "accounts.read")).kind).toBe(
        "GRANTED",
      );
      expect(
        (await admin.revokeTeamRole(grant, { userId: w.owner, reason: "self" }))
          .kind,
      ).toBe("SELF");
      expect(
        (
          await admin.revokeTeamRole(grant, {
            userId: w.member,
            reason: "Left",
          })
        ).kind,
      ).toBe("DONE");
      expect((await admin.authorize(w.member, "accounts.read")).kind).toBe(
        "NOT_FOUND",
      );
      // The trust & safety admin cannot manage the team at all.
      expect((await admin.authorize(w.ts, "roles.manage")).kind).toBe(
        "NOT_FOUND",
      );
    });
  });

  it("switches a kill switch with a reason and the reader sees it", async () => {
    await scenario(async (admin, w, tx) => {
      await tx.sql`insert into identity.platform_admins (user_id, role) values (${w.member}, 'operator')`;
      await stepUp(admin, tx, w.member);
      const grant = await granted(admin, w.member, "flags.write");
      expect(
        await admin.setFlag(grant, {
          key: "q.daily",
          enabled: false,
          reason: "Bad edition",
        }),
      ).toBe("CHANGED");
      expect(await admin.isFlagEnabled("q.daily")).toBe(false);
      const flags = await admin.listFlags(grant);
      expect(flags.find((f) => f.key === "q.daily")?.history[0]?.reason).toBe(
        "Bad edition",
      );
    });
  });

  it("runs every console read against the real schema", async () => {
    await scenario(async (admin, w) => {
      const grant = await granted(admin, w.owner, "overview.read");
      await admin.overview(grant);
      await admin.attribution(grant);
      await admin.disputes(grant);
      await admin.paused(grant);
      expect(
        (await admin.searchAccounts(grant, "member-")).length,
      ).toBeGreaterThan(0);
      expect(
        (await admin.accountDetail(grant, w.member))?.memberships,
      ).toHaveLength(1);
      expect(
        (await admin.searchOrganisations(grant, "PA C")).length,
      ).toBeGreaterThan(0);
      const orgs = await admin.searchOrganisations(grant, "PA Co");
      const detail = await admin.organisationDetail(
        grant,
        orgs[0]?.organisationId ?? "",
      );
      expect(detail?.kind).toBe("COMPANY");
      expect(detail?.relationships).toBe(1);
      await admin.verificationQueue(grant);
      await admin.safetyQueue(grant, true);
      const monitor = await admin.qMonitor(grant, "7d");
      expect(monitor.window).toBe("7d");
      await admin.qErrors(grant);
      expect(await admin.qRunTrace(grant, randomUUID())).toBeNull();
      await admin.listBreakGlass(grant);
      expect((await admin.listTeam(grant)).length).toBe(3);
      const email = await admin.emailPanel(grant, false);
      expect(email.provider).toBe("NONE");
      const page = await admin.searchAudit(grant, { limit: 1 });
      if (page.nextCursor !== null) {
        await admin.searchAudit(grant, { limit: 1, cursor: page.nextCursor });
      }
    });
  });
});
