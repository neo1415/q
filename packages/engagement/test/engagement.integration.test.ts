import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { EngagementEventInput } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import {
  createPostgresEngagementRepository,
  type EngagementViewer,
} from "../src/index.js";

/**
 * The engagement repository against local Postgres. What is proven: the
 * append authorises in SQL (a private company, the company's own team, a
 * document of another company and a data-room document never served are
 * all dropped), a retry is one row, the database stamps the viewer's
 * privacy level, and the setting round-trips. Rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

type Org = {
  readonly viewer: EngagementViewer;
  readonly entityId: string;
};

async function org(
  tx: TransactionContext,
  kind: "company" | "investment_firm",
  visibility = "network_visible",
): Promise<Org> {
  const tenantId = randomUUID();
  const orgId = randomUUID();
  const auth = randomUUID();
  const tag = orgId.slice(0, 8);
  await tx.sql`insert into auth.users (id) values (${auth})`;
  const [profile] = await tx.sql<{ id: string }[]>`
    select id from identity.user_profiles where auth_user_id = ${auth}`;
  if (profile === undefined) throw new Error("no profile");
  await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, ${tag})`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${orgId}, ${tenantId}, ${kind}, ${tag}, ${`e-${tag}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
  await tx.sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id)
    values (${tenantId}, ${orgId}, ${profile.id})`;
  const entityId = randomUUID();
  if (kind === "company") {
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, marketplace_visibility)
      values (${entityId}, ${tenantId}, ${orgId}, ${tag}, ${`e-${tag}`}, ${visibility})`;
  } else {
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${entityId}, ${tenantId}, ${orgId}, 'VC', ${tag})`;
  }
  return {
    viewer: { tenantId, userId: profile.id, organisationId: orgId },
    entityId,
  };
}

async function document(tx: TransactionContext, company: Org) {
  const id = randomUUID();
  await tx.sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id)
    values (${id}, ${company.viewer.tenantId}, ${company.entityId}, ${company.viewer.organisationId},
            'PITCH_DECK', 'Deck', ${company.viewer.userId})`;
  return id;
}

let counter = 0;
const clientId = () => `evt-${String(++counter).padStart(8, "0")}`;
const at = "2026-11-06T10:00:00.000Z";

describe("@capital-q/engagement against local Postgres", () => {
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

  async function scenario(body: (tx: TransactionContext) => Promise<void>) {
    try {
      await db.transactions.run(async (tx) => {
        await body(tx);
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  it("authorises in SQL, deduplicates and stamps the viewer's level", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const company = await org(tx, "company");
      const hidden = await org(tx, "company", "organisation_private");
      const other = await org(tx, "company");
      const investor = await org(tx, "investment_firm");
      const deck = await document(tx, company);
      const othersDeck = await document(tx, other);

      const profile: EngagementEventInput = {
        type: "PROFILE_VIEW",
        clientEventId: clientId(),
        companyId: company.entityId,
        occurredAt: at,
      };
      expect(await repo.append(investor.viewer, profile)).toBe("ACCEPTED");
      expect(await repo.append(investor.viewer, profile)).toBe("DEDUPLICATED");

      // A private company with no relationship: dropped.
      expect(
        await repo.append(investor.viewer, {
          ...profile,
          clientEventId: clientId(),
          companyId: hidden.entityId,
        }),
      ).toBe("DROPPED");
      // The company's own team: dropped.
      expect(
        await repo.append(company.viewer, {
          ...profile,
          clientEventId: clientId(),
        }),
      ).toBe("DROPPED");
      // Another company's deck: dropped.
      expect(
        await repo.append(investor.viewer, {
          type: "DECK_OPEN",
          clientEventId: clientId(),
          companyId: company.entityId,
          documentId: othersDeck,
          occurredAt: at,
        }),
      ).toBe("DROPPED");
      // A data-room document the data room never served: dropped.
      expect(
        await repo.append(investor.viewer, {
          type: "DATA_ROOM_DOCUMENT_VIEW",
          clientEventId: clientId(),
          companyId: company.entityId,
          documentId: deck,
          occurredAt: at,
        }),
      ).toBe("DROPPED");
      // The company's own deck: kept, with dwell.
      expect(
        await repo.append(investor.viewer, {
          type: "DECK_SLIDE_DWELL",
          clientEventId: clientId(),
          companyId: company.entityId,
          documentId: deck,
          slideNumber: 3,
          durationMs: 4200,
          occurredAt: at,
        }),
      ).toBe("ACCEPTED");

      const rows = await tx.sql<{ visibility_at_view: string }[]>`
        select visibility_at_view from analytics.engagement_events
         where viewer_user_id = ${investor.viewer.userId}`;
      expect(rows.map((r) => r.visibility_at_view)).toEqual([
        "ORGANISATION_ONLY",
        "ORGANISATION_ONLY",
      ]);
    });
  });

  it("a relationship admits a company that is not network visible", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const company = await org(tx, "company", "relationship_shared");
      const investor = await org(tx, "investment_firm");
      await tx.sql`insert into network.relationships (tenant_id, company_id, investor_organisation_id, current_state)
        values (${company.viewer.tenantId}, ${company.entityId}, ${investor.entityId}, 'CONNECTED')`;
      expect(
        await repo.append(investor.viewer, {
          type: "Q_CARD_VIEW",
          clientEventId: clientId(),
          companyId: company.entityId,
          occurredAt: at,
        }),
      ).toBe("ACCEPTED");
    });
  });

  it("reads the default, then the person's choice, which later views carry", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const company = await org(tx, "company");
      const investor = await org(tx, "investment_firm");
      expect(await repo.privacyFor(investor.viewer.userId)).toEqual({
        visibility: "ORGANISATION_ONLY",
        chosen: false,
        defaultVisibility: "ORGANISATION_ONLY",
      });
      await repo.setPrivacy(investor.viewer.userId, "ANONYMOUS");
      expect(await repo.privacyFor(investor.viewer.userId)).toMatchObject({
        visibility: "ANONYMOUS",
        chosen: true,
      });
      await repo.append(investor.viewer, {
        type: "PROFILE_VIEW",
        clientEventId: clientId(),
        companyId: company.entityId,
        occurredAt: at,
      });
      const [row] = await tx.sql<{ visibility_at_view: string }[]>`
        select visibility_at_view from analytics.engagement_events
         where viewer_user_id = ${investor.viewer.userId}`;
      expect(row?.visibility_at_view).toBe("ANONYMOUS");
    });
  });
});
