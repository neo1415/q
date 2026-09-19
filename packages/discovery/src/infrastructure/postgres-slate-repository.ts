import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  RecommendationItemSchema,
  RecommendationSlateSchema,
  type RecommendationItem,
  type RecommendationSlate,
} from "../slates/contracts.js";
import {
  SlateBuildInProgressError,
  type RefreshRequest,
  type RefreshRequestStore,
  type SlateRepository,
} from "../slates/ports.js";

/**
 * `recommendation.slates`, `slate_items` and `refresh_requests` behind the
 * slate ports. Publication is one transaction; every other write is one
 * statement; a page read is one indexed statement on (slate_id, rank).
 * Nothing here joins a company, a mandate or a feature value: that is the
 * read service's business, through the owning contexts' ports.
 */

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp column");
};

const SlateRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  investor_organisation_id: z.string().uuid(),
  mandate_id: z.string().uuid(),
  mandate_version: z.number().int(),
  mode: z.string(),
  status: z.string(),
  eligibility_policy_version: z.string(),
  structured_generator_version: z.string(),
  semantic_generator_version: z.string().nullable(),
  feature_schema_version: z.string(),
  ranker_version: z.string(),
  ranking_config_version: z.string(),
  taxonomy_version: z.record(z.string(), z.number().int()).nullable(),
  generation_fingerprint: z.string().nullable(),
  item_count: z.number().int(),
  diagnostics: z.unknown(),
  generated_at: z.unknown(),
  published_at: z.unknown(),
  expires_at: z.unknown(),
  invalidated_at: z.unknown(),
  invalidation_reason: z.string().nullable(),
  superseded_at: z.unknown(),
  supersedes_slate_id: z.string().uuid().nullable(),
  failure_code: z.string().nullable(),
});

function toSlate(row: unknown): RecommendationSlate {
  const r = SlateRow.parse(row);
  // The column defaults to '{}' while BUILDING; the contract says null then.
  const diagnostics =
    typeof r.diagnostics === "object" &&
    r.diagnostics !== null &&
    Object.keys(r.diagnostics).length > 0
      ? r.diagnostics
      : null;
  return RecommendationSlateSchema.parse({
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    mandateId: r.mandate_id,
    mandateVersion: r.mandate_version,
    mode: r.mode,
    status: r.status,
    eligibilityPolicyVersion: r.eligibility_policy_version,
    structuredGeneratorVersion: r.structured_generator_version,
    semanticGeneratorVersion: r.semantic_generator_version,
    featureSchemaVersion: r.feature_schema_version,
    rankerVersion: r.ranker_version,
    rankingConfigVersion: r.ranking_config_version,
    taxonomyVersion: r.taxonomy_version,
    generationFingerprint: r.generation_fingerprint,
    itemCount: r.item_count,
    diagnostics,
    generatedAt: iso(r.generated_at),
    publishedAt: iso(r.published_at),
    expiresAt: iso(r.expires_at),
    invalidatedAt: iso(r.invalidated_at),
    invalidationReason: r.invalidation_reason,
    supersededAt: iso(r.superseded_at),
    supersedesSlateId: r.supersedes_slate_id,
    failureCode: r.failure_code,
  });
}

const ItemRow = z.object({
  id: z.string().uuid(),
  slate_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_tenant_id: z.string().uuid(),
  rank: z.number().int(),
  internal_score: z.number().nullable(),
  reason_codes: z.array(z.string()),
  feature_snapshot_id: z.string().uuid(),
  feature_snapshot_fingerprint: z.string(),
  candidate_provenance: z.unknown(),
  created_at: z.unknown(),
});

function toItem(row: unknown): RecommendationItem {
  const r = ItemRow.parse(row);
  return RecommendationItemSchema.parse({
    id: r.id,
    slateId: r.slate_id,
    companyId: r.company_id,
    companyTenantId: r.company_tenant_id,
    rank: r.rank,
    internalScore: r.internal_score,
    reasonCodes: r.reason_codes,
    featureSnapshotId: r.feature_snapshot_id,
    featureSnapshotFingerprint: r.feature_snapshot_fingerprint,
    candidateProvenance: r.candidate_provenance,
    createdAt: iso(r.created_at),
  });
}

