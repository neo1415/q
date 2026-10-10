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

/**
 * What the rehearsal screen shows beside the persona, saved with the brief:
 * the entity kind, our own stored portrait or logo (permitted for use), and
 * public source quotes. Quotes are display-only; they are never given to the
 * voice as the entity's words.
 */
export const ExternalPresentationSchema = z
  .object({
    entityKind: z.enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"]),
    image: z
      .object({
        assetUrl: z.string().url().max(2048).startsWith("https://"),
        attribution: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    quotes: z
      .array(
        z
          .object({
            quote: z.string().trim().min(3).max(280),
            sourceLabel: z.string().max(200),
            sourceUrl: z.string().url().max(2048).startsWith("https://"),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type ExternalPresentation = z.infer<typeof ExternalPresentationSchema>;

export type ExternalSubjectRecord = {
  readonly subject: ExternalPersonSubject;
  /** null when the identity card carries none (a person, no portrait). */
  readonly presentation: ExternalPresentation | null;
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

type Raw = { subject: unknown; brief: unknown; presentation: unknown };

export function createPostgresExternalSubjectStore(
  sql: DatabaseExecutor,
): ExternalSubjectStore {
  const uuid = z.string().uuid();
  const json = (value: unknown) => sql.json(value as never);
  return {
    latest: async (actor, externalPersonId) => {
      if (!uuid.safeParse(externalPersonId).success) return null;
      const rows = await sql<Raw[]>`
        select subject, brief, presentation from q_runtime.rehearsal_external_subjects
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
      const presentation =
        row.presentation === null
          ? null
          : ExternalPresentationSchema.safeParse(row.presentation);
      return {
        subject: subject.data,
        presentation:
          presentation === null || !presentation.success
            ? null
            : presentation.data,
        brief: brief === null || !brief.success ? null : brief.data,
      };
    },
    save: async (actor, record) => {
      const subject = ExternalPersonSubjectSchema.parse(record.subject);
      const brief =
        record.brief === null ? null : PersonBriefSchema.parse(record.brief);
      const presentation =
        record.presentation === null
          ? null
          : ExternalPresentationSchema.parse(record.presentation);
      await sql`
        insert into q_runtime.rehearsal_external_subjects
          (tenant_id, viewer_user_id, external_person_id, brief_version,
           evidence_bundle_id, subject, brief, presentation)
        values (${actor.tenantId}, ${actor.userId}, ${subject.externalPersonId},
                ${subject.briefVersion}, ${subject.evidenceBundleId},
                ${json(subject)}, ${brief === null ? null : json(brief)},
                ${presentation === null ? null : json(presentation)})
        on conflict (viewer_user_id, external_person_id, brief_version) do nothing`;
    },
  };
}
