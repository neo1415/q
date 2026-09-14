import type { PermittedContextPlan } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { AuthorisedFact } from "@capital-q/q-core";
import {
  envelopeFromPlan,
  knowledgeConstraintsFor,
  type AuthorisedKnowledge,
  type AuthorisedRetrievalService,
  type KnowledgeQueryService,
  type RetrievalHit,
} from "@capital-q/q-knowledge";
import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";

import type {
  CompanyCanonicalPort,
  CompanyEvidencePort,
  CompanyKnowledgePort,
  CompanyResearchPort,
  CompanyResearchRead,
  PublicWebComparisonNote,
  PublicWebSource,
} from "./ports.js";

/**
 * The specialist's ports over the real Capital Q services (CQ-Q-020 §50).
 *
 * Each adapter is a thin translation and nothing else — it decides no
 * permission, holds no credential and composes no statement. The
 * authorities are where they already were: the Tool Registry authorises a
 * canonical read, the knowledge query service applies the plan's envelope,
 * and the retrieval service applies it again.
 */

/** Bounded: enough context to reason with, not a dump of the corpus (§99). */
export const COMPANY_KNOWLEDGE_LIMIT = 40;
export const COMPANY_PASSAGE_LIMIT = 8;

/**
 * Canonical structured state through the Safe Read tools (§15, §92).
 *
 * The tools are called deterministically, not offered to the model. The
 * model therefore cannot choose to read a different company, cannot
 * propose a call the plan did not admit, and cannot be talked into one by
 * text inside a document — the calls are decided before it is asked
 * anything.
 */
export function createToolCanonicalPort(
  tools: QToolPort,
  logger?: Logger,
): CompanyCanonicalPort {
  return {
    read: async (context: QToolExecutionContext, companyId: string) => {
      const offered = await tools.offer(context);
      const names = new Set(offered.map((tool) => tool.definition.name));
      const facts: AuthorisedFact[] = [];
      let toolCalls = 0;
      let available = false;
      let canonicalName: string | null = null;

      if (names.has("get_company")) {
        toolCalls += 1;
        const outcome = await tools.execute(
          {
            callId: "specialist-company",
            name: "get_company",
            arguments: { companyId },
          },
          context,
        );
        if (outcome.result.ok) {
          const company = outcome.result.data as {
            canonicalName: string;
            shortDescription: string | null;
            primaryDescription: string | null;
            currentStageCode: string | null;
            headquartersCountry: string | null;
            headquartersCity: string | null;
            foundedDate: string | null;
            websiteUrl: string | null;
          };
          available = true;
          canonicalName = company.canonicalName;
          const identity = [
            `Canonical name: ${company.canonicalName}.`,
            company.currentStageCode === null
              ? null
              : `Current stage: ${company.currentStageCode}.`,
            company.headquartersCountry === null
              ? null
              : `Headquarters: ${[company.headquartersCity, company.headquartersCountry].filter((part) => part !== null).join(", ")}.`,
            company.foundedDate === null
              ? null
              : `Founded: ${company.foundedDate}.`,
            company.websiteUrl === null
              ? null
              : `Website: ${company.websiteUrl}.`,
          ]
            .filter((line): line is string => line !== null)
            .join(" ");
          facts.push({
            scope: "COMPANY_PROFILE",
            statement: identity,
            // Profile fields are what the company declared about itself.
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            source: "Capital Q canonical company record",
          });
          const description =
            company.primaryDescription ?? company.shortDescription;
          if (description !== null && description.trim().length > 0) {
            facts.push({
              scope: "COMPANY_PROFILE",
              statement: description,
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              source: "Capital Q canonical company record",
            });
          }
        }
      }

      if (names.has("get_capital_objective")) {
        toolCalls += 1;
        const outcome = await tools.execute(
          {
            callId: "specialist-objective",
            name: "get_capital_objective",
            arguments: { companyId },
          },
          context,
        );
        if (outcome.result.ok) {
          const payload = outcome.result.data as {
            objective: {
              objectiveType: string;
              status: string;
              target: { amount?: string; currency?: string } | null;
              targetStage: string | null;
              instrumentCode: string | null;
              targetCloseDate: string | null;
            } | null;
          };
          // Null means the company has no current objective. Unknown stays
          // unknown: nothing here turns an absent objective into "not
          // raising", which would be an assertion nobody made.
          if (payload.objective !== null) {
            const objective = payload.objective;
            const amount =
              objective.target === null
                ? null
                : `${objective.target.amount ?? ""} ${objective.target.currency ?? ""}`.trim();
            facts.push({
              scope: "CAPITAL_OBJECTIVE",
              statement: [
                `Current capital objective: ${objective.objectiveType}, status ${objective.status}`,
                amount === null || amount.length === 0
                  ? null
                  : `target ${amount}`,
                objective.targetStage === null
                  ? null
                  : `stage ${objective.targetStage}`,
                objective.instrumentCode === null
                  ? null
                  : `instrument ${objective.instrumentCode}`,
                objective.targetCloseDate === null
                  ? null
                  : `target close ${objective.targetCloseDate}`,
              ]
                .filter((part): part is string => part !== null)
                .join(", "),
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              // Said out loud, because a document may disagree and this is
              // the reading that wins (§15, §92).
              source:
                "Capital Q canonical capital objective — the authoritative current state, which takes precedence over any document",
            });
          }
        }
      }

      logger?.debug(
        { companyId, toolCalls, available },
        "canonical company state read",
      );
      return { facts, toolCalls, available, canonicalName };
    },
  };
}

