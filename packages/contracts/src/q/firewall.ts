import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { MarketplaceVisibilitySchema } from "../http/companies.js";
import { MessageSensitivitySchema } from "../messaging/sensitivity.js";
import { QCapabilitySchema } from "./capability.js";
import { QRunIdSchema } from "./ids.js";
import { QSubjectRefSchema, QSubjectRefsSchema } from "./subject.js";

/**
 * The Context Firewall's output contract (doc 12 §15-16, doc 14 §30-31,
 * doc 15 §19-22): what Q is PERMITTED to reason over for one actor, in one
 * organisation context, for one purpose, about resolved subjects.
 *
 * INTERNAL. A plan never reaches a client; the public projection of a
 * denied plan is one failure code (`NOT_AVAILABLE_IN_CONTEXT`) that says
 * nothing about what exists.
 *
 *   Available knowledge ≠ authorised reasoning context
 *   Requested scope     ≠ permitted scope
 *   Reasoning access    ≠ disclosure / quoting / linking access
 *   Authorisation       ≠ truth ≠ confidence ≠ verification
 *
 * The plan is a bounded allowlist retrieval must be handed and must obey;
 * it is never the retrieved content, and it carries no title, excerpt,
 * locator or secret. Context labels are the eight ADR-001 disclosure
 * scopes (persisted lowercase); sensitivity is the doc 15 §20 baseline.
 * The two are distinct axes and are never flattened into one.
 */

/** The deterministic policy generation that produced a plan. Never "latest". */
export const Q_CONTEXT_FIREWALL_POLICY_VERSION = "context-firewall-v1" as const;

/** Context labels: exactly ADR-001's disclosure scopes. No alias vocabulary. */
export const QContextLabelSchema = MarketplaceVisibilitySchema;
export type QContextLabel = z.infer<typeof QContextLabelSchema>;

/** Sensitivity: exactly doc 15 §20's baseline, shared with messaging. */
export const QSensitivityClassSchema = MessageSensitivitySchema;
export type QSensitivityClass = z.infer<typeof QSensitivityClassSchema>;

/**
 * What kind of task Q is doing. DERIVED by the firewall from the capability,
 * the actor's relation to the subjects and the subject kinds — never chosen
 * by a client, so no request can name a more privileged purpose. There is
 * deliberately no support, admin or investigation purpose: operational
 * access is not a Q reasoning purpose.
 */
export const Q_TASK_CLASSES = [
  /** A question about a company the actor's organisation owns. */
  "OWN_COMPANY_QUESTION",
  /** A question about a company the actor does not own (investor, network). */
  "COUNTERPARTY_COMPANY_QUESTION",
  /** A question about an investor organisation (own or counterparty). */
  "INVESTOR_QUESTION",
  /** A question anchored on a canonical relationship the actor is party to. */
  "RELATIONSHIP_QUESTION",
  /** Two or more subjects set against each other. */
  "COMPARISON",
  /** Preparing a consequential action for approval. Never executes it. */
  "ACTION_PREPARATION",
  /** No canonical subject: the actor's own context and general knowledge. */
  "GENERAL_QUESTION",
] as const;
export type QTaskClass = (typeof Q_TASK_CLASSES)[number];
export const QTaskClassSchema = z.enum(Q_TASK_CLASSES);

/**
 * The bounded catalogue of knowledge Q may be allowed to use. A closed set:
 * adding a kind is a contract change reviewed as security policy. There is
 * no `ALL_DATA`, no wildcard and no free-text kind.
 */
export const Q_KNOWLEDGE_SCOPE_KINDS = [
  /** Canonical company profile as its visibility permits (structured state). */
  "COMPANY_PROFILE",
  /** The company's current capital objective (structured state). */
  "COMPANY_CAPITAL_OBJECTIVE",
  /** Founder-private financial facts of the company. */
  "COMPANY_PRIVATE_FINANCIALS",
  /** Canonical investor organisation profile. */
  "INVESTOR_PROFILE",
  /** The investor organisation's mandates (investor-private). */
  "INVESTOR_MANDATE",
  /** History of one canonical relationship, as each event's label permits. */
  "RELATIONSHIP_CONTEXT",
  /** Original evidence documents the actor's organisation holds. */
  "EVIDENCE_DOCUMENTS",
  /** The actor's own Q conversation (personal_private). */
  "OWN_Q_CONVERSATION",
  /** Anything classified network_visible across Capital Q. */
  "NETWORK_VISIBLE_DATA",
  /** Anything classified public_external. */
  "PUBLIC_EXTERNAL_DATA",
  /** The model's general knowledge. Never evidence about a subject. */
  "GENERAL_MODEL_KNOWLEDGE",
] as const;
export type QKnowledgeScopeKind = (typeof Q_KNOWLEDGE_SCOPE_KINDS)[number];
export const QKnowledgeScopeKindSchema = z.enum(Q_KNOWLEDGE_SCOPE_KINDS);

