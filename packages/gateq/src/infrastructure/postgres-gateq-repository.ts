import { z } from "zod";

import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

import {
  CriterionConfigSchema,
  GatewayCriterionSchema,
  GatewaySchema,
  GatewayVersionSchema,
  type Gateway,
  type GatewayCriterion,
  type GatewayId,
  type GatewayPolicy,
  type GatewayPublicId,
  type GatewayVersion,
  type GatewayVersionId,
} from "../contracts/index.js";
import type {
  GatewayPolicyPort,
  GatewayRepository,
  GatewayVersionRepository,
} from "../application/ports.js";

/**
 * `gateq.gateways`, `gateway_versions` and `gateway_criteria` behind the
 * GateQ ports.
 *
 * Three tables, and nothing else: no join to a company, a mandate or a
 * taxonomy node. Everything outside this schema arrives through another
 * context's port, so a change to how companies are stored cannot silently
 * change what a gateway does.
 *
 * Publication is the one place the database is doing real work. The
 * `gateway_versions_one_published_idx` partial unique index means two
 * concurrent publishes cannot both win, so the code below does not have to
 * be the thing that remembers.
 */

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp column");
};
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

const GatewayRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  investor_organisation_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  public_id: z.string(),
  name: z.string(),
  status: z.string(),
  created_by_user_id: z.string().uuid(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
});

