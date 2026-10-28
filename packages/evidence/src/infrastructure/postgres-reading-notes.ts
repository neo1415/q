import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * What a reader of a document should be told about how well it could be
 * read (deck reading 2026-10-28): how many of its current version's pages
 * were pictures nobody could read, and whether a limit stopped extraction
 * early. Counts from the completed processing run's provenance metadata,
 * never document content. A read port for other contexts (the onboarding
 * view): the caller has already authorised the documents it names.
 */

export type DocumentReadingNote = {
  readonly documentId: string;
  readonly unreadPages: number;
  readonly truncated: boolean;
};

export type DocumentReadingNotesPort = (
  executor: DatabaseExecutor,
  input: {
    readonly tenantId: string;
    readonly documentIds: readonly string[];
  },
) => Promise<readonly DocumentReadingNote[]>;

const NoteRow = z.object({
  document_id: UuidSchema,
  unread_pages: z.coerce.number().int().min(0).max(10_000),
  truncated: z.boolean(),
});

/** At most this many documents per read: a view names at most fifty. */
const NOTES_MAX = 50;

export function createPostgresDocumentReadingNotes(): DocumentReadingNotesPort {
  return async (executor, input) => {
    const ids = [...new Set(input.documentIds)].slice(0, NOTES_MAX);
    if (ids.length === 0) return [];
    const rows = await executor`
      select d.id as document_id,
             case when jsonb_typeof(r.metadata -> 'unreadPages') = 'number'
                  then least(greatest((r.metadata ->> 'unreadPages')::numeric, 0), 10000)::int
                  else 0 end as unread_pages,
             coalesce(r.metadata -> 'truncated' = 'true'::jsonb, false) as truncated
        from evidence.documents d
        join lateral (
          select run.metadata
            from evidence.document_processing_runs run
           where run.document_version_id = d.current_version_id
             and run.status = 'COMPLETED'
           order by run.completed_at desc nulls last
           limit 1
        ) r on true
       where d.tenant_id = ${input.tenantId}
         and d.id = any(${ids}::uuid[])`;
    return rows.flatMap((row) => {
      const parsed = NoteRow.safeParse(row);
      return parsed.success
        ? [
            {
              documentId: parsed.data.document_id,
              unreadPages: parsed.data.unread_pages,
              truncated: parsed.data.truncated,
            },
          ]
        : [];
    });
  };
}
