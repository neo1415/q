import { createHash, randomUUID } from "node:crypto";

import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import {
  PermittedContextPlanSchema,
  sensitivityWithin,
  strongerSensitivity,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
  type QContextDenialReason,
  type QContextLabel,
  type QDeniedScope,
  type QKnowledgeScopeKind,
  type QScopeFilter,
  type QSensitivityClass,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { DocumentQueryPort } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  actorPrincipal,
  type DisclosureAccessRequest,
  type DisclosureAccessService,
  type DisclosureClock,
  type DisclosureDecision,
  type DisclosureResourceRef,
  type DisclosureResourceResolverRegistry,
  type RelationshipPartyResolver,
} from "@capital-q/permissions";
import type {
  ContextFirewallDecision,
  ContextFirewallPort,
  ContextFirewallRequest,
} from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  relationshipLabelsFor,
  rightsFor,
  SCOPE_CATALOGUE,
  type ScopeSpec,
  type SubjectRelation,
} from "./catalogue.js";
import { applyCombinationRules } from "./combination.js";
import {
  actorWideScopeKinds,
  candidateScopeKinds,
  deriveTaskClass,
  sensitivityCeiling,
} from "./purpose.js";
import { resolveSubject, type ResolvedSubject } from "./resolve.js";
import {
  CONTEXT_FIREWALL_POLICY_VERSION,
  CONTEXT_PLAN_REVALIDATE_AFTER_MS,
} from "./version.js";

/**
 * The Context Firewall (doc 12 §15, doc 14 §30-31, doc 15 §19-22).
 *
 * Evaluation order, each stage monotonic — able to remove, narrow or
 * constrain, never to add back what an earlier stage refused:
 *
 *    1. trusted actor (server-resolved, HUMAN)
 *    2. active organisation where the subjects need one
 *    3. subjects, each on its own, through typed resolvers
 *    4. task class, derived — never chosen by a client
 *    5. candidate scopes for that task (purpose limitation ∩ requested labels)
 *    6. capability envelope for the owning side
 *    7. disclosure / relationship-party policy for every other side
 *    8. sensitivity: task ceiling, strongest-source inheritance
 *    9. combination-risk rules
 *   10. nothing left for a subject → no plan at all
 *   11. the permitted context plan, fingerprinted and time-bounded
 *
 * Everything the firewall consults is deterministic application state
 * reached through public ports. No text a person wrote is an input; no
 * model is asked anything; no SQL is written here.
 */

export type ContextFirewallDependencies = {
  readonly authorization: AuthorizationService;
  readonly disclosure: DisclosureAccessService;
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
  readonly documents: DocumentQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
  readonly clock: DisclosureClock;
  readonly logger?: Logger | undefined;
};

/** A scope under evaluation, before it is permitted or denied. */
type Candidate = {
  readonly spec: ScopeSpec;
  readonly subject: ResolvedSubject | null;
  readonly resource: DisclosureResourceRef | null;
  readonly filter: QScopeFilter;
  readonly labels: readonly QContextLabel[] | undefined;
};

type Verdict =
  | { readonly permitted: true; readonly scope: QAuthorisedKnowledgeScope }
  | { readonly permitted: false; readonly denied: QDeniedScope };

const ENTITY_KINDS = new Set<QSubjectRef["kind"]>([
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "RELATIONSHIP",
  "CAPITAL_OBJECTIVE",
  "DOCUMENT",
]);

function deny(
  spec: ScopeSpec,
  subject: ResolvedSubject | null,
  reason: QContextDenialReason,
): Verdict {
  return {
    permitted: false,
    denied: {
      kind: spec.kind,
      ...(subject === null ? {} : { subject: subject.ref }),
      reason,
    },
  };
}