const IdRow = z.object({ id: z.string().uuid() });

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "23505"
  );
}

async function findSlateById(
  sql: DatabaseExecutor,
  slateId: string,
): Promise<RecommendationSlate | null> {
  const rows = await sql`
    select * from recommendation.slates where id = ${slateId}`;
  const [first] = rows;
  return first === undefined ? null : toSlate(first);
}

export function createPostgresSlateRepository(options: {
  readonly sql: DatabaseExecutor;
}): SlateRepository {
  const { sql } = options;

  return {
    beginBuild: async (input) => {
      const v = input.versions;
      let id: string;
      try {
        const rows = await sql`
          insert into recommendation.slates
            (tenant_id, investor_organisation_id, mandate_id, mandate_version, mode, status,
             eligibility_policy_version, structured_generator_version, semantic_generator_version,
             feature_schema_version, ranker_version, ranking_config_version, taxonomy_version, generated_at)
          values
            (${input.tenantId}, ${input.investorOrganisationId}, ${input.mandateId}, ${input.mandateVersion},
             ${input.mode}, 'BUILDING', ${v.eligibilityPolicyVersion}, ${v.structuredGeneratorVersion},
             ${v.semanticGeneratorVersion}, ${v.featureSchemaVersion}, ${v.rankerVersion}, ${v.rankingConfigVersion},
             ${v.taxonomyVersion === null ? null : sql.json(v.taxonomyVersion)},
             ${input.generatedAt}::text::timestamptz)
          returning id`;
        id = IdRow.parse(rows[0]).id;
      } catch (error: unknown) {
        // slates_building_key: one build per key at a time.
        if (isUniqueViolation(error)) throw new SlateBuildInProgressError();
        throw error;
      }
      const slate = await findSlateById(sql, id);
      if (slate === null) throw new Error("slate vanished after insert");
      return slate;
    },

    insertItems: async (slateId, tenantId, items) => {
      if (items.length === 0) return 0;
      // One multi-row statement per bounded pool, never one per item.
      const rows = items.map((item) => ({
        tenant_id: tenantId,
        slate_id: slateId,
        company_id: item.companyId,
        company_tenant_id: item.companyTenantId,
        rank: item.rank,
        internal_score: item.internalScore,
        reason_codes: [...item.reasonCodes],
        feature_snapshot_id: item.featureSnapshotId,
        feature_snapshot_fingerprint: item.featureSnapshotFingerprint,
        candidate_provenance: sql.json(item.candidateProvenance),
      }));
      const inserted = await sql`
        insert into recommendation.slate_items ${sql(rows)}
        returning id`;
      return inserted.length;
    },

    publish: (transactions, input) =>
      transactions.run(async (tx) => {
        const executor = tx.sql;
        // Lock this BUILDING row, then the key's CURRENT row, so two
        // publications for one key serialise instead of both superseding.
        const building = await executor`
          select id, investor_organisation_id, mandate_id, mode, status
            from recommendation.slates
           where id = ${input.slateId}
           for update`;
        const b = z
          .object({
            id: z.string().uuid(),
            investor_organisation_id: z.string().uuid(),
            mandate_id: z.string().uuid(),
            mode: z.string(),
            status: z.string(),
          })
          .parse(building[0]);
        if (b.status !== "BUILDING") {
          throw new Error(`slate ${b.id} is ${b.status}, not BUILDING`);
        }
        const previous = await executor`
          select id from recommendation.slates
           where investor_organisation_id = ${b.investor_organisation_id}
             and mandate_id = ${b.mandate_id}
             and mode = ${b.mode}
             and status = 'CURRENT'
           for update`;
        const previousId =
          previous[0] === undefined ? null : IdRow.parse(previous[0]).id;
        if (previousId !== null) {
          await executor`
            update recommendation.slates
               set status = 'SUPERSEDED',
                   superseded_at = ${input.publishedAt}::text::timestamptz
             where id = ${previousId} and status = 'CURRENT'`;
        }
        await executor`
          update recommendation.slates
             set status = 'CURRENT',
                 generation_fingerprint = ${input.generationFingerprint},
                 item_count = ${input.itemCount},
                 diagnostics = ${executor.json(input.diagnostics)},
                 published_at = ${input.publishedAt}::text::timestamptz,
                 expires_at = ${input.expiresAt}::text::timestamptz,
                 supersedes_slate_id = ${previousId}
           where id = ${input.slateId} and status = 'BUILDING'`;
        const slate = await findSlateById(executor, input.slateId);
        if (slate === null) throw new Error("published slate not found");
        return { slate, supersededSlateId: previousId };
      }),

    fail: async (slateId, failureCode) => {
      await sql`
        update recommendation.slates
           set status = 'FAILED', failure_code = ${failureCode}
         where id = ${slateId} and status = 'BUILDING'`;
    },

    invalidate: async (slateId, reason, at) => {
      const rows = await sql`
        update recommendation.slates
           set status = 'INVALIDATED',
               invalidated_at = ${at}::text::timestamptz,
               invalidation_reason = ${reason}
         where id = ${slateId} and status = 'CURRENT'
         returning id`;
      return rows.length > 0;
    },

    expire: async (slateId) => {
      const rows = await sql`
        update recommendation.slates
           set status = 'EXPIRED'
         where id = ${slateId} and status = 'CURRENT'
         returning id`;
      return rows.length > 0;
    },

    findById: (slateId) => findSlateById(sql, slateId),

    findCurrent: async (key) => {
      const rows = await sql`
        select * from recommendation.slates
         where tenant_id = ${key.tenantId}
           and investor_organisation_id = ${key.investorOrganisationId}
           and mandate_id = ${key.mandateId}
           and mode = ${key.mode}
           and status = 'CURRENT'`;
      const [first] = rows;
      return first === undefined ? null : toSlate(first);
    },

    findCurrentContaining: async (companyId) => {
      const rows = await sql`
        select s.* from recommendation.slates s
         where s.status = 'CURRENT'
           and exists (
             select 1 from recommendation.slate_items i
              where i.slate_id = s.id and i.company_id = ${companyId})
         order by s.generated_at, s.id`;
      return rows.map(toSlate);
    },

    findCurrentForInvestor: async (input) => {
      const rows = await sql`
        select * from recommendation.slates
         where tenant_id = ${input.tenantId}
           and investor_organisation_id = ${input.investorOrganisationId}
           and status = 'CURRENT'
         order by generated_at, id`;
      return rows.map(toSlate);
    },

    listCurrent: async (limit) => {
      const rows = await sql`
        select * from recommendation.slates
         where status = 'CURRENT'
         order by published_at, id
         limit ${Math.max(1, Math.trunc(limit))}`;
      return rows.map(toSlate);
    },

    pageItems: async (input) => {
      const limit = Math.max(1, Math.trunc(input.limit));
      const rows = await sql`
        select * from recommendation.slate_items
         where slate_id = ${input.slateId}
           and rank > ${Math.max(0, Math.trunc(input.afterRank))}
         order by rank
         limit ${limit}`;
      return rows.map(toItem);
    },

    listHistory: async (key, limit) => {
      const rows = await sql`
        select * from recommendation.slates
         where tenant_id = ${key.tenantId}
           and investor_organisation_id = ${key.investorOrganisationId}
           and mandate_id = ${key.mandateId}
           and mode = ${key.mode}
         order by generated_at desc, id desc
         limit ${Math.max(1, Math.trunc(limit))}`;
      return rows.map(toSlate);
    },
  };
}

