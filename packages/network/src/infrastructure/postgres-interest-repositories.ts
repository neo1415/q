import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema, UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";

import {
  InterestIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type Interest,
} from "../contracts/index.js";
import type {
  InterestRepository,
  InterestRequestStore,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for Express Interest (CQ-NET-010). Parameterised SQL
 * only, under the application's trusted connection: the tables are
 * server-internal. No status update and no delete exist here.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const InterestRow = z.object({
  id: InterestIdSchema,
  tenant_id: TenantIdSchema,
  relationship_id: RelationshipIdSchema,
  company_id: CompanyIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  expressed_by_party: z.literal("INVESTOR"),
  status: z.enum(["EXPRESSED", "WITHDRAWN"]),
  expressed_by_user_id: UuidSchema,
  expressed_in_organisation_id: UuidSchema,
  relationship_event_id: RelationshipEventIdSchema,
  created_at: Timestamp,
});

function toInterest(row: unknown): Interest {
  const r = InterestRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    relationshipId: r.relationship_id,
    companyId: r.company_id,
    investorOrganisationId: r.investor_organisation_id,
    expressedByParty: r.expressed_by_party,
    status: r.status,
    expressedByUserId: r.expressed_by_user_id,
    expressedInOrganisationId: r.expressed_in_organisation_id,
    relationshipEventId: r.relationship_event_id,
    createdAt: r.created_at,
  };
}

function interestSelect(executor: DatabaseExecutor) {
  return executor`
    select i.id, i.tenant_id, i.relationship_id, r.company_id, r.investor_organisation_id,
           i.expressed_by_party, i.status, i.expressed_by_user_id,
           i.expressed_in_organisation_id, i.relationship_event_id, i.created_at
      from network.interests i
      join network.relationships r on r.id = i.relationship_id and r.tenant_id = i.tenant_id`;
}

export function createPostgresInterestRepository(): InterestRepository {
  return {
    findById: async (executor, interestId) => {
      const rows = await executor`
        ${interestSelect(executor)} where i.id = ${interestId}`;
      return rows.length === 0 ? null : toInterest(rows[0]);
    },
    findOpenByRelationship: async (executor, relationshipId) => {
      const rows = await executor`
        ${interestSelect(executor)}
         where i.relationship_id = ${relationshipId}
           and i.expressed_by_party = 'INVESTOR'
           and i.status = 'EXPRESSED'`;
      return rows.length === 0 ? null : toInterest(rows[0]);
    },
    insert: async (tx, input) => {
      await tx.sql`
        insert into network.interests
          (id, tenant_id, relationship_id, expressed_by_party, expressed_by_user_id,
           expressed_in_organisation_id, relationship_event_id)
        values
          (${input.id}, ${input.tenantId}, ${input.relationshipId}, 'INVESTOR',
           ${input.expressedByUserId}, ${input.expressedInOrganisationId},
           ${input.relationshipEventId})`;
      const rows = await tx.sql`
        ${interestSelect(tx.sql)} where i.id = ${input.id}`;
      return toInterest(rows[0]);
    },
  };
}

const RequestRow = z.object({
  request_hash: z.string(),
  interest_id: InterestIdSchema,
});

export function createPostgresInterestRequestStore(): InterestRequestStore {
  return {
    lock: async (tx, userId, organisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':interest:' || ${organisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, organisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select q.request_hash, q.interest_id
          from network.interest_requests q
         where q.user_id = ${userId}
           and q.organisation_id = ${organisationId}
           and q.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) return null;
      const parsed = RequestRow.parse(rows[0]);
      return {
        requestHash: parsed.request_hash,
        interestId: parsed.interest_id,
      };
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into network.interest_requests
          (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash, interest_id)
        values
          (${input.userId}, ${input.organisationId}, ${input.tenantId},
           ${input.idempotencyKeyHash}, ${input.requestHash}, ${input.interestId})`;
    },
  };
}
