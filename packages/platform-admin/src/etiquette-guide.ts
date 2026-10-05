import { createHash } from "node:crypto";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * The platform's business etiquette guide (ADR 0050): how Q conducts
 * business, as the platform admin sets it in the operations console.
 *
 * Every save is a new, immutable version (the database refuses an update
 * or a delete); which version is in force is a separate one-row pointer,
 * so going back to an earlier version, or to Capital Q's built-in guide
 * (no pointer, or a null one), rewrites nothing. Every change is recorded
 * in admin_actions with the version before and after. Reads for Q's prompts
 * go through `activePlatformEtiquetteGuide`, server-side only.
 */

export type PlatformEtiquetteSourceKind = "PASTE" | "FILE";

export type PlatformEtiquetteVersion = {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly sourceKind: PlatformEtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly characters: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
};

export type ActivePlatformEtiquetteGuide = {
  readonly versionId: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly updatedAt: string;
};

export type PlatformEtiquetteView = {
  /** Null: the built-in guide is in force. */
  readonly active: ActivePlatformEtiquetteGuide | null;
  /** The pointer's last change, even when it points at the built-in guide. */
  readonly updatedAt: string | null;
  /** Newest first, at most VERSIONS_LISTED. */
  readonly versions: readonly PlatformEtiquetteVersion[];
};

export type NewPlatformEtiquetteVersion = {
  readonly title: string;
  readonly sourceKind: PlatformEtiquetteSourceKind;
  readonly fileName: string | null;
  readonly mediaType: string | null;
  readonly text: string;
};

const VERSIONS_LISTED = 50;

type ActiveRow = {
  id: string;
  version: number;
  title: string;
  body: string;
  updated_at: Date;
};

type VersionRow = {
  id: string;
  version: number;
  title: string;
  source_kind: PlatformEtiquetteSourceKind;
  file_name: string | null;
  media_type: string | null;
  characters: number;
  created_by: string | null;
  created_at: Date;
};

const iso = (at: Date) => new Date(at).toISOString();

/** The uploaded guide in force, or null for the built-in one. */
export async function activePlatformEtiquetteGuide(
  sql: DatabaseExecutor,
): Promise<ActivePlatformEtiquetteGuide | null> {
  const [row] = await sql<ActiveRow[]>`
    select v.id, v.version, v.title, v.body, a.updated_at
      from platform_ops.etiquette_guide_active a
      join platform_ops.etiquette_guide_versions v on v.id = a.version_id`;
  return row === undefined
    ? null
    : {
        versionId: row.id,
        version: row.version,
        title: row.title,
        text: row.body,
        updatedAt: iso(row.updated_at),
      };
}

/** The console's view: what is in force and every recorded version. */
export async function platformEtiquetteView(
  sql: DatabaseExecutor,
): Promise<PlatformEtiquetteView> {
  const [active, [pointer], versions] = await Promise.all([
    activePlatformEtiquetteGuide(sql),
    sql<{ updated_at: Date }[]>`
      select updated_at from platform_ops.etiquette_guide_active`,
    sql<VersionRow[]>`
      select v.id, v.version, v.title, v.source_kind, v.file_name, v.media_type,
             length(v.body) as characters, p.display_name as created_by,
             v.created_at
        from platform_ops.etiquette_guide_versions v
        left join identity.user_profiles p on p.id = v.created_by
       order by v.version desc
       limit ${VERSIONS_LISTED}`,
  ]);
  return {
    active,
    updatedAt: pointer === undefined ? null : iso(pointer.updated_at),
    versions: versions.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      sourceKind: row.source_kind,
      fileName: row.file_name,
      mediaType: row.media_type,
      characters: Number(row.characters),
      createdBy: row.created_by,
      createdAt: iso(row.created_at),
    })),
  };
}

async function point(
  sql: DatabaseExecutor,
  grant: AdminGrant,
  versionId: string | null,
): Promise<string | null> {
  const [before] = await sql<{ version_id: string | null }[]>`
    select version_id from platform_ops.etiquette_guide_active for update`;
  await sql`
    insert into platform_ops.etiquette_guide_active (singleton, version_id, updated_by)
    values (true, ${versionId}, ${grant.userId})
    on conflict (singleton) do update
       set version_id = excluded.version_id,
           updated_by = excluded.updated_by,
           updated_at = clock_timestamp()`;
  return before?.version_id ?? null;
}

/** Record a new version and put it in force, in one transaction. */
export async function recordPlatformEtiquetteGuide(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: NewPlatformEtiquetteVersion,
): Promise<void> {
  const sha = createHash("sha256").update(input.text, "utf8").digest("hex");
  await transactions.run(async (tx) => {
    // Serialise version numbers on the one table-wide lock.
    await tx.sql`lock table platform_ops.etiquette_guide_versions in share row exclusive mode`;
    const [next] = await tx.sql<{ version: number }[]>`
      select coalesce(max(version), 0) + 1 as version
        from platform_ops.etiquette_guide_versions`;
    const [row] = await tx.sql<{ id: string }[]>`
      insert into platform_ops.etiquette_guide_versions
        (version, title, source_kind, file_name, media_type, body, body_sha256, created_by)
      values (${next?.version ?? 1}, ${input.title}, ${input.sourceKind},
              ${input.fileName}, ${input.mediaType}, ${input.text}, ${sha},
              ${grant.userId})
      returning id`;
    if (row === undefined) throw new Error("etiquette guide version not saved");
    const from = await point(tx.sql, grant, row.id);
    await recordAdminAction(tx.sql, grant, {
      actionType: "etiquette_guide.record",
      resourceType: "etiquette_guide",
      resourceId: "platform",
      metadata: {
        from,
        to: row.id,
        version: next?.version ?? 1,
        characters: input.text.length,
        sha256: sha,
      },
    });
  });
}

/**
 * Put a recorded version in force, or (null) the built-in guide. False when
 * the version does not exist; nothing changes then.
 */
export async function activatePlatformEtiquetteGuide(
  transactions: TransactionManager,
  grant: AdminGrant,
  versionId: string | null,
): Promise<boolean> {
  return transactions.run(async (tx) => {
    if (versionId !== null) {
      const [exists] = await tx.sql<{ id: string }[]>`
        select id from platform_ops.etiquette_guide_versions where id = ${versionId}`;
      if (exists === undefined) return false;
    }
    const from = await point(tx.sql, grant, versionId);
    await recordAdminAction(tx.sql, grant, {
      actionType:
        versionId === null
          ? "etiquette_guide.reset"
          : "etiquette_guide.activate",
      resourceType: "etiquette_guide",
      resourceId: "platform",
      metadata: { from, to: versionId },
    });
    return true;
  });
}

export type EtiquetteGuideAdminStore = {
  readonly active: () => Promise<ActivePlatformEtiquetteGuide | null>;
  readonly view: () => Promise<PlatformEtiquetteView>;
  readonly record: (
    grant: AdminGrant,
    input: NewPlatformEtiquetteVersion,
  ) => Promise<void>;
  readonly activate: (
    grant: AdminGrant,
    versionId: string | null,
  ) => Promise<boolean>;
};

export function createEtiquetteGuideAdminStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): EtiquetteGuideAdminStore {
  return {
    active: () => activePlatformEtiquetteGuide(options.sql),
    view: () => platformEtiquetteView(options.sql),
    record: (grant, input) =>
      recordPlatformEtiquetteGuide(options.transactions, grant, input),
    activate: (grant, versionId) =>
      activatePlatformEtiquetteGuide(options.transactions, grant, versionId),
  };
}
