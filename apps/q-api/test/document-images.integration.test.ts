import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createFakeImageProvider,
  createImageGateway,
} from "@capital-q/model-gateway/images";

import {
  createDocumentImages,
  type DocumentImageStore,
} from "../src/composition/document-images.js";

/**
 * The artifact tables against real PostgreSQL (`pnpm db:start`), run with
 * `pnpm test:integration`.
 *
 * The in-memory test beside this one can only prove the service passes the
 * actor along. What has to be true in SQL, and is asserted here: an
 * artifact belonging to another tenant or another organisation is never
 * selected, so "not yours" and "not found" are the same answer; and the
 * unique constraint on (artifact_id, version), not application code, is
 * what stops two revisions claiming the same number.
 *
 * Every test builds its own synthetic tenants inside a transaction that is
 * rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Party = {
  readonly actor: ActorContext;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly userId: string;
};

async function createParty(
  tx: TransactionContext,
  slug: string,
): Promise<Party> {
  const { sql } = tx;
  const authId = randomUUID();
  await sql`insert into auth.users (id) values (${authId})`;
  const [profile] = await sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${authId}`;
  const userId = profile?.id ?? "";
  const tenantId = randomUUID();
  const organisationId = randomUUID();
  const membershipId = randomUUID();
  await sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Images ${slug}`})`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${organisationId}, ${tenantId}, 'company', ${`Org ${slug}`}, ${`images-${slug}`})`;
  await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
    values (${membershipId}, ${tenantId}, ${organisationId}, ${userId})`;
  return {
    tenantId,
    organisationId,
    userId,
    actor: {
      userId: UserIdSchema.parse(userId),
      tenantId: TenantIdSchema.parse(tenantId),
      organisationId: OrganisationIdSchema.parse(organisationId),
      membershipId: MembershipIdSchema.parse(membershipId),
      actorType: "HUMAN",
    },
  };
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
]);

function memoryStore(): DocumentImageStore & { readonly keys: string[] } {
  const objects = new Map<string, Uint8Array>();
  const keys: string[] = [];
  return {
    keys,
    put: (key, bytes) => {
      keys.push(key);
      objects.set(key, bytes);
      return Promise.resolve(true);
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    sign: (key) =>
      Promise.resolve(
        objects.has(key)
          ? `https://storage.example.com/object/sign/cq-document-images/${key}?token=t`
          : null,
      ),
  };
}

/**
 * DOCS: generated document images against real SQL: provenance filed,
 * budgets counted from it, and an image readable only by its own
 * organisation. The provider is a fake; no credit is spent.
 */
describe("document images against local Supabase Postgres", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function rolledBack(
    work: (tx: TransactionContext) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(tx);
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const imagesIn = (
    tx: TransactionContext,
    store: DocumentImageStore,
    budgets = {
      perDocument: 2,
      perOrganisationPerDay: 3,
      platformPerDay: 1000,
    },
  ) => {
    const prompts: string[] = [];
    const images = createDocumentImages({
      sql: tx.sql,
      store,
      budgets,
      gateway: createImageGateway({
        enabled: true,
        providers: [
          createFakeImageProvider((request) => {
            prompts.push(request.prompt);
            return Promise.resolve({ bytes: PNG, contentType: "image/png" });
          }),
        ],
      }),
    });
    return { images, prompts };
  };

  it("files the picture with its provenance and reads it back only for its own organisation", async () => {
    await rolledBack(async (tx) => {
      const store = memoryStore();
      const { images } = imagesIn(tx, store);
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const stranger = await createParty(tx, `s-${randomUUID().slice(0, 8)}`);
      const runId = randomUUID();
      const port = images.illustrationsFor({ actor: mine.actor, runId });
      const image = await port?.illustrate({
        prompt: "A calm editorial illustration of freight.",
        purpose: "COVER",
        alt: "Cover illustration (AI-generated)",
      });
      expect(image?.provenance).toBe("AI_GENERATED");
      expect(image?.credit).toContain("AI-generated");
      const imageId = image?.url.replace("cq-image:", "") ?? "";

      const [row] = await tx.sql<
        {
          provenance: string;
          prompt: string;
          q_run_id: string;
          storage_key: string;
        }[]
      >`select provenance, prompt, q_run_id, storage_key
          from artifacts.document_images where id = ${imageId}`;
      expect(row?.provenance).toBe("AI_GENERATED");
      expect(row?.prompt).toContain("No real or identifiable people");
      expect(row?.q_run_id).toBe(runId);
      expect(store.keys).toEqual([row?.storage_key]);
      expect(row?.storage_key.startsWith(`${mine.organisationId}/`)).toBe(true);

      expect(await images.bytesFor(mine.actor, imageId)).toEqual(PNG);
      expect(await images.signedUrlFor(mine.actor, imageId)).toContain(
        "/object/sign/",
      );
      expect(await images.bytesFor(stranger.actor, imageId)).toBeNull();
      expect(await images.signedUrlFor(stranger.actor, imageId)).toBeNull();
    });
  });

  it("stops at the per-document and per-day budgets, calling no provider", async () => {
    await rolledBack(async (tx) => {
      const { images, prompts } = imagesIn(tx, memoryStore());
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const ask = (runId: string) =>
        images
          .illustrationsFor({ actor: mine.actor, runId })
          ?.illustrate({ prompt: "p", purpose: "SLIDE", alt: "a" });
      const first = randomUUID();
      expect(await ask(first)).not.toBeNull();
      expect(await ask(first)).not.toBeNull();
      // Two per document.
      expect(await ask(first)).toBeNull();
      // Three per organisation per day.
      expect(await ask(randomUUID())).not.toBeNull();
      expect(await ask(randomUUID())).toBeNull();
      expect(prompts).toHaveLength(3);
    });
  });

  it("is off when there is no store or the gateway is off", async () => {
    await rolledBack(async (tx) => {
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const off = createDocumentImages({
        sql: tx.sql,
        store: undefined,
        budgets: {
          perDocument: 2,
          perOrganisationPerDay: 3,
          platformPerDay: 10,
        },
        gateway: createImageGateway({ enabled: true, providers: [] }),
      });
      expect(off.enabled).toBe(false);
      expect(
        off.illustrationsFor({ actor: mine.actor, runId: randomUUID() }),
      ).toBeUndefined();
    });
  });
});
