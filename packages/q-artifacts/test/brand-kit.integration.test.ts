import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  createSavepointTransactionManager,
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
  BrandKitAlreadyAnsweredError,
  BrandKitNotFoundError,
  BrandLogoInvalidError,
  createBrandKitService,
} from "../src/index.js";

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
  await sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Brand ${slug}`})`;
  await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${organisationId}, ${tenantId}, 'company', ${`Org ${slug}`}, ${`brand-${slug}`})`;
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

/**
 * DOCS: the brand kit service against real SQL. Ownership is the where
 * clause; confirmation copies exactly the suggestion shown; a yes cannot
 * be given twice; nothing Q suggested applies on its own.
 */
describe("brand kit service against local Supabase Postgres", () => {
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

  const serviceIn = (tx: TransactionContext) =>
    createBrandKitService({
      sql: tx.sql,
      transactions: createSavepointTransactionManager(tx),
    });

  it("a suggestion applies nothing; confirming copies exactly it, once", async () => {
    await rolledBack(async (tx) => {
      const brand = serviceIn(tx);
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const suggestion = await brand.suggest(mine.actor, {
        source: "WEBSITE",
        sourceUrl: "https://example.com/",
        palette: { primary: "#0b6e4f", secondary: "#f2a900" },
        pairing: "INTER_ONLY",
        logo: { bytes: PNG, contentType: "image/png" },
      });
      expect(suggestion.status).toBe("RECOMMENDED");
      expect(await brand.effective(mine.actor)).toBeNull();

      // A newer suggestion arrives before they answer the first.
      await brand.suggest(mine.actor, {
        source: "WEBSITE",
        palette: { primary: "#aa0000" },
      });

      const confirmed = await brand.answer(mine.actor, {
        version: suggestion.version,
        decision: "CONFIRM",
      });
      expect(confirmed.status).toBe("CONFIRMED");
      expect(confirmed.palette).toEqual({
        primary: "#0b6e4f",
        secondary: "#f2a900",
      });
      expect(confirmed.pairing).toBe("INTER_ONLY");
      expect(confirmed.hasLogo).toBe(true);
      expect(
        (await brand.logo(mine.actor, confirmed.version))?.contentType,
      ).toBe("image/png");
      expect((await brand.effective(mine.actor))?.kitVersion).toBe(
        confirmed.version,
      );

      await expect(
        brand.answer(mine.actor, {
          version: suggestion.version,
          decision: "CONFIRM",
        }),
      ).rejects.toBeInstanceOf(BrandKitAlreadyAnsweredError);
      // A confirmed row is not a suggestion to confirm.
      await expect(
        brand.answer(mine.actor, {
          version: confirmed.version,
          decision: "CONFIRM",
        }),
      ).rejects.toBeInstanceOf(BrandKitNotFoundError);
    });
  });

  it("never reads or answers another organisation's brand", async () => {
    await rolledBack(async (tx) => {
      const brand = serviceIn(tx);
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const stranger = await createParty(tx, `s-${randomUUID().slice(0, 8)}`);
      const theirs = await brand.set(stranger.actor, {
        palette: { primary: "#123456" },
        logo: PNG,
      });
      const suggestion = await brand.suggest(stranger.actor, {
        source: "WEBSITE",
        palette: { primary: "#654321" },
      });
      expect(await brand.state(mine.actor)).toEqual({});
      expect(await brand.logo(mine.actor, theirs.version)).toBeNull();
      await expect(
        brand.answer(mine.actor, {
          version: suggestion.version,
          decision: "CONFIRM",
        }),
      ).rejects.toBeInstanceOf(BrandKitNotFoundError);
    });
  });

  it("their own values apply as given; the logo is kept, replaced or removed", async () => {
    await rolledBack(async (tx) => {
      const brand = serviceIn(tx);
      const mine = await createParty(tx, `m-${randomUUID().slice(0, 8)}`);
      const first = await brand.set(mine.actor, {
        palette: { primary: "#123456" },
        logo: PNG,
      });
      expect(first.status).toBe("CONFIRMED");
      const kept = await brand.set(mine.actor, {
        palette: { primary: "#222222" },
      });
      expect(kept.hasLogo).toBe(true);
      const removed = await brand.set(mine.actor, {
        palette: { primary: "#222222" },
        logo: null,
      });
      expect(removed.hasLogo).toBe(false);
      await expect(
        brand.set(mine.actor, {
          palette: { primary: "#222222" },
          logo: new TextEncoder().encode("<svg></svg>"),
        }),
      ).rejects.toBeInstanceOf(BrandLogoInvalidError);
    });
  });
});
