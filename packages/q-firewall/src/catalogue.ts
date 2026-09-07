import type {
  QContextLabel,
  QDisclosureRights,
  QFactCategory,
  QKnowledgeScopeKind,
  QRetrievalLayer,
  QSensitivityClass,
} from "@capital-q/contracts";
import type { DisclosureResourceType } from "@capital-q/permissions";
import { capability, type Capability } from "@capital-q/security";

/**
 * The scope catalogue: what each knowledge scope kind IS, as policy.
 *
 * For every kind: the context label it carries by default, its
 * sensitivity when the owning side uses it and when a shared path grants
 * it, the retrieval layer it belongs to, the fact categories it can reveal
 * (for combination-risk rules), the capability the owning side must hold,
 * which disclosure resource kind decides shared access (if any), and
 * whether anyone but the owner can ever hold it.
 *
 * This table is policy, not data: changing a row is a new policy version.
 * There is no row that grants everything.
 */

/** How the actor relates to a subject. Decides which access path applies. */
export const SUBJECT_RELATIONS = [
  /** The actor's active organisation owns the subject. */
  "OWNER",
  /** The actor's organisation is the other party of the subject's relationship. */
  "COUNTERPARTY",
  /** The actor is the person the subject is (USER = self). */
  "SELF",
  /** Neither owner nor party: only network/public/explicit paths can apply. */
  "NETWORK",
] as const;
export type SubjectRelation = (typeof SUBJECT_RELATIONS)[number];

export type ScopeSpec = {
  readonly kind: QKnowledgeScopeKind;
  /** Bound to a subject, or actor-wide. */
  readonly bound: boolean;
  readonly defaultLabel: QContextLabel;
  readonly ownerSensitivity: QSensitivityClass;
  readonly sharedSensitivity: QSensitivityClass;
  readonly layer: QRetrievalLayer;
  readonly factCategories: readonly QFactCategory[];
  /** Capability the owning side must hold on the subject's resource. */
  readonly ownerCapability: Capability | null;
  /** Disclosure resource kind a shared path is evaluated on; null = owner only. */
  readonly sharedVia: DisclosureResourceType | null;
  readonly isEvidence: boolean;
};

const OWNER_RIGHTS: QDisclosureRights = {
  canUseForReasoning: true,
  canDiscloseExistence: true,
  canQuote: true,
  canProvideLink: true,
};

/**
 * A view-only share lets Q reason with the material and acknowledge it
 * exists; it never lets Q reproduce it or hand out a location. Re-sharing
 * is a capability the share does not carry (doc 15 §23.2).
 */
const SHARED_RIGHTS: QDisclosureRights = {
  canUseForReasoning: true,
  canDiscloseExistence: true,
  canQuote: false,
  canProvideLink: false,
};

export function rightsFor(relation: SubjectRelation): QDisclosureRights {
  return relation === "OWNER" || relation === "SELF"
    ? OWNER_RIGHTS
    : SHARED_RIGHTS;
}

