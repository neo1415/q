import { randomUUID } from "node:crypto";

import type {
  ModelSensitivity,
  QFindingId,
  QOperatingMode,
  QSubjectRef,
  TenantModelPolicy,
  UtcTimestamp,
} from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { AuthorisedKnowledge } from "@capital-q/q-knowledge";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type CompanyAnalystV2Result,
  type CompanyAnalystV2Variables,
  type CompanyIntelligenceDimension,
  type PromptRegistry,
} from "@capital-q/q-core";
import {
  CompanyAnalystV2ResultSchema,
  COMPANY_INTELLIGENCE_DIMENSIONS,
} from "@capital-q/q-core";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
// One place decides what an EVIDENCE_SYNTHESIS call may cost and how long
// it may take. A specialist inventing its own budget would be a second,
// quieter answer to a question the gateway already governs (§99).
import { budgetForTaskClass } from "@capital-q/model-gateway/q";

import type {
  QSpecialist,
  QSpecialistBlockedReason,
  QSpecialistExecutionContext,
  QSpecialistProbe,
} from "../contracts.js";
import { assembleCompanyContext, type LabelledFact } from "./assembly.js";
import type {
  CompanyFinding,
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
} from "./contracts.js";
import {
  coverageByDimension,
  contradictionFindings,
  deterministicFindings,
  informationConfidence,
  institutionalNotes,
  materialChangeFindings,
  type DeterministicInput,
} from "./deterministic.js";
import { asksAboutChange, focusFromQuestion } from "./dimensions.js";
import type {
  CompanyCanonicalPort,
  CompanyEvidencePort,
  CompanyKnowledgePort,
} from "./ports.js";
import { validateModelFindings } from "./validation.js";

/**
 * The Company Intelligence specialist (CQ-Q-020).
 *
 * One bounded investigation, in this order and no other:
 *
 *   canonical structured state → authorised Q Knowledge → authorised
 *   hybrid retrieval → deterministic findings → ONE model call →
 *   validated model findings → structured result
 *
 * Three design commitments worth stating plainly, because each is a place
 * a company-analysis feature usually goes wrong:
 *
 *   - The model is asked once, for prose over facts somebody else
 *     authorised. Everything that could be got wrong in a way that
 *     flatters — which figures conflict, what is past its useful life,
 *     what changed, what is missing — is computed before the call and
 *     shown to the model as a frame it may not overturn (§20-§22, §100).
 *   - The specialist never fetches on its own initiative. Every read
 *     carries the Context Firewall's plan, and there is no path from a
 *     question to a wider scope, which is why "the founder-private runway
 *     silently lowered the investor's assessment" cannot happen here: the
 *     investor's run never held the figure (§46-§48).
 *   - It produces no score, no fit, no probability and no InvestIQ
 *     result. It is not that these are deferred — it is that Company
 *     Intelligence is the wrong place for them, and a second ungoverned
 *     answer to a governed question is worse than no answer (§4, §6,
 *     §68-§70).
 *
 * It speaks to Q, never to a person (§11, §57). Nothing here writes a
 * message, and nothing here carries a name a person could read.
 */

export const COMPANY_INTELLIGENCE_ID = "company-intelligence" as const;
export const COMPANY_INTELLIGENCE_VERSION = "v1" as const;

export type CompanyIntelligenceDependencies = {
  readonly gateway: ModelGateway;
  readonly canonical: CompanyCanonicalPort;
  readonly knowledge: CompanyKnowledgePort;
  readonly evidence: CompanyEvidencePort;
  readonly registry?: PromptRegistry | undefined;
  /**
   * How the request's sensitivity is declared to the gateway. FROM_PLAN in
   * production: the plan's ceiling is the strongest class this run may
   * reason over, and the gateway decides provider eligibility from it
   * BEFORE any provider is contacted (§45).
   */
  readonly sensitivity?:
    | { readonly kind: "FROM_PLAN" }
    | {
        readonly kind: "DECLARED_SYNTHETIC";
        readonly sensitivity: ModelSensitivity;
      }
    | undefined;
  /** Narrows provider eligibility for this composition; never widens it. */
  readonly tenantPolicy?: TenantModelPolicy | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
};

