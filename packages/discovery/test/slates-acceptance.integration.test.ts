import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { CapitalQEvent } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createPostgresCompanyCardPort,
  createPostgresDiscoverablePoolPort,
} from "../src/infrastructure/postgres-discovery-repository.js";
import { createPostgresRefreshQueue } from "../src/infrastructure/postgres-refresh-queue.js";
import {
  RECOMMENDATION_REFRESH_QUEUE,
  RefreshRecommendationSlateJob,
} from "../src/jobs/index.js";
import { createSlateReadService } from "../src/slates/reader.js";
import {
  createRefreshRequester,
  createSlateInvalidationService,
  REFRESH_TRIGGER_EVENTS,
  refreshDirectiveFor,
} from "../src/slates/refresh.js";
import {
  conceptEmbedder,
  seedRecommendationWorld,
  TEST_DATABASE_URL,
  type CompanyFixture,
  type RecommendationWorld,
} from "./support/recommendation-world.js";

/**
 * CQ-REC-006 §92 live acceptance over the local stack, with the real
 * components in the order production runs them:
 *
 *   domain event → directive → invalidation → refresh request row → a
 *   message on the real pgmq queue → claim → builder (REC-002 → REC-005)
 *   → CURRENT slate → reader page by cursor with the REC-001 guard
 *   → a company withdraws → invalidation → RECOMMENDATIONS_REFRESHING
 *   → rebuild → served again without the company.
 *
 * Only the queue runner loop and the HTTP route are absent; both have
 * their own tests. Everything rolls back.
 */

class Rollback extends Error {}

const MANDATE = {
  name: "Africa enterprise logistics",
  narrative:
    "We back enterprise logistics software companies serving African markets.",
  stageCodes: ["seed"],
  countryCodes: ["NG"],
  preferences: [["industry", "logistics"]],
  exclusions: [],
} as const;

const COMPANIES: readonly CompanyFixture[] = [
  {
    label: "KoboLogistics",
    summary: "Logistics workflow SaaS for African distributors.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "logistics"]],
    ready: true,
  },
  {
    label: "Bakehouse",
    summary: "Artisan bread and pastry retail.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "ecommerce"]],
    ready: true,
  },
  {
    label: "PetPal",
    summary: "Pet grooming marketplace.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "ecommerce"]],
    ready: true,
  },
];

type QueueRow = { readonly msg_id: string; readonly message: unknown };

