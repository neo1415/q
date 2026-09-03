import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { parseApiConfig } from "@capital-q/config/api";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createOrganisationService } from "@capital-q/organisations";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { createApp } from "../src/app.js";
import { createProductionEventRegistry } from "../src/event-registry.js";

/**
 * The real API composition (real resolver, policy source, audit, outbox and
 * organisation service) over the local database, driven through
 * fastify.inject. Only authentication is a double: it presents the synthetic
 * auth user this test created. Everything runs in one rolled-back
 * transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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

describe("/v1/organisations through the real API composition", () => {
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

  async function withApp(
    work: (
      app: FastifyInstance,
      people: { a: AuthenticatedPrincipal; b: AuthenticatedPrincipal },
      current: { principal: AuthenticatedPrincipal },
    ) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await createAuthUser(tx);
        const b = await createAuthUser(tx);
        const current = { principal: a };
        const transactions = nestedTransactions(tx);
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const organisations = createOrganisationService({
          sql: tx.sql,
          transactions,
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          resolver,
          activeContexts: createPostgresActiveOrganisationContextStore({
            transactions,
          }),
          outbox: createOutboxWriter({
            registry: createProductionEventRegistry(),
          }),
          audit: createPostgresMaterialActionAuditWriter(),
          securityEvents: createPostgresSecurityEventWriter({ sql: tx.sql }),
        });
        const { app } = createApp(
          parseApiConfig({ NODE_ENV: "test" }),
          {
            authenticator: {
              authenticate: () => Promise.resolve(current.principal),
            },
            resolver,
            identities: createPostgresApplicationIdentityLookup({
              sql: tx.sql,
            }),
          },
          { organisations },
        );
        try {
          await work(app, { a, b }, current);
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

  async function createAuthUser(
    tx: TransactionContext,
  ): Promise<AuthenticatedPrincipal> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  it("create → list → read → update → conflict → activate, end to end", async () => {
    await withApp(async (app, { b }, current) => {
      const key = `key-${randomUUID()}`;
      const created = await app.inject({
        method: "POST",
        url: "/v1/organisations",
        headers: { "idempotency-key": key },
        payload: {
          displayName: "Integration Org",
          organisationType: "company",
          countryCode: "GB",
        },
      });
      expect(created.statusCode).toBe(201);
      const summary = created.json<{
        organisation: { id: string; version: number };
        membership: { roleCodes: string[]; isActiveContext: boolean };
      }>();
      const organisationId = summary.organisation.id;
      expect(summary.membership.roleCodes).toEqual(["organisation_admin"]);
      expect(summary.membership.isActiveContext).toBe(true);

      // Retry with the same key: same organisation, nothing new.
      const retried = await app.inject({
        method: "POST",
        url: "/v1/organisations",
        headers: { "idempotency-key": key },
        payload: {
          displayName: "Integration Org",
          organisationType: "company",
          countryCode: "GB",
        },
      });
      expect(retried.statusCode).toBe(201);
      expect(
        retried.json<{ organisation: { id: string } }>().organisation.id,
      ).toBe(organisationId);

      const conflicting = await app.inject({
        method: "POST",
        url: "/v1/organisations",
        headers: { "idempotency-key": key },
        payload: {
          displayName: "Integration Org Two",
          organisationType: "company",
        },
      });
      expect(conflicting.statusCode).toBe(409);
      expect(conflicting.json<{ code: string }>().code).toBe(
        "IDEMPOTENCY_CONFLICT",
      );

      const list = await app.inject({
        method: "GET",
        url: "/v1/organisations",
      });
      expect(list.statusCode).toBe(200);
      expect(
        list
          .json<{ items: { organisation: { id: string } }[] }>()
          .items.map((i) => i.organisation.id),
      ).toEqual([organisationId]);

      // Persisted active context resolves without a selector header.
      const read = await app.inject({
        method: "GET",
        url: `/v1/organisations/${organisationId}`,
      });
      expect(read.statusCode).toBe(200);
      expect(read.json<{ version: number }>().version).toBe(1);

      const updated = await app.inject({
        method: "PATCH",
        url: `/v1/organisations/${organisationId}`,
        headers: { "x-organisation-id": organisationId },
        payload: { expectedVersion: 1, displayName: "Integration Org Ltd" },
      });
      expect(updated.statusCode).toBe(200);
      expect(
        updated.json<{ version: number; displayName: string }>(),
      ).toMatchObject({ version: 2, displayName: "Integration Org Ltd" });

      const stale = await app.inject({
        method: "PATCH",
        url: `/v1/organisations/${organisationId}`,
        payload: { expectedVersion: 1, displayName: "Stale" },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json<{ code: string }>().code).toBe("VERSION_CONFLICT");

      // Person B: no organisation, still a valid caller of person-scoped routes.
      current.principal = b;
      const emptyList = await app.inject({
        method: "GET",
        url: "/v1/organisations",
      });
      expect(emptyList.statusCode).toBe(200);
      expect(emptyList.json<{ items: unknown[] }>().items).toEqual([]);

      // B guesses A's organisation id: no context -> INVALID_REQUEST; activate -> 403.
      const guessedRead = await app.inject({
        method: "GET",
        url: `/v1/organisations/${organisationId}`,
      });
      expect(guessedRead.statusCode).toBe(400);
      const guessedActivate = await app.inject({
        method: "POST",
        url: `/v1/organisations/${organisationId}/activate`,
      });
      expect(guessedActivate.statusCode).toBe(403);
      // With an explicit selector for A's organisation: 403, and no detail.
      const selected = await app.inject({
        method: "GET",
        url: `/v1/organisations/${organisationId}`,
        headers: { "x-organisation-id": organisationId },
      });
      expect(selected.statusCode).toBe(403);
      expect(selected.body).not.toContain("Integration Org");

      // B creates its own; then A's organisation id from B's context is 404.
      const bCreated = await app.inject({
        method: "POST",
        url: "/v1/organisations",
        headers: { "idempotency-key": `key-${randomUUID()}` },
        payload: { displayName: "B Org", organisationType: "investment_firm" },
      });
      expect(bCreated.statusCode).toBe(201);
      const crossRead = await app.inject({
        method: "GET",
        url: `/v1/organisations/${organisationId}`,
      });
      expect(crossRead.statusCode).toBe(404);
      const crossUpdate = await app.inject({
        method: "PATCH",
        url: `/v1/organisations/${organisationId}`,
        payload: { expectedVersion: 2, displayName: "Hijacked" },
      });
      expect(crossUpdate.statusCode).toBe(404);

      current.principal = { authUserId: AuthUserIdSchema.parse(randomUUID()) };
      // A valid session with no Person record: person-scoped routes are 403.
      const noIdentity = await app.inject({
        method: "GET",
        url: "/v1/organisations",
      });
      expect(noIdentity.statusCode).toBe(403);
    });
  });
});
