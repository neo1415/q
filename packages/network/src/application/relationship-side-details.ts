import {
  AuditActionTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  RelationshipSideDetailsReadSchema,
  RelationshipSideDetailsSchema,
  UpdateRelationshipSideDetailsRequestSchema,
  UuidSchema,
  type CorrelationId,
  type RelationshipMySideSummary,
  type RelationshipSideDetails,
  type RelationshipSideDetailsRead,
} from "@capital-q/contracts";
import {
  ActorContextRequiredError,
  type ActorContext,
} from "@capital-q/security";

import { CompanyIdSchema } from "@capital-q/companies";

import {
  InterestCompanyNotFoundError,
  InterestNotFoundError,
  RelationshipSideDetailsConflictError,
  RelationshipSideOwnerError,
} from "../domain/errors.js";
import {
  createPostgresRelationshipSideDetails,
  type RelationshipSideDetailRepository,
  type RelationshipSideDetailRow,
  type RelationshipSideOf,
  type SideDetailValues,
} from "../infrastructure/postgres-relationship-side-details.js";
import { RESOURCE_RELATIONSHIP } from "./ensure-relationship.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { requireRelationshipListingScope } from "./relationship-status.js";

/**
 * A side's own pipeline fields on one of its relationships (CRM import
 * gaps 1-5, decision 106): its own stage, deal owner, source and
 * introducer, expected cheque and priority.
 *
 * - The side is the actor's own party, by the pipeline's own rule
 *   (requireRelationshipListingScope) under the actor's active
 *   organisation; a client-supplied company id is input, never proof. The
 *   relationship must have that party as one of its two.
 * - Reads and writes touch only the actor organisation's row for that side:
 *   the counterpart's fields on the same relationship are never read.
 * - A save names the revision it was made from; a save over a newer one is
 *   refused (never silently overwritten). Each save is audited with the
 *   names of the fields it changed, never their values.
 * - The owner is an active member of the side's own organisation.
 * - Nothing here moves the shared relationship state, ranking or fit.
 */

type Dependencies = Pick<
  ExpressInterestDependencies,
  | "sql"
  | "transactions"
  | "audit"
  | "authorization"
  | "companies"
  | "investorSubject"
> & {
  readonly sideDetails?: RelationshipSideDetailRepository | undefined;
};

export type RelationshipSideDetailService = {
  readonly read: (
    actor: ActorContext,
    relationshipId: string,
    companyId?: string,
  ) => Promise<RelationshipSideDetailsRead>;
  readonly update: (
    actor: ActorContext,
    relationshipId: string,
    input: unknown,
    options: {
      readonly companyId?: string | undefined;
      readonly correlationId: CorrelationId;
    },
  ) => Promise<RelationshipSideDetails>;
  /**
   * The actor's own side's fields on one relationship, whichever side
   * their active organisation is (Q's read). Null: not a party.
   */
  readonly own: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<RelationshipSideDetails | null>;
  /** The reader's own side's summary for a page of its relationships. */
  readonly summaries: (
    actor: ActorContext,
    relationshipIds: readonly string[],
    companyId?: string,
  ) => Promise<ReadonlyMap<string, RelationshipMySideSummary>>;
};

const ACTION_UPDATED = AuditActionTypeSchema.parse(
  "relationship.side_details.updated",
);

