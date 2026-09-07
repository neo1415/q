import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import { DocumentIdSchema, type DocumentQueryPort } from "@capital-q/evidence";
import {
  QSubjectRefSchema,
  type QContextDenialReason,
  type QSubjectKind,
  type QSubjectRef,
} from "@capital-q/contracts";
import type {
  DisclosureResourceRef,
  DisclosureResourceResolverRegistry,
  RelationshipPartyResolver,
} from "@capital-q/permissions";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
} from "@capital-q/security";

import type { SubjectRelation } from "./catalogue.js";

/**
 * Subject resolution (packet §15-16, §37): a typed reference becomes a
 * trusted description — its tenant, its owning organisation, how the
 * actor relates to it, and the disclosure resource that decides shared
 * access — or it does not resolve. Every subject is resolved on its own
 * through the owning context's public port (via the Permissions
 * resolvers); one authorised subject says nothing about the next, and a
 * well-formed UUID that resolves to nothing is exactly as absent as one
 * that resolves to something the actor may not touch.
 *
 * No table is chosen by the subject kind; the kind chooses a resolver.
 */

export type ResolvedSubject = {
  readonly ref: QSubjectRef;
  readonly kind: QSubjectKind;
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId | null;
  readonly relation: SubjectRelation;
  /** The resource disclosure is evaluated on for shared access; null when none exists. */
  readonly resource: DisclosureResourceRef | null;
  /** Which side of a relationship the actor is, for relationship subjects. */
  readonly relationshipSide?: "COMPANY" | "INVESTOR" | undefined;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly capitalObjectiveId?: string | undefined;
  readonly documentId?: string | undefined;
  readonly relationshipId?: string | undefined;
};

export type SubjectResolution =
  | { readonly ok: true; readonly subject: ResolvedSubject }
  | { readonly ok: false; readonly reason: QContextDenialReason };

export type SubjectResolutionPorts = {
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
  readonly documents: DocumentQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
};

function relationTo(
  actor: ActorContext,
  tenantId: TenantId,
  ownerOrganisationId: OrganisationId | undefined,
): SubjectRelation {
  return ownerOrganisationId !== undefined &&
    actor.organisationId !== undefined &&
    actor.organisationId === ownerOrganisationId &&
    actor.tenantId === tenantId
    ? "OWNER"
    : "NETWORK";
}

const unresolved: SubjectResolution = {
  ok: false,
  reason: "SUBJECT_UNRESOLVED",
};

export async function resolveSubject(
  ports: SubjectResolutionPorts,
  actor: ActorContext,
  ref: QSubjectRef,
): Promise<SubjectResolution> {
  // Even internal input is re-validated: a kind this build does not know
  // is refused, never routed to a "default" lookup.
  if (!QSubjectRefSchema.safeParse(ref).success) {
    return { ok: false, reason: "SUBJECT_KIND_UNSUPPORTED" };
  }
  switch (ref.kind) {
    case "COMPANY": {
      const descriptor = await ports.resolvers.resolve({
        type: "company",
        id: ref.companyId,
      });
      if (descriptor === null) {
        return unresolved;
      }
      return {
        ok: true,
        subject: {
          ref,
          kind: ref.kind,
          tenantId: descriptor.tenantId,
          ownerOrganisationId: descriptor.ownerOrganisationId ?? null,
          relation: relationTo(
            actor,
            descriptor.tenantId,
            descriptor.ownerOrganisationId,
          ),
          resource: descriptor.resource,
          companyId: ref.companyId,
        },
      };
    }

    case "INVESTOR_ORGANISATION": {
      const descriptor = await ports.resolvers.resolve({
        type: "investor_organisation",
        id: ref.investorOrganisationId,
      });
      if (descriptor === null) {
        return unresolved;
      }
      return {
        ok: true,
        subject: {
          ref,
          kind: ref.kind,
          tenantId: descriptor.tenantId,
          ownerOrganisationId: descriptor.ownerOrganisationId ?? null,
          relation: relationTo(
            actor,
            descriptor.tenantId,
            descriptor.ownerOrganisationId,
          ),
          resource: descriptor.resource,
          investorOrganisationId: ref.investorOrganisationId,
        },
      };
    }

    case "CAPITAL_OBJECTIVE": {
      const descriptor = await ports.resolvers.resolve({
        type: "capital_objective",
        id: ref.capitalObjectiveId,
      });
      if (descriptor === null) {
        return unresolved;
      }
      return {
        ok: true,
        subject: {
          ref,
          kind: ref.kind,
          tenantId: descriptor.tenantId,
          ownerOrganisationId: descriptor.ownerOrganisationId ?? null,
          relation: relationTo(
            actor,
            descriptor.tenantId,
            descriptor.ownerOrganisationId,
          ),
          resource: descriptor.resource,
          capitalObjectiveId: ref.capitalObjectiveId,
        },
      };
    }

    case "RELATIONSHIP": {
      // The exact parties decide: the company side owns its private
      // history, the investor side its own; anyone else is not a party and
      // learns nothing — not even that the relationship exists.
      const parties = await ports.relationshipParties.resolve(
        ref.relationshipId,
      );
      if (parties === null) {
        return unresolved;
      }
      const side =
        actor.organisationId !== undefined &&
        actor.organisationId === parties.company.organisationId &&
        actor.tenantId === parties.company.tenantId
          ? "COMPANY"
          : actor.organisationId !== undefined &&
              actor.organisationId === parties.investor.organisationId &&
              actor.tenantId === parties.investor.tenantId
            ? "INVESTOR"
            : null;
      if (side === null) {
        return { ok: false, reason: "RELATIONSHIP_SCOPE_MISMATCH" };
      }
      return {
        ok: true,
        subject: {
          ref,
          kind: ref.kind,
          tenantId: parties.company.tenantId,
          ownerOrganisationId: null,
          relation: side === "COMPANY" ? "OWNER" : "COUNTERPARTY",
          resource: { type: "relationship", id: ref.relationshipId },
          relationshipSide: side,
          relationshipId: ref.relationshipId,
        },
      };
    }

    case "DOCUMENT": {
      // Documents are held by an organisation in the actor's own tenant;
      // sharing them is the Data Room's, not this packet's.
      const id = DocumentIdSchema.safeParse(ref.documentId);
      if (!id.success) {
        return unresolved;
      }
      const document = await ports.documents.findCanonicalDocument(
        actor.tenantId,
        id.data,
      );
      if (document === null) {
        return unresolved;
      }
      return {
        ok: true,
        subject: {
          ref,
          kind: ref.kind,
          tenantId: document.tenantId,
          ownerOrganisationId: document.ownerOrganisationId,
          relation: relationTo(
            actor,
            document.tenantId,
            document.ownerOrganisationId,
          ),
          resource: null,
          documentId: ref.documentId,
          companyId: document.companyId ?? undefined,
        },
      };
    }

    case "USER":
      // A person as a subject: only oneself.
      return ref.userId === actor.userId
        ? {
            ok: true,
            subject: {
              ref,
              kind: ref.kind,
              tenantId: actor.tenantId,
              ownerOrganisationId: actor.organisationId ?? null,
              relation: "SELF",
              resource: null,
            },
          }
        : unresolved;

    case "ORGANISATION":
      // Only the organisation the actor is acting for.
      return actor.organisationId !== undefined &&
        ref.organisationId === actor.organisationId
        ? {
            ok: true,
            subject: {
              ref,
              kind: ref.kind,
              tenantId: actor.tenantId,
              ownerOrganisationId: actor.organisationId,
              relation: "SELF",
              resource: null,
            },
          }
        : unresolved;
  }
}