describe("CQ-REC-006 live acceptance (local stack)", () => {
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
    work: (world: RecommendationWorld) => Promise<void>,
  ) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(
          await seedRecommendationWorld(tx, {
            mandate: MANDATE,
            companies: COMPANIES,
            embedder: conceptEmbedder(),
          }),
        );
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  function event(
    type: string,
    tenantId: string,
    data: unknown,
  ): CapitalQEvent<unknown> {
    return {
      specVersion: "1.0",
      id: randomUUID(),
      type,
      source: "capitalq://api/test",
      time: new Date().toISOString(),
      subject: "acceptance",
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId,
      correlationId: `cor_${randomUUID()}`,
      data,
    } as CapitalQEvent<unknown>;
  }

  it("event → queue → claim → build → cursor pages → withdrawal → invalidation → rebuild", async () => {
    await withWorld(async (w) => {
      const sql = w.tx.sql;
      const queue = createPostgresRefreshQueue({ sql });
      const requester = createRefreshRequester({
        requests: w.pipeline.refreshRequests,
        queue,
      });
      const invalidation = createSlateInvalidationService({
        slates: w.pipeline.slates,
        requester,
      });
      const reader = createSlateReadService({
        ports: w.pipeline.eligibilityPorts,
        eligibility: w.pipeline.eligibility,
        suppression: w.pipeline.suppression,
        slates: w.pipeline.slates,
        cards: createPostgresCompanyCardPort({ sql }),
        pool: createPostgresDiscoverablePoolPort({ sql }),
        requester,
        clock: () => new Date("2026-09-18T12:00:00.000Z"),
      });
      const key = {
        tenantId: w.investorActor.tenantId,
        investorOrganisationId: w.investorOrgId,
        mandateId: w.mandateId,
        mode: "INVESTOR_DISCOVER" as const,
      };
      const readQueue = async (): Promise<readonly QueueRow[]> =>
        sql<
          QueueRow[]
        >`select msg_id, message from pgmq.read(${RECOMMENDATION_REFRESH_QUEUE}, 0, 10) order by msg_id`;

      // 1. Before any slate exists the feed is honest and asks for one.
      const cold = await reader.pageCompanies({ actor: w.investorActor });
      expect(cold).toMatchObject({
        slateId: null,
        items: [],
        notes: ["RECOMMENDATIONS_REFRESHING"],
      });
      let messages = await readQueue();
      expect(messages).toHaveLength(1);

      // 2. The mandate activation event: HIGH refresh, its own message.
      const activated = await invalidation.apply(
        refreshDirectiveFor(
          event(REFRESH_TRIGGER_EVENTS.MANDATE_ACTIVATED, key.tenantId, {
            investorMandateId: w.mandateId,
            investorOrganisationId: w.investorOrgId,
            version: 1,
            effectiveFrom: new Date().toISOString(),
          }),
        ),
      );
      expect(activated).toEqual({ invalidated: 0, enqueued: 1, coalesced: 0 });
      messages = await readQueue();
      expect(messages).toHaveLength(2);
      const job = messages[1]?.message as {
        type: string;
        tenantId: string;
        data: { mandateId: string; reason: string; requestSequence: number };
      };
      expect(job.type).toBe(RefreshRecommendationSlateJob.name);
      expect(job.tenantId).toBe(key.tenantId);
      expect(job.data).toMatchObject({
        mandateId: w.mandateId,
        reason: "MANDATE_ACTIVATED",
        requestSequence: 2,
      });

      // 3. The worker's turn: claim, build, complete. The second message
      //    finds nothing pending afterwards.
      const claimed = await w.pipeline.refreshRequests.claim(
        key,
        new Date().toISOString(),
      );
      expect(claimed?.status).toBe("CLAIMED");
      expect(claimed?.priority).toBe("HIGH");
      const built = await w.pipeline.builder.build({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
      });
      expect(built.kind).toBe("PUBLISHED");
      if (built.kind !== "PUBLISHED") return;
      expect(built.slate.itemCount).toBe(3);
      expect(
        await w.pipeline.refreshRequests.complete(
          claimed?.id ?? "",
          new Date().toISOString(),
        ),
      ).toEqual({ reopened: false });
      expect(
        await w.pipeline.refreshRequests.claim(key, new Date().toISOString()),
      ).toBeNull();

      // 4. Served by cursor, guarded at read time.
      const page1 = await reader.pageCompanies({
        actor: w.investorActor,
        limit: 2,
      });
      expect(page1.slateId).toBe(built.slate.id);
      expect(page1.items.map((i) => w.labelOf(i.companyId))).toEqual([
        "KoboLogistics",
        "Bakehouse",
      ]);
      const page2 = await reader.pageCompanies({
        actor: w.investorActor,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.items.map((i) => w.labelOf(i.companyId))).toEqual([
        "PetPal",
      ]);
      expect(page2.nextCursor).toBeNull();
      expect(JSON.stringify([page1, page2])).not.toMatch(
        /internalScore|featureSnapshot|candidateProvenance|fingerprint/,
      );

      // 5. KoboLogistics withdraws from discovery: the row changes, the
      //    event arrives, the served slate is invalidated at once and a
      //    HIGH rebuild is asked for; meanwhile the feed says so and the
      //    company is not shown even from the old slate.
      const kobo = w.companies["KoboLogistics"];
      if (kobo === undefined) throw new Error("fixture");
      await sql`update core.companies set marketplace_visibility = 'organisation_private' where id = ${kobo.id}`;
      const withdrawn = await invalidation.apply(
        refreshDirectiveFor(
          event(
            REFRESH_TRIGGER_EVENTS.COMPANY_VISIBILITY_CHANGED,
            kobo.tenantId,
            {
              companyId: kobo.id,
              version: 2,
              visibility: "organisation_private",
            },
          ),
        ),
      );
      expect(withdrawn).toEqual({ invalidated: 1, enqueued: 1, coalesced: 0 });
      expect((await w.pipeline.slates.findById(built.slate.id))?.status).toBe(
        "INVALIDATED",
      );
      const refreshing = await reader.pageCompanies({
        actor: w.investorActor,
        limit: 2,
      });
      expect(refreshing.slateId).toBeNull();
      expect(refreshing.notes).toEqual(["RECOMMENDATIONS_REFRESHING"]);
      // A client mid-scroll on the invalidated slate restarts honestly.
      const midScroll = await reader.pageCompanies({
        actor: w.investorActor,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(midScroll.notes).toContain("SLATE_RESTARTED");
      expect(midScroll.items.map((i) => w.labelOf(i.companyId))).not.toContain(
        "KoboLogistics",
      );

      // 6. The rebuild: a new slate without the company; the old one is history.
      const again = await w.pipeline.refreshRequests.claim(
        key,
        new Date().toISOString(),
      );
      expect(again?.status).toBe("CLAIMED");
      const rebuilt = await w.pipeline.builder.build({
        actor: w.investorActor,
        mode: "INVESTOR_DISCOVER",
      });
      expect(rebuilt.kind).toBe("PUBLISHED");
      if (rebuilt.kind !== "PUBLISHED") return;
      expect(rebuilt.slate.itemCount).toBe(2);
      expect(rebuilt.fingerprint).not.toBe(built.fingerprint);
      await w.pipeline.refreshRequests.complete(
        again?.id ?? "",
        new Date().toISOString(),
      );
      const served = await reader.pageCompanies({
        actor: w.investorActor,
        limit: 10,
      });
      expect(served.slateId).toBe(rebuilt.slate.id);
      expect(served.items.map((i) => w.labelOf(i.companyId))).toEqual([
        "Bakehouse",
        "PetPal",
      ]);
      const history = await w.pipeline.slates.listHistory(key, 10);
      expect(history.map((s) => s.status)).toEqual(["CURRENT", "INVALIDATED"]);
      expect(history[1]?.invalidationReason).toBe("VISIBILITY_CHANGED");
      console.info(
        `[REC-006 §92] slate ${built.slate.id} built (3 items), invalidated on withdrawal, rebuilt as ${rebuilt.slate.id} (2 items); ${(await readQueue()).length} messages seen on ${RECOMMENDATION_REFRESH_QUEUE}`,
      );
    });
  }, 60_000);
});