function toGateway(row: unknown): Gateway {
  const r = GatewayRow.parse(row);
  return GatewaySchema.parse({
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    organisationId: r.organisation_id,
    publicId: r.public_id,
    name: r.name,
    status: r.status,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

const VersionRow = z.object({
  id: z.string().uuid(),
  gateway_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  version_number: z.number().int(),
  status: z.string(),
  inbound_mode: z.string(),
  public_title: z.string(),
  public_description: z.string().nullable(),
  qualification_policy_version: z.string(),
  created_by_user_id: z.string().uuid(),
  published_by_user_id: z.string().uuid().nullable(),
  published_at: z.unknown(),
  superseded_at: z.unknown(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
});

function toVersion(row: unknown): GatewayVersion {
  const r = VersionRow.parse(row);
  return GatewayVersionSchema.parse({
    id: r.id,
    gatewayId: r.gateway_id,
    tenantId: r.tenant_id,
    versionNumber: r.version_number,
    status: r.status,
    inboundMode: r.inbound_mode,
    publicTitle: r.public_title,
    publicDescription: r.public_description,
    qualificationPolicyVersion: r.qualification_policy_version,
    createdByUserId: r.created_by_user_id,
    publishedByUserId: r.published_by_user_id,
    publishedAt: isoOrNull(r.published_at),
    supersededAt: isoOrNull(r.superseded_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });
}

const CriterionRow = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  position: z.number().int(),
  requiredness: z.string(),
  label: z.string(),
  config: z.unknown(),
});

function toCriterion(row: unknown): GatewayCriterion {
  const r = CriterionRow.parse(row);
  return GatewayCriterionSchema.parse({
    id: r.id,
    versionId: r.version_id,
    position: r.position,
    requiredness: r.requiredness,
    label: r.label,
    // Validated on the way out as well as in. A payload that no longer
    // parses is a policy nobody can be judged against, and failing here is
    // better than evaluating a rule whose shape has drifted.
    config: CriterionConfigSchema.parse(r.config),
  });
}

export function createPostgresGatewayRepository(options: {
  readonly sql: DatabaseExecutor;
}): GatewayRepository {
  const { sql } = options;
  return {
    create: async (tx, gateway) => {
      const rows = await tx.sql`
        insert into gateq.gateways (
          id, tenant_id, investor_organisation_id, organisation_id,
          public_id, name, status, created_by_user_id
        ) values (
          ${gateway.id}, ${gateway.tenantId}, ${gateway.investorOrganisationId},
          ${gateway.organisationId}, ${gateway.publicId}, ${gateway.name},
          ${gateway.status}, ${gateway.createdByUserId}
        )
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("gateway insert returned nothing");
      return toGateway(row);
    },

    findById: async (id) => {
      const rows = await sql`
        select * from gateq.gateways where id = ${id} limit 1`;
      const row = rows[0];
      return row === undefined ? null : toGateway(row);
    },

    findByPublicId: async (publicId) => {
      const rows = await sql`
        select * from gateq.gateways where public_id = ${publicId} limit 1`;
      const row = rows[0];
      return row === undefined ? null : toGateway(row);
    },

    listForInvestorOrganisation: async (query) => {
      const rows = await sql`
        select * from gateq.gateways
         where tenant_id = ${query.tenantId}
           and investor_organisation_id = ${query.investorOrganisationId}
         order by created_at desc
         limit ${query.limit}`;
      return rows.map(toGateway);
    },

    setStatus: async (tx, id, status) => {
      const rows = await tx.sql`
        update gateq.gateways
           set status = ${status}, updated_at = now()
         where id = ${id}
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("no such gateway");
      return toGateway(row);
    },
  };
}

async function insertCriteria(
  tx: TransactionContext,
  versionId: string,
  tenantId: string,
  criteria: readonly {
    readonly position: number;
    readonly requiredness: string;
    readonly label: string;
    readonly config: unknown;
  }[],
): Promise<void> {
  for (const criterion of criteria) {
    await tx.sql`
      insert into gateq.gateway_criteria (
        version_id, tenant_id, position, requiredness, criterion_type, label, config
      ) values (
        ${versionId}, ${tenantId}, ${criterion.position},
        ${criterion.requiredness},
        ${(criterion.config as { type: string }).type},
        ${criterion.label},
        ${JSON.stringify(criterion.config)}::jsonb
      )`;
  }
}

export function createPostgresGatewayVersionRepository(options: {
  readonly sql: DatabaseExecutor;
}): GatewayVersionRepository {
  const { sql } = options;
  return {
    createDraft: async (tx, input) => {
      // The next number under a lock on the gateway, so two drafts started
      // at once cannot claim the same one.
      await tx.sql`select id from gateq.gateways where id = ${input.gatewayId} for update`;
      const rows = await tx.sql`
        insert into gateq.gateway_versions (
          gateway_id, tenant_id, version_number, status, inbound_mode,
          public_title, public_description, qualification_policy_version,
          created_by_user_id
        )
        select ${input.gatewayId}, ${input.tenantId},
               coalesce(max(v.version_number), 0) + 1, 'DRAFT', ${input.inboundMode},
               ${input.publicTitle}, ${input.publicDescription},
               ${input.qualificationPolicyVersion}, ${input.createdByUserId}
          from gateq.gateway_versions v
         where v.gateway_id = ${input.gatewayId}
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("draft insert returned nothing");
      const version = toVersion(row);
      await insertCriteria(tx, version.id, input.tenantId, input.criteria);
      return version;
    },

    findById: async (id) => {
      const rows = await sql`
        select * from gateq.gateway_versions where id = ${id} limit 1`;
      const row = rows[0];
      return row === undefined ? null : toVersion(row);
    },

    listForGateway: async (gatewayId) => {
      const rows = await sql`
        select * from gateq.gateway_versions
         where gateway_id = ${gatewayId}
         order by version_number desc`;
      return rows.map(toVersion);
    },

    findPublished: async (gatewayId) => {
      const rows = await sql`
        select * from gateq.gateway_versions
         where gateway_id = ${gatewayId} and status = 'PUBLISHED'
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : toVersion(row);
    },

    replaceDraft: async (tx, input) => {
      const rows = await tx.sql`
        update gateq.gateway_versions
           set inbound_mode = ${input.inboundMode},
               public_title = ${input.publicTitle},
               public_description = ${input.publicDescription},
               updated_at = now()
         where id = ${input.versionId} and status = 'DRAFT'
        returning *`;
      const row = rows[0];
      if (row === undefined) throw new Error("no such draft");
      const version = toVersion(row);
      // Criteria are replaced wholesale: a draft is one coherent proposal,
      // not a set of independently editable rules.
      await tx.sql`delete from gateq.gateway_criteria where version_id = ${version.id}`;
      await insertCriteria(tx, version.id, version.tenantId, input.criteria);
      return version;
    },

    publish: async (tx, input) => {
      const claimed = await tx.sql`
        select * from gateq.gateway_versions
         where id = ${input.versionId} for update`;
      const draft = claimed[0];
      if (draft === undefined) throw new Error("no such version");
      const parsed = toVersion(draft);
      if (parsed.status !== "DRAFT") throw new Error("not a draft");

      // Take the incumbent out first, under its own lock, so the partial
      // unique index is never momentarily violated.
      const superseded = await tx.sql`
        update gateq.gateway_versions
           set status = 'SUPERSEDED', superseded_at = ${input.publishedAt}, updated_at = now()
         where gateway_id = ${parsed.gatewayId} and status = 'PUBLISHED'
        returning id`;
      const previous = superseded[0] as { id: string } | undefined;

      const published = await tx.sql`
        update gateq.gateway_versions
           set status = 'PUBLISHED',
               published_at = ${input.publishedAt},
               published_by_user_id = ${input.publishedByUserId},
               updated_at = now()
         where id = ${input.versionId}
        returning *`;
      const row = published[0];
      if (row === undefined) throw new Error("publish returned nothing");
      return {
        version: toVersion(row),
        supersededVersionId: (previous?.id ?? null) as GatewayVersionId | null,
      };
    },

    criteriaFor: async (versionId) => {
      const rows = await sql`
        select * from gateq.gateway_criteria
         where version_id = ${versionId}
         order by position asc`;
      return rows.map(toCriterion);
    },
  };
}

/**
 * The published policy, assembled in one place.
 *
 * Three reads rather than one join, because a join across three tables with
 * two different cardinalities produces rows that have to be re-grouped in
 * memory anyway. The number of statements is fixed: it does not grow with
 * the number of criteria.
 */
export function createPostgresGatewayPolicyPort(options: {
  readonly sql: DatabaseExecutor;
}): GatewayPolicyPort {
  const { sql } = options;
  const gateways = createPostgresGatewayRepository({ sql });
  const versions = createPostgresGatewayVersionRepository({ sql });

  const assemble = async (
    gateway: Gateway | null,
  ): Promise<GatewayPolicy | null> => {
    if (gateway === null) return null;
    const version = await versions.findPublished(gateway.id);
    if (version === null) return null;
    const criteria = await versions.criteriaFor(version.id);
    return { gateway, version, criteria: [...criteria] };
  };

  return {
    publishedPolicy: async (gatewayId: GatewayId) =>
      assemble(await gateways.findById(gatewayId)),
    publishedPolicyByPublicId: async (publicId: GatewayPublicId) =>
      assemble(await gateways.findByPublicId(publicId)),
  };
}
