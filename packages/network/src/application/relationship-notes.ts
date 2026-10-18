import {
  CreateRelationshipNoteRequestSchema,
  RelationshipNoteListSchema,
  RelationshipNoteSchema,
  UuidSchema,
  type RelationshipNote,
  type RelationshipNoteList,
} from "@capital-q/contracts";
import {
  ActorContextRequiredError,
  type ActorContext,
} from "@capital-q/security";

import {
  InterestNotFoundError,
  RelationshipNoteSupersededError,
} from "../domain/errors.js";
import {
  createPostgresRelationshipNotes,
  type RelationshipNoteRepository,
  type RelationshipNoteRow,
  type RelationshipNoteSide,
} from "../infrastructure/postgres-relationship-notes.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { requireRelationshipListingScope } from "./relationship-status.js";

/**
 * CRM private notes (S3, research 2026-10-15 §2): a side's own notes on one
 * of its relationships.
 *
 * - The side is the actor's own party, by the same authorisation as the
 *   pipeline list (requireRelationshipListingScope) under the actor's
 *   active organisation; a client-supplied company id is input, never
 *   proof. The relationship must have that party as one of its two.
 * - Reads return only the actor organisation's notes for that side: the
 *   counterpart's notes on the same relationship are never read here.
 * - Writes are idempotent on the client-chosen id. A correction names the
 *   note it supersedes; the superseded note stays as history (the table
 *   refuses updates and deletes for every role).
 * - Notes are not evidence and never enter ranking, fit or Q context.
 */

type Dependencies = Pick<
  ExpressInterestDependencies,
  "sql" | "authorization" | "companies" | "investorSubject"
> & { readonly notes?: RelationshipNoteRepository | undefined };

export type RelationshipNoteService = {
  readonly list: (
    actor: ActorContext,
    relationshipId: string,
    companyId?: string,
  ) => Promise<RelationshipNoteList>;
  readonly add: (
    actor: ActorContext,
    relationshipId: string,
    noteId: string,
    input: unknown,
    companyId?: string,
  ) => Promise<RelationshipNote>;
};

export function createRelationshipNoteService(
  dependencies: Dependencies,
): RelationshipNoteService {
  const notes = dependencies.notes ?? createPostgresRelationshipNotes();

  async function sideOf(
    actor: ActorContext,
    relationshipId: string,
    companyId?: string,
  ): Promise<{
    readonly side: RelationshipNoteSide;
    readonly membershipId: string;
    readonly relationshipId: string;
  }> {
    if (actor.organisationId === undefined || actor.membershipId === undefined)
      throw new ActorContextRequiredError();
    const id = UuidSchema.safeParse(relationshipId);
    if (!id.success) throw new InterestNotFoundError();
    const party = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    const side: RelationshipNoteSide = {
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      companyId: party.party === "COMPANY" ? party.partyId : null,
      investorOrganisationId: party.party === "INVESTOR" ? party.partyId : null,
    };
    // Not theirs and not there read the same: one not-found.
    if (!(await notes.isParty(dependencies.sql, id.data, side)))
      throw new InterestNotFoundError();
    return { side, membershipId: actor.membershipId, relationshipId: id.data };
  }

  const dto = (row: RelationshipNoteRow, actor: ActorContext) =>
    RelationshipNoteSchema.parse({
      id: row.id,
      body: row.body,
      authorName: row.author_name,
      authoredByMe: row.author_user_id === actor.userId,
      createdAt: new Date(row.created_at).toISOString(),
      supersedesNoteId: row.supersedes_note_id,
    });

  return {
    async list(actor, relationshipId, companyId) {
      const scope = await sideOf(actor, relationshipId, companyId);
      const rows = await notes.listCurrent(
        dependencies.sql,
        scope.relationshipId,
        scope.side,
      );
      return RelationshipNoteListSchema.parse({
        items: rows.map((row) => dto(row, actor)),
        visibility: "organisation_private",
      });
    },

    async add(actor, relationshipId, noteId, input, companyId) {
      const data = CreateRelationshipNoteRequestSchema.parse(input);
      const id = UuidSchema.parse(noteId);
      const scope = await sideOf(actor, relationshipId, companyId);
      // A retried write answers with what the first one wrote.
      const retried = await notes.findOwn(
        dependencies.sql,
        id,
        scope.relationshipId,
        scope.side,
      );
      if (retried !== null) return dto(retried, actor);
      if (data.supersedesNoteId !== undefined) {
        const replaced = await notes.findOwn(
          dependencies.sql,
          data.supersedesNoteId,
          scope.relationshipId,
          scope.side,
        );
        if (replaced === null) throw new InterestNotFoundError();
      }
      const written = await notes
        .insert(dependencies.sql, {
          id,
          relationshipId: scope.relationshipId,
          side: scope.side,
          userId: actor.userId,
          membershipId: scope.membershipId,
          body: data.body,
          supersedesNoteId: data.supersedesNoteId ?? null,
        })
        .catch((error: unknown) => {
          // relationship_notes_supersedes_once_idx: one correction per note.
          if ((error as { readonly code?: unknown }).code === "23505")
            throw new RelationshipNoteSupersededError();
          throw error;
        });
      // The id belongs to a row outside this side: indistinguishable from none.
      if (written === null) throw new InterestNotFoundError();
      const created = await notes.findOwn(
        dependencies.sql,
        id,
        scope.relationshipId,
        scope.side,
      );
      if (created === null) throw new InterestNotFoundError();
      return dto(created, actor);
    },
  };
}
