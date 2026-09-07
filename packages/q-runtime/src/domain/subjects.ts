import {
  CapitalObjectiveIdSchema,
  type CapitalObjectiveQueryPort,
} from "@capital-q/capital";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type { QSubjectKind, QSubjectRef } from "@capital-q/contracts";
import { DocumentIdSchema, type DocumentQueryPort } from "@capital-q/evidence";
import {
  InvestorOrganisationIdSchema,
  type InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  RelationshipIdSchema,
  type RelationshipQueryPort,
} from "@capital-q/network";
import type { OrganisationQueryPort } from "@capital-q/organisations";
import {
  OrganisationIdSchema,
  type ActorContext,
  type OrganisationId,
  type TenantId,
} from "@capital-q/security";

/**
 * Subject resolution: a typed QSubjectRef → the canonical entity it names,
 * as the acting person may know it (doc 12 §8.1; TM-Q-11).
 *
 * A subject identifier is a selection, never authority. Each kind resolves
 * through the owning context's public query port, inside the actor's
 * tenant; anything that does not resolve there is absent, and absent is
 * all the caller learns. There is no dynamic table lookup keyed on the
 * kind, and an unregistered kind fails closed.
 *
 * This is deliberately NOT the Context Firewall. It answers "does this
 * canonical thing exist in the caller's tenant"; it does not decide which
 * of its knowledge may enter Q's reasoning, and a cross-tenant subject an
 * investor may legitimately ask about (a company they discovered) arrives
 * with the firewall and disclosure work in CQ-Q-004, not by loosening this.
 */

export type ResolvedQSubject = {
  readonly ref: QSubjectRef;
  readonly tenantId: TenantId;
  /** The organisation accountable for the subject, when it has one. */
  readonly organisationId: OrganisationId | null;
};

export type QSubjectResolver = {
  readonly kind: QSubjectKind;
  readonly resolve: (
    actor: ActorContext,
    ref: QSubjectRef,
  ) => Promise<ResolvedQSubject | null>;
};

export type QSubjectResolverRegistry = {
  readonly supports: (kind: QSubjectKind) => boolean;
  /** Null for absent, foreign and unsupported alike. */
  readonly resolve: (
    actor: ActorContext,
    ref: QSubjectRef,
  ) => Promise<ResolvedQSubject | null>;
};

/**
 * "May this actor view this canonical resource?" answered by the
 * deterministic disclosure layer (CQ-Q-004). Lets a legitimately visible
 * or deliberately shared subject in another tenant be selected — a
 * discovered company, for instance — while an unshared one stays
 * indistinguishable from a typo. Optional: without it, subjects resolve in
 * the actor's tenant only.
 */
export type QSubjectViewPort = {
  readonly canView: (
    actor: ActorContext,
    resource: {
      readonly type: "company" | "investor_organisation";
      readonly id: string;
    },
  ) => Promise<boolean>;
};

export function createQSubjectResolverRegistry(
  resolvers: readonly QSubjectResolver[],
): QSubjectResolverRegistry {
  const byKind = new Map<QSubjectKind, QSubjectResolver>();
  for (const resolver of resolvers) {
    if (byKind.has(resolver.kind)) {
      // Two resolvers for one kind would make "which one answered"
      // composition-order dependent, which is exactly the ambiguity a
      // subject lookup must not have.
      throw new Error(`Duplicate Q subject resolver for ${resolver.kind}`);
    }
    byKind.set(resolver.kind, resolver);
  }
  return {
    supports: (kind) => byKind.has(kind),
    resolve: (actor, ref) => {
      const resolver = byKind.get(ref.kind);
      return resolver === undefined
        ? Promise.resolve(null)
        : resolver.resolve(actor, ref);
    },
  };
}

function inTenant(
  actor: ActorContext,
  ref: QSubjectRef,
  found: { readonly tenantId: TenantId } | null,
  organisationId: OrganisationId | null,
): ResolvedQSubject | null {
  if (found === null || found.tenantId !== actor.tenantId) {
    return null;
  }
  return { ref, tenantId: found.tenantId, organisationId };
}