/** Doc 14 §22 retrieval layers, so a plan can say which layers may be used. */
export const Q_RETRIEVAL_LAYERS = [
  "STRUCTURED_STATE",
  "KNOWLEDGE_OBJECTS",
  "EVIDENCE_DOCUMENTS",
  "CONVERSATIONS_AND_RELATIONSHIPS",
  "SEMANTIC_HYBRID",
  "CONNECTED_KNOWLEDGE",
  "PUBLIC_EXTERNAL",
  "GENERAL_MODEL",
] as const;
export type QRetrievalLayer = (typeof Q_RETRIEVAL_LAYERS)[number];
export const QRetrievalLayerSchema = z.enum(Q_RETRIEVAL_LAYERS);

/**
 * Fact categories a scope can reveal, for combination-risk policy (doc 15
 * §22). Bounded and deterministic: a rule names categories, never words.
 */
export const Q_FACT_CATEGORIES = [
  "COMPANY_IDENTITY",
  "RAISE_TARGET",
  "FUNDING_DEADLINE",
  "CASH_POSITION",
  "BURN_RATE",
  "PAYROLL_TIMING",
  "NEGOTIATION_STATE",
  "INVESTOR_THESIS",
  "PERSONAL_CONTEXT",
] as const;
export type QFactCategory = (typeof Q_FACT_CATEGORIES)[number];
export const QFactCategorySchema = z.enum(Q_FACT_CATEGORIES);

/** FULL = the scope as classified; AGGREGATE = a coarser projection policy requires. */
export const Q_SCOPE_PROJECTIONS = ["FULL", "AGGREGATE"] as const;
export type QScopeProjection = (typeof Q_SCOPE_PROJECTIONS)[number];
export const QScopeProjectionSchema = z.enum(Q_SCOPE_PROJECTIONS);

/**
 * Reasoning access is not disclosure access. A scope in a plan may be used
 * for reasoning by construction; whether its existence, wording or location
 * may reach the person is decided separately and carried here so the
 * response serializer (later) cannot guess.
 */
export const QDisclosureRightsSchema = z
  .object({
    canUseForReasoning: z.literal(true),
    canDiscloseExistence: z.boolean(),
    canQuote: z.boolean(),
    canProvideLink: z.boolean(),
  })
  .strict();
export type QDisclosureRights = z.infer<typeof QDisclosureRightsSchema>;

/**
 * The typed retrieval constraint a scope carries. Identifiers only, closed
 * shape: retrieval builds its database predicate from these fields and
 * from nothing else. No table name, no free key.
 */
export const QScopeFilterSchema = z
  .object({
    tenantId: UuidSchema,
    organisationId: UuidSchema.optional(),
    companyId: UuidSchema.optional(),
    investorOrganisationId: UuidSchema.optional(),
    capitalObjectiveId: UuidSchema.optional(),
    relationshipIds: z.array(UuidSchema).max(20).optional(),
    userId: UuidSchema.optional(),
    /** Labels retrieval may include for this scope (relationship events, documents). */
    contextLabels: z.array(QContextLabelSchema).max(8).optional(),
  })
  .strict();
export type QScopeFilter = z.infer<typeof QScopeFilterSchema>;

/** One permitted scope: what may be retrieved, under which label, ceiling and rights. */
export const QAuthorisedKnowledgeScopeSchema = z
  .object({
    kind: QKnowledgeScopeKindSchema,
    /** The subject this scope is bound to; absent for actor-wide scopes. */
    subject: QSubjectRefSchema.optional(),
    contextLabel: QContextLabelSchema,
    sensitivity: QSensitivityClassSchema,
    layer: QRetrievalLayerSchema,
    factCategories: z.array(QFactCategorySchema).max(9),
    projection: QScopeProjectionSchema,
    rights: QDisclosureRightsSchema,
    filter: QScopeFilterSchema,
    /** True only for GENERAL_MODEL_KNOWLEDGE: never entity-specific evidence. */
    isEvidence: z.boolean(),
  })
  .strict();
export type QAuthorisedKnowledgeScope = z.infer<
  typeof QAuthorisedKnowledgeScopeSchema
>;

/**
 * Stable INTERNAL denial reasons for diagnostics, tests and telemetry.
 * Never echoed to a client: several of them confirm that something exists.
 */
