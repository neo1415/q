import { createHash } from "node:crypto";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import type {
  PersonalEtiquetteSourceKind,
  SavePersonalEtiquetteGuide,
} from "./postgres-etiquette-guides.js";

/**
 * An organisation's own business etiquette guide (owner decision 112): "How
 * Q speaks for us". organisation_private: every call names the
 * organisation explicitly (the resolved actor's tenant and organisation,
 * never a client-supplied id). Who may save is the API's question
 * (organisation.admin); this store only records.
 *
 * Append-only: each save is a new version, the newest is in force, and no
 * version is rewritten or deleted (the database refuses). Saving the same
 * text again is a no-op, so a retried request adds nothing.
 */

export type OrganisationEtiquetteOwner = {
  readonly tenantId: string;
  readonly organisationId: string;
};

export type OrganisationEtiquetteGuide = {
  readonly version: number;
  readonly sourceKind: PersonalEtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly text: string;
  readonly savedAt: string;
  /** The application user who saved this version. */
  readonly savedBy: string;
};

export type OrganisationEtiquetteVersion = Omit<
  OrganisationEtiquetteGuide,
  "text" | "mediaType"
> & { readonly characters: number };

export type OrganisationEtiquetteStore = {
  readonly read: (
    owner: OrganisationEtiquetteOwner,
  ) => Promise<OrganisationEtiquetteGuide | null>;
  /** Newest first, at most `limit`. */
  readonly history: (
    owner: OrganisationEtiquetteOwner,
    limit: number,
  ) => Promise<readonly OrganisationEtiquetteVersion[]>;
  readonly save: (
    owner: OrganisationEtiquetteOwner,
    savedBy: string,
    input: SavePersonalEtiquetteGuide,
  ) => Promise<OrganisationEtiquetteGuide>;
};

type Row = {
  version: number;
  source_kind: PersonalEtiquetteSourceKind;
  file_name: string | null;
  media_type: string | null;
  body: string;
  body_sha256: string;
  created_by_user_id: string;
  created_at: Date;
};

const toGuide = (row: Row): OrganisationEtiquetteGuide => ({
  version: row.version,
  sourceKind: row.source_kind,
  fileName: row.file_name,
  mediaType: row.media_type,
  text: row.body,
  savedAt: new Date(row.created_at).toISOString(),
  savedBy: row.created_by_user_id,
});

async function newest(
  sql: DatabaseExecutor,
  owner: OrganisationEtiquetteOwner,
): Promise<Row | undefined> {
  const [row] = await sql<Row[]>`
    select version, source_kind, file_name, media_type, body, body_sha256,
           created_by_user_id, created_at
      from q_runtime.organisation_etiquette_versions
     where tenant_id = ${owner.tenantId} and organisation_id = ${owner.organisationId}
     order by version desc
     limit 1`;
  return row;
}

export function createPostgresOrganisationEtiquetteStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): OrganisationEtiquetteStore {
  return {
    read: async (owner) => {
      const row = await newest(options.sql, owner);
      return row === undefined ? null : toGuide(row);
    },
    history: async (owner, limit) => {
      const rows = await options.sql<
        (Omit<Row, "body" | "media_type" | "body_sha256"> & {
          characters: number;
        })[]
      >`
        select version, source_kind, file_name, created_by_user_id, created_at,
               length(body) as characters
          from q_runtime.organisation_etiquette_versions
         where tenant_id = ${owner.tenantId} and organisation_id = ${owner.organisationId}
         order by version desc
         limit ${Math.max(1, Math.min(limit, 50))}`;
      return rows.map((row) => ({
        version: row.version,
        sourceKind: row.source_kind,
        fileName: row.file_name,
        savedAt: new Date(row.created_at).toISOString(),
        savedBy: row.created_by_user_id,
        characters: Number(row.characters),
      }));
    },
    save: (owner, savedBy, input) => {
      const sha = createHash("sha256").update(input.text, "utf8").digest("hex");
      return options.transactions.run(async (tx) => {
        // One writer per organisation at a time, so versions never collide.
        await tx.sql`
          select pg_advisory_xact_lock(hashtextextended(${`org-etiquette:${owner.tenantId}:${owner.organisationId}`}, 0))`;
        const current = await newest(tx.sql, owner);
        if (
          current !== undefined &&
          current.body_sha256 === sha &&
          current.source_kind === input.sourceKind &&
          current.file_name === input.fileName
        ) {
          return toGuide(current);
        }
        const [row] = await tx.sql<Row[]>`
          insert into q_runtime.organisation_etiquette_versions
            (tenant_id, organisation_id, version, source_kind, file_name, media_type,
             body, body_sha256, created_by_user_id)
          values (${owner.tenantId}, ${owner.organisationId}, ${(current?.version ?? 0) + 1},
                  ${input.sourceKind}, ${input.fileName}, ${input.mediaType},
                  ${input.text}, ${sha}, ${savedBy})
          returning version, source_kind, file_name, media_type, body, body_sha256,
                    created_by_user_id, created_at`;
        if (row === undefined) throw new Error("organisation guide not saved");
        return toGuide(row);
      });
    },
  };
}
