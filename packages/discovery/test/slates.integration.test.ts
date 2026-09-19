import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  createSavepointTransactionManager,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import { STRUCTURED_GENERATOR_VERSION } from "../src/candidates/contracts.js";
import { ELIGIBILITY_POLICY_VERSION } from "../src/eligibility/contracts.js";
import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import {
  createPostgresRefreshRequestStore,
  createPostgresSlateRepository,
} from "../src/infrastructure/postgres-slate-repository.js";
import { RANKING_CONFIG_V1 } from "../src/ranking/config.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import { SEMANTIC_GENERATOR_VERSION } from "../src/semantic/contracts.js";
import {
  decodeSlateCursor,
  encodeSlateCursor,
  type NewRecommendationItem,
  type SlateVersions,
} from "../src/slates/contracts.js";
import {
  SlateBuildInProgressError,
  type SlateKey,
} from "../src/slates/ports.js";
import {
  conceptEmbedder,
  node,
  seedRecommendationWorld,
  TEST_DATABASE_URL,
  type CompanyFixture,
  type RecommendationWorld,
} from "./support/recommendation-world.js";

/**
 * The slate store against local PostgreSQL (CQ-REC-006 Checkpoint A): the
 * build → publish → supersede lifecycle, the one-BUILDING and one-CURRENT
 * claims, immutability after publication, the (slate, rank) page query and
 * refresh-request coalescing. Real REC-004 snapshots back the items so the
 * RESTRICT reference is exercised. Everything rolls back.
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

const VERSIONS: SlateVersions = {
  eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
  structuredGeneratorVersion: STRUCTURED_GENERATOR_VERSION,
  semanticGeneratorVersion: SEMANTIC_GENERATOR_VERSION,
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  rankerVersion: RANKER_VERSION,
  rankingConfigVersion: RANKING_CONFIG_V1.version,
  taxonomyVersion: { industry: 1 },
};

const T0 = "2026-09-19T10:00:00.000Z";
const T1 = "2026-09-19T11:00:00.000Z";
const T2 = "2026-09-19T12:00:00.000Z";
const EXPIRY = "2026-09-20T10:00:00.000Z";
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

type SnapshotRow = {
  readonly id: string;
  readonly company_id: string;
  readonly company_tenant_id: string;
  readonly fingerprint: string;
};

describe("@capital-q/discovery slate store against local PostgreSQL", () => {
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
    readonly key: SlateKey;
    readonly repo: ReturnType<typeof createPostgresSlateRepository>;
    readonly requests: ReturnType<typeof createPostgresRefreshRequestStore>;
    readonly items: readonly NewRecommendationItem[];
    /** Runs work expected to fail inside its own savepoint, so the outer transaction survives. */
    readonly attempt: <T>(
      work: (sql: TransactionContext["sql"]) => Promise<T>,
    ) => Promise<T>;
    readonly item: (index: number) => NewRecommendationItem;
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
        // Real feature snapshots for the items: REC-004 over the live pool.
        const computed = await w.features.computeForCandidates({
          actor: w.investorActor,
          mode: "INVESTOR_DISCOVER",
          candidates: await w.pool(3),
          persist: true,
        });
        if (computed.kind !== "COMPUTED") throw new Error(computed.kind);
        const snapshots = await tx.sql<SnapshotRow[]>`
          select id, company_id, company_tenant_id, fingerprint
            from recommendation.feature_snapshots
           where mandate_id = ${w.mandateId} and status = 'CURRENT'
           order by company_id`;
        expect(snapshots.length).toBe(COMPANIES.length);
        const items: NewRecommendationItem[] = snapshots.map((s, index) => ({
          companyId: s.company_id,
          companyTenantId: s.company_tenant_id,
          rank: index + 1,
          internalScore: Number(((3 - index) / 4).toFixed(2)),
          reasonCodes: ["STAGE_ALIGNED"],
          featureSnapshotId: s.id,
          featureSnapshotFingerprint: s.fingerprint,
          candidateProvenance: {
            structured: {
              generatorVersion: STRUCTURED_GENERATOR_VERSION,
              reasonCodes: ["STAGE_OVERLAP"],
            },
            semantic: null,
          },
        }));
        const key: SlateKey = {
          tenantId: w.investorActor.tenantId,
          investorOrganisationId: w.investorOrgId,
          mandateId: w.mandateId,
          mode: "INVESTOR_DISCOVER",
        };
        await work({
          w,
          tx,
          key,
          repo: createPostgresSlateRepository({ sql: tx.sql }),
          requests: createPostgresRefreshRequestStore({ sql: tx.sql }),
          items,
          attempt: async (inner) =>
            (
              await tx.sql.savepoint(async (sql) => ({
                value: await inner(sql),
              }))
            ).value,
          item: (index) => {
            const item = items[index];
            if (item === undefined) throw new Error(`no item ${index}`);
            return item;
          },
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const build = async (h: Harness, generatedAt: string) => {
    const slate = await h.repo.beginBuild({
      ...h.key,
      mandateVersion: 1,
      versions: VERSIONS,
      generatedAt,
    });
    expect(slate.status).toBe("BUILDING");
    expect(slate.diagnostics).toBeNull();
    expect(await h.repo.insertItems(slate.id, h.key.tenantId, h.items)).toBe(
      h.items.length,
    );
    return slate;
  };

  const publish = (
    h: Harness,
    slateId: string,
    fingerprint: string,
    publishedAt: string,
  ) =>
    h.repo.publish(createSavepointTransactionManager(h.tx), {
      slateId,
      generationFingerprint: fingerprint,
      itemCount: h.items.length,
      diagnostics: {
        structuredCandidates: 3,
        semanticCandidates: 1,
        semanticUnavailable: false,
        mergedCandidates: 3,
        featureSnapshots: 3,
        ranked: 3,
        scored: 3,
        buildDurationMs: 12,
      },
      publishedAt,
      expiresAt: EXPIRY,
    });

  it("builds, publishes and supersedes: one CURRENT per key, history kept, items immutable after publication", async () => {
    await withHarness(async (h) => {
      expect(await h.repo.findCurrent(h.key)).toBeNull();

      const first = await build(h, T0);
      // A second concurrent build claim for the same key is refused.
      await expect(
        h.attempt((sql) =>
          createPostgresSlateRepository({ sql }).beginBuild({
            ...h.key,
            mandateVersion: 1,
            versions: VERSIONS,
            generatedAt: T0,
          }),
        ),
      ).rejects.toBeInstanceOf(SlateBuildInProgressError);
      // Readers still see nothing: a BUILDING slate is not served.
      expect(await h.repo.findCurrent(h.key)).toBeNull();

      const published = await publish(h, first.id, FINGERPRINT_A, T1);
      expect(published.supersededSlateId).toBeNull();
      expect(published.slate.status).toBe("CURRENT");
      expect(published.slate.generationFingerprint).toBe(FINGERPRINT_A);
      expect(published.slate.itemCount).toBe(3);
      expect(published.slate.publishedAt).toBe(T1);
      expect(published.slate.expiresAt).toBe(EXPIRY);
      expect(published.slate.diagnostics?.ranked).toBe(3);
      expect((await h.repo.findCurrent(h.key))?.id).toBe(first.id);

      // Published content is frozen: no new item, no moved rank.
      await expect(
        h.attempt((sql) =>
          createPostgresSlateRepository({ sql }).insertItems(
            first.id,
            h.key.tenantId,
            [{ ...h.item(0), companyId: h.item(1).companyId, rank: 9 }],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        h.attempt(
          (sql) =>
            sql`update recommendation.slate_items set rank = 7 where slate_id = ${first.id} and rank = 1`,
        ),
      ).rejects.toThrow();
      // Publishing twice is refused: the row is no longer BUILDING.
      await expect(
        h.attempt((sql) =>
          createPostgresSlateRepository({ sql }).publish(
            createSavepointTransactionManager({ sql }),
            {
              slateId: first.id,
              generationFingerprint: FINGERPRINT_B,
              itemCount: 3,
              diagnostics: published.slate.diagnostics ?? {
                structuredCandidates: 0,
                semanticCandidates: 0,
                semanticUnavailable: false,
                mergedCandidates: 0,
                featureSnapshots: 0,
                ranked: 0,
                scored: 0,
                buildDurationMs: 0,
              },
              publishedAt: T2,
              expiresAt: EXPIRY,
            },
          ),
        ),
      ).rejects.toThrow(/not BUILDING/);

      // A rebuild starts while the first is served, then supersedes it atomically.
      const second = await build(h, T1);
      expect((await h.repo.findCurrent(h.key))?.id).toBe(first.id);
      const republished = await publish(h, second.id, FINGERPRINT_B, T2);
      expect(republished.supersededSlateId).toBe(first.id);
      expect(republished.slate.supersedesSlateId).toBe(first.id);
      expect((await h.repo.findCurrent(h.key))?.id).toBe(second.id);
      const previous = await h.repo.findById(first.id);
      expect(previous?.status).toBe("SUPERSEDED");
      expect(previous?.supersededAt).toBe(T2);
      expect(previous?.generationFingerprint).toBe(FINGERPRINT_A);
      // History: newest first, the superseded slate still has its items.
      expect(
        (await h.repo.listHistory(h.key, 10)).map((s) => s.status),
      ).toEqual(["CURRENT", "SUPERSEDED"]);
      expect(
        (await h.repo.pageItems({ slateId: first.id, afterRank: 0, limit: 10 }))
          .length,
      ).toBe(3);

      // Lifecycle only from CURRENT; a superseded slate is terminal.
      expect(await h.repo.invalidate(first.id, "REBUILT", T2)).toBe(false);
      expect(await h.repo.expire(first.id)).toBe(false);
      expect(await h.repo.invalidate(second.id, "VISIBILITY_CHANGED", T2)).toBe(
        true,
      );
      const invalidated = await h.repo.findById(second.id);
      expect(invalidated?.status).toBe("INVALIDATED");
      expect(invalidated?.invalidationReason).toBe("VISIBILITY_CHANGED");
      expect(invalidated?.invalidatedAt).toBe(T2);
      expect(await h.repo.findCurrent(h.key)).toBeNull();
      expect(await h.repo.expire(second.id)).toBe(false);
    });
  });

  it("fails a build without touching the served slate, and the failed slate's items stay for diagnosis", async () => {
    await withHarness(async (h) => {
      const served = await build(h, T0);
      await publish(h, served.id, FINGERPRINT_A, T1);
      const failing = await build(h, T1);
      await h.repo.fail(failing.id, "RANKER_REFUSED");
      const failed = await h.repo.findById(failing.id);
      expect(failed?.status).toBe("FAILED");
      expect(failed?.failureCode).toBe("RANKER_REFUSED");
      expect((await h.repo.findCurrent(h.key))?.id).toBe(served.id);
      // The claim is released: a new build may start.
      const retry = await build(h, T2);
      expect(retry.status).toBe("BUILDING");
      // Failing a non-BUILDING slate is a no-op.
      await h.repo.fail(served.id, "IGNORED");
      expect((await h.repo.findById(served.id))?.status).toBe("CURRENT");
    });
  });

  it("pages items by (slate, rank) with a stable opaque cursor, and finds current slates by company and investor", async () => {
    await withHarness(async (h) => {
      const slate = await build(h, T0);
      await publish(h, slate.id, FINGERPRINT_A, T1);

      const page1 = await h.repo.pageItems({
        slateId: slate.id,
        afterRank: 0,
        limit: 2,
      });
      expect(page1.map((i) => i.rank)).toEqual([1, 2]);
      expect(page1[0]?.internalScore).toBe(0.75);
      expect(page1[0]?.reasonCodes).toEqual(["STAGE_ALIGNED"]);
      expect(page1[0]?.featureSnapshotId).toBe(h.item(0).featureSnapshotId);
      expect(page1[0]?.candidateProvenance.structured?.generatorVersion).toBe(
        STRUCTURED_GENERATOR_VERSION,
      );

      const cursor = encodeSlateCursor({
        v: 1,
        slateId: slate.id,
        afterRank: page1[1]?.rank ?? 0,
      });
      expect(cursor).not.toContain(slate.id);
      const decoded = decodeSlateCursor(cursor);
      const page2 = await h.repo.pageItems({
        slateId: decoded.slateId,
        afterRank: decoded.afterRank,
        limit: 2,
      });
      expect(page2.map((i) => i.rank)).toEqual([3]);
      expect(
        await h.repo.pageItems({ slateId: slate.id, afterRank: 3, limit: 2 }),
      ).toEqual([]);
      expect(() => decodeSlateCursor("not-a-cursor")).toThrow();
      expect(() =>
        decodeSlateCursor(
          Buffer.from(
            JSON.stringify({ v: 1, slateId: slate.id, afterRank: -1 }),
          ).toString("base64url"),
        ),
      ).toThrow();

      // Invalidation fan-out lookups.
      const kobo = h.w.companies["KoboLogistics"]?.id ?? "";
      expect(kobo).not.toBe("");
      expect(
        (await h.repo.findCurrentContaining(kobo)).map((s) => s.id),
      ).toEqual([slate.id]);
      expect(
        (
          await h.repo.findCurrentForInvestor({
            tenantId: h.key.tenantId,
            investorOrganisationId: h.key.investorOrganisationId,
          })
        ).map((s) => s.id),
      ).toEqual([slate.id]);
      expect((await h.repo.listCurrent(10)).map((s) => s.id)).toEqual([
        slate.id,
      ]);
      await h.repo.invalidate(slate.id, "MANDATE_CLOSED", T2);
      expect(await h.repo.findCurrentContaining(kobo)).toEqual([]);
      expect(await h.repo.listCurrent(10)).toEqual([]);
    });
  });

  it("coalesces refresh requests per key, raises priority, reopens when a request lands mid-build, and bounds retries", async () => {
    await withHarness(async (h) => {
      const first = await h.requests.requestRefresh({
        ...h.key,
        reason: "MANDATE_ACTIVATED",
        priority: "NORMAL",
        requestedAt: T0,
      });
      expect(first.coalesced).toBe(false);
      expect(first.request.status).toBe("PENDING");
      expect(first.request.requestSequence).toBe(1);

      const second = await h.requests.requestRefresh({
        ...h.key,
        reason: "COMPANY_UPDATED",
        priority: "HIGH",
        requestedAt: T1,
      });
      expect(second.coalesced).toBe(true);
      expect(second.request.id).toBe(first.request.id);
      expect(second.request.requestSequence).toBe(2);
      expect(second.request.priority).toBe("HIGH");
      const lowered = await h.requests.requestRefresh({
        ...h.key,
        reason: "SCHEDULED",
        priority: "NORMAL",
        requestedAt: T1,
      });
      expect(lowered.request.priority).toBe("HIGH");
      expect(lowered.request.reason).toBe("SCHEDULED");

      // Claim takes the whole sequence so far.
      const claimed = await h.requests.claim(h.key, T1);
      expect(claimed?.status).toBe("CLAIMED");
      expect(claimed?.claimedSequence).toBe(3);
      expect(claimed?.attempts).toBe(1);
      expect(await h.requests.claim(h.key, T1)).toBeNull();

      // A request during the build coalesces into the claimed row and reopens it on completion.
      const during = await h.requests.requestRefresh({
        ...h.key,
        reason: "TAXONOMY_CHANGED",
        priority: "NORMAL",
        requestedAt: T2,
      });
      expect(during.coalesced).toBe(true);
      expect(during.request.status).toBe("CLAIMED");
      expect(during.request.requestSequence).toBe(4);
      expect(await h.requests.complete(claimed?.id ?? "", T2)).toEqual({
        reopened: true,
      });
      expect((await h.requests.findByKey(h.key))?.status).toBe("PENDING");

      // Retry and exhaustion.
      const again = await h.requests.claim(h.key, T2);
      expect(again?.attempts).toBe(2);
      await h.requests.release(
        again?.id ?? "",
        "RETRY",
        "SEMANTIC_UNAVAILABLE",
      );
      let row = await h.requests.findByKey(h.key);
      expect(row?.status).toBe("PENDING");
      const last = await h.requests.claim(h.key, T2);
      expect(last?.attempts).toBe(3);
      await h.requests.release(last?.id ?? "", "FAILED", "RANKER_REFUSED");
      row = await h.requests.findByKey(h.key);
      expect(row?.status).toBe("FAILED");
      expect(await h.requests.claim(h.key, T2)).toBeNull();

      // A new request after failure starts a fresh attempt budget.
      const fresh = await h.requests.requestRefresh({
        ...h.key,
        reason: "MANUAL",
        priority: "NORMAL",
        requestedAt: T2,
      });
      expect(fresh.coalesced).toBe(false);
      expect(fresh.request.status).toBe("PENDING");
      expect(fresh.request.attempts).toBe(0);
      expect(fresh.request.priority).toBe("NORMAL");
      const done = await h.requests.claim(h.key, T2);
      expect(await h.requests.complete(done?.id ?? "", T2)).toEqual({
        reopened: false,
      });
      expect((await h.requests.findByKey(h.key))?.status).toBe("DONE");
    });
  });
});

const MARKER = "REC006_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_SLATE";

const BUILD_MANDATE = {
  ...MANDATE,
  exclusions: [["industry", "media_entertainment"]],
} as const;

describe("@capital-q/discovery slate builder over the live local pipeline", () => {
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
            mandate: BUILD_MANDATE,
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

  const build = async (w: RecommendationWorld) =>
    w.pipeline.builder.build({
      actor: w.investorActor,
      mode: "INVESTOR_DISCOVER",
    });

  it("builds, publishes and reproduces: same rows, same fingerprint, no second slate; private founder data changes nothing", async () => {
    await withWorld(async (w) => {
      const first = await build(w);
      expect(first.kind).toBe("PUBLISHED");
      if (first.kind !== "PUBLISHED") return;
      expect(first.slate.status).toBe("CURRENT");
      expect(first.slate.itemCount).toBe(COMPANIES.length);
      expect(first.slate.eligibilityPolicyVersion).toBe(
        ELIGIBILITY_POLICY_VERSION,
      );
      expect(first.slate.semanticGeneratorVersion).toBe(
        SEMANTIC_GENERATOR_VERSION,
      );
      expect(first.slate.rankerVersion).toBe(RANKER_VERSION);
      expect(first.slate.rankingConfigVersion).toBe(RANKING_CONFIG_V1.version);
      expect(first.slate.taxonomyVersion).not.toBeNull();
      const items = await w.pipeline.slates.pageItems({
        slateId: first.slate.id,
        afterRank: 0,
        limit: 50,
      });
      expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
      expect(w.labelOf(items[0]?.companyId ?? "")).toBe("KoboLogistics");
      // Every item names the CURRENT snapshot the ranker scored.
      const stored = await w.tx.sql<{ id: string; fingerprint: string }[]>`
        select id, fingerprint from recommendation.feature_snapshots
         where mandate_id = ${w.mandateId} and status = 'CURRENT'`;
      for (const item of items) {
        const match = stored.find((s) => s.id === item.featureSnapshotId);
        expect(match?.fingerprint).toBe(item.featureSnapshotFingerprint);
      }

      // Reproducible: the same inputs are a no-op.
      const again = await build(w);
      expect(again.kind).toBe("UNCHANGED");
      if (again.kind !== "UNCHANGED") return;
      expect(again.slate.id).toBe(first.slate.id);
      expect(again.fingerprint).toBe(first.fingerprint);

      // Private founder data: Q memory, a conversation, a data room deck,
      // a private source and a Q inference on an excluded node. None of
      // it is an input, so the fingerprint cannot move.
      const target = w.companies["KoboLogistics"];
      if (target === undefined) throw new Error("fixture");
      await w.tx.sql`insert into q_knowledge.memory_items
        (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key, content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${target.tenantId}, 'company', ${target.id}, 'COMPANY', ${target.id}, 'fact', 'rec6.churn', ${`${MARKER}: largest customer may churn`}, ${"c".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
      await w.tx
        .sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
        values (${target.tenantId}, ${target.founder.userId}, ${target.organisationId}, 'ORGANISATION', ${`${MARKER}: voice interview summary`})`;
      await w.tx
        .sql`insert into evidence.documents (tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${target.tenantId}, ${target.id}, ${target.organisationId}, 'PITCH_DECK', ${`${MARKER}: data room deck`.slice(0, 200)}, 'founder_private', 'RESTRICTED', ${target.founder.userId})`;
      await w.tx
        .sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
        values (${target.tenantId}, 'PUBLIC_WEB', 'COMPANY', ${target.id}, ${`${MARKER}: article`.slice(0, 200)}, 'https://example.test/rec6', 'founder_private', 'CONFIDENTIAL')`;
      await w.tx
        .sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        values (${target.tenantId}, 'COMPANY', ${target.id}, ${node("industry", "media_entertainment")}, 'q_inferred')`;
      const after = await build(w);
      expect(after.kind).toBe("UNCHANGED");
      if (after.kind !== "UNCHANGED") return;
      expect(after.fingerprint).toBe(first.fingerprint);
      const rows = await w.tx.sql`
        select s.*, i.* from recommendation.slates s
          left join recommendation.slate_items i on i.slate_id = s.id
         where s.mandate_id = ${w.mandateId}`;
      expect(rows.length).toBe(COMPANIES.length);
      expect(JSON.stringify(rows)).not.toContain(MARKER);
      expect(JSON.stringify(first)).not.toContain(MARKER);
    });
  });

  it("an ACTIVE mandate change publishes a new slate that supersedes the old one atomically; a DRAFT change does not", async () => {
    await withWorld(async (w) => {
      const first = await build(w);
      if (first.kind !== "PUBLISHED") throw new Error(first.kind);
      await w.tx
        .sql`update core.investor_mandates set raw_mandate_text = 'Draft: series A only' where id = ${w.draftId}`;
      expect((await build(w)).kind).toBe("UNCHANGED");

      // A declared preference change on the ACTIVE mandate: new snapshots,
      // new fingerprints, new slate.
      await w.tx
        .sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
        values (${w.investorActor.tenantId}, ${w.mandateId}, ${node("industry", "ecommerce")}, 'STRONG', false, 'user_selected')`;
      await w.tx
        .sql`update core.investor_mandates set version = version + 1 where id = ${w.mandateId}`;
      const second = await build(w);
      expect(second.kind).toBe("PUBLISHED");
      if (second.kind !== "PUBLISHED") return;
      expect(second.fingerprint).not.toBe(first.fingerprint);
      expect(second.supersededSlateId).toBe(first.slate.id);
      expect(second.slate.mandateVersion).toBe(first.slate.mandateVersion + 1);
      const history = await w.pipeline.slates.listHistory(
        {
          tenantId: w.investorActor.tenantId,
          investorOrganisationId: w.investorOrgId,
          mandateId: w.mandateId,
          mode: "INVESTOR_DISCOVER",
        },
        10,
      );
      expect(history.map((s) => s.status)).toEqual(["CURRENT", "SUPERSEDED"]);
      expect(
        (
          await w.pipeline.slates.pageItems({
            slateId: first.slate.id,
            afterRank: 0,
            limit: 10,
          })
        ).length,
      ).toBe(COMPANIES.length);
    });
  });
});