/** The ADR-001 label a disclosure path grants. */
function labelForDisclosure(
  decision: Extract<DisclosureDecision, { outcome: "ALLOW" }>,
  fallback: QContextLabel,
): QContextLabel {
  switch (decision.reasonCode) {
    case "NETWORK_VISIBLE":
      return "network_visible";
    case "PUBLIC_EXTERNAL":
      return "public_external";
    case "RELATIONSHIP_PARTY":
      return "relationship_shared";
    case "EXPLICIT_RECIPIENT":
      return "specifically_shared";
    case "SAME_ORGANISATION":
      return "organisation_private";
    case "OWNER":
      return fallback;
  }
}

function denialForDisclosure(
  decision: Extract<DisclosureDecision, { outcome: "DENY" }>,
): QContextDenialReason {
  switch (decision.reasonCode) {
    case "POLICY_EXPIRED":
      return "DISCLOSURE_EXPIRED";
    case "POLICY_REVOKED":
      return "DISCLOSURE_REVOKED";
    case "UNRESOLVED_RELATIONSHIP":
      return "RELATIONSHIP_SCOPE_MISMATCH";
    // Every other refusal is one plain denial: the internal reason must not
    // distinguish "no such thing" from "not yours" from "wrong recipient".
    case "INVALID_REQUEST":
    case "NON_HUMAN_PRINCIPAL":
    case "AUTHENTICATION_REQUIRED":
    case "UNKNOWN_RESOURCE":
    case "UNKNOWN_RESOURCE_SCOPE":
    case "NO_MATCHING_SCOPE":
    case "WRONG_RECIPIENT":
    case "INSUFFICIENT_ACCESS_LEVEL":
      return "DISCLOSURE_DENIED";
  }
}

function fingerprintOf(
  plan: Omit<PermittedContextPlan, "fingerprint">,
): string {
  const material = {
    policyVersion: plan.policyVersion,
    tenantId: plan.tenantId,
    actor: plan.actor,
    purpose: plan.purpose,
    subjects: plan.subjects,
    scopes: [...plan.scopes].sort((a, b) =>
      `${a.kind}:${JSON.stringify(a.subject ?? null)}`.localeCompare(
        `${b.kind}:${JSON.stringify(b.subject ?? null)}`,
      ),
    ),
    combinationConstraints: plan.combinationConstraints,
    maxSensitivity: plan.maxSensitivity,
  };
  return createHash("sha256")
    .update(JSON.stringify(material), "utf8")
    .digest("hex");
}

