import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ContractValidationError,
  createEventRegistry,
  type CorrelationId,
  type CreateInvestorMandateRequest,
  type MandateConstraintInput,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  AuthorizationDeniedError,
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { INVESTOR_EVENTS } from "../src/events/index.js";
import {
  createInvestorService,
  createPostgresInvestorMandateQueryPort,
  InvestorMandateCreationConflictError,
  InvestorMandateIdSchema,
  InvestorMandateLifecycleError,
  InvestorMandateNotFoundError,
  InvestorVersionConflictError,
  type InvestorMandate,
  type InvestorOrganisationId,
  type InvestorService,
} from "../src/index.js";

/**
 * Declared-mandate behaviour against the real local database, in rolled-back
 * transactions. Covers the separations this packet protects: declared vs
 * everything else, AVOID vs HARD_EXCLUSION, exploratory vs hard exclusion,
 * representative/title vs authority, and privacy of raw text and values.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const RAW_SENTINEL = "PRIVATE-INVESTOR-MANDATE-TEXT-DO-NOT-EMIT";
const EXCLUSION_SENTINEL = "secret_exclusion_code_do_not_emit";

class Rollback extends Error {}

type Person = { principal: AuthenticatedPrincipal; membershipId: string };

type World = {
  readonly tx: TransactionContext;
  readonly service: InvestorService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext>;
  readonly adminA: Person;
  readonly memberA: Person;
  readonly adminB: Person;
  readonly investorA: InvestorOrganisationId;
  readonly investorB: InvestorOrganisationId;
  readonly tenantA: string;
  readonly orgA: string;
};

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

const registry = createEventRegistry([...INVESTOR_EVENTS]);

const STAGE: MandateConstraintInput = {
  dimension: "stage",
  operator: "IN",
  value: { kind: "codes", values: ["seed", "series_a"] },
  importance: "MUST",
  isHardExclusion: false,
};
const GEO: MandateConstraintInput = {
  dimension: "geography.country",
  operator: "IN",
  value: { kind: "codes", values: ["NG", "GH", "KE"] },
  importance: "STRONG",
  isHardExclusion: false,
};
const HARDWARE_AVOID: MandateConstraintInput = {
  dimension: "business.attribute",
  operator: "IN",
  value: { kind: "codes", values: ["hardware"] },
  importance: "AVOID",
  isHardExclusion: false,
};
const GAMBLING_EXCLUDED: MandateConstraintInput = {
  dimension: "red_flag",
  operator: "IN",
  value: { kind: "codes", values: [EXCLUSION_SENTINEL] },
  importance: "HARD_EXCLUSION",
  isHardExclusion: true,
};
const CUSTOM: MandateConstraintInput = {
  dimension: "custom.text",
  operator: "EQ",
  value: { kind: "text", text: "I only want founders who ship weekly." },
  importance: "NICE",
  isHardExclusion: false,
};

describe("@capital-q/investors mandates against local PostgreSQL", () => {
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

  async function withWorld(
    work: (world: World) => Promise<void>,
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
    } = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Mandate Tenant A");
        const tenantB = await insertTenant(tx, "Mandate Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Apex Ventures");
        const orgB = await insertOrganisation(tx, tenantB, "Beta Capital");
        const adminA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_admin",
        );
        const memberA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminB = await insertMember(
          tx,
          tenantB,
          orgB,
          "organisation_admin",
        );

        const transactions = nestedTransactions(tx);
        const realOutbox = createOutboxWriter({ registry });
        const service = createInvestorService({
          sql,
          transactions,
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          organisations: createPostgresOrganisationQueryPort({ sql }),
          outbox:
            options.outbox === undefined
              ? realOutbox
              : options.outbox(realOutbox),
          audit: createPostgresMaterialActionAuditWriter(),
        });
        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return resolution.context;
        };
        // Investor organisations through the real service, with a real
        // outbox so their events are registered.
        const investorA = (
          await createInvestorService({
            sql,
            transactions,
            authorization: createAuthorizationService(
              createPostgresAuthorizationPolicySource({ sql }),
            ),
            organisations: createPostgresOrganisationQueryPort({ sql }),
            outbox: realOutbox,
            audit: createPostgresMaterialActionAuditWriter(),
          }).createInvestorOrganisation({
            actor: await resolve(adminA.principal),
            input: { investorType: "VC" },
            idempotencyKey: "investor-a",
            correlationId: CORRELATION(),
          })
        ).id;
        const investorB = (
          await createInvestorService({
            sql,
            transactions,
            authorization: createAuthorizationService(
              createPostgresAuthorizationPolicySource({ sql }),
            ),
            organisations: createPostgresOrganisationQueryPort({ sql }),
            outbox: realOutbox,
            audit: createPostgresMaterialActionAuditWriter(),
          }).createInvestorOrganisation({
            actor: await resolve(adminB.principal),
            input: { investorType: "FAMILY_OFFICE" },
            idempotencyKey: "investor-b",
            correlationId: CORRELATION(),
          })
        ).id;

        await work({
          tx,
          service,
          resolve,
          adminA,
          memberA,
          adminB,
          investorA,
          investorB,
          tenantA,
          orgA,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'investment_firm', ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<Person> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
    };
  }

  function request(
    overrides: Partial<CreateInvestorMandateRequest> = {},
  ): CreateInvestorMandateRequest {
    return { name: "Primary Seed Mandate", ...overrides };
  }

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  async function eventsFor(
    tx: TransactionContext,
    correlationId: CorrelationId,
  ) {
    return tx.sql<
      { event_type: string; payload: { data: Record<string, unknown> } }[]
    >`
      select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId} order by event_type`;
  }

  async function auditsFor(
    tx: TransactionContext,
    correlationId: CorrelationId,
  ) {
    return tx.sql<{ action_type: string; metadata: Record<string, unknown> }[]>`
      select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
  }

  function byDimension(mandate: InvestorMandate, dimension: string) {
    return mandate.constraints.filter((c) => c.dimension === dimension);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  it("an investor admin creates a DRAFT v1 mandate with typed constraints, typical cheque, audit and event; nothing else is created", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, investorA, tenantA }) => {
        const actor = await resolve(adminA.principal);
        const correlationId = CORRELATION();
        const mandate = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({
            discoveryMode: "EXPLORATORY",
            chequeRange: {
              currency: "USD",
              min: "250000",
              typical: "750000.50",
              max: "2000000",
            },
            minStageCode: "pre_seed",
            maxStageCode: "series_a",
            rawMandateText: RAW_SENTINEL,
            constraints: [
              STAGE,
              GEO,
              HARDWARE_AVOID,
              GAMBLING_EXCLUDED,
              CUSTOM,
            ],
          }),
          idempotencyKey: "mandate-1",
          correlationId,
        });

        expect(mandate.id).not.toBe(investorA);
        expect(mandate.tenantId).toBe(tenantA);
        expect(mandate.investorOrganisationId).toBe(investorA);
        expect(mandate.status).toBe("DRAFT");
        expect(mandate.version).toBe(1);
        expect(mandate.effectiveFrom).toBeNull();
        expect(mandate.discoveryMode).toBe("EXPLORATORY");
        expect(mandate.minCheque).toBe("250000");
        expect(mandate.maxCheque).toBe("2000000");
        expect(mandate.currencyCode).toBe("USD");
        expect(mandate.createdByUserId).toBe(actor.userId);
        expect(mandate.constraints).toHaveLength(6);
        const typical = byDimension(mandate, "cheque.typical")[0];
        expect(typical?.value).toEqual({
          kind: "amount",
          amount: "750000.50",
          currency: "USD",
        });
        // Exploratory mode and a hard exclusion coexist; AVOID stays soft.
        expect(byDimension(mandate, "red_flag")[0]?.isHardExclusion).toBe(true);
        expect(byDimension(mandate, "business.attribute")[0]).toMatchObject({
          importance: "AVOID",
          isHardExclusion: false,
        });

        const audits = await auditsFor(tx, correlationId);
        expect(audits).toHaveLength(1);
        expect(audits[0]?.action_type).toBe("investor_mandate.created");
        expect(audits[0]?.metadata).toEqual({
          investorOrganisationId: investorA,
          constraintCount: 6,
        });
        const events = await eventsFor(tx, correlationId);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("core.investor_mandate.created");
        expect(events[0]?.payload.data).toEqual({
          investorMandateId: mandate.id,
          investorOrganisationId: investorA,
          version: 1,
        });
        for (const text of [RAW_SENTINEL, EXCLUSION_SENTINEL, "750000"]) {
          expect(JSON.stringify(events)).not.toContain(text);
          expect(JSON.stringify(audits)).not.toContain(text);
        }

        // No behaviour feature, Q knowledge, GateQ rule set, fund or slate exists.
        const tables = await tx.sql<{ n: string }[]>`
        select table_schema || '.' || table_name as n from information_schema.tables
         where table_name in ('investor_behavior_features', 'gateq_rule_sets', 'investment_funds',
                              'recommendation_slates', 'q_knowledge_objects', 'onboarding_investor_mandate')`;
        expect(tables).toEqual([]);

        // Query port: typed snapshot with automated-use, no raw text.
        const snapshot = await createPostgresInvestorMandateQueryPort({
          sql: tx.sql,
        }).getMandate(actor.tenantId, investorA, mandate.id);
        expect(snapshot?.cheque).toEqual({
          currency: "USD",
          min: "250000",
          typical: "750000.50",
          max: "2000000",
        });
        expect(
          snapshot?.constraints.find((c) => c.dimension === "custom.text")
            ?.automatedUse,
        ).toBe("MANUAL_ONLY");
        expect(
          snapshot?.constraints.find((c) => c.dimension === "stage")
            ?.automatedUse,
        ).toBe("ELIGIBLE");
        expect(JSON.stringify(snapshot)).not.toContain(RAW_SENTINEL);
      },
    );
  });

  it("rejects protected dimensions, executable-looking rules and inconsistent cheques before anything is written", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, investorA }) => {
      const actor = await resolve(adminA.principal);
      await expect(
        service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({
            chequeRange: { currency: "USD", min: "5", max: "1" },
          }),
          idempotencyKey: "bad-cheque",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      await expect(
        service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({
            constraints: [
              {
                ...GEO,
                operator: "SQL" as never,
                value: { kind: "text", text: "drop table" } as never,
              },
            ],
          }),
          idempotencyKey: "bad-rule",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
      expect(
        await count(
          tx.sql`select count(*)::int as count from core.investor_mandates where investor_organisation_id = ${investorA}`,
        ),
      ).toBe(0);
    });
  });

  it("is retry-safe and refuses key reuse with a different payload; a member and a titled representative cannot create", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, investorA }) => {
        const actor = await resolve(adminA.principal);
        const input = request({ constraints: [STAGE] });
        const first = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input,
          idempotencyKey: "retry",
          correlationId: CORRELATION(),
        });
        const again = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: { ...input, constraints: [{ ...STAGE }] },
          idempotencyKey: "retry",
          correlationId: CORRELATION(),
        });
        expect(again.id).toBe(first.id);
        await expect(
          service.createInvestorMandate({
            actor,
            investorOrganisationId: investorA,
            input: request({ constraints: [GEO] }),
            idempotencyKey: "retry",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorMandateCreationConflictError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandates where investor_organisation_id = ${investorA}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandate_constraints where mandate_id = ${first.id}`,
          ),
        ).toBe(1);

        const member = await resolve(memberA.principal);
        await service.upsertMyInvestorRepresentative({
          actor: member,
          investorOrganisationId: investorA,
          input: { businessTitle: "Partner" },
          correlationId: CORRELATION(),
        });
        await expect(
          service.createInvestorMandate({
            actor: member,
            investorOrganisationId: investorA,
            input: request(),
            idempotencyKey: "member",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      },
    );
  });

  it("rolls back mandate, constraints, audit and idempotency record when the event cannot be enqueued", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, investorA }) => {
        const correlationId = CORRELATION();
        await expect(
          service.createInvestorMandate({
            actor: await resolve(adminA.principal),
            investorOrganisationId: investorA,
            input: request({ constraints: [STAGE, GEO] }),
            idempotencyKey: "doomed",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandates where investor_organisation_id = ${investorA}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandate_constraints where tenant_id = (select tenant_id from core.investor_organisations where id = ${investorA})`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandate_creation_requests where investor_organisation_id = ${investorA}`,
          ),
        ).toBe(0);
      },
      {
        outbox: () => ({
          enqueue: () => Promise.reject(new Error("outbox unavailable")),
        }),
      },
    );
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  it("lists only the investor's own mandates with a cursor and status filter; foreign ids are not found; members may view", async () => {
    await withWorld(
      async ({
        tx,
        service,
        resolve,
        adminA,
        memberA,
        adminB,
        investorA,
        investorB,
      }) => {
        const a = await resolve(adminA.principal);
        const b = await resolve(adminB.principal);
        const created: string[] = [];
        for (const name of ["Fund I", "Fund II", "Opportunity"]) {
          const mandate = await service.createInvestorMandate({
            actor: a,
            investorOrganisationId: investorA,
            input: request({ name }),
            idempotencyKey: `list-${name}`,
            correlationId: CORRELATION(),
          });
          created.push(mandate.id);
          // now() is frozen inside this rolled-back test transaction; in
          // production every request commits separately. Give each row the
          // distinct creation instant it would have had.
          await tx.sql`update core.investor_mandates set created_at = clock_timestamp() where id = ${mandate.id}`;
        }
        const bMandate = await service.createInvestorMandate({
          actor: b,
          investorOrganisationId: investorB,
          input: request({ name: "B strategy" }),
          idempotencyKey: "list-b",
          correlationId: CORRELATION(),
        });

        const page1 = await service.listInvestorMandates({
          actor: a,
          investorOrganisationId: investorA,
          limit: 2,
        });
        expect(page1.items.map((m) => m.name)).toEqual([
          "Opportunity",
          "Fund II",
        ]);
        expect(page1.nextCursor).toBeDefined();
        const page2 = await service.listInvestorMandates({
          actor: a,
          investorOrganisationId: investorA,
          limit: 2,
          cursor: page1.nextCursor,
        });
        expect(page2.items.map((m) => m.name)).toEqual(["Fund I"]);
        expect(page2.nextCursor).toBeUndefined();
        expect(
          (
            await service.listInvestorMandates({
              actor: a,
              investorOrganisationId: investorA,
              status: "ACTIVE",
            })
          ).items,
        ).toEqual([]);

        // Investor B's ids are invisible to A in every direction.
        await expect(
          service.listInvestorMandates({
            actor: a,
            investorOrganisationId: investorB,
          }),
        ).rejects.toThrow(/investor organisation was not found/);
        await expect(
          service.getInvestorMandate({
            actor: a,
            investorOrganisationId: investorA,
            mandateId: bMandate.id,
          }),
        ).rejects.toBeInstanceOf(InvestorMandateNotFoundError);
        await expect(
          service.getInvestorMandate({
            actor: b,
            investorOrganisationId: investorB,
            mandateId: InvestorMandateIdSchema.parse(created[0] ?? ""),
          }),
        ).rejects.toBeInstanceOf(InvestorMandateNotFoundError);

        const member = await resolve(memberA.principal);
        await expect(
          service.getInvestorMandate({
            actor: member,
            investorOrganisationId: investorA,
            mandateId: InvestorMandateIdSchema.parse(created[0] ?? ""),
          }),
        ).resolves.toMatchObject({ name: "Fund I" });
      },
    );
  });

  // -------------------------------------------------------------------------
  // Updating
  // -------------------------------------------------------------------------

  it("updates cheque, discovery mode and constraints atomically with change kinds; values never reach events or audit", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, investorA }) => {
        const actor = await resolve(adminA.principal);
        const mandate = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({
            discoveryMode: "STRICT",
            chequeRange: { currency: "USD", min: "100000", max: "500000" },
            constraints: [STAGE, GEO, HARDWARE_AVOID],
          }),
          idempotencyKey: "update",
          correlationId: CORRELATION(),
        });
        const stageId = byDimension(mandate, "stage")[0]?.id;

        // A -> D style replacement: keep stage, drop geography, escalate
        // hardware AVOID -> HARD_EXCLUSION, add a NICE green flag.
        const correlationId = CORRELATION();
        const updated = await service.updateInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          mandateId: mandate.id,
          input: {
            expectedVersion: 1,
            discoveryMode: "BALANCED",
            chequeRange: {
              currency: "USD",
              min: "100000",
              typical: "250000",
              max: "750000",
            },
            rawMandateText: RAW_SENTINEL,
            constraints: [
              STAGE,
              {
                ...HARDWARE_AVOID,
                importance: "HARD_EXCLUSION",
                isHardExclusion: true,
              },
              {
                dimension: "green_flag",
                operator: "IN",
                value: { kind: "codes", values: ["enterprise_customers"] },
                importance: "NICE",
                isHardExclusion: false,
              },
            ],
          },
          correlationId,
        });
        expect(updated.version).toBe(2);
        expect(updated.discoveryMode).toBe("BALANCED");
        expect(updated.maxCheque).toBe("750000");
        expect(updated.constraints.map((c) => c.dimension).sort()).toEqual([
          "business.attribute",
          "cheque.typical",
          "green_flag",
          "stage",
        ]);
        // Unchanged constraints keep their identity.
        expect(byDimension(updated, "stage")[0]?.id).toBe(stageId);
        expect(
          byDimension(updated, "business.attribute")[0]?.isHardExclusion,
        ).toBe(true);

        const events = await eventsFor(tx, correlationId);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("core.investor_mandate.updated");
        const data = events[0]?.payload.data;
        expect(data?.["version"]).toBe(2);
        expect(data?.["changedFields"]).toEqual([
          "discoveryMode",
          "rawMandateText",
          "chequeRange",
          "constraints",
        ]);
        expect(data?.["changeKinds"]).toEqual(
          expect.arrayContaining([
            "DISCOVERY_MODE",
            "RAW_TEXT",
            "CHEQUE",
            "GEOGRAPHY",
            "PREFERENCE",
            "HARD_EXCLUSION",
          ]),
        );
        const audits = await auditsFor(tx, correlationId);
        expect(audits[0]?.action_type).toBe("investor_mandate.updated");
        expect(audits[0]?.metadata["previousVersion"]).toBe(1);
        expect(audits[0]?.metadata["newVersion"]).toBe(2);
        for (const text of [
          RAW_SENTINEL,
          "hardware",
          "250000",
          "enterprise_customers",
          "NG",
        ]) {
          expect(JSON.stringify(events[0]?.payload)).not.toContain(text);
          expect(JSON.stringify(audits[0]?.metadata)).not.toContain(text);
        }
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${RAW_SENTINEL}%`}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_mandates where raw_mandate_text = ${RAW_SENTINEL}`,
          ),
        ).toBe(1);

        // NICE -> STRONG is a PREFERENCE change; STRICT stays as chosen.
        const soft = CORRELATION();
        await service.updateInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          mandateId: mandate.id,
          input: {
            expectedVersion: 2,
            constraints: [
              STAGE,
              {
                ...HARDWARE_AVOID,
                importance: "HARD_EXCLUSION",
                isHardExclusion: true,
              },
              {
                dimension: "green_flag",
                operator: "IN",
                value: { kind: "codes", values: ["enterprise_customers"] },
                importance: "STRONG",
                isHardExclusion: false,
              },
            ],
          },
          correlationId: soft,
        });
        const softEvents = await eventsFor(tx, soft);
        expect(softEvents[0]?.payload.data["changeKinds"]).toEqual([
          "PREFERENCE",
        ]);

        // A no-op update returns the current row and emits nothing.
        const noop = CORRELATION();
        const same = await service.updateInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          mandateId: mandate.id,
          input: { expectedVersion: 3, discoveryMode: "BALANCED" },
          correlationId: noop,
        });
        expect(same.version).toBe(3);
        expect(await eventsFor(tx, noop)).toHaveLength(0);

        // Member (even as a titled representative) cannot edit; stale writes conflict.
        const member = await resolve(memberA.principal);
        await service.upsertMyInvestorRepresentative({
          actor: member,
          investorOrganisationId: investorA,
          input: { businessTitle: "Partner" },
          correlationId: CORRELATION(),
        });
        await expect(
          service.updateInvestorMandate({
            actor: member,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
            input: { expectedVersion: 3, name: "Hijacked" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        await expect(
          service.updateInvestorMandate({
            actor,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
            input: { expectedVersion: 1, name: "Stale" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorVersionConflictError);
        const [row] = await tx.sql<{ name: string; version: number }[]>`
        select name, version from core.investor_mandates where id = ${mandate.id}`;
        expect(row).toEqual({ name: "Primary Seed Mandate", version: 3 });
      },
    );
  });

  it("keeps the old constraint set intact when a replacement fails mid-transaction", async () => {
    let calls = 0;
    await withWorld(
      async ({ tx, service, resolve, adminA, investorA }) => {
        const actor = await resolve(adminA.principal);
        const mandate = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({ constraints: [STAGE, GEO, HARDWARE_AVOID] }),
          idempotencyKey: "atomic",
          correlationId: CORRELATION(),
        });
        calls = 1; // the creation event succeeded; the next enqueue fails
        await expect(
          service.updateInvestorMandate({
            actor,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
            input: {
              expectedVersion: 1,
              constraints: [STAGE, GAMBLING_EXCLUDED],
            },
            correlationId: CORRELATION(),
          }),
        ).rejects.toThrow("outbox unavailable");
        const rows = await tx.sql<{ dimension: string }[]>`
          select dimension from core.investor_mandate_constraints where mandate_id = ${mandate.id} order by dimension`;
        expect(rows.map((r) => r.dimension)).toEqual([
          "business.attribute",
          "geography.country",
          "stage",
        ]);
        const [row] = await tx.sql<{ version: number }[]>`
          select version from core.investor_mandates where id = ${mandate.id}`;
        expect(row?.version).toBe(1);
      },
      {
        outbox: (real) => ({
          enqueue: (tx, event) =>
            calls === 0
              ? real.enqueue(tx, event)
              : Promise.reject(new Error("outbox unavailable")),
        }),
      },
    );
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it("activates a draft with server time, closes it as history, and refuses edits or reactivation afterwards", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, investorA }) => {
        const actor = await resolve(adminA.principal);
        const mandate = await service.createInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          input: request({ constraints: [GAMBLING_EXCLUDED] }),
          idempotencyKey: "lifecycle",
          correlationId: CORRELATION(),
        });
        const member = await resolve(memberA.principal);
        await expect(
          service.activateInvestorMandate({
            actor: member,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
            input: {},
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);

        const activation = CORRELATION();
        const active = await service.activateInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          mandateId: mandate.id,
          input: { expectedVersion: 1 },
          correlationId: activation,
        });
        expect(active.status).toBe("ACTIVE");
        expect(active.version).toBe(2);
        expect(active.effectiveFrom).not.toBeNull();
        const activated = await eventsFor(tx, activation);
        expect(activated[0]?.event_type).toBe(
          "core.investor_mandate.activated",
        );
        expect(activated[0]?.payload.data["effectiveFrom"]).toBe(
          active.effectiveFrom,
        );
        expect((await auditsFor(tx, activation))[0]?.action_type).toBe(
          "investor_mandate.activated",
        );
        await expect(
          service.activateInvestorMandate({
            actor,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
            input: {},
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorMandateLifecycleError);
        expect(
          (
            await createPostgresInvestorMandateQueryPort({
              sql: tx.sql,
            }).listActiveMandates(actor.tenantId, investorA)
          ).map((m) => m.id),
        ).toEqual([mandate.id]);
        // Nothing was ranked synchronously: no slate/recommendation table exists.
        expect(
          (
            await tx.sql<{ n: string }[]>`
            select table_name as n from information_schema.tables
             where table_name like '%slate%' or table_name like '%recommendation%'`
          ).length,
        ).toBe(0);

        const closing = CORRELATION();
        const closed = await service.closeInvestorMandate({
          actor,
          investorOrganisationId: investorA,
          mandateId: mandate.id,
          input: { expectedVersion: 2 },
          correlationId: closing,
        });
        expect(closed.status).toBe("CLOSED");
        expect(closed.version).toBe(3);
        expect(closed.effectiveTo).not.toBeNull();
        expect((await eventsFor(tx, closing))[0]?.event_type).toBe(
          "core.investor_mandate.closed",
        );
        // History remains, with its hard exclusion.
        await expect(
          service.getInvestorMandate({
            actor,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
          }),
        ).resolves.toMatchObject({ status: "CLOSED" });
        expect(byDimension(closed, "red_flag")).toHaveLength(1);

        for (const attempt of [
          () =>
            service.updateInvestorMandate({
              actor,
              investorOrganisationId: investorA,
              mandateId: mandate.id,
              input: { expectedVersion: 3, name: "Reopened" },
              correlationId: CORRELATION(),
            }),
          () =>
            service.activateInvestorMandate({
              actor,
              investorOrganisationId: investorA,
              mandateId: mandate.id,
              input: {},
              correlationId: CORRELATION(),
            }),
          () =>
            service.closeInvestorMandate({
              actor,
              investorOrganisationId: investorA,
              mandateId: mandate.id,
              input: {},
              correlationId: CORRELATION(),
            }),
        ]) {
          await expect(attempt()).rejects.toBeInstanceOf(
            InvestorMandateLifecycleError,
          );
        }
        const [row] = await tx.sql<{ status: string; version: number }[]>`
        select status, version from core.investor_mandates where id = ${mandate.id}`;
        expect(row).toEqual({ status: "CLOSED", version: 3 });
      },
    );
  });

  it("revoking the organisation membership removes mandate access while the mandate and representation remain", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, investorA }) => {
        const admin = await resolve(adminA.principal);
        const mandate = await service.createInvestorMandate({
          actor: admin,
          investorOrganisationId: investorA,
          input: request(),
          idempotencyKey: "revoke",
          correlationId: CORRELATION(),
        });
        const member = await resolve(memberA.principal);
        await service.upsertMyInvestorRepresentative({
          actor: member,
          investorOrganisationId: investorA,
          input: { businessTitle: "Partner" },
          correlationId: CORRELATION(),
        });
        await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = clock_timestamp() where id = ${memberA.membershipId}`;
        await expect(resolve(memberA.principal)).rejects.toThrow(
          "CONTEXT_REQUIRED",
        );
        await expect(
          service.getInvestorMandate({
            actor: member,
            investorOrganisationId: investorA,
            mandateId: mandate.id,
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_representatives where user_id = ${member.userId} and is_current`,
          ),
        ).toBe(1);
      },
    );
  });
});
