import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import type {
  SemanticNearestHit,
  SemanticRepresentationStore,
  StoredRepresentation,
  VectorIdentity,
} from "../semantic/ports.js";

/**
 * The `recommendation` schema, behind the store port. Representations and
 * vectors are written only here; nearest-neighbour retrieval joins the
 * company's CURRENT discoverability on every query so a vector never
 * outlives a privacy or readiness change. Exact scan under a
 * configuration prefilter, by the repository's convention for this
 * volume; see the migration for why no approximate index yet.
 */

const RepresentationRowSchema = z.object({
  id: z.string().uuid(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

const VectorRowSchema = z.object({
  embedding: z.string(),
});

const NearestRowSchema = z.object({
  company_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  distance: z.coerce.number().finite(),
});

const DISCOVERABLE = ["network_visible", "public_external"] as const;

/** pgvector's text form. Built from validated finite numbers, bound as one parameter. */
export function toVectorLiteral(vector: readonly number[]): string {
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new RangeError("a vector component is not finite");
    }
  }
  return `[${vector.join(",")}]`;
}

/** pgvector's text form back to numbers. */
export function fromVectorLiteral(text: string): readonly number[] {
  const inner = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner === "") return [];
  return inner.split(",").map((part) => {
    const value = Number(part);
    if (!Number.isFinite(value)) {
      throw new RangeError("a stored vector component is not finite");
    }
    return value;
  });
}

function toStored(row: unknown): StoredRepresentation {
  const r = RepresentationRowSchema.parse(row);
  return {
    id: r.id,
    contentSha256: r.content_sha256,
    sourceFingerprint: r.source_fingerprint,
  };
}

function vectorOf(rows: readonly unknown[]): readonly number[] | null {
  const [first] = rows;
  if (first === undefined) return null;
  return fromVectorLiteral(VectorRowSchema.parse(first).embedding);
}

