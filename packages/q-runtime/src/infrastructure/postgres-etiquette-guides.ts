import { createHash } from "node:crypto";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

/**
 * A person's own business etiquette guide (ADR 0050): "How Q speaks for
 * you". personal_private: every call names its owner explicitly (the
 * resolved actor's tenant and user, never a client-supplied id), and the
 * row's RLS policy holds the same rule for any browser read.
 *
 * Each save is a new version and the newest is in force; a version is
 * never rewritten (the database refuses). Saving the same text again is a
 * no-op, so a retried request does not add a version. Removing deletes the
 * owner's versions: it is their own words about style, and remove means
 * gone.
 */

export type EtiquetteGuideOwner = {
  readonly tenantId: string;
  readonly userId: string;
};

export type PersonalEtiquetteSourceKind = "PASTE" | "FILE";

export type PersonalEtiquetteGuide = {
  readonly version: number;
  readonly sourceKind: PersonalEtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly text: string;
  readonly savedAt: string;
};

export type SavePersonalEtiquetteGuide = {
  readonly sourceKind: PersonalEtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly text: string;
};

export type PersonalEtiquetteGuideStore = {
  readonly read: (
    owner: EtiquetteGuideOwner,
  ) => Promise<PersonalEtiquetteGuide | null>;
  readonly save: (
    owner: EtiquetteGuideOwner,
    input: SavePersonalEtiquetteGuide,
  ) => Promise<PersonalEtiquetteGuide>;
  /** True when there was a guide to remove. */
  readonly remove: (owner: EtiquetteGuideOwner) => Promise<boolean>;
};

type Row = {
  version: number;
  source_kind: PersonalEtiquetteSourceKind;
  file_name: string | null;
  media_type: string | null;
  body: string;
  body_sha256: string;
  created_at: Date;
};

const toGuide = (row: Row): PersonalEtiquetteGuide => ({
  version: row.version,
  sourceKind: row.source_kind,
  fileName: row.file_name,
  mediaType: row.media_type,
  text: row.body,
  savedAt: new Date(row.created_at).toISOString(),
});

async function newest(
  sql: DatabaseExecutor,
  owner: EtiquetteGuideOwner,
): Promise<Row | undefined> {
  const [row] = await sql<Row[]>`
    select version, source_kind, file_name, media_type, body, body_sha256, created_at
      from q_runtime.etiquette_guide_versions
     where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
     order by version desc
     limit 1`;
  return row;
}

export function createPostgresEtiquetteGuideStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): PersonalEtiquetteGuideStore {
  return {
    read: async (owner) => {
      const row = await newest(options.sql, owner);
      return row === undefined ? null : toGuide(row);
    },
    save: (owner, input) => {
      const sha = createHash("sha256").update(input.text, "utf8").digest("hex");
      return options.transactions.run(async (tx) => {
        // One writer per person at a time, so versions never collide.
        await tx.sql`
          select pg_advisory_xact_lock(hashtextextended(${`etiquette:${owner.tenantId}:${owner.userId}`}, 0))`;
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
          insert into q_runtime.etiquette_guide_versions
            (tenant_id, user_id, version, source_kind, file_name, media_type, body, body_sha256)
          values (${owner.tenantId}, ${owner.userId}, ${(current?.version ?? 0) + 1},
                  ${input.sourceKind}, ${input.fileName}, ${input.mediaType},
                  ${input.text}, ${sha})
          returning version, source_kind, file_name, media_type, body, body_sha256, created_at`;
        if (row === undefined) throw new Error("etiquette guide not saved");
        return toGuide(row);
      });
    },
    remove: async (owner) => {
      const removed = await options.sql<{ version: number }[]>`
        delete from q_runtime.etiquette_guide_versions
         where tenant_id = ${owner.tenantId} and user_id = ${owner.userId}
        returning version`;
      return removed.length > 0;
    },
  };
}