export const Q_CONTEXT_DENIAL_REASONS = [
  "NON_HUMAN_ACTOR",
  "ORGANISATION_CONTEXT_REQUIRED",
  "SUBJECT_KIND_UNSUPPORTED",
  "SUBJECT_UNRESOLVED",
  "CROSS_TENANT",
  "OWNER_ONLY",
  "CAPABILITY_MISSING",
  "CAPABILITY_REQUIREMENT_UNMET",
  "DISCLOSURE_DENIED",
  "DISCLOSURE_EXPIRED",
  "DISCLOSURE_REVOKED",
  "RELATIONSHIP_SCOPE_MISMATCH",
  "SENSITIVITY_NOT_PERMITTED",
  "SCOPE_NOT_RELEVANT",
  "SCOPE_NOT_REQUESTED",
  "COMBINATION_RISK",
  "NO_AUTHORISED_CONTEXT",
] as const;
export type QContextDenialReason = (typeof Q_CONTEXT_DENIAL_REASONS)[number];
export const QContextDenialReasonSchema = z.enum(Q_CONTEXT_DENIAL_REASONS);

export const QDeniedScopeSchema = z
  .object({
    kind: QKnowledgeScopeKindSchema,
    subject: QSubjectRefSchema.optional(),
    reason: QContextDenialReasonSchema,
  })
  .strict();
export type QDeniedScope = z.infer<typeof QDeniedScopeSchema>;

export const Q_COMBINATION_EFFECTS = [
  "DENY_SCOPES",
  "AGGREGATE_PROJECTION",
] as const;
export const QCombinationConstraintSchema = z
  .object({
    ruleId: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(64),
    effect: z.enum(Q_COMBINATION_EFFECTS),
    affectedScopeKinds: z.array(QKnowledgeScopeKindSchema).min(1).max(11),
    categories: z.array(QFactCategorySchema).min(1).max(9),
  })
  .strict();
export type QCombinationConstraint = z.infer<
  typeof QCombinationConstraintSchema
>;

export const Q_PLAN_SCOPES_MAX = 32;
export const Q_PLAN_DENIED_MAX = 64;

/**
 * The permitted context plan. Everything retrieval, the model gateway and
 * the response serializer need in order to stay inside the authorised
 * boundary, and nothing that is itself sensitive.
 *
 * `fingerprint` is a SHA-256 over the policy-relevant content (version,
 * tenant, actor, purpose, subjects, scopes, constraints, ceiling) so a run
 * can be audited against exactly what was allowed. It contains no secret.
 * `revalidateAfter` and `revalidateOnResume` say the plan is a decision at
 * an instant, not a bearer token: a resumed run re-plans before retrieval.
 */
export const PermittedContextPlanSchema = z
  .object({
    contractVersion: z.literal(1),
    policyVersion: z.literal(Q_CONTEXT_FIREWALL_POLICY_VERSION),
    planId: UuidSchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    runId: QRunIdSchema,
    tenantId: UuidSchema,
    actor: z
      .object({
        userId: UuidSchema,
        organisationId: UuidSchema.optional(),
      })
      .strict(),
    purpose: z
      .object({
        capability: QCapabilitySchema,
        taskClass: QTaskClassSchema,
      })
      .strict(),
    subjects: QSubjectRefsSchema,
    scopes: z.array(QAuthorisedKnowledgeScopeSchema).max(Q_PLAN_SCOPES_MAX),
    denied: z.array(QDeniedScopeSchema).max(Q_PLAN_DENIED_MAX),
    /** The strongest sensitivity of any permitted scope: what derived output inherits. */
    maxSensitivity: QSensitivityClassSchema,
    allowedLayers: z.array(QRetrievalLayerSchema).max(8),
    combinationConstraints: z.array(QCombinationConstraintSchema).max(16),
    evaluatedAt: UtcTimestampSchema,
    revalidateAfter: UtcTimestampSchema,
    revalidateOnResume: z.literal(true),
  })
  .strict();
export type PermittedContextPlan = z.infer<typeof PermittedContextPlanSchema>;

/** Sensitivity ordering for ceilings and inheritance. Explicit, never string order. */
export const Q_SENSITIVITY_RANK: Readonly<Record<QSensitivityClass, number>> = {
  PUBLIC: 0,
  NETWORK_VISIBLE: 1,
  INTERNAL: 2,
  CONFIDENTIAL: 3,
  HIGHLY_CONFIDENTIAL: 4,
  RESTRICTED: 5,
};

export function strongerSensitivity(
  a: QSensitivityClass,
  b: QSensitivityClass,
): QSensitivityClass {
  return Q_SENSITIVITY_RANK[a] >= Q_SENSITIVITY_RANK[b] ? a : b;
}

export function sensitivityWithin(
  value: QSensitivityClass,
  ceiling: QSensitivityClass,
): boolean {
  return Q_SENSITIVITY_RANK[value] <= Q_SENSITIVITY_RANK[ceiling];
}