export function createPostgresSemanticRepresentationStore(options: {
  readonly sql: DatabaseExecutor;
}): SemanticRepresentationStore {
  const { sql } = options;

  const identityPredicate = (identity: VectorIdentity) => ({
    modelCode: identity.modelCode,
    dimension: identity.dimension,
    configurationVersion: identity.configurationVersion,
    instructionVersion: identity.instructionVersion,
  });

  return {
    currentCompanyRepresentation: async (input) => {
      const rows = await sql`
        select r.id, r.content_sha256, r.source_fingerprint
          from recommendation.company_representations r
         where r.company_id = ${input.companyId}
           and r.purpose = ${input.purpose}
           and r.representation_version = ${input.representationVersion}
           and r.status = 'CURRENT'`;
      const [first] = rows;
      return first === undefined ? null : toStored(first);
    },

    supersedeCompanyRepresentation: async (id) => {
      await sql`
        update recommendation.company_representations
           set status = 'SUPERSEDED', superseded_at = now()
         where id = ${id} and status = 'CURRENT'`;
    },

    insertCompanyRepresentation: async (input) => {
      const rows = await sql`
        insert into recommendation.company_representations
          (tenant_id, company_id, purpose, representation_version, source_fingerprint, content_sha256, content)
        values
          (${input.tenantId}, ${input.companyId}, ${input.purpose}, ${input.representationVersion},
           ${input.sourceFingerprint}, ${input.contentSha256}, ${input.content})
        returning id, content_sha256, source_fingerprint`;
      const [first] = rows;
      if (first === undefined)
        throw new Error("representation insert returned no row");
      return toStored(first);
    },

    hasCompanyEmbedding: async (input) => {
      const p = identityPredicate(input.identity);
      const rows = await sql`
        select 1 as present
          from recommendation.company_embeddings e
         where e.representation_id = ${input.representationId}
           and e.model_code = ${p.modelCode}
           and e.embedding_dimension = ${p.dimension}
           and e.configuration_version = ${p.configurationVersion}
           and e.instruction_version = ${p.instructionVersion}
         limit 1`;
      return rows.length > 0;
    },

    findReusableCompanyVector: async (input) => {
      const p = identityPredicate(input.identity);
      const rows = await sql`
        select e.embedding::text as embedding
          from recommendation.company_embeddings e
         where e.company_id = ${input.companyId}
           and e.content_sha256 = ${input.contentSha256}
           and e.model_code = ${p.modelCode}
           and e.embedding_dimension = ${p.dimension}
           and e.configuration_version = ${p.configurationVersion}
           and e.instruction_version = ${p.instructionVersion}
         order by e.created_at desc
         limit 1`;
      return vectorOf(rows);
    },

    insertCompanyEmbedding: async (input) => {
      const i = input.identity;
      await sql`
        insert into recommendation.company_embeddings
          (tenant_id, representation_id, company_id, provider_code, model_code, model_revision,
           configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
        values
          (${input.tenantId}, ${input.representationId}, ${input.companyId}, ${i.providerCode}, ${i.modelCode},
           ${i.modelRevision}, ${i.configurationVersion}, ${i.instructionVersion}, ${i.dimension},
           ${toVectorLiteral(input.vector)}::extensions.vector, ${input.contentSha256})
        on conflict on constraint company_embeddings_work_identity_key do nothing`;
    },

    currentMandateRepresentation: async (input) => {
      const rows = await sql`
        select r.id, r.content_sha256, r.source_fingerprint
          from recommendation.mandate_representations r
         where r.mandate_id = ${input.mandateId}
           and r.purpose = ${input.purpose}
           and r.representation_version = ${input.representationVersion}
           and r.status = 'CURRENT'`;
      const [first] = rows;
      return first === undefined ? null : toStored(first);
    },

    supersedeMandateRepresentation: async (id) => {
      await sql`
        update recommendation.mandate_representations
           set status = 'SUPERSEDED', superseded_at = now()
         where id = ${id} and status = 'CURRENT'`;
    },

    insertMandateRepresentation: async (input) => {
      const rows = await sql`
        insert into recommendation.mandate_representations
          (tenant_id, investor_organisation_id, mandate_id, mandate_version, purpose, representation_version,
           source_fingerprint, content_sha256, content)
        values
          (${input.tenantId}, ${input.investorOrganisationId}, ${input.mandateId}, ${input.mandateVersion},
           ${input.purpose}, ${input.representationVersion}, ${input.sourceFingerprint}, ${input.contentSha256},
           ${input.content})
        returning id, content_sha256, source_fingerprint`;
      const [first] = rows;
      if (first === undefined)
        throw new Error("representation insert returned no row");
      return toStored(first);
    },

    findMandateVector: async (input) => {
      const p = identityPredicate(input.identity);
      const rows = await sql`
        select e.embedding::text as embedding
          from recommendation.mandate_embeddings e
         where e.representation_id = ${input.representationId}
           and e.model_code = ${p.modelCode}
           and e.embedding_dimension = ${p.dimension}
           and e.configuration_version = ${p.configurationVersion}
           and e.instruction_version = ${p.instructionVersion}
         limit 1`;
      return vectorOf(rows);
    },

    insertMandateEmbedding: async (input) => {
      const i = input.identity;
      await sql`
        insert into recommendation.mandate_embeddings
          (tenant_id, representation_id, investor_organisation_id, provider_code, model_code, model_revision,
           configuration_version, instruction_version, embedding_dimension, embedding, content_sha256)
        values
          (${input.tenantId}, ${input.representationId}, ${input.investorOrganisationId}, ${i.providerCode},
           ${i.modelCode}, ${i.modelRevision}, ${i.configurationVersion}, ${i.instructionVersion}, ${i.dimension},
           ${toVectorLiteral(input.vector)}::extensions.vector, ${input.contentSha256})
        on conflict on constraint mandate_embeddings_work_identity_key do nothing`;
    },

    nearestCompanies: async (input): Promise<readonly SemanticNearestHit[]> => {
      const limit = Math.max(1, Math.trunc(input.limit));
      // Distance is computed only over vectors in the query's own space
      // (configuration + instruction version), for CURRENT representations
      // of the asked purpose and version, of companies that are
      // discoverable NOW. A company that went private, closed, or whose
      // representation was superseded is excluded before any distance
      // ordering; readiness and disclosure are REC-001's to decide next.
      const rows = await sql`
        select r.company_id, c.tenant_id, c.organisation_id,
               (e.embedding <=> ${toVectorLiteral(input.queryVector)}::extensions.vector) as distance
          from recommendation.company_embeddings e
          join recommendation.company_representations r
            on r.id = e.representation_id and r.tenant_id = e.tenant_id
          join core.companies c
            on c.id = r.company_id and c.tenant_id = r.tenant_id
         where e.configuration_version = ${input.configurationVersion}
           and e.instruction_version = ${input.documentInstructionVersion}
           and r.status = 'CURRENT'
           and r.purpose = ${input.purpose}
           and r.representation_version = ${input.representationVersion}
           and c.company_status = 'active'
           and c.marketplace_visibility = any(${[...DISCOVERABLE]}::text[])
         order by distance asc, r.company_id asc
         limit ${limit}`;
      return rows.map((row) => {
        const r = NearestRowSchema.parse(row);
        return {
          companyId: r.company_id,
          tenantId: r.tenant_id,
          organisationId: r.organisation_id,
          distance: r.distance,
        };
      });
    },
  };
}
