import {
  ExternalPersonSubjectSchema,
  PersonBriefSchema,
  type ExternalPersonSubject,
  type PersonBrief,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

/**
 * The researched external person a rehearsal is prepared from: the identity
 * (W2's ExternalPersonSubject) and its evidence-classed public brief,
 * frozen per brief version in q_runtime.rehearsal_external_subjects. The
 * rows belong to one viewer in one tenant; nothing here is a Capital Q
 * fact and no founder-private data is stored in it.
 */

export type ExternalSubjectRecord = {
  readonly subject: ExternalPersonSubject;
  /** null while no brief exists: thin evidence, a role simulation. */
  readonly brief: PersonBrief | null;
};

export type ExternalSubjectStore = {
  /** The newest brief version this viewer holds for the person. */
  readonly latest: (
    actor: ActorContext,
    externalPersonId: string,
  ) => Promise<ExternalSubjectRecord | null>;
  /** Idempotent per (viewer, person, briefVersion): a repeat is a no-op. */
  readonly save: (
    actor: ActorContext,
    record: ExternalSubjectRecord,
  ) => Promise<void>;
};

type Raw = { subject: unknown; brief: unknown };

export function createPostgresExternalSubjectStore(
  sql: DatabaseExecutor,
): ExternalSubjectStore {
  const uuid = z.string().uuid();
  const json = (value: unknown) => sql.json(value as never);
  return {
    latest: async (actor, externalPersonId) => {
      if (!uuid.safeParse(externalPersonId).success) return null;
      const rows = await sql<Raw[]>`
        select subject, brief from q_runtime.rehearsal_external_subjects
         where viewer_user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and external_person_id = ${externalPersonId}
         order by brief_version desc limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      // External data starts as unknown: re-validate what was stored.
      const subject = ExternalPersonSubjectSchema.safeParse(row.subject);
      if (!subject.success) return null;
      const brief =
        row.brief === null ? null : PersonBriefSchema.safeParse(row.brief);
      return {
        subject: subject.data,
        brief: brief === null || !brief.success ? null : brief.data,
      };
    },
    save: async (actor, record) => {
      const subject = ExternalPersonSubjectSchema.parse(record.subject);
      const brief =
        record.brief === null ? null : PersonBriefSchema.parse(record.brief);
      await sql`
        insert into q_runtime.rehearsal_external_subjects
          (tenant_id, viewer_user_id, external_person_id, brief_version,
           evidence_bundle_id, subject, brief)
        values (${actor.tenantId}, ${actor.userId}, ${subject.externalPersonId},
                ${subject.briefVersion}, ${subject.evidenceBundleId},
                ${json(subject)}, ${brief === null ? null : json(brief)})
        on conflict (viewer_user_id, external_person_id, brief_version) do nothing`;
    },
  };
}
