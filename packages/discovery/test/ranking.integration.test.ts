import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createFeatureRegistry } from "../src/features/policy.js";
import { RANKING_CONFIG_V1 } from "../src/ranking/config.js";
import type { RankedCandidate } from "../src/ranking/contracts.js";
import { createDeterministicRanker } from "../src/ranking/ranker.js";
import { createRankingService } from "../src/ranking/service.js";
import {
  conceptEmbedder,
  node,
  seedRecommendationWorld,
  TEST_DATABASE_URL,
  type CompanyFixture,
  type RecommendationWorld,
} from "./support/recommendation-world.js";

/**
 * The deterministic ranker over the whole local pipeline (CQ-REC-005 §95):
 * REC-001 eligibility, REC-002 + REC-003 candidates, REC-004 feature
 * snapshots in the real store, then ranking-config.v1. Synthetic companies
 * only; everything rolls back. The ranker itself reads nothing: every
 * statement here is candidate generation or feature computation.
 */

const MARKER = "REC005_PRIVATE_FOUNDER_DATA_MUST_NOT_CHANGE_RANKING";

class Rollback extends Error {}

const MANDATE = {
  name: "Africa enterprise logistics",
  narrative:
    "We back enterprise logistics software companies serving African markets.",
  stageCodes: ["seed"],
  countryCodes: ["NG"],
  preferences: [["industry", "logistics"]],
  exclusions: [["industry", "media_entertainment"]],
} as const;

const COMPANIES: readonly CompanyFixture[] = [
  // The obvious mandate match: seed, NG, logistics, logistics software.
  {
    label: "KoboLogistics",
    summary: "Logistics workflow SaaS for African distributors.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "logistics"]],
    ready: true,
  },
  // A reasonable related company: NG, freight software, but series A and enterprise software.
  {
    label: "LagosFreight",
    summary: "Freight workflow software for Lagos distributors.",
    stage: "series_a",
    country: "NG",
    nodes: [["industry", "enterprise_software"]],
    ready: true,
  },
  // Semantic-only: the same concept in other words, outside every declared dimension.
  {
    label: "Haulr",
    summary:
      "Freight and supply chain operations platform for Nigerian distributors.",
    stage: "series_b",
    country: "KE",
    nodes: [["industry", "enterprise_software"]],
    ready: true,
  },
  // Structured-only: seed and NG, nothing semantic in common.
  {
    label: "Bakehouse",
    summary: "Artisan bread and pastry retail.",
    stage: "seed",
    country: "NG",
    nodes: [["industry", "ecommerce"]],
    ready: true,
  },
  // Weak fit, still eligible: seed only.
  {
    label: "PetPal",
    summary: "Pet grooming marketplace.",
    stage: "seed",
    country: "DE",
    nodes: [["industry", "ecommerce"]],
    ready: true,
  },
];

const TOP_K = 3;

