import {
  RELATIONSHIP_VIEW_LIMIT,
  SaveRelationshipViewRequestSchema,
  SavedRelationshipViewSchema,
  UuidSchema,
  type SavedRelationshipView,
  type SavedRelationshipViewList,
} from "@capital-q/contracts";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import {
  InterestNotFoundError,
  InterestNotPermittedError,
  RelationshipViewLimitError,
} from "../domain/errors.js";
import {
  createPostgresRelationshipViews,
  RelationshipViewDefinitionSchema,
  type RelationshipViewParty,
  type RelationshipViewRepository,
  type RelationshipViewRow,
} from "../infrastructure/postgres-relationship-views.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { requireRelationshipListingScope } from "./relationship-status.js";

/**
 * CRM saved views (owner directive 2026-10-15 §D): server-kept, scoped
 * presentation preferences over the pipeline.
 *
 * - The party is the actor's own: the same canonical-party authorisation
 *   as the pipeline list (requireRelationshipListingScope), under the
 *   actor's active organisation. A client-supplied company id is input,
 *   never proof.
 * - PERSONAL views are the owner's alone. ORGANISATION views are shared
 *   with the workspace; anyone who may list the pipeline reads them, and
 *   only an organisation admin creates, renames or deletes them.
 * - A view stores no record, selection or cursor, so opening a shared one
 *   re-runs the reader's own authorised query.
 * - Writes are compare-and-swap on version; creates are idempotent on the
 *   client-chosen id; the per-party limit is checked under a transaction
 *   lock so two concurrent creates cannot both pass it.
 */

type Dependencies = Pick<
  ExpressInterestDependencies,
  "sql" | "transactions" | "authorization" | "companies" | "investorSubject"
> & { readonly views?: RelationshipViewRepository | undefined };

export type RelationshipViewService = {
  readonly list: (
    actor: ActorContext,
    companyId?: string,
  ) => Promise<SavedRelationshipViewList>;
  readonly save: (
    actor: ActorContext,
    viewId: string,
    input: unknown,
    companyId?: string,
  ) => Promise<SavedRelationshipView>;
  readonly remove: (
    actor: ActorContext,
    viewId: string,
    expectedVersion: number,
    companyId?: string,
  ) => Promise<void>;
};

export function createRelationshipViewService(
  dependencies: Dependencies,
): RelationshipViewService {
  const views = dependencies.views ?? createPostgresRelationshipViews();

  async function scope(actor: ActorContext, companyId?: string) {
    if (actor.organisationId === undefined || actor.membershipId === undefined)
      throw new ActorContextRequiredError();
    const party = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    const decision = await dependencies.authorization.authorize({
      actor,
      capability: capability("organisation.admin"),
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: "organisation",
        resourceId: actor.organisationId,
      },
    });
    const owned: RelationshipViewParty = {
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      companyId: party.party === "COMPANY" ? party.partyId : null,
      investorOrganisationId: party.party === "INVESTOR" ? party.partyId : null,
    };
    return {
      party: owned,
      membershipId: actor.membershipId,
      teamEditable: decision.outcome === "ALLOW",
      lock: `network.relationship-views:${actor.tenantId}:${actor.organisationId}:${party.party}:${party.partyId}`,
    };
  }

  function dto(
    row: RelationshipViewRow,
    actor: ActorContext,
    teamEditable: boolean,
  ): SavedRelationshipView {
    return SavedRelationshipViewSchema.parse({
      id: row.id,
      name: row.name,
      ...row.definition,
      scope: row.scope,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
      editable:
        row.scope === "PERSONAL"
          ? row.owner_user_id === actor.userId
          : teamEditable,
    });
  }

  return {
    async list(actor, companyId) {
      const view = await scope(actor, companyId);
      const rows = await views.list(
        dependencies.sql,
        view.party,
        actor.userId,
        RELATIONSHIP_VIEW_LIMIT * 2,
      );
      return {
        items: rows.map((row) => dto(row, actor, view.teamEditable)),
        teamEditable: view.teamEditable,
      };
    },

    async save(actor, id, input, companyId) {
      const data = SaveRelationshipViewRequestSchema.parse(input);
      const viewId = UuidSchema.parse(id);
      const view = await scope(actor, companyId);
      if (data.scope === "ORGANISATION" && !view.teamEditable)
        throw new InterestNotPermittedError();
      const definition = RelationshipViewDefinitionSchema.parse({
        query: data.query,
        layout: data.layout,
        columns: data.columns,
      });
      return dependencies.transactions.run(async ({ sql }) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${view.lock}, 0))`;
        if (data.expectedVersion === 0) {
          const retried = await views.findOwn(
            sql,
            viewId,
            view.party,
            actor.userId,
          );
          // A retried create answers with what the first one wrote.
          if (retried !== null) return dto(retried, actor, view.teamEditable);
          if (
            (await views.count(sql, view.party, data.scope, actor.userId)) >=
            RELATIONSHIP_VIEW_LIMIT
          )
            throw new RelationshipViewLimitError();
          const created = await views.insert(sql, {
            id: viewId,
            party: view.party,
            userId: actor.userId,
            membershipId: view.membershipId,
            name: data.name,
            scope: data.scope,
            definition,
          });
          // The id belongs to someone else's view: indistinguishable from none.
          if (created === null) throw new InterestNotFoundError();
          return dto(created, actor, view.teamEditable);
        }
        const updated = await views.update(sql, {
          id: viewId,
          party: view.party,
          userId: actor.userId,
          teamEditable: view.teamEditable,
          scope: data.scope,
          name: data.name,
          definition,
          expectedVersion: data.expectedVersion,
        });
        if (updated === null) throw new InterestNotFoundError();
        return dto(updated, actor, view.teamEditable);
      });
    },

    async remove(actor, id, expectedVersion, companyId) {
      const viewId = UuidSchema.parse(id);
      const view = await scope(actor, companyId);
      const removed = await views.remove(dependencies.sql, {
        id: viewId,
        party: view.party,
        userId: actor.userId,
        teamEditable: view.teamEditable,
        expectedVersion,
      });
      if (!removed) throw new InterestNotFoundError();
    },
  };
}
