import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { QArtifactStatus } from "@capital-q/contracts";

import { parseContent } from "../domain/artifact.js";
import type {
  ArtifactHistoryEntry,
  StoredArtifact,
  StoredArtifactVersion,
} from "../domain/artifact.js";
import type { ArtifactRepository } from "../application/ports.js";

/**
 * The two artifact tables behind their port.
 *
 * Two things here are doing real work rather than moving rows.
 *
 * **Every read carries the actor into the `where` clause.** Not fetched
 * and then checked: an artifact belonging to another tenant or another
 * organisation is never selected, so it is never in this process's memory
 * and "not yours" and "not found" are indistinguishable to a caller. The
 * organisation is the unit of ownership, so a colleague sees the
 * organisation's artifacts and a stranger sees nothing.
 *
 * **Appending a version is `on conflict do nothing`, returning nothing on
 * a loss.** The unique constraint on (artifact_id, version) decides who
 * wins when two revisions are composed at once. Reading the number and
 * then inserting would be a race this code cannot see; letting the
 * database refuse and telling the caller is a race it can.
 */

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError("expected a timestamp column");
};
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

const ArtifactRow = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  type: z.string(),
  company_id: z.string().uuid().nullable(),
  investor_organisation_id: z.string().uuid().nullable(),
  status: z.enum(["PREPARING", "READY", "FAILED"]),
  current_version: z.coerce.number().int(),
  visibility_scope: z.string(),
  created_by_user_id: z.string().uuid(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
  archived_at: z.unknown(),
});

function toArtifact(row: unknown): StoredArtifact {
  const r = ArtifactRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    type: r.type,
    companyId: r.company_id,
    investorOrganisationId: r.investor_organisation_id,
    status: r.status,
    currentVersion: r.current_version,
    visibilityScope: r.visibility_scope,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: isoOrNull(r.archived_at),
  };
}

const VersionRow = z.object({
  artifact_id: z.string().uuid(),
  version: z.coerce.number().int(),
  title: z.string(),
  summary: z.string(),
  content: z.unknown(),
  instruction: z.string().nullable(),
  composed_by_run_id: z.string().uuid().nullable(),
  created_by_user_id: z.string().uuid(),
  created_at: z.unknown(),
});

function toVersionRow(row: unknown): StoredArtifactVersion {
  const r = VersionRow.parse(row);
  return {
    artifactId: r.artifact_id,
    version: r.version,
    title: r.title,
    summary: r.summary,
    // Validated on the way out as well as in: a payload whose shape has
    // drifted is not something to render at somebody.
    content: parseContent(r.content),
    instruction: r.instruction,
    composedByRunId: r.composed_by_run_id,
    createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at),
  };
}

export function createPostgresArtifactRepository(options: {
  readonly sql: DatabaseExecutor;
}): ArtifactRepository {
  const { sql } = options;
  return {
    create: async (tx, artifact) => {
      const rows = await tx.sql`
        insert into artifacts.artifacts (
          tenant_id, organisation_id, type,
          company_id, investor_organisation_id, created_by_user_id
        ) values (
          ${artifact.tenantId}, ${artifact.organisationId}, ${artifact.type},
          ${artifact.companyId}, ${artifact.investorOrganisationId},
          ${artifact.createdByUserId}
        )
        returning *
      `;
      return toArtifact(rows[0]);
    },

    findById: async (actor, artifactId) => {
      const rows = await sql`
        select * from artifacts.artifacts
         where id = ${artifactId}
           and tenant_id = ${actor.tenantId}
           and organisation_id = ${actor.organisationId ?? null}
           and archived_at is null
         limit 1
      `;
      return rows.length === 0 ? null : toArtifact(rows[0]);
    },

    list: async (actor, query) => {
      const rows = await sql`
        select * from artifacts.artifacts
         where tenant_id = ${actor.tenantId}
           and organisation_id = ${actor.organisationId ?? null}
           and archived_at is null
           and (${query.before ?? null}::timestamptz is null
                or updated_at < ${query.before ?? null}::timestamptz)
           and (${query.subjectId ?? null}::uuid is null
                or company_id = ${query.subjectId ?? null}::uuid
                or investor_organisation_id = ${query.subjectId ?? null}::uuid)
         order by updated_at desc
         limit ${query.limit}
      `;
      return rows.map(toArtifact);
    },

    setStatus: async (tx, artifactId, status: QArtifactStatus) => {
      await tx.sql`
        update artifacts.artifacts
           set status = ${status}, updated_at = now()
         where id = ${artifactId}
      `;
    },

    appendVersion: async (tx, version) => {
      const rows = await tx.sql`
        insert into artifacts.artifact_versions (
          artifact_id, tenant_id, version, title, summary, content,
          instruction, composed_by_run_id, created_by_user_id
        ) values (
          ${version.artifactId}, ${version.tenantId}, ${version.version},
          ${version.title}, ${version.summary},
          ${tx.sql.json(version.content)}::jsonb,
          ${version.instruction}, ${version.composedByRunId},
          ${version.createdByUserId}
        )
        on conflict (artifact_id, version) do nothing
        returning *
      `;
      if (rows.length === 0) {
        // Somebody else's revision took this number while this one was
        // being composed. Their version stands; the caller retries.
        return null;
      }
      await tx.sql`
        update artifacts.artifacts
           set current_version = ${version.version}, updated_at = now()
         where id = ${version.artifactId}
           and current_version < ${version.version}
      `;
      return toVersionRow(rows[0]);
    },

    findVersion: async (actor, artifactId, version) => {
      const rows = await sql`
        select v.* from artifacts.artifact_versions v
          join artifacts.artifacts a on a.id = v.artifact_id
         where v.artifact_id = ${artifactId}
           and v.version = ${version}
           and a.tenant_id = ${actor.tenantId}
           and a.organisation_id = ${actor.organisationId ?? null}
           and a.archived_at is null
         limit 1
      `;
      return rows.length === 0 ? null : toVersionRow(rows[0]);
    },

    history: async (actor, artifactId) => {
      const rows = await sql`
        select v.version, v.title, v.instruction, v.created_at
          from artifacts.artifact_versions v
          join artifacts.artifacts a on a.id = v.artifact_id
         where v.artifact_id = ${artifactId}
           and a.tenant_id = ${actor.tenantId}
           and a.organisation_id = ${actor.organisationId ?? null}
           and a.archived_at is null
         order by v.version desc
         limit 200
      `;
      const HistoryRow = z.object({
        version: z.coerce.number().int(),
        title: z.string(),
        instruction: z.string().nullable(),
        created_at: z.unknown(),
      });
      return rows.map((row): ArtifactHistoryEntry => {
        const r = HistoryRow.parse(row);
        return {
          version: r.version,
          title: r.title,
          instruction: r.instruction,
          createdAt: iso(r.created_at),
        };
      });
    },
  };
}
