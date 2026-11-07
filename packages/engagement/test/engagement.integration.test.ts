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
  createEngagementNotices,
  createPostgresCompanyEngagementReader,
  createPostgresEngagementRepository,
  createPostgresMyEngagementReader,
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
// In a completed week: passive figures exclude the current one.
const at = "2026-10-20T10:00:00.000Z";

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
        allowedVisibilities: [
          "FULL_IDENTITY",
          "ORGANISATION_ONLY",
          "ANONYMOUS",
        ],
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

  it("the founder read: aggregates on a free plan, each viewer's own level on Founder Pro", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const reader = createPostgresCompanyEngagementReader(tx.sql);
      const company = await org(tx, "company");
      const named = await org(tx, "investment_firm");
      const quiet = await org(tx, "investment_firm");
      const third = await org(tx, "investment_firm");
      const outsider = await org(tx, "company");
      await repo.setPrivacy(named.viewer.userId, "FULL_IDENTITY");
      await repo.setPrivacy(quiet.viewer.userId, "ANONYMOUS");
      const viewOf = (viewer: EngagementViewer) =>
        repo.append(viewer, {
          type: "PROFILE_VIEW",
          clientEventId: clientId(),
          companyId: company.entityId,
          occurredAt: at,
        });
      await viewOf(named.viewer);
      await viewOf(quiet.viewer);

      const query = {
        actorUserId: company.viewer.userId,
        companyId: company.entityId,
        since: null,
      };
      const below = await reader.read(query);
      expect(below).toMatchObject({
        floorMet: false,
        floor: 3,
        sliceFloor: 5,
        passiveBatch: "WEEKLY",
        perViewer: false,
        entitled: false,
        periods: [],
        viewers: [],
        slices: [],
        viewerDeckDetail: [],
      });

      await viewOf(third.viewer);
      const free = await reader.read(query);
      expect(free?.floorMet).toBe(true);
      expect(free?.periods).toHaveLength(1);
      expect(free?.periods[0]?.organisations).toBe(3);
      // A free plan: one aggregate row, no names, no organisations.
      expect(free?.viewers).toEqual([
        expect.objectContaining({
          visibility: "AGGREGATE",
          viewerUserId: null,
          viewerOrganisationId: null,
          organisations: 3,
          lastPeriodStart: null,
        }),
      ]);
      // Three VC firms is below the slice floor of 5: hidden.
      expect(
        free?.slices.filter((slice) => slice.dimension === "INVESTOR_TYPE"),
      ).toEqual([
        {
          dimension: "INVESTOR_TYPE",
          slice: "OTHER",
          organisations: null,
          suppressed: true,
        },
      ]);

      // Founder Pro: each viewer at the level they chose.
      await tx.sql`insert into billing.plan_assignments (organisation_id, plan_id, source, assigned_by_user_id, reason)
        select ${company.viewer.organisationId}, p.id, 'ADMIN', ${company.viewer.userId}, 'Founder Pro test'
          from billing.plans p where p.key = 'founder_pro'`;
      const pro = await reader.read(query);
      expect(pro).toMatchObject({ perViewer: true, entitled: true });
      expect(
        pro?.viewers.find((v) => v.viewerUserId === named.viewer.userId),
      ).toMatchObject({
        visibility: "FULL_IDENTITY",
        basis: "VIEWER_CHOICE",
        deckDwellMs: null,
        lastPeriodStart: "2026-10-19",
      });
      expect(
        pro?.viewers.find(
          (v) => v.viewerOrganisationId === third.viewer.organisationId,
        ),
      ).toMatchObject({ visibility: "ORGANISATION_ONLY", viewerUserId: null });
      // The Anonymous viewer: never named, never their organisation, and a
      // lone anonymous viewer is below the floor even as "an investor".
      expect(
        pro?.viewers.some(
          (v) =>
            v.viewerUserId === quiet.viewer.userId ||
            v.viewerOrganisationId === quiet.viewer.organisationId ||
            v.visibility === "ANONYMOUS",
        ),
      ).toBe(false);

      // Someone outside the company reads nothing.
      expect(
        await reader.read({ ...query, actorUserId: outsider.viewer.userId }),
      ).toBeNull();
    });
  });

  it("an investor's own read: their views and visibility, never anyone else's", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const mine = createPostgresMyEngagementReader(tx.sql, repo);
      const company = await org(tx, "company");
      const investor = await org(tx, "investment_firm");
      const other = await org(tx, "investment_firm");
      for (const viewer of [investor.viewer, investor.viewer, other.viewer]) {
        await repo.append(viewer, {
          type: "PROFILE_VIEW",
          clientEventId: clientId(),
          companyId: company.entityId,
          occurredAt: at,
        });
      }
      const read = await mine.read({
        actorUserId: investor.viewer.userId,
        organisationId: investor.viewer.organisationId,
      });
      expect(read.privacy.visibility).toBe("ORGANISATION_ONLY");
      expect(read.viewed).toEqual([
        expect.objectContaining({ companyId: company.entityId, views: 2 }),
      ]);
      expect(read.responses).toEqual([]);
    });
  });

  it("save notices: worded at the saver's level, and silent when the admin turns them off", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const notices = createEngagementNotices(tx.sql);
      const company = await org(tx, "company");
      const named = await org(tx, "investment_firm");
      const quiet = await org(tx, "investment_firm");
      await repo.setPrivacy(named.viewer.userId, "FULL_IDENTITY");
      await repo.setPrivacy(quiet.viewer.userId, "ANONYMOUS");
      const save = (saver: Org) =>
        notices.companySaved({
          saverUserId: saver.viewer.userId,
          investorOrganisationId: saver.entityId,
          companyId: company.entityId,
        });
      expect(await save(named)).toBe(1);
      expect(await save(named)).toBe(0); // one per firm, company and day
      expect(await save(quiet)).toBe(1);
      const titles = await tx.sql<{ title: string; link_path: string }[]>`
        select title, link_path from communication.notifications
         where user_id = ${company.viewer.userId} and kind = 'COMPANY_SAVED'
         order by created_at`;
      expect(titles.map((row) => row.title)).toEqual([
        expect.stringMatching(/^.+ from .+ saved your company$/),
        "An investor saved your company",
      ]);
      expect(titles.every((row) => row.link_path === "/analytics")).toBe(true);
      await tx.sql`update analytics.platform_settings set intent_signal_notifications = false`;
      const third = await org(tx, "investment_firm");
      expect(await save(third)).toBe(0);
    });
  });

  it("the weekly digest: off by default; on, aggregate only and only above the floor", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const notices = createEngagementNotices(tx.sql);
      const company = await org(tx, "company");
      const now = new Date("2026-10-27T12:00:00.000Z");
      const viewers = [
        await org(tx, "investment_firm"),
        await org(tx, "investment_firm"),
      ];
      const viewOf = (viewer: EngagementViewer) =>
        repo.append(viewer, {
          type: "PROFILE_VIEW",
          clientEventId: clientId(),
          companyId: company.entityId,
          occurredAt: at,
        });
      for (const viewer of viewers) await viewOf(viewer.viewer);
      expect(await notices.weeklyDigest({ now })).toBe(0); // OFF by default
      await tx.sql`update analytics.platform_settings set passive_view_notifications = true`;
      expect(await notices.weeklyDigest({ now })).toBe(0); // two firms: below the floor
      const third = await org(tx, "investment_firm");
      await viewOf(third.viewer);
      expect(await notices.weeklyDigest({ now })).toBe(1);
      expect(await notices.weeklyDigest({ now })).toBe(0); // once per week
      const [notice] = await tx.sql<{ title: string; body: string }[]>`
        select title, body from communication.notifications
         where user_id = ${company.viewer.userId} and kind = 'VIEWING_DIGEST'`;
      expect(notice?.title).toBe(
        "3 investor organisations viewed your company last week",
      );
      expect(notice?.body).toContain("not an invitation to get in touch");
    });
  });

  it("a Q Card view by handle resolves only an active company handle", async () => {
    await scenario(async (tx) => {
      const repo = createPostgresEngagementRepository(tx.sql);
      const company = await org(tx, "company");
      const investor = await org(tx, "investment_firm");
      const handle = `card-${company.entityId.slice(0, 8)}`;
      await tx.sql`insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
        values (${handle}, ${company.viewer.tenantId}, ${company.viewer.organisationId}, 'COMPANY', ${company.entityId})`;
      expect(
        await repo.append(investor.viewer, {
          type: "Q_CARD_VIEW",
          clientEventId: clientId(),
          handle,
          occurredAt: at,
        }),
      ).toBe("ACCEPTED");
      expect(
        await repo.append(investor.viewer, {
          type: "Q_CARD_VIEW",
          clientEventId: clientId(),
          handle: "no-such-card",
          occurredAt: at,
        }),
      ).toBe("DROPPED");
      const [row] = await tx.sql<{ company_id: string }[]>`
        select company_id from analytics.engagement_events
         where viewer_user_id = ${investor.viewer.userId} and engagement_type = 'Q_CARD_VIEW'`;
      expect(row?.company_id).toBe(company.entityId);
    });
  });
});
