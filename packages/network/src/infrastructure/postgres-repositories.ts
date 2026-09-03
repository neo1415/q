import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  CorrelationIdSchema,
  DisclosureScopeSchema,
  RelationshipCurrentStateSchema,
  RelationshipEventTypeSchema,
  RelationshipSourceTypeSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { ActorTypeSchema, TenantIdSchema } from "@capital-q/security";

import {
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type Relationship,
  type RelationshipEvent,
} from "../contracts/index.js";
import type {
  RelationshipEventRepository,
  RelationshipRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for the Network ports. Parameterised SQL only; the
 * relationship tables are server-internal, so these adapters run under the
 * application's trusted connection and never under a browser principal.
 * They expose no UPDATE or DELETE of history and no state setter.
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

const RelationshipRow = z.object({
  id: RelationshipIdSchema,
  tenant_id: TenantIdSchema,
  company_id: CompanyIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  current_state: RelationshipCurrentStateSchema,
  state_updated_at: Timestamp,
  first_discovered_at: Timestamp,
  last_event_sequence: z.coerce.number().int().min(0),
  created_at: Timestamp,
});

function toRelationship(row: unknown): Relationship {
  const r = RelationshipRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    companyId: r.company_id,
    investorOrganisationId: r.investor_organisation_id,
    currentState: r.current_state,
    stateUpdatedAt: r.state_updated_at,
    firstDiscoveredAt: r.first_discovered_at,
    lastEventSequence: r.last_event_sequence,
    createdAt: r.created_at,
  };
}

function relationshipSelect(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.company_id, r.investor_organisation_id, r.current_state,
           r.state_updated_at, r.first_discovered_at, r.last_event_sequence, r.created_at
      from network.relationships r`;
}

export function createPostgresRelationshipRepository(): RelationshipRepository {
  return {
    findById: async (executor, relationshipId) => {
      const rows = await executor`
        ${relationshipSelect(executor)} where r.id = ${relationshipId}`;
      return rows.length === 0 ? null : toRelationship(rows[0]);
    },
    findByParties: async (executor, companyId, investorOrganisationId) => {
      const rows = await executor`
        ${relationshipSelect(executor)}
         where r.company_id = ${companyId}
           and r.investor_organisation_id = ${investorOrganisationId}`;
      return rows.length === 0 ? null : toRelationship(rows[0]);
    },
    lockPair: async (tx, companyId, investorOrganisationId) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext('network.relationship'),
          hashtext(${companyId}::text || ':' || ${investorOrganisationId}::text))`;
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into network.relationships (tenant_id, company_id, investor_organisation_id)
        values (${input.tenantId}, ${input.companyId}, ${input.investorOrganisationId})
        returning id`;
      const inserted = z.object({ id: RelationshipIdSchema }).parse(rows[0]);
      const created = await tx.sql`
        ${relationshipSelect(tx.sql)} where r.id = ${inserted.id}`;
      return toRelationship(created[0]);
    },
    allocateNextEventSequence: async (tx, relationshipId) => {
      // The UPDATE takes the row lock, so concurrent appenders serialise and
      // every committed sequence is unique; a rolled-back caller releases its
      // number with the transaction, so committed sequences stay gapless.
      const rows = await tx.sql`
        update network.relationships r
           set last_event_sequence = r.last_event_sequence + 1
         where r.id = ${relationshipId}
        returning r.last_event_sequence as sequence`;
      const parsed = z
        .object({ sequence: z.coerce.number().int().min(1) })
        .parse(rows[0]);
      return parsed.sequence;
    },
    listByCompany: async (executor, companyId, limit) => {
      const rows = await executor`
        ${relationshipSelect(executor)}
         where r.company_id = ${companyId}
         order by r.created_at desc
         limit ${limit}`;
      return rows.map(toRelationship);
    },
    listByInvestorOrganisation: async (
      executor,
      investorOrganisationId,
      limit,
    ) => {
      const rows = await executor`
        ${relationshipSelect(executor)}
         where r.investor_organisation_id = ${investorOrganisationId}
         order by r.created_at desc
         limit ${limit}`;
      return rows.map(toRelationship);
    },
  };
}

const EventRow = z.object({
  id: RelationshipEventIdSchema,
  tenant_id: TenantIdSchema,
  relationship_id: RelationshipIdSchema,
  sequence: z.coerce.number().int().min(1),
  event_type: RelationshipEventTypeSchema,
  occurred_at: Timestamp,
  actor_type: ActorTypeSchema,
  actor_id: z.string(),
  source_type: RelationshipSourceTypeSchema,
  source_id: z.string().nullable(),
  visibility_scope: DisclosureScopeSchema,
  payload: z.record(z.string(), z.unknown()),
  correlation_id: CorrelationIdSchema,
  created_at: Timestamp,
});

function toEvent(row: unknown): RelationshipEvent {
  const r = EventRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    relationshipId: r.relationship_id,
    sequence: r.sequence,
    eventType: r.event_type,
    occurredAt: r.occurred_at,
    actor: { type: r.actor_type, id: r.actor_id },
    source: { type: r.source_type, id: r.source_id },
    visibilityScope: r.visibility_scope,
    payload: r.payload,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
  };
}

function eventSelect(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.relationship_id, e.sequence, e.event_type, e.occurred_at,
           e.actor_type, e.actor_id, e.source_type, e.source_id, e.visibility_scope,
           e.payload, e.correlation_id, e.created_at
      from network.relationship_events e`;
}

export function createPostgresRelationshipEventRepository(): RelationshipEventRepository {
  return {
    append: async (tx, input) => {
      const rows = await tx.sql`
        insert into network.relationship_events
          (tenant_id, relationship_id, sequence, event_type, occurred_at, actor_type, actor_id,
           source_type, source_id, visibility_scope, payload, correlation_id)
        values
          (${input.tenantId}, ${input.relationshipId}, ${input.sequence}, ${input.eventType},
           coalesce(${input.occurredAt}::text::timestamptz, clock_timestamp()),
           ${input.actorType}, ${input.actorId}, ${input.sourceType}, ${input.sourceId},
           ${input.visibilityScope}, ${JSON.stringify(input.payload)}::text::jsonb,
           ${input.correlationId})
        returning id`;
      const inserted = z
        .object({ id: RelationshipEventIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${eventSelect(tx.sql)} where e.id = ${inserted.id}`;
      return toEvent(created[0]);
    },
    listByRelationship: async (executor, relationshipId, page) => {
      const rows = await executor`
        ${eventSelect(executor)}
         where e.relationship_id = ${relationshipId}
           and e.sequence > ${page.afterSequence ?? 0}
         order by e.sequence
         limit ${page.limit}`;
      return rows.map(toEvent);
    },
  };
}
