import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import { createPostgresInteractionRepository } from "../src/infrastructure/postgres-interaction-repository.js";
import type { NewInteractionEvent } from "../src/interactions/ports.js";

import {
  conceptEmbedder,
  seedRecommendationWorld,
  TEST_DATABASE_URL,
  type CompanyFixture,
  type RecommendationWorld,
} from "./support/recommendation-world.js";

/**
 * `recommendation.interaction_events` and `interaction_state` against real
 * PostgreSQL (CQ-REC-008 A).
 *
 * The properties that only the database can prove: the uniqueness that makes
 * a retry harmless, the trigger that makes history append-only, and the
 * projection arithmetic that has to settle a save and an unsave without
 * caring which transaction committed first.
 */

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
];

const SESSION = "sess-0000000000000001";
const T0 = "2026-09-30T10:00:00.000Z";
const T1 = "2026-09-30T11:00:00.000Z";

describe("@capital-q/discovery interactions against local PostgreSQL", () => {
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

  type Harness = {
    readonly w: RecommendationWorld;
    readonly tx: TransactionContext;
    readonly repo: ReturnType<typeof createPostgresInteractionRepository>;
    readonly companyId: string;
    readonly companyTenantId: string;
    readonly other: { readonly id: string; readonly tenantId: string };
    readonly event: (
      overrides: Partial<NewInteractionEvent>,
    ) => NewInteractionEvent;
    /** Runs work expected to fail in its own savepoint, so the outer transaction survives. */
    readonly attempt: <T>(
      work: (sql: TransactionContext["sql"]) => Promise<T>,
    ) => Promise<T>;
  };

  async function withHarness(work: (h: Harness) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const w = await seedRecommendationWorld(tx, {
          mandate: MANDATE,
          companies: COMPANIES,
          embedder: conceptEmbedder(),
        });
        const seeded = Object.values(w.companies);
        const first = seeded[0];
        const second = seeded[1];
        if (first === undefined || second === undefined) {
          throw new Error("expected two seeded companies");
        }
        const repo = createPostgresInteractionRepository({ sql: tx.sql });
        const event = (
          overrides: Partial<NewInteractionEvent>,
        ): NewInteractionEvent => ({
          tenantId: w.investorActor.tenantId,
          actorUserId: w.investorActor.userId,
          investorOrganisationId: w.investorOrgId,
          companyId: first.id,
          companyTenantId: first.tenantId,
          interactionType: "IMPRESSION",
          surface: "RECOMMENDATION_FEED",
          exposure: null,
          mediaAssetId: null,
          watchMilestone: null,
          passReason: null,
          clientEventId: `evt-${randomUUID()}`,
          sessionId: SESSION,
          occurredAt: T0,
          ...overrides,
        });
        await work({
          w,
          tx,
          repo,
          companyId: first.id,
          companyTenantId: first.tenantId,
          other: { id: second.id, tenantId: second.tenantId },
          event,
          attempt: async (inner) =>
            (
              await tx.sql.savepoint(async (sql) => ({
                value: await inner(sql),
              }))
            ).value,
        });
        completed = true;
        throw new Error("rollback");
      });
    } catch (error: unknown) {
      if (!completed) throw error;
    }
  }

  it("records an interaction and returns it as stored", async () => {
    await withHarness(async (h) => {
      const { event, deduplicated } = await h.repo.append(h.event({}));
      expect(deduplicated).toBe(false);
      expect(event.interactionType).toBe("IMPRESSION");
      // Doc 19 §66: the class is recorded, never a number.
      expect(event.strengthClass).toBe("ATTENTION");
      expect(event.interactionVersion).toBe("recommendation-interaction.v1");
      expect(event.occurredAt).toBe(T0);
    });
  });

  it("C/I: the same client event id is one row, however often it arrives", async () => {
    await withHarness(async (h) => {
      const input = h.event({ clientEventId: "evt-retry-0000001" });
      const first = await h.repo.append(input);
      const second = await h.repo.append(input);
      expect(first.deduplicated).toBe(false);
      expect(second.deduplicated).toBe(true);
      expect(second.event.id).toBe(first.event.id);
      const rows = await h.tx.sql`
        select count(*)::int as n from recommendation.interaction_events
         where client_event_id = 'evt-retry-0000001'`;
      expect((rows[0] as { n: number }).n).toBe(1);
    });
  });

  it("X: the same client event id from another actor is a different row", async () => {
    await withHarness(async (h) => {
      // Uniqueness is scoped per actor, so one person's id cannot occupy
      // another person's identity.
      const shared = "evt-shared-000001";
      await h.repo.append(h.event({ clientEventId: shared }));
      // A second colleague of the same investor organisation. Profiles are
      // created by the auth trigger, the same way a real person's is.
      const authUserId = randomUUID();
      await h.tx.sql`insert into auth.users (id) values (${authUserId})`;
      const profiles = await h.tx.sql<{ id: string }[]>`
        select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      const colleague = profiles[0]?.id;
      if (colleague === undefined)
        throw new Error("profile trigger did not run");
      const second = await h.repo.append(
        h.event({ clientEventId: shared, actorUserId: colleague }),
      );
      expect(second.deduplicated).toBe(false);
    });
  });

  it("E: the same watch milestone in one session cannot be recorded twice", async () => {
    await withHarness(async (h) => {
      const media = randomUUID();
      const milestone = {
        interactionType: "WATCH_MILESTONE" as const,
        mediaAssetId: media,
        watchMilestone: "P50" as const,
      };
      const first = await h.repo.append(h.event(milestone));
      // A retry that invented a fresh client id must still not duplicate the
      // logical milestone -- and must be reported as the duplicate it is,
      // not as an error the caller has to interpret.
      const again = await h.repo.append(
        h.event({ ...milestone, clientEventId: "evt-different-00001" }),
      );
      expect(again.deduplicated).toBe(true);
      expect(again.event.id).toBe(first.event.id);
      const rows = await h.tx.sql`
        select count(*)::int as n from recommendation.interaction_events
         where interaction_type = 'WATCH_MILESTONE' and watch_milestone = 'P50'`;
      expect((rows[0] as { n: number }).n).toBe(1);
    });
  });

  it("history is append-only: an event cannot be edited or deleted", async () => {
    await withHarness(async (h) => {
      const { event } = await h.repo.append(h.event({}));
      await expect(
        h.attempt(
          (sql) => sql`
            update recommendation.interaction_events
               set surface = 'SEARCH' where id = ${event.id}`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        h.attempt(
          (sql) => sql`
            delete from recommendation.interaction_events where id = ${event.id}`,
        ),
      ).rejects.toThrow(/append-only/);
    });
  });

  it("H/I: save is durable and saving twice leaves one saved company", async () => {
    await withHarness(async (h) => {
      const saved = await h.repo.append(
        h.event({ interactionType: "SAVE", occurredAt: T0 }),
      );
      const state = await h.repo.project(saved.event);
      expect(state.saved).toBe(true);
      expect(state.savedAt).toBe(T0);
      // The same report again changes nothing.
      const retry = await h.repo.append(
        h.event({
          interactionType: "SAVE",
          clientEventId: saved.event.clientEventId,
        }),
      );
      expect(retry.deduplicated).toBe(true);
      const ids = await h.repo.savedCompanyIds({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: h.w.investorOrgId,
        limit: 10,
      });
      expect(ids).toEqual([h.companyId]);
    });
  });

  it("save then unsave leaves the company unsaved, and the history intact", async () => {
    await withHarness(async (h) => {
      const saved = await h.repo.append(h.event({ interactionType: "SAVE" }));
      await h.repo.project(saved.event);
      const unsaved = await h.repo.append(
        h.event({ interactionType: "UNSAVE", occurredAt: T1 }),
      );
      const state = await h.repo.project(unsaved.event);
      expect(state.saved).toBe(false);
      expect(state.savedAt).toBeNull();
      // Both decisions are still readable: the projection changed, the
      // record of what happened did not.
      const history = await h.repo.historyForCompany({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: h.w.investorOrgId,
        companyId: h.companyId,
        limit: 10,
      });
      expect(history.map((e) => e.interactionType)).toEqual(["UNSAVE", "SAVE"]);
    });
  });

  it("J/K: a pass is durable and carries its reason only when given", async () => {
    await withHarness(async (h) => {
      const passed = await h.repo.append(
        h.event({ interactionType: "PASS", passReason: "STAGE" }),
      );
      const state = await h.repo.project(passed.event);
      expect(state.passed).toBe(true);
      expect(state.lastPassReason).toBe("STAGE");

      const bare = await h.repo.append(
        h.event({
          interactionType: "PASS",
          companyId: h.other.id,
          companyTenantId: h.other.tenantId,
        }),
      );
      const other = await h.repo.project(bare.event);
      expect(other.passed).toBe(true);
      expect(other.lastPassReason).toBeNull();
    });
  });

  it("undo pass (doc 19 §68): unpassed, listed no longer, history intact, and a retried undo is one event", async () => {
    await withHarness(async (h) => {
      const passed = await h.repo.append(
        h.event({ interactionType: "PASS", passReason: "STAGE" }),
      );
      await h.repo.project(passed.event);
      const listed = await h.repo.passedCompanyIds({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: h.w.investorOrgId,
        limit: 10,
      });
      expect(listed).toEqual([h.companyId]);

      const undo = h.event({ interactionType: "UNPASS", occurredAt: T1 });
      const first = await h.repo.append(undo);
      const state = await h.repo.project(first.event);
      expect(state).toMatchObject({
        passed: false,
        passedAt: null,
        lastPassReason: null,
      });
      // The same press again (same client event id): one row, no new fold.
      const again = await h.repo.append(undo);
      expect(again.deduplicated).toBe(true);

      expect(
        await h.repo.passedCompanyIds({
          tenantId: h.w.investorActor.tenantId,
          investorOrganisationId: h.w.investorOrgId,
          limit: 10,
        }),
      ).toEqual([]);
      const history = await h.repo.historyForCompany({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: h.w.investorOrgId,
        companyId: h.companyId,
        limit: 10,
      });
      expect(history.map((e) => e.interactionType)).toEqual(["UNPASS", "PASS"]);
    });
  });

  it("impressions accumulate a bounded count, not a popularity score", async () => {
    await withHarness(async (h) => {
      const first = await h.repo.append(
        h.event({ clientEventId: "evt-imp-0000001" }),
      );
      await h.repo.project(first.event);
      const second = await h.repo.append(
        h.event({
          clientEventId: "evt-imp-0000002",
          sessionId: "sess-0000000000000002",
          occurredAt: T1,
        }),
      );
      const state = await h.repo.project(second.event);
      expect(state.impressionCount).toBe(2);
      expect(state.lastImpressionAt).toBe(T1);
      // The count lives with this investor, never on the company.
      const onCompany = await h.tx.sql`
        select count(*)::int as n
          from information_schema.columns
         where table_schema = 'core' and table_name = 'companies'
           and column_name in ('impression_count', 'view_count', 'popularity_score')`;
      expect((onCompany[0] as { n: number }).n).toBe(0);
    });
  });

  it("state is returned per company and says nothing about companies it has none for", async () => {
    await withHarness(async (h) => {
      const saved = await h.repo.append(h.event({ interactionType: "SAVE" }));
      await h.repo.project(saved.event);
      const state = await h.repo.stateForCompanies({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: h.w.investorOrgId,
        companyIds: [h.companyId, h.other.id],
      });
      expect(state.get(h.companyId)?.saved).toBe(true);
      expect(state.has(h.other.id)).toBe(false);
    });
  });

  it("Q: another investor organisation sees none of it", async () => {
    await withHarness(async (h) => {
      const saved = await h.repo.append(h.event({ interactionType: "SAVE" }));
      await h.repo.project(saved.event);
      const stranger = await h.repo.stateForCompanies({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: randomUUID(),
        companyIds: [h.companyId],
      });
      expect(stranger.size).toBe(0);
      const ids = await h.repo.savedCompanyIds({
        tenantId: h.w.investorActor.tenantId,
        investorOrganisationId: randomUUID(),
        limit: 10,
      });
      expect(ids).toEqual([]);
    });
  });
});
