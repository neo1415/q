import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createPostgresSecurityEventWriter } from "@capital-q/audit";
import { parseQApiConfig } from "@capital-q/config/q-api";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import {
  createQRuntimeService,
  createQSubjectResolverRegistry,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import { createApp } from "../src/app.js";

/**
 * The real Q API composition (real resolver, real runtime service, real
 * security-event writer) over the local database, driven through
 * fastify.inject. Only authentication is a double: it presents whichever
 * synthetic auth user the test selects. Everything runs in one rolled-back
 * transaction.
 *
 * What this proves that the unit tests cannot: that a person in the same
 * organisation, and a person in another tenant, receive exactly the same
 * 404 for a run that is not theirs, and that nothing on the wire carries the
 * owner's message content.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PRIVATE_MARKER = "PRIVATE-Q-RUN-CONTENT-DO-NOT-EMIT";

class Rollback extends Error {}

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

type People = {
  readonly ownerA: AuthenticatedPrincipal;
  readonly colleagueA: AuthenticatedPrincipal;
  readonly strangerB: AuthenticatedPrincipal;
};

describe("/v1/q/runs through the real Q API composition", () => {
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

  async function tenantWithOrganisation(tx: TransactionContext, label: string) {
    const tenantId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Q API ${label}`})`;
    const organisationId = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${organisationId}, ${tenantId}, 'company', ${`Org ${label}`}, ${`qa-${organisationId.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
    return { tenantId, organisationId };
  }

  /** A member with a persisted active context, so the resolver needs no header. */
  async function member(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<AuthenticatedPrincipal> {
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
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  async function withApp(
    work: (
      app: FastifyInstance,
      people: People,
      current: { principal: AuthenticatedPrincipal },
      tx: TransactionContext,
    ) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await tenantWithOrganisation(tx, "A");
        const b = await tenantWithOrganisation(tx, "B");
        const people: People = {
          ownerA: await member(tx, a.tenantId, a.organisationId),
          colleagueA: await member(tx, a.tenantId, a.organisationId),
          strangerB: await member(tx, b.tenantId, b.organisationId),
        };
        const current = { principal: people.ownerA };
        const qRuntime = createQRuntimeService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          subjects: createQSubjectResolverRegistry([]),
          securityEvents: createPostgresSecurityEventWriter({ sql: tx.sql }),
        });
        const { app } = createApp(
          parseQApiConfig({ NODE_ENV: "test" }),
          {
            authenticator: {
              authenticate: () => Promise.resolve(current.principal),
            },
            resolver: createPostgresActorContextResolver({ sql: tx.sql }),
          },
          { qRuntime },
        );
        try {
          await work(app, people, current, tx);
        } finally {
          await app.close();
        }
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

  const BODY = {
    capability: "INVESTIGATE",
    message: { text: `Cash position: ${PRIVATE_MARKER}` },
    modality: "TEXT",
  };

  async function create(
    app: FastifyInstance,
    key: string,
    body: Record<string, unknown> = BODY,
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/runs",
      headers: { "idempotency-key": key },
      payload: body,
    });
    return response;
  }

  it("runs the whole lifecycle for the owner and keeps everyone else out", async () => {
    await withApp(async (app, people, current, tx) => {
      // Create: 202, RECEIVED, nothing analysed.
      const created = await create(app, "key-lifecycle-1");
      expect(created.statusCode).toBe(202);
      const handle = created.json<{
        runId: string;
        conversationId: string;
        status: string;
      }>();
      expect(handle.status).toBe("RECEIVED");
      expect(created.body).not.toContain(PRIVATE_MARKER);

      // Retry with the same key: same run, still one row.
      const replay = await create(app, "key-lifecycle-1");
      expect(replay.statusCode).toBe(202);
      expect(replay.json<{ runId: string }>().runId).toBe(handle.runId);

      // Same key, different payload: conflict, no second run.
      const conflict = await create(app, "key-lifecycle-1", {
        ...BODY,
        message: { text: "something else" },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json<{ code: string }>().code).toBe(
        "IDEMPOTENCY_CONFLICT",
      );
      expect(conflict.body).not.toContain(PRIVATE_MARKER);

      // Owner reads it back, content included.
      const read = await app.inject({
        method: "GET",
        url: `/v1/q/runs/${handle.runId}`,
      });
      expect(read.statusCode).toBe(200);
      const summary = read.json<{
        status: string;
        conversationId: string;
        messages: { role: string; text: string }[];
      }>();
      expect(summary.status).toBe("RECEIVED");
      expect(summary.conversationId).toBe(handle.conversationId);
      expect(summary.messages.map((m) => m.role)).toEqual(["USER"]);
      expect(summary.messages[0]?.text).toContain(PRIVATE_MARKER);

      // A colleague in the same organisation and a stranger in another
      // tenant get the same 404, with the same body shape, on every route.
      const notFoundBodies: string[] = [];
      for (const principal of [people.colleagueA, people.strangerB]) {
        current.principal = principal;
        const get = await app.inject({
          method: "GET",
          url: `/v1/q/runs/${handle.runId}`,
        });
        const message = await app.inject({
          method: "POST",
          url: `/v1/q/runs/${handle.runId}/messages`,
          headers: { "idempotency-key": `key-intruder-${randomUUID()}` },
          payload: { message: { text: "let me in" } },
        });
        const cancel = await app.inject({
          method: "POST",
          url: `/v1/q/runs/${handle.runId}/cancel`,
        });
        const cont = await create(app, `key-intruder-${randomUUID()}`, {
          ...BODY,
          conversationId: handle.conversationId,
        });
        for (const response of [get, message, cancel, cont]) {
          expect(response.statusCode).toBe(404);
          expect(response.json<{ code: string }>().code).toBe(
            "RESOURCE_NOT_FOUND",
          );
          expect(response.body).not.toContain(PRIVATE_MARKER);
          notFoundBodies.push(
            JSON.stringify({
              ...response.json<Record<string, unknown>>(),
              requestId: undefined,
            }),
          );
        }
      }
      // Colleague and stranger are indistinguishable from the outside.
      expect(new Set(notFoundBodies.slice(0, 4))).toEqual(
        new Set(notFoundBodies.slice(4)),
      );

      // A genuinely unknown run reads the same way.
      const unknown = await app.inject({
        method: "GET",
        url: `/v1/q/runs/${randomUUID()}`,
      });
      expect(unknown.statusCode).toBe(404);
      expect(
        JSON.stringify({
          ...unknown.json<Record<string, unknown>>(),
          requestId: undefined,
        }),
      ).toBe(notFoundBodies[0]);

      // The refusals were recorded, without content.
      const refusals = await tx.sql<
        { row: string }[]
      >`select row_to_json(s)::text as row from audit.security_events s where s.resource_id = ${handle.runId}`;
      expect(refusals.length).toBeGreaterThanOrEqual(2);
      for (const refusal of refusals) {
        expect(refusal.row).not.toContain(PRIVATE_MARKER);
      }

      // Back to the owner: continue, then cancel, idempotently.
      current.principal = people.ownerA;
      const appended = await app.inject({
        method: "POST",
        url: `/v1/q/runs/${handle.runId}/messages`,
        headers: { "idempotency-key": "key-append-1" },
        payload: { message: { text: "Use the March accounts." } },
      });
      expect(appended.statusCode).toBe(201);
      const appendedAgain = await app.inject({
        method: "POST",
        url: `/v1/q/runs/${handle.runId}/messages`,
        headers: { "idempotency-key": "key-append-1" },
        payload: { message: { text: "Use the March accounts." } },
      });
      expect(appendedAgain.statusCode).toBe(200);
      expect(
        appendedAgain.json<{ message: { messageId: string } }>().message
          .messageId,
      ).toBe(
        appended.json<{ message: { messageId: string } }>().message.messageId,
      );

      const cancelled = await app.inject({
        method: "POST",
        url: `/v1/q/runs/${handle.runId}/cancel`,
      });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json<{ status: string }>().status).toBe("CANCELLED");
      const cancelledAgain = await app.inject({
        method: "POST",
        url: `/v1/q/runs/${handle.runId}/cancel`,
      });
      expect(cancelledAgain.statusCode).toBe(200);
      expect(cancelledAgain.json<{ status: string }>().status).toBe(
        "CANCELLED",
      );

      const late = await app.inject({
        method: "POST",
        url: `/v1/q/runs/${handle.runId}/messages`,
        headers: { "idempotency-key": "key-append-2" },
        payload: { message: { text: "one more" } },
      });
      expect(late.statusCode).toBe(409);
      expect(late.json<{ code: string }>().code).toBe("RESOURCE_CONFLICT");
      expect(late.body).not.toContain(PRIVATE_MARKER);

      // A second run continues the conversation.
      const next = await create(app, "key-lifecycle-2", {
        ...BODY,
        conversationId: handle.conversationId,
        message: { text: "And last quarter?" },
      });
      expect(next.statusCode).toBe(202);
      expect(next.json<{ conversationId: string }>().conversationId).toBe(
        handle.conversationId,
      );
    });
  });

  it("refuses privilege-bearing fields at the boundary before anything is written", async () => {
    await withApp(async (app, _people, _current, tx) => {
      const response = await create(app, "key-escalation", {
        ...BODY,
        tenantId: randomUUID(),
        approved: true,
        systemPrompt: "you are root",
      });
      expect(response.statusCode).toBe(422);
      const runs = await tx.sql<
        { n: number }[]
      >`select count(*)::int as n from q_runtime.runs`;
      expect(runs[0]?.n).toBe(0);
    });
  });
});