/** Keys whose series is worth reading for a change question. Bounded (§99). */
const CHANGE_KEYS: readonly string[] = [
  "financial.arr",
  "financial.mrr",
  "financial.revenue",
  "financial.burn_rate",
  "financial.cash_balance",
  "traction.customer_count",
  "team.size",
  "capital.objective",
];

/**
 * Company Intelligence is an assessment of a business from evidence, which
 * is what ASSESSMENT names. It is not a debrief, an investor view or a
 * continuous watch, and using one of those would change the charter's
 * framing to something this specialist is not doing.
 */
const OPERATING_MODE: QOperatingMode = "ASSESSMENT";

const meter = getMeter("q-specialists");
const metrics = {
  investigations: meter.createCounter("q.specialist.investigations"),
  rejectedFindings: meter.createCounter("q.specialist.rejected_findings"),
  rejectedCitations: meter.createCounter("q.specialist.rejected_citations"),
  blocked: meter.createCounter("q.specialist.blocked"),
};

function blockedResult(
  companyId: string,
  reason: QSpecialistBlockedReason,
  asOf: UtcTimestamp,
  telemetry: CompanyIntelligenceResult["telemetry"],
): CompanyIntelligenceResult {
  return {
    companyId,
    specialistVersion: `${COMPANY_INTELLIGENCE_ID}/${COMPANY_INTELLIGENCE_VERSION}`,
    asOf,
    blocked: reason,
    findings: [],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "INSUFFICIENT_EVIDENCE",
    synthesis: null,
    telemetry,
  };
}

