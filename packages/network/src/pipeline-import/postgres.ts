import { z } from "zod";

import {
  PipelineImportMappingSchema,
  PipelineImportResultSchema,
  UuidSchema,
  type PipelineImportMapping,
  type PipelineImportMatchStatus,
  type PipelineImportResult,
} from "@capital-q/contracts";
import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";

import {
  ImportRowFieldsSchema,
  type ImportRowFields,
  type MatchCandidate,
} from "./proposal.js";
import { domainOf, nameKey } from "./values.js";

/**
 * network.pipeline_imports and network.pipeline_import_rows (migration
 * 20261231598370), and the authorised candidate search a row is matched
 * by. SQL only; the service decides who may act and repeats the actor's
 * tenant and organisation in every WHERE.
 */

export type ImportSide = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly party: "INVESTOR" | "COMPANY";
  /** The importing side's own company or investor organisation. */
  readonly partyId: string;
};

export type StoredImport = {
  readonly id: string;
  readonly party: "INVESTOR" | "COMPANY";
  readonly partyId: string;
  readonly createdByUserId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly fileName: string;
  readonly sourceFormat: "CSV" | "XLSX";
  readonly mapping: PipelineImportMapping;
  readonly mappingSource: "Q" | "HEADERS" | "PERSON";
  readonly proposalHash: string;
  readonly status: "PREPARED" | "APPLIED";
  readonly applyIdempotencyKey: string | null;
  readonly result: PipelineImportResult | null;
};

export type StoredImportRow = {
  readonly rowNumber: number;
  readonly name: string | null;
  readonly domain: string | null;
  readonly fields: ImportRowFields;
  readonly status: PipelineImportMatchStatus;
  readonly matchedId: string | null;
  readonly candidateIds: readonly string[];
  readonly outcome: "LINKED" | "KEPT_PRIVATE" | "SKIPPED" | null;
  readonly relationshipId: string | null;
};

const ImportRowSchema = z.object({
  id: UuidSchema,
  company_id: UuidSchema.nullable(),
  investor_organisation_id: UuidSchema.nullable(),
  created_by_user_id: UuidSchema,
  document_id: UuidSchema,
  document_version_id: UuidSchema,
  file_name: z.string(),
  source_format: z.enum(["CSV", "XLSX"]),
  mapping: PipelineImportMappingSchema,
  mapping_source: z.enum(["Q", "HEADERS", "PERSON"]),
  proposal_hash: z.string(),
  status: z.enum(["PREPARED", "APPLIED"]),
  apply_idempotency_key: UuidSchema.nullable(),
  result: PipelineImportResultSchema.nullable(),
});

const RowRowSchema = z.object({
  row_number: z.number().int(),
  counterpart_name: z.string().nullable(),
  website_domain: z.string().nullable(),
  fields: ImportRowFieldsSchema,
  match_status: z.enum(["MATCHED", "AMBIGUOUS", "NEW", "INVALID"]),
  matched_party_id: UuidSchema.nullable(),
  candidate_ids: z.array(UuidSchema),
  outcome: z.enum(["LINKED", "KEPT_PRIVATE", "SKIPPED"]).nullable(),
  relationship_id: UuidSchema.nullable(),
});

/** Discoverable on the network: what an investor's search may match. */
const DISCOVERABLE = ["network_visible", "public_external"] as const;

/** Rows inserted per statement. */
const INSERT_BATCH = 500;
/** Candidates read per search, at most (a bounded scan for one import). */
const CANDIDATES_MAX = 20_000;

/*
 * The SQL twin of `nameKey` (without accent folding: the caller re-checks
 * every candidate with `nameKey` itself) and of `domainOf`, written out in
 * each query below because the driver's tagged template is the only query
 * surface (no string assembly).
 */

export type PipelineImportStore = ReturnType<
  typeof createPostgresPipelineImports
>;

