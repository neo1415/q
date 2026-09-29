import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema, UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";

import {
  InterestIdSchema,
  InterestResponseIdSchema,
  MatchIdSchema,
  RelationshipEventIdSchema,
  INTEREST_PARTIES,
  RelationshipIdSchema,
  type Interest,
} from "../contracts/index.js";
import type {
  InterestRepository,
  InterestRequestStore,
  InterestResponseRepository,
  InterestResponseRequestStore,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for Express Interest (CQ-NET-010) and the company's
 * answer to it (CQ-NET-011). Parameterised SQL only, under the
 * application's trusted connection: the tables are server-internal. No
 * status update and no delete exist here; an answer is inserted once.
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
  expressed_by_party: z.enum(INTEREST_PARTIES),
  status: z.enum(["EXPRESSED", "WITHDRAWN"]),
  expressed_by_user_id: UuidSchema,
  expressed_in_organisation_id: UuidSchema,
  relationship_event_id: RelationshipEventIdSchema,
  created_at: Timestamp,
  response_id: InterestResponseIdSchema.nullable(),
  response_decision: z.enum(["ACCEPTED", "DECLINED"]).nullable(),
  responded_at: Timestamp.nullable(),
  match_id: MatchIdSchema.nullable(),
  match_status: z.enum(["ACTIVE", "ENDED"]).nullable(),
  matched_at: Timestamp.nullable(),
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
    response:
      r.response_id === null ||
      r.response_decision === null ||
      r.responded_at === null
        ? null
        : {
            id: r.response_id,
            decision: r.response_decision,
            respondedAt: r.responded_at,
          },
    connection:
      r.match_id === null || r.match_status === null || r.matched_at === null
        ? null
        : { id: r.match_id, status: r.match_status, connectedAt: r.matched_at },
  };
}

/** An interest always travels with its answer and the match it opened. */
function interestSelect(executor: DatabaseExecutor) {
  return executor`
    select i.id, i.tenant_id, i.relationship_id, r.company_id, r.investor_organisation_id,
           i.expressed_by_party, i.status, i.expressed_by_user_id,
           i.expressed_in_organisation_id, i.relationship_event_id, i.created_at,
           a.id as response_id, a.decision as response_decision, a.created_at as responded_at,
           m.id as match_id, m.status as match_status, m.matched_at
      from network.interests i
      join network.relationships r on r.id = i.relationship_id and r.tenant_id = i.tenant_id
      left join network.interest_responses a on a.interest_id = i.id
      left join network.matches m on m.interest_response_id = a.id`;
}

export function createPostgresInterestRepository(): InterestRepository {
  return {
    findById: async (executor, interestId) => {
      const rows = await executor`
        ${interestSelect(executor)} where i.id = ${interestId}`;
      return rows.length === 0 ? null : toInterest(rows[0]);
    },
    findOpenByRelationship: async (
      executor,
      relationshipId,
      party = "INVESTOR",
    ) => {
      const rows = await executor`
        ${interestSelect(executor)}
         where i.relationship_id = ${relationshipId}
           and i.expressed_by_party = ${party}
           and i.status = 'EXPRESSED'`;
      return rows.length === 0 ? null : toInterest(rows[0]);
    },
    listByCompany: async (executor, companyId, limit) => {
      const rows = await executor`
        ${interestSelect(executor)}
         where r.company_id = ${companyId}
           and i.expressed_by_party = 'INVESTOR'
           and i.status = 'EXPRESSED'
         order by i.created_at desc
         limit ${limit}`;
      return rows.map(toInterest);
    },
    listByInvestor: async (executor, investorOrganisationId, limit) => {
      const rows = await executor`
        ${interestSelect(executor)}
         where r.investor_organisation_id = ${investorOrganisationId}
           and i.expressed_by_party = 'COMPANY'
           and i.status = 'EXPRESSED'
         order by i.created_at desc
         limit ${limit}`;
      return rows.map(toInterest);
    },
    insert: async (tx, input) => {
      await tx.sql`
        insert into network.interests
          (id, tenant_id, relationship_id, expressed_by_party, expressed_by_user_id,
           expressed_in_organisation_id, relationship_event_id)
        values
          (${input.id}, ${input.tenantId}, ${input.relationshipId},
           ${input.expressedByParty ?? "INVESTOR"},
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

export function createPostgresInterestResponseRepository(): InterestResponseRepository {
  return {
    insert: async (tx, input) => {
      await tx.sql`
        insert into network.interest_responses
          (id, tenant_id, relationship_id, interest_id, decision,
           responded_by_user_id, responded_in_organisation_id, relationship_event_id,
           responded_by_party)
        values
          (${input.id}, ${input.tenantId}, ${input.relationshipId}, ${input.interestId},
           ${input.decision}, ${input.respondedByUserId}, ${input.respondedInOrganisationId},
           ${input.relationshipEventId}, ${input.respondedByParty ?? "COMPANY"})`;
    },
    insertMatch: async (tx, input) => {
      await tx.sql`
        insert into network.matches
          (id, tenant_id, relationship_id, match_source, interest_response_id)
        values
          (${input.id}, ${input.tenantId}, ${input.relationshipId}, 'INTEREST_ACCEPTED',
           ${input.interestResponseId})`;
    },
  };
}

const ResponseRequestRow = z.object({
  request_hash: z.string(),
  interest_id: InterestIdSchema,
});

export function createPostgresInterestResponseRequestStore(): InterestResponseRequestStore {
  return {
    lock: async (tx, userId, organisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':interest-response:' || ${organisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, organisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select q.request_hash, a.interest_id
          from network.interest_response_requests q
          join network.interest_responses a on a.id = q.interest_response_id
         where q.user_id = ${userId}
           and q.organisation_id = ${organisationId}
           and q.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) return null;
      const parsed = ResponseRequestRow.parse(rows[0]);
      return {
        requestHash: parsed.request_hash,
        interestId: parsed.interest_id,
      };
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into network.interest_response_requests
          (user_id, organisation_id, tenant_id, idempotency_key_hash, request_hash,
           interest_response_id)
        values
          (${input.userId}, ${input.organisationId}, ${input.tenantId},
           ${input.idempotencyKeyHash}, ${input.requestHash}, ${input.interestResponseId})`;
    },
  };
}