export function createCompanyIntelligenceSpecialist(
  dependencies: CompanyIntelligenceDependencies,
): QSpecialist<CompanyIntelligenceRequest, CompanyIntelligenceResult> {
  const { gateway, canonical, knowledge, evidence, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const sensitivityPolicy = dependencies.sensitivity ?? { kind: "FROM_PLAN" };
  const now = dependencies.now ?? (() => new Date());

  return {
    id: COMPANY_INTELLIGENCE_ID,
    version: COMPANY_INTELLIGENCE_VERSION,

    /**
     * One company, its business, its evidence, its changes (§54).
     *
     * Deliberately narrow. Investor mandate synthesis, company-investor
     * fit, relationship history, meetings, calendars and general world
     * knowledge are other specialists' questions or nobody's, and a
     * specialist that claimed them would answer them badly rather than
     * decline them honestly.
     */
    supports: (probe: QSpecialistProbe): boolean => {
      const companies = probe.subjects.filter(
        (subject) => subject.kind === "COMPANY",
      );
      if (companies.length !== 1) {
        return false;
      }
      if (
        probe.subjects.some(
          (subject) =>
            subject.kind === "INVESTOR_ORGANISATION" ||
            subject.kind === "RELATIONSHIP",
        )
      ) {
        // A question with an investor or a relationship in it is a
        // question about fit or about a relationship. Neither is this.
        return false;
      }
      return (
        probe.capability === "ANSWER" ||
        probe.capability === "INVESTIGATE" ||
        probe.capability === "ASSESS"
      );
    },

    investigate: async (
      request: CompanyIntelligenceRequest,
      context: QSpecialistExecutionContext,
    ): Promise<CompanyIntelligenceResult> => {
      const started = Date.now();
      // Read fresh each time: control-flow narrowing must not cache an
      // earlier answer to "has this run been cancelled" (§101).
      const cancelled = (): boolean => context.signal?.aborted === true;
      const companyId = request.company.companyId;
      const asOfStamp = now().toISOString();
      const subjects: readonly QSubjectRef[] = [request.company];
      // Findings are run output, not durable records, so their identity is
      // fresh per run. The seed is kept for readability at the call sites.
      const findingId = (_seed: string): QFindingId =>
        randomUUID() as QFindingId;

      let telemetry: CompanyIntelligenceResult["telemetry"] = {
        specialistId: COMPANY_INTELLIGENCE_ID,
        specialistVersion: COMPANY_INTELLIGENCE_VERSION,
        promptBundleVersion: null,
        providerCode: null,
        modelCode: null,
        routingPolicyCode: null,
        modelCalls: 0,
        retrievalCalls: 0,
        knowledgeReads: 0,
        toolCalls: 0,
        factCount: 0,
        promptCharacters: 0,
        latencyMs: 0,
        costUsd: 0,
        findingCountsByType: {},
        evidenceRefCount: 0,
        contradictionCount: 0,
        gapCount: 0,
        uncertaintyCount: 0,
        staleFactCount: 0,
        rejectedFindingCount: 0,
        rejectedCitationCount: 0,
      };
      const finish = (
        result: CompanyIntelligenceResult,
      ): CompanyIntelligenceResult => ({
        ...result,
        telemetry: { ...result.telemetry, latencyMs: Date.now() - started },
      });

      if (cancelled()) {
        return finish(
          blockedResult(companyId, "CANCELLED", asOfStamp, telemetry),
        );
      }

      // ---- 1. canonical structured state (§15) ---------------------------
      const canonicalRead = await canonical.read(
        {
          actor: context.actor,
          runId: context.runId,
          correlationId: context.correlationId,
          capability: context.capability,
          plan: context.plan,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        },
        companyId,
      );
      telemetry = { ...telemetry, toolCalls: canonicalRead.toolCalls };
      if (!canonicalRead.available) {
        // Absent, cross-tenant, unshared and out-of-plan are one answer.
        // A specialist that could distinguish them would leak existence.
        metrics.blocked.add(1, { reason: "NO_AUTHORISED_SUBJECT" });
        return finish(
          blockedResult(
            companyId,
            "NO_AUTHORISED_SUBJECT",
            asOfStamp,
            telemetry,
          ),
        );
      }

      // ---- 2. authorised Q Knowledge (§16) -------------------------------
      const [current, disputes] = await Promise.all([
        knowledge.current(context.plan, companyId),
        knowledge.disputes(context.plan, companyId),
      ]);
      let knowledgeReads = 2;

      // A historical question is answered from valid time. The current
      // readings are replaced, not supplemented, so nothing about a later
      // period can reach the answer (§65, §81).
      const historical: AuthorisedKnowledge[] = [];
      if (request.asOf !== undefined) {
        for (const key of new Set(current.map((k) => k.object.knowledgeKey))) {
          const at = await knowledge.asOf(
            context.plan,
            companyId,
            key,
            request.asOf,
          );
          knowledgeReads += 1;
          if (at !== null) {
            historical.push(at);
          }
        }
      }
      const readings = request.asOf === undefined ? current : historical;

      // ---- series, only when the question is about change (§22, §67) ----
      const series = new Map<string, readonly AuthorisedKnowledge[]>();
      if (request.asOf === undefined && asksAboutChange(request.question)) {
        const present = new Set(current.map((k) => k.object.knowledgeKey));
        for (const key of CHANGE_KEYS) {
          if (!present.has(key)) {
            continue;
          }
          const history = await knowledge.series(context.plan, companyId, key);
          knowledgeReads += 1;
          if (history.length > 1) {
            series.set(key, history);
          }
        }
      }
      telemetry = { ...telemetry, knowledgeReads };

      if (cancelled()) {
        return finish(
          blockedResult(companyId, "CANCELLED", asOfStamp, telemetry),
        );
      }

      // ---- 3. authorised hybrid retrieval (§17) --------------------------
      // One search, with the person's own words. No model is spent
      // rewriting the query: a deterministic query is one fewer place for
      // an injected instruction to be laundered into a search.
      const hits = await evidence.search(
        context.plan,
        request.question,
        context.signal,
      );
      telemetry = { ...telemetry, retrievalCalls: 1 };

      const assembled = assembleCompanyContext({
        plan: context.plan,
        canonicalFacts: canonicalRead.facts,
        knowledge: readings,
        passages: hits,
        subjectDescription:
          canonicalRead.canonicalName === null
            ? "a company available in this conversation"
            : `${canonicalRead.canonicalName}, a company available in this conversation`,
      });
      telemetry = { ...telemetry, factCount: assembled.facts.length };

      // ---- deterministic findings (§20-§23, §37, §40) --------------------
      const requested = new Set<CompanyIntelligenceDimension>([
        ...(request.focus ?? []).filter(
          (focus): focus is CompanyIntelligenceDimension =>
            (COMPANY_INTELLIGENCE_DIMENSIONS as readonly string[]).includes(
              focus,
            ),
        ),
        ...focusFromQuestion(request.question),
      ]);
      const deterministicInput: DeterministicInput = {
        knowledge: readings,
        disputes,
        series,
        facts: assembled.facts,
        runId: context.runId,
        subjects,
        // A finding inherits the classification of the context it was made
        // from. It is never filed more openly than what it is about.
        sensitivity: context.plan.maxSensitivity,
        visibilityScope: "organisation_private",
        validAt: asOfStamp,
        findingId,
      };
      const computed = deterministicFindings(deterministicInput, requested);
      const contradictions = contradictionFindings(deterministicInput);
      const changes = materialChangeFindings(deterministicInput);
      const staleKeys = readings
        .filter((reading) => reading.freshness.stale)
        .map((reading) => reading.object.knowledgeKey);

      // ---- 4. one model call (§43, §100) ---------------------------------
      const notes = institutionalNotes({
        disputes,
        staleKeys,
        changes,
        asOf: request.asOf ?? null,
      });
      const variables: Omit<
        CompanyAnalystV2Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        capability: context.capability,
        userMessage: request.question,
        conversation: [],
        authorisedFacts: assembled.facts.map((fact) => fact.fact),
        subjectDescription: assembled.subjectDescription,
        institutionalNotes: notes,
      };
      const rendered = renderPrompt<CompanyAnalystV2Variables>(registry, {
        task: "COMPANY_ANALYST",
        operatingMode: OPERATING_MODE,
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          assembled.facts.length === 0
            ? "No authorised facts about this company are available in this context. Say so plainly; do not answer from general knowledge."
            : `${String(assembled.facts.length)} authorised facts are supplied. No tools are available to you and no scoring service exists; do not produce scores.`,
        variables,
      });
      telemetry = {
        ...telemetry,
        promptBundleVersion: rendered.bundle.bundleVersion,
        promptCharacters: rendered.characters,
      };

      let analyst: CompanyAnalystV2Result | undefined;
      let blocked: QSpecialistBlockedReason | null = null;
      try {
        const result = await gateway.execute<CompanyAnalystV2Result>(
          {
            taskClass: "EVIDENCE_SYNTHESIS",
            budget: budgetForTaskClass("EVIDENCE_SYNTHESIS"),
            sensitivity:
              sensitivityPolicy.kind === "FROM_PLAN"
                ? context.plan.maxSensitivity
                : sensitivityPolicy.sensitivity,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: context.actor.tenantId,
              userId: context.actor.userId,
              qRunId: context.runId,
              correlationId: context.correlationId,
            },
            ...(dependencies.tenantPolicy === undefined
              ? {}
              : { tenantPolicy: dependencies.tenantPolicy }),
          },
          {
            schema: CompanyAnalystV2ResultSchema,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          },
        );
        telemetry = {
          ...telemetry,
          modelCalls: 1,
          providerCode: result.providerCode,
          modelCode: result.modelCode,
          routingPolicyCode: result.routingPolicyCode,
          costUsd: result.cost.amount,
        };
        if (result.output.kind === "STRUCTURED") {
          analyst = result.output.value;
        } else {
          blocked = "MODEL_OUTPUT_REJECTED";
        }
      } catch (error: unknown) {
        telemetry = { ...telemetry, modelCalls: 1 };
        if (isModelGatewayError(error)) {
          // POLICY_INELIGIBLE with no attempt means no configured provider
          // may receive context this sensitive. That is a correct refusal,
          // not an outage, and it must never be worked around by sending
          // the context somewhere less suitable (§45).
          blocked =
            error.failureClass === "POLICY_INELIGIBLE"
              ? "NO_ELIGIBLE_MODEL_ROUTE"
              : error.failureClass === "CANCELLED"
                ? "CANCELLED"
                : "MODEL_UNAVAILABLE";
          logger?.warn(
            {
              qRunId: context.runId,
              specialist: COMPANY_INTELLIGENCE_ID,
              specialistVersion: COMPANY_INTELLIGENCE_VERSION,
              failureClass: error.failureClass,
              routingPolicy: error.routingPolicyCode,
              attempts: error.attempts,
            },
            "company intelligence produced no model findings",
          );
        } else {
          throw error;
        }
      }

      // ---- 5. validate what the model wrote (§61, §89) --------------------
      let findings: readonly CompanyFinding[] = computed;
      let synthesis: string | null = null;
      let rejectedFindingCount = 0;
      let rejectedCitationCount = 0;
      if (analyst !== undefined) {
        const validation = validateModelFindings({
          findings: analyst.companyFindings,
          context: assembled,
          runId: context.runId,
          subjects,
          sensitivity: context.plan.maxSensitivity,
          visibilityScope: "organisation_private",
          validAt: asOfStamp,
          findingId: (index) => findingId(`model:${String(index)}`),
        });
        findings = [...computed, ...validation.accepted];
        rejectedFindingCount = validation.rejectedFindings;
        rejectedCitationCount = validation.rejectedCitations;
        synthesis = analyst.answer;
        metrics.rejectedFindings.add(validation.rejectedFindings);
        metrics.rejectedCitations.add(validation.rejectedCitations);
      }

      const countsByType: Record<string, number> = {};
      for (const finding of findings) {
        countsByType[finding.type] = (countsByType[finding.type] ?? 0) + 1;
      }
      const stale = assembled.facts.filter((fact) => fact.stale).length;

      telemetry = {
        ...telemetry,
        findingCountsByType: countsByType,
        evidenceRefCount: findings.reduce(
          (total, finding) => total + finding.evidenceRefs.length,
          0,
        ),
        contradictionCount: contradictions.length,
        gapCount: countsByType["GAP"] ?? 0,
        uncertaintyCount: countsByType["UNCERTAINTY"] ?? 0,
        staleFactCount: stale,
        rejectedFindingCount,
        rejectedCitationCount,
      };

      metrics.investigations.add(1, {
        capability: context.capability,
        blocked: blocked === null ? "NO" : blocked,
      });
      // Counts, codes and identifiers only. No statement, no fact, no
      // excerpt, no prompt and no model output (§102).
      logger?.info(
        {
          qRunId: context.runId,
          specialist: COMPANY_INTELLIGENCE_ID,
          specialistVersion: COMPANY_INTELLIGENCE_VERSION,
          promptBundleVersion: telemetry.promptBundleVersion,
          provider: telemetry.providerCode,
          model: telemetry.modelCode,
          facts: assembled.facts.length,
          findings: findings.length,
          contradictions: contradictions.length,
          gaps: telemetry.gapCount,
          uncertainties: telemetry.uncertaintyCount,
          stale,
          rejectedFindings: rejectedFindingCount,
          rejectedCitations: rejectedCitationCount,
          modelCalls: telemetry.modelCalls,
          retrievalCalls: telemetry.retrievalCalls,
          knowledgeReads: telemetry.knowledgeReads,
          blocked,
        },
        "company intelligence completed",
      );

      return finish({
        companyId,
        specialistVersion: `${COMPANY_INTELLIGENCE_ID}/${COMPANY_INTELLIGENCE_VERSION}`,
        asOf: asOfStamp,
        blocked,
        findings,
        coverage: coverageByDimension(assembled.facts, findings),
        materialChanges: changes,
        contradictions,
        informationConfidence: informationConfidence(assembled.facts, disputes),
        synthesis,
        telemetry,
      });
    },
  };
}

/** Re-exported so a composition root can bound its own fact budget. */
export type { LabelledFact };