export function createPostgresPipelineImports() {
  return {
    /**
     * Canonical companies an investor may match: active, discoverable on
     * the network, not the investor's own organisation's. The caller still
     * asks the disclosure rule for each one before it is a candidate.
     */
    async companyCandidates(
      sql: DatabaseExecutor,
      side: ImportSide,
      keys: readonly string[],
      domains: readonly string[],
    ): Promise<readonly MatchCandidate[]> {
      if (keys.length === 0 && domains.length === 0) return [];
      const rows = await sql<
        { id: string; name: string; website_url: string | null }[]
      >`
        select c.id, c.canonical_name as name, c.website_url
          from core.companies c
         where c.company_status = 'active'
           and c.marketplace_visibility = any(${[...DISCOVERABLE]}::text[])
           and c.organisation_id <> ${side.organisationId}::uuid
           and (replace(regexp_replace(regexp_replace(regexp_replace(lower(replace(c.canonical_name, '&', ' and ')), '\\s*\\([^)]*\\)\\s*$', ''), '[^a-z0-9]+', ' ', 'g'), '(\\s(inc|incorporated|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|sas|bv|nv|pty|corp|corporation|co|company))+\\s*$', ''), ' ', '') = any(${[...keys]}::text[])
                or (c.legal_name is not null and replace(regexp_replace(regexp_replace(regexp_replace(lower(replace(c.legal_name, '&', ' and ')), '\\s*\\([^)]*\\)\\s*$', ''), '[^a-z0-9]+', ' ', 'g'), '(\\s(inc|incorporated|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|sas|bv|nv|pty|corp|corporation|co|company))+\\s*$', ''), ' ', '') = any(${[...keys]}::text[]))
                or regexp_replace(regexp_replace(lower(coalesce(c.website_url, '')), '^https?://(www[0-9]?\\.)?', ''), '[/:?#].*$', '') = any(${[...domains]}::text[]))
         order by c.id
         limit ${CANDIDATES_MAX}`;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        nameKey: nameKey(row.name),
        domain: row.website_url === null ? null : domainOf(row.website_url),
      }));
    },

    /** Canonical investor organisations a founder may match (not their own). */
    async investorCandidates(
      sql: DatabaseExecutor,
      side: ImportSide,
      keys: readonly string[],
      domains: readonly string[],
    ): Promise<readonly MatchCandidate[]> {
      if (keys.length === 0 && domains.length === 0) return [];
      const rows = await sql<
        { id: string; name: string; website_url: string | null }[]
      >`
        select i.id, i.display_name as name, i.website_url
          from core.investor_organisations i
         where i.organisation_id <> ${side.organisationId}::uuid
           and (replace(regexp_replace(regexp_replace(regexp_replace(lower(replace(i.display_name, '&', ' and ')), '\\s*\\([^)]*\\)\\s*$', ''), '[^a-z0-9]+', ' ', 'g'), '(\\s(inc|incorporated|ltd|limited|llc|llp|lp|plc|gmbh|ag|sa|sas|bv|nv|pty|corp|corporation|co|company))+\\s*$', ''), ' ', '') = any(${[...keys]}::text[])
                or regexp_replace(regexp_replace(lower(coalesce(i.website_url, '')), '^https?://(www[0-9]?\\.)?', ''), '[/:?#].*$', '') = any(${[...domains]}::text[]))
         order by i.id
         limit ${CANDIDATES_MAX}`;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        nameKey: nameKey(row.name),
        domain: row.website_url === null ? null : domainOf(row.website_url),
      }));
    },

    async insertImport(
      sql: DatabaseExecutor,
      side: ImportSide,
      input: {
        readonly id: string;
        readonly userId: string;
        readonly documentId: string;
        readonly documentVersionId: string;
        readonly fileName: string;
        readonly sourceFormat: "CSV" | "XLSX";
        readonly rowCount: number;
        readonly mapping: PipelineImportMapping;
        readonly mappingSource: "Q" | "HEADERS" | "PERSON";
        readonly proposalHash: string;
        readonly rows: readonly {
          readonly rowNumber: number;
          readonly name: string | null;
          readonly domain: string | null;
          readonly fields: unknown;
          readonly status: PipelineImportMatchStatus;
          readonly matchedId: string | null;
          readonly candidateIds: readonly string[];
        }[];
      },
    ): Promise<void> {
      await sql`
        insert into network.pipeline_imports
          (id, tenant_id, organisation_id, company_id, investor_organisation_id,
           created_by_user_id, document_id, document_version_id, file_name,
           source_format, row_count, mapping, mapping_source, proposal_hash)
        values
          (${input.id}, ${side.tenantId}, ${side.organisationId},
           ${side.party === "COMPANY" ? side.partyId : null},
           ${side.party === "INVESTOR" ? side.partyId : null},
           ${input.userId}, ${input.documentId}, ${input.documentVersionId},
           ${input.fileName}, ${input.sourceFormat}, ${input.rowCount},
           ${jsonbParam(sql, input.mapping)}, ${input.mappingSource},
           ${input.proposalHash})`;
      for (let at = 0; at < input.rows.length; at += INSERT_BATCH) {
        const batch = input.rows.slice(at, at + INSERT_BATCH).map((row) => ({
          row_number: row.rowNumber,
          counterpart_name: row.name,
          website_domain: row.domain,
          fields: row.fields,
          match_status: row.status,
          matched_party_id: row.matchedId,
          candidate_ids: row.candidateIds,
        }));
        await sql`
          insert into network.pipeline_import_rows
            (import_id, row_number, tenant_id, organisation_id, counterpart_name,
             website_domain, fields, match_status, matched_party_id, candidate_ids)
          select ${input.id}, r.row_number, ${side.tenantId}, ${side.organisationId},
                 r.counterpart_name, r.website_domain, coalesce(r.fields, '{}'::jsonb),
                 r.match_status, r.matched_party_id,
                 coalesce(array(select jsonb_array_elements_text(r.candidate_ids)::uuid), '{}')
            from jsonb_to_recordset(${jsonbParam(sql, batch)}) as r(
              row_number int, counterpart_name text, website_domain text, fields jsonb,
              match_status text, matched_party_id uuid, candidate_ids jsonb)`;
      }
    },

    /** One import of the side's own organisation, or null. */
    async findImport(
      sql: DatabaseExecutor,
      side: ImportSide,
      importId: string,
    ): Promise<StoredImport | null> {
      const [raw] = await sql`
        select id, company_id, investor_organisation_id, created_by_user_id,
               document_id, document_version_id, file_name, source_format, mapping,
               mapping_source, proposal_hash, status, apply_idempotency_key, result
          from network.pipeline_imports
         where id = ${importId}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
           and company_id is not distinct from ${side.party === "COMPANY" ? side.partyId : null}::uuid
           and investor_organisation_id is not distinct from ${side.party === "INVESTOR" ? side.partyId : null}::uuid`;
      if (raw === undefined) return null;
      const row = ImportRowSchema.parse(raw);
      return {
        id: row.id,
        party: row.company_id === null ? "INVESTOR" : "COMPANY",
        partyId: row.company_id ?? row.investor_organisation_id ?? "",
        createdByUserId: row.created_by_user_id,
        documentId: row.document_id,
        documentVersionId: row.document_version_id,
        fileName: row.file_name,
        sourceFormat: row.source_format,
        mapping: row.mapping,
        mappingSource: row.mapping_source,
        proposalHash: row.proposal_hash,
        status: row.status,
        applyIdempotencyKey: row.apply_idempotency_key,
        result: row.result,
      };
    },

    async listRows(
      sql: DatabaseExecutor,
      side: ImportSide,
      importId: string,
    ): Promise<readonly StoredImportRow[]> {
      const raw = await sql`
        select row_number, counterpart_name, website_domain, fields, match_status,
               matched_party_id, candidate_ids, outcome, relationship_id
          from network.pipeline_import_rows
         where import_id = ${importId}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
         order by row_number`;
      return raw.map((one) => {
        const row = RowRowSchema.parse(one);
        return {
          rowNumber: row.row_number,
          name: row.counterpart_name,
          domain: row.website_domain,
          fields: row.fields,
          status: row.match_status,
          matchedId: row.matched_party_id,
          candidateIds: row.candidate_ids,
          outcome: row.outcome,
          relationshipId: row.relationship_id,
        };
      });
    },

    /** Sets a row's outcome once; false when it already had one. */
    async settleRow(
      sql: DatabaseExecutor,
      side: ImportSide,
      importId: string,
      rowNumber: number,
      outcome: "LINKED" | "KEPT_PRIVATE" | "SKIPPED",
      relationshipId: string | null,
    ): Promise<boolean> {
      const updated = await sql`
        update network.pipeline_import_rows
           set outcome = ${outcome}, relationship_id = ${relationshipId}
         where import_id = ${importId}
           and row_number = ${rowNumber}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
           and outcome is null
        returning row_number`;
      return updated.length === 1;
    },

    /** PREPARED -> APPLIED, once; false when another apply got there first. */
    async markApplied(
      sql: DatabaseExecutor,
      side: ImportSide,
      importId: string,
      input: {
        readonly idempotencyKey: string;
        readonly approvedBy: string;
        readonly result: PipelineImportResult;
      },
    ): Promise<boolean> {
      const updated = await sql`
        update network.pipeline_imports
           set status = 'APPLIED', apply_idempotency_key = ${input.idempotencyKey},
               approved_by_user_id = ${input.approvedBy}, applied_at = clock_timestamp(),
               result = ${jsonbParam(sql, input.result)}
         where id = ${importId}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
           and status = 'PREPARED'
        returning id`;
      return updated.length === 1;
    },

    /** Whether this relationship already holds the imported stage with this fingerprint. */
    async hasStageEvent(
      sql: DatabaseExecutor,
      relationshipId: string,
      fingerprint: string,
    ): Promise<boolean> {
      const [row] = await sql`
        select 1 as one
          from network.relationship_events
         where relationship_id = ${relationshipId}
           and event_type = 'crm_stage_imported'
           and payload->>'fingerprint' = ${fingerprint}
         limit 1`;
      return row !== undefined;
    },

    /**
     * The relationships an applied import linked, with the counterpart's
     * canonical name, for the result's links. The rows are the side's own;
     * the relationship's other party is the counterpart.
     */
    async linkedRelationships(
      sql: DatabaseExecutor,
      side: ImportSide,
      importId: string,
      limit: number,
    ): Promise<
      readonly {
        readonly relationshipId: string;
        readonly counterpartId: string;
        readonly name: string;
      }[]
    > {
      const raw =
        side.party === "INVESTOR"
          ? await sql`
              select distinct on (r.relationship_id)
                     r.relationship_id, rel.company_id as counterpart_id,
                     c.canonical_name as name, r.row_number
                from network.pipeline_import_rows r
                join network.relationships rel on rel.id = r.relationship_id
                join core.companies c on c.id = rel.company_id
               where r.import_id = ${importId}
                 and r.tenant_id = ${side.tenantId}
                 and r.organisation_id = ${side.organisationId}
                 and r.outcome = 'LINKED'
                 and rel.investor_organisation_id = ${side.partyId}
               order by r.relationship_id, r.row_number
               limit ${limit}`
          : await sql`
              select distinct on (r.relationship_id)
                     r.relationship_id, rel.investor_organisation_id as counterpart_id,
                     i.display_name as name, r.row_number
                from network.pipeline_import_rows r
                join network.relationships rel on rel.id = r.relationship_id
                join core.investor_organisations i on i.id = rel.investor_organisation_id
               where r.import_id = ${importId}
                 and r.tenant_id = ${side.tenantId}
                 and r.organisation_id = ${side.organisationId}
                 and r.outcome = 'LINKED'
                 and rel.company_id = ${side.partyId}
               order by r.relationship_id, r.row_number
               limit ${limit}`;
      return raw
        .map((one) =>
          LinkSchema.parse({
            relationshipId: (one as Record<string, unknown>)["relationship_id"],
            counterpartId: (one as Record<string, unknown>)["counterpart_id"],
            name: (one as Record<string, unknown>)["name"],
            rowNumber: (one as Record<string, unknown>)["row_number"],
          }),
        )
        .sort((a, b) => a.rowNumber - b.rowNumber)
        .map(({ relationshipId, counterpartId, name }) => ({
          relationshipId,
          counterpartId,
          name: name.slice(0, 200),
        }));
    },

    /**
     * The organisation's private prospects (decision 106, gap 7): rows it
     * kept because the counterpart is not on Capital Q, for this side, the
     * latest import's row per name. Never a canonical record.
     */
    async prospects(
      sql: DatabaseExecutor,
      side: ImportSide,
      limit: number,
    ): Promise<readonly ProspectRow[]> {
      const raw = await sql`
        select * from (
          select distinct on (lower(btrim(r.counterpart_name)))
                 r.import_id, r.row_number, r.counterpart_name, r.website_domain,
                 r.fields, i.file_name, i.applied_at
            from network.pipeline_import_rows r
            join network.pipeline_imports i
              on i.id = r.import_id
             and i.tenant_id = r.tenant_id
             and i.organisation_id = r.organisation_id
           where r.tenant_id = ${side.tenantId}
             and r.organisation_id = ${side.organisationId}
             and r.outcome = 'KEPT_PRIVATE'
             and r.counterpart_name is not null
             and i.status = 'APPLIED'
             and i.company_id is not distinct from ${side.party === "COMPANY" ? side.partyId : null}::uuid
             and i.investor_organisation_id is not distinct from ${side.party === "INVESTOR" ? side.partyId : null}::uuid
           order by lower(btrim(r.counterpart_name)), i.applied_at desc, r.row_number
        ) latest
        order by applied_at desc, row_number
        limit ${limit}`;
      return raw.map((one) => ProspectRowSchema.parse(one));
    },
  };
}

const LinkSchema = z.object({
  relationshipId: UuidSchema,
  counterpartId: UuidSchema,
  name: z.string(),
  rowNumber: z.number().int(),
});

const ProspectRowSchema = z.object({
  import_id: UuidSchema,
  row_number: z.number().int(),
  counterpart_name: z.string(),
  website_domain: z.string().nullable(),
  fields: ImportRowFieldsSchema,
  file_name: z.string(),
  applied_at: z.union([z.date(), z.string()]),
});
export type ProspectRow = z.infer<typeof ProspectRowSchema>;