describe("@capital-q/discovery deterministic ranking against local PostgreSQL", () => {
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

  const service = (w: RecommendationWorld) =>
    createRankingService({
      features: w.features,
      ranker: createDeterministicRanker({
        config: RANKING_CONFIG_V1,
        registry: createFeatureRegistry(),
      }),
    });

  async function ranked(w: RecommendationWorld) {
    const result = await service(w).rankCandidates({
      actor: w.investorActor,
      mode: "INVESTOR_DISCOVER",
      candidates: await w.pool(TOP_K),
    });
    if (result.kind !== "RANKED") throw new Error(result.kind);
    return result;
  }

  const labels = (w: RecommendationWorld, r: readonly RankedCandidate[]) =>
    r.map((c) => w.labelOf(c.companyId));

  it("live local ranking: the obvious match leads, every pool shape is ranked from its own features, and the arithmetic reconciles (§95)", async () => {
    await withWorld(async (w) => {
      const result = await ranked(w);
      const order = labels(w, result.ranked);
      expect([...order].sort()).toEqual(COMPANIES.map((c) => c.label).sort());
      expect(order[0]).toBe("KoboLogistics");
      const at = (label: string) => {
        const r = result.ranked.find((c) => w.labelOf(c.companyId) === label);
        if (r === undefined) throw new Error(label);
        return r;
      };
      // Pool shapes, as REC-002 and REC-003 produced them.
      expect(at("KoboLogistics").candidateProvenance.structured).not.toBeNull();
      expect(at("KoboLogistics").candidateProvenance.semantic).not.toBeNull();
      expect(at("Haulr").candidateProvenance.structured).toBeNull();
      expect(at("Bakehouse").candidateProvenance.semantic).toBeNull();
      expect(at("PetPal").candidateProvenance.semantic).toBeNull();
      // A structured-only candidate has no semantic zero.
      expect(
        at("Bakehouse").factors.find(
          (f) => f.featureId === "semantic_fit.mandate_similarity",
        ),
      ).toMatchObject({ outcome: "MISSING", contribution: null });
      // A weaker declared fit sits below a stronger one of the same pool shape.
      expect(order.indexOf("PetPal")).toBeGreaterThan(
        order.indexOf("Bakehouse"),
      );
      for (const r of result.ranked) {
        if (r.internalScore === null) continue;
        const sum = r.factors.reduce((s, f) => s + (f.contribution ?? 0), 0);
        expect(Math.abs(sum - r.internalScore)).toBeLessThan(1e-9);
        expect(r.rankingConfigVersion).toBe("ranking-config.v1");
      }
      expect(result.diagnostics).toMatchObject({
        candidates: 5,
        scored: 5,
        unscored: 0,
        rankingConfigVersion: "ranking-config.v1",
        rankerVersion: "deterministic-ranker.v1",
      });
      expect(result.diagnostics.features.queries).toBe(6);

      console.info(
        `[REC-005 live ranking] config=${RANKING_CONFIG_V1.version} candidates=${String(result.diagnostics.candidates)} scored=${String(result.diagnostics.scored)} unscored=${String(result.diagnostics.unscored)} rankMs=${String(result.diagnostics.rankDurationMs)} featureQueries=${String(result.diagnostics.features.queries)} rankerQueries=0 providerCalls=0`,
      );
      for (const r of result.ranked) {
        const present = r.factors.filter((f) => f.outcome === "SCORED");
        console.info(
          `[REC-005 live ranking] #${String(r.rank)} ${w.labelOf(r.companyId)} score=${r.internalScore === null ? "UNSCORED" : r.internalScore.toFixed(4)} present=${String(r.diagnostics.presentFactorCount)} missing=${String(r.diagnostics.missingFactorCount)} factors=${present.map((f) => `${f.featureId.split(".")[1] ?? f.featureId}:${String(f.featureValue)}→${(f.normalizedValue ?? 0).toFixed(3)}`).join(",")} reasons=${r.reasonCodes.join(",")}`,
        );
      }
    });
  });

  it("H/I/J: founder-private markers in the real private tables change no score, factor, reason or position (§55, §80)", async () => {
    await withWorld(async (w) => {
      const before = await ranked(w);
      const target = w.companies["KoboLogistics"];
      if (target === undefined) throw new Error("fixture");
      await w.tx.sql`insert into q_knowledge.memory_items
        (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key, content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${target.tenantId}, 'company', ${target.id}, 'COMPANY', ${target.id}, 'fact', 'rec5.churn', ${`${MARKER}: largest customer may churn`}, ${"c".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
      await w.tx
        .sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
        values (${target.tenantId}, ${target.founder.userId}, ${target.organisationId}, 'ORGANISATION', ${`${MARKER}: voice interview summary`})`;
      await w.tx
        .sql`insert into evidence.documents (tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${target.tenantId}, ${target.id}, ${target.organisationId}, 'PITCH_DECK', ${`${MARKER}: data room deck`.slice(0, 200)}, 'founder_private', 'RESTRICTED', ${target.founder.userId})`;
      await w.tx
        .sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
        values (${target.tenantId}, 'PUBLIC_WEB', 'COMPANY', ${target.id}, ${`${MARKER}: article`.slice(0, 200)}, 'https://example.test/rec5', 'founder_private', 'CONFIDENTIAL')`;
      // A Q inference on the very node this investor hard-excludes. Under
      // eligibility.v2 only declared classifications decide exclusion, and
      // KoboLogistics declares its industry, so the company stays ELIGIBLE;
      // structured-mandate.v2 and the feature layer ignore the row too.
      await w.tx
        .sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        values (${target.tenantId}, 'COMPANY', ${target.id}, ${node("industry", "media_entertainment")}, 'q_inferred')`;
      const after = await ranked(w);
      expect(after.ranked).toEqual(before.ranked);
      expect(after.diagnostics.features).toMatchObject({
        reused: 5,
        inserted: 0,
        superseded: 0,
      });
      expect(JSON.stringify(after)).not.toContain(MARKER);
    });
  });

  it("K/L: a DRAFT change leaves the ranking alone; an ACTIVE mandate change re-ranks from new snapshots", async () => {
    await withWorld(async (w) => {
      const first = await ranked(w);
      await w.tx
        .sql`update core.investor_mandates set raw_mandate_text = 'Draft: series A only' where id = ${w.draftId}`;
      await w.tx
        .sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
        values (${w.investorActor.tenantId}, ${w.draftId}, 'stage', 'IN', ${w.tx.sql.json({ kind: "codes", values: ["series_a"] })}, 'MUST', false)`;
      const second = await ranked(w);
      expect(second.ranked).toEqual(first.ranked);

      await w.tx
        .sql`update core.investor_mandate_constraints set value_jsonb = ${w.tx.sql.json({ kind: "codes", values: ["series_a"] })} where mandate_id = ${w.mandateId} and dimension = 'stage'`;
      await w.tx
        .sql`update core.investor_mandates set version = version + 1 where id = ${w.mandateId}`;
      const third = await ranked(w);
      expect(
        third.ranked.every((r) => r.featureSnapshot.mandateVersion === 2),
      ).toBe(true);
      const stageOf = (label: string) =>
        third.ranked
          .find((r) => w.labelOf(r.companyId) === label)
          ?.factors.find((f) => f.featureId === "declared_fit.stage")
          ?.featureValue;
      expect(stageOf("KoboLogistics")).toBe("NO_MATCH");
      expect(labels(w, third.ranked)).not.toEqual(labels(w, first.ranked));
    });
  });

  it("M: the same world ranks identically run after run", async () => {
    await withWorld(async (w) => {
      const first = await ranked(w);
      for (let i = 0; i < 3; i += 1) {
        expect((await ranked(w)).ranked).toEqual(first.ranked);
      }
    });
  });
});