export const SCOPE_CATALOGUE: Readonly<Record<QKnowledgeScopeKind, ScopeSpec>> =
  {
    COMPANY_PROFILE: {
      kind: "COMPANY_PROFILE",
      bound: true,
      defaultLabel: "organisation_private",
      ownerSensitivity: "INTERNAL",
      sharedSensitivity: "NETWORK_VISIBLE",
      layer: "STRUCTURED_STATE",
      factCategories: ["COMPANY_IDENTITY"],
      ownerCapability: capability("company.view"),
      sharedVia: "company",
      isEvidence: true,
    },
    COMPANY_CAPITAL_OBJECTIVE: {
      kind: "COMPANY_CAPITAL_OBJECTIVE",
      bound: true,
      defaultLabel: "founder_private",
      ownerSensitivity: "CONFIDENTIAL",
      sharedSensitivity: "CONFIDENTIAL",
      layer: "STRUCTURED_STATE",
      factCategories: ["RAISE_TARGET", "FUNDING_DEADLINE"],
      ownerCapability: capability("capital_objective.view"),
      sharedVia: "capital_objective",
      isEvidence: true,
    },
    COMPANY_PRIVATE_FINANCIALS: {
      kind: "COMPANY_PRIVATE_FINANCIALS",
      bound: true,
      defaultLabel: "founder_private",
      ownerSensitivity: "HIGHLY_CONFIDENTIAL",
      sharedSensitivity: "HIGHLY_CONFIDENTIAL",
      layer: "STRUCTURED_STATE",
      factCategories: ["CASH_POSITION", "BURN_RATE", "PAYROLL_TIMING"],
      ownerCapability: capability("company.financials.view"),
      // No disclosure resource exists for financials: nothing but the owning
      // side can hold this until a Data Room packet defines one.
      sharedVia: null,
      isEvidence: true,
    },
    INVESTOR_PROFILE: {
      kind: "INVESTOR_PROFILE",
      bound: true,
      defaultLabel: "investor_private",
      ownerSensitivity: "INTERNAL",
      sharedSensitivity: "CONFIDENTIAL",
      layer: "STRUCTURED_STATE",
      factCategories: ["COMPANY_IDENTITY"],
      ownerCapability: capability("investor.view"),
      sharedVia: "investor_organisation",
      isEvidence: true,
    },
    INVESTOR_MANDATE: {
      kind: "INVESTOR_MANDATE",
      bound: true,
      defaultLabel: "investor_private",
      ownerSensitivity: "CONFIDENTIAL",
      sharedSensitivity: "CONFIDENTIAL",
      layer: "STRUCTURED_STATE",
      factCategories: ["INVESTOR_THESIS"],
      ownerCapability: capability("investor.mandate.view"),
      // The raw mandate is never network-visible; a projected Investor
      // Profile decides later what a founder may see.
      sharedVia: null,
      isEvidence: true,
    },
    RELATIONSHIP_CONTEXT: {
      kind: "RELATIONSHIP_CONTEXT",
      bound: true,
      defaultLabel: "relationship_shared",
      ownerSensitivity: "CONFIDENTIAL",
      sharedSensitivity: "CONFIDENTIAL",
      layer: "CONVERSATIONS_AND_RELATIONSHIPS",
      factCategories: ["NEGOTIATION_STATE"],
      ownerCapability: null,
      // Party membership is decided by the exact-parties resolver, not by a
      // policy row; a relationship has no intrinsic scope.
      sharedVia: "relationship",
      isEvidence: true,
    },
    EVIDENCE_DOCUMENTS: {
      kind: "EVIDENCE_DOCUMENTS",
      bound: true,
      defaultLabel: "founder_private",
      ownerSensitivity: "HIGHLY_CONFIDENTIAL",
      sharedSensitivity: "HIGHLY_CONFIDENTIAL",
      layer: "EVIDENCE_DOCUMENTS",
      factCategories: [],
      ownerCapability: capability("document.view"),
      // Document sharing is the Data Room's; nothing here invents it.
      sharedVia: null,
      isEvidence: true,
    },
    OWN_Q_CONVERSATION: {
      kind: "OWN_Q_CONVERSATION",
      bound: false,
      defaultLabel: "personal_private",
      ownerSensitivity: "CONFIDENTIAL",
      sharedSensitivity: "CONFIDENTIAL",
      layer: "CONVERSATIONS_AND_RELATIONSHIPS",
      factCategories: ["PERSONAL_CONTEXT"],
      ownerCapability: null,
      sharedVia: null,
      isEvidence: false,
    },
    NETWORK_VISIBLE_DATA: {
      kind: "NETWORK_VISIBLE_DATA",
      bound: false,
      defaultLabel: "network_visible",
      ownerSensitivity: "NETWORK_VISIBLE",
      sharedSensitivity: "NETWORK_VISIBLE",
      layer: "SEMANTIC_HYBRID",
      factCategories: [],
      ownerCapability: null,
      sharedVia: null,
      isEvidence: true,
    },
    PUBLIC_EXTERNAL_DATA: {
      kind: "PUBLIC_EXTERNAL_DATA",
      bound: false,
      defaultLabel: "public_external",
      ownerSensitivity: "PUBLIC",
      sharedSensitivity: "PUBLIC",
      layer: "PUBLIC_EXTERNAL",
      factCategories: [],
      ownerCapability: null,
      sharedVia: null,
      isEvidence: true,
    },
    GENERAL_MODEL_KNOWLEDGE: {
      kind: "GENERAL_MODEL_KNOWLEDGE",
      bound: false,
      defaultLabel: "public_external",
      ownerSensitivity: "PUBLIC",
      sharedSensitivity: "PUBLIC",
      layer: "GENERAL_MODEL",
      factCategories: [],
      ownerCapability: null,
      sharedVia: null,
      // Never evidence about a subject (doc 14; packet §57).
      isEvidence: false,
    },
  };

/** The ADR-001 labels the owning side of a relationship may see in its history. */
export function relationshipLabelsFor(
  side: "COMPANY" | "INVESTOR",
): readonly QContextLabel[] {
  return [
    side === "COMPANY" ? "founder_private" : "investor_private",
    "relationship_shared",
    "specifically_shared",
    "network_visible",
    "public_external",
  ];
}
