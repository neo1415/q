import { z } from "zod";

import { RELATIONSHIP_NOTE_LIMIT, UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * network.relationship_notes (migration 20261227140000): CRM private notes.
 * SQL only. Who may read or write is decided by the caller
 * (application/relationship-notes.ts) and repeated in every WHERE: a row
 * outside the actor's own tenant, organisation and side is never read.
 */

/** The side a note belongs to: the actor organisation's own party. */
export type RelationshipNoteSide = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly companyId: string | null;
  readonly investorOrganisationId: string | null;
};

const RowSchema = z.object({
  id: UuidSchema,
  body: z.string(),
  author_user_id: UuidSchema,
  author_name: z.string().nullable(),
  created_at: z.union([z.date(), z.string()]),
  supersedes_note_id: UuidSchema.nullable(),
});
export type RelationshipNoteRow = z.infer<typeof RowSchema>;

const rows = (raw: readonly unknown[]) =>
  raw.map((row) => RowSchema.parse(row));

export type RelationshipNoteRepository = ReturnType<
  typeof createPostgresRelationshipNotes
>;

export function createPostgresRelationshipNotes() {
  return {
    /** Whether the relationship has this side as one of its two parties. */
    async isParty(
      sql: DatabaseExecutor,
      relationshipId: string,
      side: RelationshipNoteSide,
    ): Promise<boolean> {
      const [row] = await sql`
        select 1 as one
          from network.relationships
         where id = ${relationshipId}
           and (company_id = ${side.companyId}
                or investor_organisation_id = ${side.investorOrganisationId})
         limit 1`;
      return row !== undefined;
    },

    /** The side's current notes (not superseded), newest first. */
    async listCurrent(
      sql: DatabaseExecutor,
      relationshipId: string,
      side: RelationshipNoteSide,
    ): Promise<readonly RelationshipNoteRow[]> {
      return rows(
        await sql`
          select n.id, n.body, n.author_user_id, n.created_at, n.supersedes_note_id,
                 nullif(btrim(coalesce(p.display_name,
                   concat_ws(' ', p.given_name, p.family_name))), '') as author_name
            from network.relationship_notes n
            left join identity.user_profiles p on p.id = n.author_user_id
           where n.tenant_id = ${side.tenantId}
             and n.organisation_id = ${side.organisationId}
             and n.relationship_id = ${relationshipId}
             and n.company_id is not distinct from ${side.companyId}
             and n.investor_organisation_id is not distinct from ${side.investorOrganisationId}
             and not exists (
               select 1 from network.relationship_notes s
                where s.supersedes_note_id = n.id)
           order by n.created_at desc, n.id desc
           limit ${RELATIONSHIP_NOTE_LIMIT}`,
      );
    },

    /** One note of the side, current or not. */
    async findOwn(
      sql: DatabaseExecutor,
      noteId: string,
      relationshipId: string,
      side: RelationshipNoteSide,
    ): Promise<RelationshipNoteRow | null> {
      const [row] = rows(
        await sql`
          select n.id, n.body, n.author_user_id, n.created_at, n.supersedes_note_id,
                 nullif(btrim(coalesce(p.display_name,
                   concat_ws(' ', p.given_name, p.family_name))), '') as author_name
            from network.relationship_notes n
            left join identity.user_profiles p on p.id = n.author_user_id
           where n.id = ${noteId}
             and n.tenant_id = ${side.tenantId}
             and n.organisation_id = ${side.organisationId}
             and n.relationship_id = ${relationshipId}
             and n.company_id is not distinct from ${side.companyId}
             and n.investor_organisation_id is not distinct from ${side.investorOrganisationId}`,
      );
      return row ?? null;
    },

    /** Writes one note; null when the id is already taken by another row. */
    async insert(
      sql: DatabaseExecutor,
      input: {
        readonly id: string;
        readonly relationshipId: string;
        readonly side: RelationshipNoteSide;
        readonly userId: string;
        readonly membershipId: string;
        readonly body: string;
        readonly supersedesNoteId: string | null;
      },
    ): Promise<string | null> {
      const inserted = await sql`
        insert into network.relationship_notes
          (id, tenant_id, organisation_id, relationship_id, company_id,
           investor_organisation_id, author_user_id, author_membership_id,
           body, supersedes_note_id)
        values
          (${input.id}, ${input.side.tenantId}, ${input.side.organisationId},
           ${input.relationshipId}, ${input.side.companyId},
           ${input.side.investorOrganisationId}, ${input.userId},
           ${input.membershipId}, ${input.body}, ${input.supersedesNoteId})
        on conflict (id) do nothing
        returning id`;
      return inserted.length === 1 ? input.id : null;
    },
  };
}