/** Authorised Q Knowledge reads under the plan's own envelope (§16, §46). */
export function createKnowledgeCompanyPort(
  knowledge: KnowledgeQueryService,
): CompanyKnowledgePort {
  const scope = (plan: PermittedContextPlan) => ({
    tenantId: plan.tenantId,
    constraints: knowledgeConstraintsFor(plan),
  });
  const subject = (companyId: string) =>
    ({ subjectType: "COMPANY", subjectId: companyId }) as const;

  return {
    current: async (
      plan,
      companyId,
    ): Promise<readonly AuthorisedKnowledge[]> => {
      const constraints = knowledgeConstraintsFor(plan);
      if (constraints.length === 0) {
        return [];
      }
      return knowledge.currentForSubject(scope(plan), subject(companyId), {
        limit: COMPANY_KNOWLEDGE_LIMIT,
      });
    },
    disputes: async (plan, companyId) => {
      const constraints = knowledgeConstraintsFor(plan);
      if (constraints.length === 0) {
        return [];
      }
      return knowledge.disputesForSubject(scope(plan), subject(companyId));
    },
    series: async (plan, companyId, knowledgeKey) => {
      const constraints = knowledgeConstraintsFor(plan);
      if (constraints.length === 0) {
        return [];
      }
      return knowledge.historyForKey(
        scope(plan),
        subject(companyId),
        knowledgeKey,
        { limit: 8 },
      );
    },
    asOf: async (plan, companyId, knowledgeKey, at) => {
      const constraints = knowledgeConstraintsFor(plan);
      if (constraints.length === 0) {
        return null;
      }
      return knowledge.asOfForKey(
        scope(plan),
        subject(companyId),
        knowledgeKey,
        at,
      );
    },
  };
}

/**
 * Authorised hybrid retrieval (§17).
 *
 * One search per investigation, with the person's own words as the query.
 * A plan reaching no chunk-backed scope returns nothing rather than
 * widening: an empty result and a denied envelope are indistinguishable
 * from outside, which is what keeps source existence private (§86).
 */
export function createRetrievalEvidencePort(
  retrieval: AuthorisedRetrievalService,
  logger?: Logger,
): CompanyEvidencePort {
  return {
    search: async (
      plan: PermittedContextPlan,
      query: string,
      signal?: AbortSignal,
    ): Promise<readonly RetrievalHit[]> => {
      const envelope = envelopeFromPlan(plan);
      if (envelope.constraints.length === 0) {
        return [];
      }
      const result = await retrieval.retrieve({
        query,
        envelope,
        ...(signal === undefined ? {} : { signal }),
      });
      logger?.debug(
        { hits: result.hits.length, degraded: result.degraded },
        "company intelligence retrieval",
      );
      return result.hits.slice(0, COMPANY_PASSAGE_LIMIT);
    },
  };
}

/**
 * Public-web research through the Tool Registry (CQ-Q-RESEARCH-001 §24).
 *
 * Called deterministically, like the canonical read: the specialist decides
 * from the person's words whether to research at all, the registry decides
 * whether this run may, and the research capability decides what leaves.
 * The model is never offered the tool and cannot be talked into a search
 * by text inside a document or a page. A tool that is not offered to this
 * run is reported as such; nothing is sent.
 */
export function createToolResearchPort(
  tools: QToolPort,
  logger?: Logger,
): CompanyResearchPort {
  return {
    research: async (context: QToolExecutionContext, input) => {
      const offered = await tools.offer(context);
      if (
        !offered.some((tool) => tool.definition.name === "research_public_web")
      ) {
        return {
          status: "NOT_OFFERED",
          message: null,
          sources: [],
          comparison: [],
          toolCalls: 0,
        };
      }
      const outcome = await tools.execute(
        {
          callId: "specialist-research",
          name: "research_public_web",
          arguments: {
            // The person's words, bounded. The tool composes the real query
            // from these and the authorised identity; private tokens drop.
            query: input.question.trim().slice(0, 200) || "company",
            companyId: input.companyId,
          },
        },
        context,
      );
      if (!outcome.result.ok) {
        // Denied or failed reads are one plain outcome; the reason stays in
        // the tool's own telemetry.
        logger?.debug(
          { qRunId: context.runId, status: outcome.status },
          "public research not available to this investigation",
        );
        return {
          status: "NOT_OFFERED",
          message: null,
          sources: [],
          comparison: [],
          toolCalls: 1,
        };
      }
      const data = outcome.result.data as {
        status: CompanyResearchRead["status"];
        message: string | null;
        sources: readonly PublicWebSource[];
        comparison: readonly PublicWebComparisonNote[];
      };
      const read: CompanyResearchRead = {
        status: data.status,
        message: data.message,
        sources: data.sources.map((source) => ({
          index: source.index,
          url: source.url,
          domain: source.domain,
          title: source.title,
          publishedAt: source.publishedAt,
          retrievedAt: source.retrievedAt,
          temporal: source.temporal,
          excerpt: source.excerpt,
          isSubjectWebsite: source.isSubjectWebsite,
          mentionedCountries: [...source.mentionedCountries],
          instructionRiskSignals: source.instructionRiskSignals,
          recordedAsEvidence: source.recordedAsEvidence,
        })),
        comparison: data.comparison.map((note) => ({ ...note })),
        toolCalls: 1,
      };
      logger?.debug(
        {
          qRunId: context.runId,
          status: read.status,
          sources: read.sources.length,
          comparison: read.comparison.length,
        },
        "public research read",
      );
      return read;
    },
  };
}
