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
import type { PassStanding } from "../domain/reapproach.js";

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
    findByInvestorAndCompanies: async (
      executor,
      investorOrganisationId,
      companyIds,
    ) => {
      if (companyIds.length === 0) return [];
      const rows = await executor`
        ${relationshipSelect(executor)}
         where r.investor_organisation_id = ${investorOrganisationId}
           and r.company_id = any(${[...companyIds]}::uuid[])`;
      return rows.map(toRelationship);
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
    recordProjection: async (executor, input) => {
      // One statement, so it needs no transaction: the predicate is the
      // compare-and-set that keeps a replayed or late projection from ever
      // overwriting one that folded further.
      const rows = await executor`
        update network.relationships r
           set current_state = ${input.state},
               state_updated_at = ${input.stateSince}::text::timestamptz,
               projected_sequence = ${input.throughSequence},
               projector_version = ${input.version},
               projected_at = clock_timestamp()
         where r.id = ${input.relationshipId}
           and ${input.throughSequence} <= r.last_event_sequence
           and (r.projected_sequence < ${input.throughSequence}
                or (r.projected_sequence = ${input.throughSequence}
                    and r.projector_version <> ${input.version}))
        returning r.id`;
      return rows.length > 0;
    },
    listIdsForProjection: async (executor, page) => {
      const rows = await executor`
        select r.id from network.relationships r
         where (${page.after}::uuid is null or r.id > ${page.after}::uuid)
           and (not ${page.onlyBehind}
                or r.projected_sequence < r.last_event_sequence
                or (${page.version ?? null}::text is not null
                    and r.projected_sequence > 0
                    and r.projector_version <> ${page.version ?? null}::text))
         order by r.id
         limit ${page.limit}`;
      return rows.map((row) => RelationshipIdSchema.parse(row["id"]));
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
    findById: async (executor, relationshipEventId) => {
      const rows = await executor`
        ${eventSelect(executor)} where e.id = ${relationshipEventId}`;
      return rows.length === 0 ? null : toEvent(rows[0]);
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

/**
 * The latest pass on a relationship, for the re-approach rule (doc 19 §67):
 * when, and under which mandate. Never the reason or the note.
 */
export function createPostgresPassStandingReader(sql: DatabaseExecutor) {
  return async (relationshipId: string): Promise<PassStanding | null> => {
    const rows = await sql<
      {
        created_at: Date;
        mandate_id: string | null;
        mandate_version: number | null;
      }[]
    >`
      select created_at, mandate_id, mandate_version
        from network.relationship_passes
       where relationship_id = ${relationshipId}
       order by created_at desc
       limit 1`;
    const row = rows[0];
    return row === undefined
      ? null
      : {
          passedAt: row.created_at.toISOString(),
          mandateId: row.mandate_id,
          mandateVersion: row.mandate_version,
        };
  };
}