export function createCompanyQSubjectResolver(
  companies: CompanyQueryPort,
  view?: QSubjectViewPort,
): QSubjectResolver {
  return {
    kind: "COMPANY",
    resolve: async (actor, ref) => {
      if (ref.kind !== "COMPANY") {
        return null;
      }
      const companyId = CompanyIdSchema.parse(ref.companyId);
      const own = await companies.getCanonicalCompany(
        actor.tenantId,
        companyId,
      );
      if (own !== null) {
        return inTenant(actor, ref, own, own.organisationId);
      }
      // Outside the actor's tenant a company is selectable only when the
      // disclosure layer says this actor may view it. Absent and unshared
      // resolve identically: null.
      if (view === undefined) {
        return null;
      }
      const canonical = await companies.findCanonicalCompany(companyId);
      if (
        canonical === null ||
        !(await view.canView(actor, { type: "company", id: companyId }))
      ) {
        return null;
      }
      return {
        ref,
        tenantId: canonical.tenantId,
        organisationId: canonical.organisationId,
      };
    },
  };
}

export function createInvestorOrganisationQSubjectResolver(
  investors: InvestorOrganisationQueryPort,
  view?: QSubjectViewPort,
): QSubjectResolver {
  return {
    kind: "INVESTOR_ORGANISATION",
    resolve: async (actor, ref) => {
      if (ref.kind !== "INVESTOR_ORGANISATION") {
        return null;
      }
      const investorId = InvestorOrganisationIdSchema.parse(
        ref.investorOrganisationId,
      );
      const own = await investors.getCanonicalInvestorOrganisation(
        actor.tenantId,
        investorId,
      );
      if (own !== null) {
        return inTenant(actor, ref, own, own.organisationId);
      }
      if (view === undefined) {
        return null;
      }
      const canonical =
        await investors.findCanonicalInvestorOrganisation(investorId);
      if (
        canonical === null ||
        !(await view.canView(actor, {
          type: "investor_organisation",
          id: investorId,
        }))
      ) {
        return null;
      }
      return {
        ref,
        tenantId: canonical.tenantId,
        organisationId: canonical.organisationId,
      };
    },
  };
}

export function createOrganisationQSubjectResolver(
  organisations: OrganisationQueryPort,
): QSubjectResolver {
  return {
    kind: "ORGANISATION",
    resolve: async (actor, ref) => {
      if (ref.kind !== "ORGANISATION") {
        return null;
      }
      const organisationId = OrganisationIdSchema.parse(ref.organisationId);
      const organisation = await organisations.getActiveOrganisationIdentity(
        actor.tenantId,
        organisationId,
      );
      return inTenant(actor, ref, organisation, organisationId);
    },
  };
}

/**
 * A person as a subject: only oneself. Asking Q about another person is a
 * disclosure question this packet does not answer, so it is absent.
 */
export function createSelfUserQSubjectResolver(): QSubjectResolver {
  return {
    kind: "USER",
    resolve: (actor, ref) =>
      Promise.resolve(
        ref.kind === "USER" && ref.userId === actor.userId
          ? { ref, tenantId: actor.tenantId, organisationId: null }
          : null,
      ),
  };
}

export function createCapitalObjectiveQSubjectResolver(
  capital: CapitalObjectiveQueryPort,
): QSubjectResolver {
  return {
    kind: "CAPITAL_OBJECTIVE",
    resolve: async (actor, ref) => {
      if (ref.kind !== "CAPITAL_OBJECTIVE") {
        return null;
      }
      const objective = await capital.findCanonicalCapitalObjective(
        CapitalObjectiveIdSchema.parse(ref.capitalObjectiveId),
      );
      return inTenant(actor, ref, objective, null);
    },
  };
}

export function createDocumentQSubjectResolver(
  documents: DocumentQueryPort,
): QSubjectResolver {
  return {
    kind: "DOCUMENT",
    resolve: async (actor, ref) => {
      if (ref.kind !== "DOCUMENT") {
        return null;
      }
      const document = await documents.findCanonicalDocument(
        actor.tenantId,
        DocumentIdSchema.parse(ref.documentId),
      );
      return inTenant(
        actor,
        ref,
        document,
        document?.ownerOrganisationId ?? null,
      );
    },
  };
}

/**
 * A relationship resolves for the company side's tenant — its storage
 * anchor (ADR 0003). The investor side, whose tenant differs, reaches it
 * through disclosure in CQ-Q-004.
 */
export function createRelationshipQSubjectResolver(
  relationships: Pick<RelationshipQueryPort, "getById">,
): QSubjectResolver {
  return {
    kind: "RELATIONSHIP",
    resolve: async (actor, ref) => {
      if (ref.kind !== "RELATIONSHIP") {
        return null;
      }
      const relationship = await relationships.getById(
        RelationshipIdSchema.parse(ref.relationshipId),
      );
      return inTenant(actor, ref, relationship, null);
    },
  };
}