export function createRelationshipSideDetailService(
  dependencies: Dependencies,
): RelationshipSideDetailService {
  const repository =
    dependencies.sideDetails ?? createPostgresRelationshipSideDetails();

  async function sideOf(
    actor: ActorContext,
    companyId?: string,
  ): Promise<RelationshipSideOf> {
    if (actor.organisationId === undefined)
      throw new ActorContextRequiredError();
    const scope = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    return {
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      party: scope.party,
      partyId: scope.partyId,
    };
  }

  async function partyOf(
    actor: ActorContext,
    relationshipId: string,
    companyId?: string,
  ): Promise<{ side: RelationshipSideOf; relationshipId: string }> {
    const id = UuidSchema.safeParse(relationshipId);
    if (!id.success) throw new InterestNotFoundError();
    const side = await sideOf(actor, companyId);
    // Not theirs and not there read the same: one not-found.
    if (!(await repository.isParty(dependencies.sql, id.data, side)))
      throw new InterestNotFoundError();
    return { side, relationshipId: id.data };
  }

  async function current(
    side: RelationshipSideOf,
    relationshipId: string,
  ): Promise<RelationshipSideDetails> {
    const [row] = await repository.forRelationships(dependencies.sql, side, [
      relationshipId,
    ]);
    return detailsOf(relationshipId, side.party, row ?? null);
  }

  return {
    async read(actor, relationshipId, companyId) {
      const { side, relationshipId: id } = await partyOf(
        actor,
        relationshipId,
        companyId,
      );
      const [details, members] = await Promise.all([
        current(side, id),
        repository.activeMembers(dependencies.sql, side),
      ]);
      return RelationshipSideDetailsReadSchema.parse({
        details,
        members: members.map((member) => ({
          membershipId: member.membership_id,
          name: member.name.slice(0, 200),
        })),
      });
    },

    async update(actor, relationshipId, input, options) {
      const request = UpdateRelationshipSideDetailsRequestSchema.parse(input);
      const { side, relationshipId: id } = await partyOf(
        actor,
        relationshipId,
        options.companyId,
      );
      const values: {
        -readonly [K in keyof SideDetailValues]: SideDetailValues[K];
      } = {};
      if (request.stage !== undefined) values.stage = request.stage;
      if (request.stageLabel !== undefined)
        values.stageLabel = request.stageLabel;
      if (request.source !== undefined) values.source = request.source;
      if (request.introducerName !== undefined)
        values.introducerName = request.introducerName;
      if (request.introducerEmail !== undefined)
        values.introducerEmail = request.introducerEmail;
      if (request.expected !== undefined) values.expected = request.expected;
      if (request.priority !== undefined) values.priority = request.priority;
      if (request.ownerMembershipId !== undefined) {
        if (request.ownerMembershipId === null) {
          values.owner = null;
        } else {
          const members = await repository.activeMembers(
            dependencies.sql,
            side,
          );
          const owner = members.find(
            (member) => member.membership_id === request.ownerMembershipId,
          );
          if (owner === undefined) throw new RelationshipSideOwnerError();
          values.owner = {
            membershipId: owner.membership_id,
            userId: owner.user_id,
          };
        }
      }
      const changed = Object.keys(values).sort();
      if (changed.length > 0) {
        await dependencies.transactions.run(async (tx) => {
          const written = await repository.write(tx.sql, {
            relationshipId: id,
            side,
            userId: actor.userId,
            expectedRevision: request.revision,
            values,
          });
          if (written === null)
            throw new RelationshipSideDetailsConflictError();
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: ACTION_UPDATED,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: id,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            // Which fields, never their values: they are the side's own.
            metadata: { side: side.party, fields: changed, revision: written },
            correlationId: options.correlationId,
          });
        });
      }
      return current(side, id);
    },

    async own(actor, relationshipId) {
      const id = UuidSchema.safeParse(relationshipId);
      if (!id.success) return null;
      const pair = await repository.partiesOf(dependencies.sql, id.data);
      if (pair === null) return null;
      // The founder's side when the actor's organisation is the company's;
      // otherwise the investor's. Either way the listing rule authorises.
      const company = await dependencies.companies.findCanonicalCompany(
        CompanyIdSchema.parse(pair.companyId),
      );
      const companyId =
        company !== null && company.organisationId === actor.organisationId
          ? pair.companyId
          : undefined;
      try {
        const { side } = await partyOf(actor, id.data, companyId);
        return await current(side, id.data);
      } catch (error: unknown) {
        if (
          error instanceof InterestNotFoundError ||
          error instanceof InterestCompanyNotFoundError
        )
          return null;
        throw error;
      }
    },

    async summaries(actor, relationshipIds, companyId) {
      const ids = relationshipIds.filter(
        (id) => UuidSchema.safeParse(id).success,
      );
      const out = new Map<string, RelationshipMySideSummary>();
      if (ids.length === 0) return out;
      const side = await sideOf(actor, companyId);
      for (const row of await repository.forRelationships(
        dependencies.sql,
        side,
        ids,
      )) {
        out.set(row.relationship_id, {
          stage: row.stage,
          stageLabel: row.stage_label,
          priority: row.priority,
          ownerName: row.owner_name,
        });
      }
      return out;
    },
  };
}

function detailsOf(
  relationshipId: string,
  party: "INVESTOR" | "COMPANY",
  row: RelationshipSideDetailRow | null,
): RelationshipSideDetails {
  return RelationshipSideDetailsSchema.parse({
    relationshipId,
    side: party,
    stage: row?.stage ?? null,
    stageLabel: row?.stage_label ?? null,
    owner:
      row === null || row.owner_membership_id === null
        ? null
        : { membershipId: row.owner_membership_id, name: row.owner_name },
    source: row?.source ?? null,
    introducerName: row?.introducer_name ?? null,
    introducerEmail: row?.introducer_email ?? null,
    expected:
      row === null ||
      row.expected_amount === null ||
      row.expected_currency === null
        ? null
        : {
            amount: exactAmount(row.expected_amount),
            currency: row.expected_currency,
          },
    priority: row?.priority ?? null,
    revision: row?.revision ?? 0,
    updatedAt: row === null ? null : new Date(row.updated_at).toISOString(),
    visibility: "organisation_private",
  });
}

/** numeric(17,2) as text ("250000.00") read back without its zero cents. */
export function exactAmount(text: string): string {
  return text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
