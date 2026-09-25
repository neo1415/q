import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  PROFILE_FINDING_KEYS,
  ProfileFindingsResponseSchema,
  QRunIdSchema,
  type LifecycleStatus,
  type ProfileFinding,
  type ProfileFindingsQuery,
  type ProfileFindingsResponse,
  type QSubjectRef,
} from "@capital-q/contracts";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import {
  EvidenceSourceIdSchema,
  type EvidenceService,
} from "@capital-q/evidence";
import {
  InvestorOrganisationIdSchema,
  type InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type { Logger } from "@capital-q/observability";
import {
  knowledgeConstraintsFor,
  type AuthorisedKnowledge,
  type KnowledgeQueryService,
} from "@capital-q/q-knowledge";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * What Q found about the person's own profile subject (BIZ-002).
 *
 * The profile page's "Q found" column. Read in the order the architecture
 * requires: the subject must be the actor's own (themselves, or a company
 * or investor organisation of their own organisation), then the Context
 * Firewall plans the read, and only then are knowledge rows touched --
 * under the plan's own-public-presence envelope and nothing wider. What
 * comes back is exactly what the presence build recorded, on ADR-001's
 * three axes, with the pages it cited; nothing is upgraded, merged with
 * the declared profile, or given a number.
 */

const FINDING_KEYS: ReadonlySet<string> = new Set(PROFILE_FINDING_KEYS);
const MAX_SOURCES = 5;

export type ProfileFindingsReader = {
  /** Null when the subject is not the actor's own, or cannot be read: one answer. */
  readonly read: (
    actor: ActorContext,
    query: ProfileFindingsQuery,
  ) => Promise<ProfileFindingsResponse | null>;
};

export type ProfileFindingsDependencies = {
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly firewall: ContextFirewallPort;
  readonly knowledge: KnowledgeQueryService;
  readonly evidence: Pick<EvidenceService, "getEvidenceSource">;
  readonly logger?: Logger | undefined;
};

function lifecycleOf(item: AuthorisedKnowledge): LifecycleStatus {
  if (item.disputed || item.object.status === "DISPUTED") return "DISPUTED";
  return item.freshness.stale ? "STALE" : "CURRENT";
}

export function createProfileFindingsReader(
  dependencies: ProfileFindingsDependencies,
): ProfileFindingsReader {
  const { companies, investors, firewall, knowledge, evidence, logger } =
    dependencies;

  /** The subject as the firewall names it, only when it is the actor's own. */
  const ownSubject = async (
    actor: ActorContext,
    query: ProfileFindingsQuery,
  ): Promise<QSubjectRef | null> => {
    switch (query.subjectType) {
      case "PERSON":
        return query.subjectId === actor.userId
          ? { kind: "USER", userId: actor.userId }
          : null;
      case "COMPANY": {
        const profile = await companies.findCanonicalCompanyProfile(
          CompanyIdSchema.parse(query.subjectId),
        );
        return profile !== null &&
          profile.tenantId === actor.tenantId &&
          actor.organisationId !== undefined &&
          profile.organisationId === actor.organisationId
          ? { kind: "COMPANY", companyId: profile.id }
          : null;
      }
      case "INVESTOR_ORGANISATION": {
        const identity = await investors.findCanonicalInvestorOrganisation(
          InvestorOrganisationIdSchema.parse(query.subjectId),
        );
        return identity !== null &&
          identity.tenantId === actor.tenantId &&
          actor.organisationId !== undefined &&
          identity.organisationId === actor.organisationId
          ? {
              kind: "INVESTOR_ORGANISATION",
              investorOrganisationId: identity.id,
            }
          : null;
      }
    }
  };

  const sourcesOf = async (
    actor: ActorContext,
    item: AuthorisedKnowledge,
  ): Promise<ProfileFinding["sources"]> => {
    const found: ProfileFinding["sources"][number][] = [];
    for (const sourceId of item.sourceIds.slice(0, MAX_SOURCES)) {
      try {
        // The evidence context's own read: its ownership and evidence.view
        // checks apply again, so a source the actor may not see is skipped.
        const source = await evidence.getEvidenceSource({
          actor,
          sourceId: EvidenceSourceIdSchema.parse(sourceId),
        });
        if (source.sourceUrl === null) continue;
        found.push({
          title: source.title,
          url: source.sourceUrl,
          retrievedAt: source.retrievedAt,
        });
      } catch {
        // A source that cannot be read is left out, never guessed.
      }
    }
    return found;
  };

  return {
    read: async (actor, query) => {
      const subject = await ownSubject(actor, query);
      if (subject === null) return null;
      const decision = await firewall.plan({
        actor,
        runId: QRunIdSchema.parse(randomUUID()),
        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        capability: "ANSWER",
        subjects: [subject],
      });
      if (decision.outcome !== "AUTHORISED") return null;
      const constraints = knowledgeConstraintsFor(decision.plan).filter(
        (constraint) => constraint.scopeKind === "OWN_PUBLIC_PRESENCE",
      );
      const items = await knowledge.currentForSubject(
        { tenantId: actor.tenantId, constraints },
        { subjectType: query.subjectType, subjectId: query.subjectId },
        { limit: 50 },
      );
      const findings: ProfileFinding[] = [];
      for (const item of items) {
        if (!FINDING_KEYS.has(item.object.knowledgeKey)) continue;
        if (findings.length >= 20) break;
        findings.push({
          id: item.object.id,
          key: item.object.knowledgeKey as ProfileFinding["key"],
          statement: item.object.statement.slice(0, 2000),
          truthClass: item.object.truthClass,
          evidenceStatus: item.object.evidenceStatus,
          lifecycleStatus: lifecycleOf(item),
          recordedAt: item.object.recordedAt,
          sources: await sourcesOf(actor, item),
        });
      }
      logger?.debug(
        { subjectType: query.subjectType, findings: findings.length },
        "profile findings read",
      );
      return ProfileFindingsResponseSchema.parse({
        subjectType: query.subjectType,
        subjectId: query.subjectId,
        findings,
      });
    },
  };
}