// ---------------------------------------------------------------------------
// Refresh requests: one row per key, coalescing by sequence.
// ---------------------------------------------------------------------------

const RequestRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  investor_organisation_id: z.string().uuid(),
  mandate_id: z.string().uuid(),
  mode: z.string(),
  status: z.string(),
  priority: z.enum(["NORMAL", "HIGH"]),
  reason: z.string(),
  request_sequence: z.number().int(),
  claimed_sequence: z.number().int().nullable(),
  attempts: z.number().int(),
});

function toRequest(row: unknown): RefreshRequest {
  const r = RequestRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    mandateId: r.mandate_id,
    mode: r.mode,
    status: r.status,
    priority: r.priority,
    reason: r.reason as RefreshRequest["reason"],
    requestSequence: r.request_sequence,
    claimedSequence: r.claimed_sequence,
    attempts: r.attempts,
  };
}

export function createPostgresRefreshRequestStore(options: {
  readonly sql: DatabaseExecutor;
}): RefreshRequestStore {
  const { sql } = options;
  return {
    requestRefresh: async (input) => {
      // A DONE/FAILED row becomes PENDING again with a fresh attempt budget.
      // A PENDING or CLAIMED row keeps its status and only moves its
      // sequence, priority and reason: the work is coalesced, and a CLAIMED
      // worker sees the moved sequence when it completes and reopens.
      const rows = await sql`
        with prior as (
          select status as prior_status
            from recommendation.refresh_requests
           where investor_organisation_id = ${input.investorOrganisationId}
             and mandate_id = ${input.mandateId}
             and mode = ${input.mode}
        )
        insert into recommendation.refresh_requests as r
          (tenant_id, investor_organisation_id, mandate_id, mode, status, priority, reason,
           request_sequence, requested_at)
        values
          (${input.tenantId}, ${input.investorOrganisationId}, ${input.mandateId}, ${input.mode},
           'PENDING', ${input.priority}, ${input.reason}, 1, ${input.requestedAt}::text::timestamptz)
        on conflict (investor_organisation_id, mandate_id, mode) do update
          set status = case when r.status in ('DONE', 'FAILED') then 'PENDING' else r.status end,
              priority = case when r.status in ('DONE', 'FAILED') then excluded.priority
                              when r.priority = 'HIGH' or excluded.priority = 'HIGH' then 'HIGH'
                              else 'NORMAL' end,
              reason = excluded.reason,
              request_sequence = r.request_sequence + 1,
              requested_at = excluded.requested_at,
              attempts = case when r.status in ('DONE', 'FAILED') then 0 else r.attempts end,
              last_error_code = case when r.status in ('DONE', 'FAILED') then null else r.last_error_code end,
              completed_at = null
        returning r.*, (select prior_status from prior) as prior_status`;
      const [first] = rows;
      if (first === undefined) {
        throw new Error("refresh request upsert returned no row");
      }
      const request = toRequest(first);
      const prior = z
        .object({ prior_status: z.string().nullable() })
        .parse(first).prior_status;
      return {
        request,
        coalesced: prior === "PENDING" || prior === "CLAIMED",
      };
    },

    claim: async (key, claimedAt) => {
      const rows = await sql`
        update recommendation.refresh_requests r
           set status = 'CLAIMED',
               claimed_at = ${claimedAt}::text::timestamptz,
               claimed_sequence = r.request_sequence,
               attempts = r.attempts + 1
         where r.tenant_id = ${key.tenantId}
           and r.investor_organisation_id = ${key.investorOrganisationId}
           and r.mandate_id = ${key.mandateId}
           and r.mode = ${key.mode}
           and r.status = 'PENDING'
         returning r.*`;
      const [first] = rows;
      return first === undefined ? null : toRequest(first);
    },

    complete: async (requestId, completedAt) => {
      const rows = await sql`
        update recommendation.refresh_requests r
           set status = case when r.request_sequence > r.claimed_sequence then 'PENDING' else 'DONE' end,
               completed_at = case when r.request_sequence > r.claimed_sequence
                                   then null else ${completedAt}::text::timestamptz end,
               claimed_at = null,
               claimed_sequence = null,
               last_error_code = null
         where r.id = ${requestId} and r.status = 'CLAIMED'
         returning r.status`;
      const [first] = rows;
      const status =
        first === undefined
          ? "DONE"
          : z.object({ status: z.string() }).parse(first).status;
      return { reopened: status === "PENDING" };
    },

    release: async (requestId, outcome, errorCode) => {
      await sql`
        update recommendation.refresh_requests r
           set status = ${outcome === "RETRY" ? "PENDING" : "FAILED"},
               claimed_at = null,
               claimed_sequence = null,
               last_error_code = ${errorCode}
         where r.id = ${requestId} and r.status = 'CLAIMED'`;
    },

    findByKey: async (key) => {
      const rows = await sql`
        select * from recommendation.refresh_requests
         where tenant_id = ${key.tenantId}
           and investor_organisation_id = ${key.investorOrganisationId}
           and mandate_id = ${key.mandateId}
           and mode = ${key.mode}`;
      const [first] = rows;
      return first === undefined ? null : toRequest(first);
    },
  };
}