export function createContextFirewall(
  dependencies: ContextFirewallDependencies,
): ContextFirewallPort {
  const {
    authorization,
    disclosure,
    resolvers,
    relationshipParties,
    documents,
    capital,
    clock,
    logger,
  } = dependencies;
  const resolution = { resolvers, relationshipParties, documents, capital };

  /** Builds the candidates a subject contributes for the task. */
  async function candidatesFor(
    actor: ActorContext,
    capability: ContextFirewallRequest["capability"],
    subject: ResolvedSubject,
  ): Promise<{ candidates: Candidate[]; denied: QDeniedScope[] }> {
    const candidates: Candidate[] = [];
    const denied: QDeniedScope[] = [];
    const base: QScopeFilter = { tenantId: subject.tenantId };

    for (const kind of candidateScopeKinds(capability, subject.kind)) {
      const spec = SCOPE_CATALOGUE[kind];
      switch (kind) {
        case "COMPANY_PROFILE":
          candidates.push({
            spec,
            subject,
            resource: subject.resource,
            filter: { ...base, companyId: subject.companyId },
            labels: undefined,
          });
          break;

        case "COMPANY_CAPITAL_OBJECTIVE": {
          // The CURRENT objective of the company, looked up in the
          // company's own tenant. None → the scope is simply not relevant.
          let objectiveId = subject.capitalObjectiveId;
          if (objectiveId === undefined && subject.companyId !== undefined) {
            const current = await capital.getCurrentForCompany(
              subject.tenantId,
              subject.companyId as never,
            );
            objectiveId = current?.id;
          }
          if (objectiveId === undefined) {
            denied.push({
              kind,
              subject: subject.ref,
              reason: "SCOPE_NOT_RELEVANT",
            });
            break;
          }
          candidates.push({
            spec,
            subject,
            resource: { type: "capital_objective", id: objectiveId },
            filter: {
              ...base,
              ...(subject.companyId === undefined
                ? {}
                : { companyId: subject.companyId }),
              capitalObjectiveId: objectiveId,
            },
            labels: undefined,
          });
          break;
        }

        case "COMPANY_PRIVATE_FINANCIALS":
        case "EVIDENCE_DOCUMENTS":
          candidates.push({
            spec,
            subject,
            resource: null,
            filter: {
              ...base,
              ...(subject.ownerOrganisationId === null
                ? {}
                : { organisationId: subject.ownerOrganisationId }),
              ...(subject.companyId === undefined
                ? {}
                : { companyId: subject.companyId }),
              ...(kind === "EVIDENCE_DOCUMENTS"
                ? { contextLabels: ["founder_private", "organisation_private"] }
                : {}),
            },
            labels: undefined,
          });
          break;

        case "INVESTOR_PROFILE":
        case "INVESTOR_MANDATE":
          candidates.push({
            spec,
            subject,
            resource: kind === "INVESTOR_PROFILE" ? subject.resource : null,
            filter: {
              ...base,
              investorOrganisationId: subject.investorOrganisationId,
            },
            labels: undefined,
          });
          break;

        case "RELATIONSHIP_CONTEXT":
          candidates.push({
            spec,
            subject,
            resource: null,
            filter: {
              ...base,
              ...(subject.relationshipId === undefined
                ? {}
                : { relationshipIds: [subject.relationshipId] }),
              contextLabels:
                subject.relationshipSide === undefined
                  ? []
                  : [...relationshipLabelsFor(subject.relationshipSide)],
            },
            labels: undefined,
          });
          break;

        case "OWN_Q_CONVERSATION":
          candidates.push({
            spec,
            subject,
            resource: null,
            filter: { tenantId: actor.tenantId, userId: actor.userId },
            labels: undefined,
          });
          break;

        case "NETWORK_VISIBLE_DATA":
        case "PUBLIC_EXTERNAL_DATA":
        case "GENERAL_MODEL_KNOWLEDGE":
          break;
      }
    }
    return { candidates, denied };
  }

  function actorWide(
    actor: ActorContext,
    capability: ContextFirewallRequest["capability"],
  ): Candidate[] {
    return actorWideScopeKinds(capability).map((kind) => ({
      spec: SCOPE_CATALOGUE[kind],
      subject: null,
      resource: null,
      filter:
        kind === "OWN_Q_CONVERSATION"
          ? { tenantId: actor.tenantId, userId: actor.userId }
          : { tenantId: actor.tenantId },
      labels: undefined,
    }));
  }

  /**
   * Stage 6-7: the permission layers. The owning side needs its capability
   * (and, where a disclosure resource exists, the disclosure layer's own
   * SAME_ORGANISATION/OWNER answer); every other side needs a disclosure
   * path — network, public, exact relationship party, explicit recipient —
   * or the scope is simply not held. Scopes with no disclosure resource are
   * owner-only by construction.
   */
  async function evaluate(
    actor: ActorContext,
    candidates: readonly Candidate[],
  ): Promise<Verdict[]> {
    const disclosureRequests: DisclosureAccessRequest[] = [];
    const disclosureIndex = new Map<number, number>();
    candidates.forEach((candidate, index) => {
      if (candidate.resource !== null && candidate.spec.sharedVia !== null) {
        disclosureIndex.set(index, disclosureRequests.length);
        disclosureRequests.push({
          principal: actorPrincipal(actor),
          resource: candidate.resource,
          requestedAccess: "view",
        });
      }
    });
    const disclosures =
      disclosureRequests.length === 0
        ? []
        : await disclosure.evaluateMany(disclosureRequests);

    const verdicts: Verdict[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const { spec, subject } = candidate;
      const relation: SubjectRelation = subject?.relation ?? "SELF";

      // Actor-wide scopes: held by any authenticated human context.
      if (subject === null) {
        verdicts.push(
          permit(candidate, relation, spec.defaultLabel, spec.ownerSensitivity),
        );
        continue;
      }

      // The relationship history: exact party membership, decided at
      // resolution, is the whole rule. Non-parties never reach here.
      if (spec.kind === "RELATIONSHIP_CONTEXT") {
        verdicts.push(
          subject.relationshipSide === undefined
            ? deny(spec, subject, "RELATIONSHIP_SCOPE_MISMATCH")
            : permit(
                candidate,
                relation,
                "relationship_shared",
                spec.ownerSensitivity,
              ),
        );
        continue;
      }

      if (relation === "OWNER" || relation === "SELF") {
        if (spec.ownerCapability !== null) {
          if (
            subject.ownerOrganisationId === null ||
            (subject.resource === null && spec.sharedVia !== null)
          ) {
            verdicts.push(deny(spec, subject, "OWNER_ONLY"));
            continue;
          }
          const decision = await authorization.authorize({
            actor,
            capability: spec.ownerCapability,
            resource: {
              kind: "RESOURCE",
              tenantId: subject.tenantId,
              organisationId: subject.ownerOrganisationId,
              resourceType: resourceTypeFor(spec.kind, subject),
              resourceId: resourceIdFor(candidate, subject),
            },
          });
          if (decision.outcome === "DENY") {
            verdicts.push(deny(spec, subject, "CAPABILITY_MISSING"));
            continue;
          }
          if (decision.outcome !== "ALLOW") {
            verdicts.push(deny(spec, subject, "CAPABILITY_REQUIREMENT_UNMET"));
            continue;
          }
        }
        const position = disclosureIndex.get(index);
        const disclosed =
          position === undefined ? undefined : disclosures[position];
        if (disclosed !== undefined && disclosed.outcome === "DENY") {
          verdicts.push(deny(spec, subject, denialForDisclosure(disclosed)));
          continue;
        }
        // The owner holds the scope under its intrinsic label (the class
        // the data lives in), whatever path the disclosure layer names:
        // same-organisation membership reaches founder_private material
        // without relabelling it. Disclosure is the second gate here, not
        // the label's source.
        verdicts.push(
          permit(candidate, relation, spec.defaultLabel, spec.ownerSensitivity),
        );
        continue;
      }

      // Not the owner: only a disclosure path can hold the scope.
      if (spec.sharedVia === null) {
        verdicts.push(deny(spec, subject, "OWNER_ONLY"));
        continue;
      }
      const position = disclosureIndex.get(index);
      const disclosed =
        position === undefined ? undefined : disclosures[position];
      if (disclosed === undefined) {
        verdicts.push(deny(spec, subject, "DISCLOSURE_DENIED"));
        continue;
      }
      if (disclosed.outcome === "DENY") {
        verdicts.push(deny(spec, subject, denialForDisclosure(disclosed)));
        continue;
      }
      verdicts.push(
        permit(
          candidate,
          relation,
          labelForDisclosure(disclosed, spec.defaultLabel),
          spec.sharedSensitivity,
        ),
      );
    }
    return verdicts;
  }

  function permit(
    candidate: Candidate,
    relation: SubjectRelation,
    label: QContextLabel,
    sensitivity: QSensitivityClass,
  ): Verdict {
    const { spec, subject } = candidate;
    return {
      permitted: true,
      scope: {
        kind: spec.kind,
        ...(subject === null ? {} : { subject: subject.ref }),
        contextLabel: label,
        sensitivity,
        layer: spec.layer,
        factCategories: [...spec.factCategories],
        projection: "FULL",
        rights: rightsFor(relation),
        filter: candidate.filter,
        isEvidence: spec.isEvidence,
      },
    };
  }

  return {
    plan: async (request): Promise<ContextFirewallDecision> => {
      const started = Date.now();
      const decision = await evaluateRequest(request);
      logger?.info(
        {
          qRunId: request.runId,
          correlationId: request.correlationId,
          policyVersion: CONTEXT_FIREWALL_POLICY_VERSION,
          outcome: decision.outcome,
          ...(decision.outcome === "AUTHORISED"
            ? {
                taskClass: decision.plan.purpose.taskClass,
                permittedScopeKinds: decision.plan.scopes.map((s) => s.kind),
                deniedReasons: decision.plan.denied.map((d) => d.reason),
                maxSensitivity: decision.plan.maxSensitivity,
                combinationRules: decision.plan.combinationConstraints.map(
                  (c) => c.ruleId,
                ),
              }
            : {
                reason: decision.reason,
                deniedReasons: decision.denied.map((d) => d.reason),
              }),
          durationMs: Date.now() - started,
        },
        "context firewall evaluated",
      );
      return decision;
    },
  };

  async function evaluateRequest(
    request: ContextFirewallRequest,
  ): Promise<ContextFirewallDecision> {
    // 1. Trusted actor. The shape is re-validated even though it is
    // server-resolved; a non-human principal holds nothing here.
    const parsedActor = ActorContextSchema.safeParse(request.actor);
    if (!parsedActor.success) {
      return { outcome: "DENIED", reason: "NON_HUMAN_ACTOR", denied: [] };
    }
    const actor = parsedActor.data;
    if (actor.actorType !== "HUMAN") {
      return { outcome: "DENIED", reason: "NON_HUMAN_ACTOR", denied: [] };
    }

    // 2. Active organisation, explicit. Entity subjects need one; nothing
    // picks a membership on the person's behalf.
    const needsOrganisation = request.subjects.some((subject) =>
      ENTITY_KINDS.has(subject.kind),
    );
    if (needsOrganisation && actor.organisationId === undefined) {
      return {
        outcome: "DENIED",
        reason: "ORGANISATION_CONTEXT_REQUIRED",
        denied: [],
      };
    }

    // 3. Subjects, each on its own. One that does not resolve for this
    // actor ends the request: a request about something the actor may not
    // reach gets no plan, and no partial plan can be used to pivot.
    const subjects: ResolvedSubject[] = [];
    for (const ref of request.subjects) {
      const resolved = await resolveSubject(resolution, actor, ref);
      if (!resolved.ok) {
        return { outcome: "DENIED", reason: resolved.reason, denied: [] };
      }
      subjects.push(resolved.subject);
    }

    // 4. Task class — derived, never declared.
    const taskClass = deriveTaskClass(
      request.capability,
      subjects.map((subject) => ({
        kind: subject.kind,
        relation: subject.relation,
      })),
    );

    // 5. Candidates: what this task may need at most.
    const candidates: Candidate[] = [];
    const denied: QDeniedScope[] = [];
    for (const subject of subjects) {
      const built = await candidatesFor(actor, request.capability, subject);
      candidates.push(...built.candidates);
      denied.push(...built.denied);
    }
    candidates.push(...actorWide(actor, request.capability));

    // 6-7. Permission layers.
    const verdicts = await evaluate(actor, candidates);
    let permitted: QAuthorisedKnowledgeScope[] = [];
    for (const verdict of verdicts) {
      if (verdict.permitted) {
        permitted.push(verdict.scope);
      } else {
        denied.push(verdict.denied);
      }
    }

    // 8. Sensitivity ceiling for the task. Inheritance is the plan's
    // maxSensitivity below: derived output carries the strongest source.
    const ceiling = sensitivityCeiling(taskClass);
    permitted = permitted.filter((scope) => {
      if (sensitivityWithin(scope.sensitivity, ceiling)) {
        return true;
      }
      denied.push({
        kind: scope.kind,
        ...(scope.subject === undefined ? {} : { subject: scope.subject }),
        reason: "SENSITIVITY_NOT_PERMITTED",
      });
      return false;
    });

    // 9. Combination risk.
    const relationOf = (scope: QAuthorisedKnowledgeScope): SubjectRelation => {
      if (scope.subject === undefined) {
        return "SELF";
      }
      const subject = subjects.find(
        (candidate) =>
          JSON.stringify(candidate.ref) === JSON.stringify(scope.subject),
      );
      return subject?.relation ?? "NETWORK";
    };
    const combined = applyCombinationRules(permitted, relationOf);
    permitted = [...combined.scopes];
    denied.push(...combined.denied);

    // 5b. Requested labels narrow, never widen.
    if (request.requestedLabels !== undefined) {
      const requested = new Set(request.requestedLabels);
      permitted = permitted.filter((scope) => {
        if (requested.has(scope.contextLabel)) {
          return true;
        }
        denied.push({
          kind: scope.kind,
          ...(scope.subject === undefined ? {} : { subject: scope.subject }),
          reason: "SCOPE_NOT_REQUESTED",
        });
        return false;
      });
    }

    // 10. A subject with nothing left is a request Q cannot serve at all.
    for (const subject of subjects) {
      if (!ENTITY_KINDS.has(subject.kind)) {
        continue;
      }
      const held = permitted.some(
        (scope) =>
          scope.subject !== undefined &&
          JSON.stringify(scope.subject) === JSON.stringify(subject.ref),
      );
      if (!held) {
        return { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied };
      }
    }
    if (permitted.length === 0) {
      return { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied };
    }

    // 11. The plan.
    const evaluatedAt = clock.now();
    const revalidateAfter = new Date(
      Date.parse(evaluatedAt) + CONTEXT_PLAN_REVALIDATE_AFTER_MS,
    ).toISOString();
    const maxSensitivity = permitted.reduce<QSensitivityClass>(
      (strongest, scope) => strongerSensitivity(strongest, scope.sensitivity),
      "PUBLIC",
    );
    const allowedLayers = [...new Set(permitted.map((scope) => scope.layer))];
    const draft: Omit<PermittedContextPlan, "fingerprint"> = {
      contractVersion: 1,
      policyVersion: CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      runId: request.runId,
      tenantId: actor.tenantId,
      actor: {
        userId: actor.userId,
        ...(actor.organisationId === undefined
          ? {}
          : { organisationId: actor.organisationId }),
      },
      purpose: { capability: request.capability, taskClass },
      subjects: [...request.subjects],
      scopes: permitted,
      denied: denied.slice(0, 64),
      maxSensitivity,
      allowedLayers,
      combinationConstraints: [...combined.constraints],
      evaluatedAt,
      revalidateAfter,
      revalidateOnResume: true,
    };
    const plan = PermittedContextPlanSchema.parse({
      ...draft,
      fingerprint: fingerprintOf(draft),
    });
    return { outcome: "AUTHORISED", plan };
  }
}

function resourceTypeFor(
  kind: QKnowledgeScopeKind,
  subject: ResolvedSubject,
): string {
  switch (kind) {
    case "COMPANY_PROFILE":
    case "COMPANY_PRIVATE_FINANCIALS":
    case "EVIDENCE_DOCUMENTS":
      return subject.kind === "DOCUMENT" ? "document" : "company";
    case "COMPANY_CAPITAL_OBJECTIVE":
      return "capital_objective";
    case "INVESTOR_PROFILE":
    case "INVESTOR_MANDATE":
      return "investor_organisation";
    case "RELATIONSHIP_CONTEXT":
      return "relationship";
    case "OWN_Q_CONVERSATION":
    case "NETWORK_VISIBLE_DATA":
    case "PUBLIC_EXTERNAL_DATA":
    case "GENERAL_MODEL_KNOWLEDGE":
      return "q_run";
  }
}

function resourceIdFor(candidate: Candidate, subject: ResolvedSubject): string {
  if (candidate.resource !== null) {
    return candidate.resource.id;
  }
  return (
    subject.documentId ??
    subject.capitalObjectiveId ??
    subject.companyId ??
    subject.investorOrganisationId ??
    subject.relationshipId ??
    subject.ref.kind
  );
}
