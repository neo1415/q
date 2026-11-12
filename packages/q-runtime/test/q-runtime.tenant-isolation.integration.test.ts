import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  QConversationIdSchema,
  QRunIdSchema,
  type CorrelationId,
  type CreateQRunRequest,
  type QConversationId,
  type QRunId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createLogger } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import {
  createCompanyQSubjectResolver,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  type QRuntimeService,
} from "../src/index.js";

/**
 * Application-path tenant isolation for Q conversations, messages and runs
 * (security lane, 2026-11-12).
 *
 * Production runs every server statement as `postgres`, which bypasses RLS
 * (ADR 0065; docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md), and q_runtime
 * conversations/messages/runs are server-only, so ownership in the runtime
 * is the only fence. Against the local database, as `postgres`, through the
 * real service: a person of another tenant gets the same answer for a real
 * conversation, run or message id as for one that never existed, on every
 * read and on every write that names an id, and no conversation, message,
 * run or run event is written. Refusals of a REAL id are recorded in
 * audit.security_events by design (ADR 0012), so that table is not part of
 * the write surface.
 *
 * Revocation: the real request path (the actor-context resolver) refuses a
 * revoked membership. A stale context is NOT re-checked by q-runtime:
 * conversations are owned by (tenant, person), so the former member still
 * reads their own thread. That is recorded below as today's behaviour and
 * raised for an owner decision in docs/ai-handoff/PERSON-VS-ORG-DATA.md.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const PRIVATE_MARKER = "PRIVATE-ISOLATION-Q-TURN-DO-NOT-EMIT";

const WRITE_SURFACE = [
  "q_runtime.conversations",
  "q_runtime.conversation_messages",
  "q_runtime.conversation_message_marks",
  "q_runtime.runs",
  "q_runtime.run_events",
  "q_runtime.run_creation_requests",
  "q_runtime.message_creation_requests",
] as const;

class Rollback extends Error {}

type Outcome =
  | { readonly kind: "value"; readonly value: unknown }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly message: string;
    };

async function outcome(attempt: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "value", value: await attempt() };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { kind: "refused", name: error.name, message: error.message };
    }
    throw error;
  }
}

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

function request(
  overrides: Partial<CreateQRunRequest> = {},
): CreateQRunRequest {
  return {
    capability: "INVESTIGATE",
    message: { text: PRIVATE_MARKER },
    modality: "TEXT",
    ...overrides,
  };
}

type Ids = {
  readonly conversationId: QConversationId;
  readonly runId: QRunId;
  readonly messageId: string;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: QRuntimeService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext | null>;
  readonly ownerA: {
    readonly principal: AuthenticatedPrincipal;
    readonly membershipId: string;
    readonly context: ActorContext;
  };
  readonly personB: ActorContext;
};

describe("q-runtime: tenant isolation on the application path (as postgres)", () => {
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
      values (${id}, ${tenantId}, 'company', ${name}, ${`iso-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ) {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    const principal: AuthenticatedPrincipal = {
      authUserId: AuthUserIdSchema.parse(authUserId),
    };
    return { principal, membershipId };
  }

  async function rowCounts(tx: TransactionContext) {
    const out: Record<string, number> = {};
    for (const table of WRITE_SURFACE) {
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from ${tx.sql(table)}`;
      out[table] = row?.n ?? -1;
    }
    return out;
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          return resolution.status === "RESOLVED" ? resolution.context : null;
        };
        const mustResolve = async (principal: AuthenticatedPrincipal) => {
          const context = await resolve(principal);
          if (context === null) throw new Error("context not resolved");
          return context;
        };

        const tenantA = await insertTenant(tx, "Isolation Q A");
        const tenantB = await insertTenant(tx, "Isolation Q B");
        const orgA = await insertOrganisation(tx, tenantA, "Org A");
        const orgB = await insertOrganisation(tx, tenantB, "Org B");
        const ownerA = await insertMember(tx, tenantA, orgA);
        const personB = await mustResolve(
          (await insertMember(tx, tenantB, orgB)).principal,
        );

        const service = createQRuntimeService({
          sql,
          transactions: nestedTransactions(tx),
          subjects: createQSubjectResolverRegistry([
            createCompanyQSubjectResolver(
              createPostgresCompanyQueryPort({ sql }),
            ),
          ]),
          securityEvents: createPostgresSecurityEventWriter({ sql }),
          logger: createLogger(
            { serviceName: "q-runtime-isolation-test", environment: "test" },
            { level: "silent" },
          ),
        });

        await work({
          tx,
          service,
          resolve,
          ownerA: { ...ownerA, context: await mustResolve(ownerA.principal) },
          personB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  async function seed(world: World): Promise<Ids> {
    const created = await world.service.createRun({
      actor: world.ownerA.context,
      input: request(),
      idempotencyKey: `iso-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    const [message] = await world.tx.sql<{ id: string }[]>`
      select id from q_runtime.conversation_messages where run_id = ${created.run.id}`;
    if (message === undefined) throw new Error("no opening message");
    return {
      conversationId: created.conversation.id,
      runId: created.run.id,
      messageId: message.id,
    };
  }

  function missingIds(): Ids {
    return {
      conversationId: QConversationIdSchema.parse(randomUUID()),
      runId: QRunIdSchema.parse(randomUUID()),
      messageId: randomUUID(),
    };
  }

  function attempts(
    service: QRuntimeService,
    actor: ActorContext,
    ids: Ids,
  ): (readonly [string, () => Promise<unknown>])[] {
    return [
      [
        "getConversation",
        () =>
          service.getConversation({
            actor,
            conversationId: ids.conversationId,
          }),
      ],
      ["getRun", () => service.getRun({ actor, runId: ids.runId })],
      [
        "createRun (continue)",
        () =>
          service.createRun({
            actor,
            input: request({ conversationId: ids.conversationId }),
            idempotencyKey: `iso-${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
      ],
      [
        "appendMessage",
        () =>
          service.appendMessage({
            actor,
            runId: ids.runId,
            input: { message: { text: "let me in" } },
            idempotencyKey: `iso-${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
      ],
      [
        "cancelRun",
        () =>
          service.cancelRun({
            actor,
            runId: ids.runId,
            correlationId: CORRELATION(),
          }),
      ],
      [
        "archiveConversation",
        () =>
          service.archiveConversation({
            actor,
            conversationId: ids.conversationId,
          }),
      ],
      [
        "hideConversationMessage",
        () =>
          service.hideConversationMessage({
            actor,
            conversationId: ids.conversationId,
            messageId: ids.messageId,
          }),
      ],
    ];
  }

  it("a person of another tenant gets the same answer for a real conversation, run or message id as for one that never existed, and nothing is written", async () => {
    await withWorld(async (world) => {
      const { tx, service, personB } = world;
      const real = await seed(world);
      const before = await rowCounts(tx);

      const viaReal = attempts(service, personB, real);
      const viaMissing = attempts(service, personB, missingIds());
      for (let i = 0; i < viaReal.length; i += 1) {
        const [name, attempt] = viaReal[i] ?? ["?", () => Promise.resolve()];
        const seen = await outcome(attempt);
        const missing = await outcome(
          viaMissing[i]?.[1] ?? (() => Promise.resolve()),
        );
        expect({ name, seen }).toEqual({ name, seen: missing });
        expect(seen.kind).toBe("refused");
        expect(JSON.stringify(seen)).not.toContain(PRIVATE_MARKER);
      }
      expect(
        (await service.listConversations({ actor: personB })).items,
      ).toEqual([]);

      expect(await rowCounts(tx)).toEqual(before);
      // The owner's thread is intact and still theirs.
      const [row] = await tx.sql<{ archived: boolean }[]>`
        select archived_at is not null as archived from q_runtime.conversations
         where id = ${real.conversationId}`;
      expect(row).toEqual({ archived: false });
    });
  });

  it("a revoked member gets no actor context; a stale context still reaches its own thread today (recorded for an owner decision)", async () => {
    await withWorld(async (world) => {
      const { tx, service, resolve, ownerA } = world;
      const real = await seed(world);
      await tx.sql`update identity.organisation_memberships
        set membership_status = 'revoked', left_at = clock_timestamp()
        where id = ${ownerA.membershipId}`;

      // The real request path refuses the revoked membership outright.
      expect(await resolve(ownerA.principal)).toBeNull();

      // Today's behaviour, not a target: q-runtime trusts the context it is
      // handed and owns threads by (tenant, person), so a context captured
      // before the revocation still reads the thread. Flip this assertion
      // if the owner decides org-context threads end with the membership
      // (docs/ai-handoff/PERSON-VS-ORG-DATA.md).
      const stale = await outcome(() =>
        service.getConversation({
          actor: ownerA.context,
          conversationId: real.conversationId,
        }),
      );
      expect(stale.kind).toBe("value");
    });
  });
});
