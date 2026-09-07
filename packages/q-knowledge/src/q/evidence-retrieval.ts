import type { PermittedContextPlan, QRunId } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { AuthorisedFact } from "@capital-q/q-core";
import type {
  QOrchestrationSubjectContext,
  QRetrievalOutcome,
  QRetrievalPort,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import type { TenantId } from "@capital-q/security";

import {
  assembleAuthorisedFacts,
  describeRetrieval,
} from "../retrieval/assembler.js";
import type { AuthorisedRetrievalResult } from "../retrieval/contracts.js";
import { envelopeFromPlan } from "../retrieval/envelope.js";
import type { ChunkHydrationPort } from "../retrieval/ports.js";
import type { AuthorisedRetrievalService } from "../retrieval/service.js";
import {
  knowledgeConstraintsFor,
  type KnowledgeQueryService,
} from "../knowledge/query.js";

/**
 * The Q seam (CQ-RAG-004 §35, §37, §55).
 *
 * Two ports over one retrieval service, in the shape CQ-Q-004 and CQ-Q-007
 * already established: the package that owns the capability implements the
 * runtime's port, and the runtime learns nothing about the database
 * underneath.
 *
 *   retrieval seam — runs immediately after the Context Firewall
 *     revalidates. It receives identifiers and, by deliberate design, no
 *     message text, so it cannot search. What it can establish honestly is
 *     whether this plan reaches any source material at all.
 *
 *   context seam — runs inside the answer, where the run's conversation is
 *     available. It performs the one search of the run and returns bounded,
 *     source-labelled facts.
 *
 * There is no cache between them and none anywhere else in this packet.
 * Each answer re-derives the envelope from the plan it was handed, which is
 * the plan the firewall produced moments earlier; a revoked share or a
 * switched organisation therefore takes effect on the next answer rather
 * than being remembered from the last one.
 */

export type QEvidenceRetrievalDependencies = {
  readonly sql: DatabaseExecutor;
  readonly repositories: QRuntimeRepositories;
  readonly retrieval: AuthorisedRetrievalService;
  readonly hydration: ChunkHydrationPort;
  /**
   * Authorised knowledge reads (CQ-KNW-002 §23, §34). Optional: an
   * environment without a knowledge store still answers from documents.
   */
  readonly knowledge?: KnowledgeQueryService | undefined;
  readonly logger?: Logger | undefined;
};

/**
 * Structurally the model gateway's `QAuthorisedContextPort`. Declared here
 * rather than imported so the knowledge context does not depend on the
 * gateway; the composition root satisfies both.
 */
export type QAuthorisedEvidenceContext = {
  readonly assemble: (request: {
    readonly runId: QRunId;
    readonly tenantId: TenantId;
    readonly plan: PermittedContextPlan;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<{
    readonly facts: readonly AuthorisedFact[];
    readonly subjectDescription: string;
  }>;
};

export type QEvidenceRetrieval = {
  readonly port: QRetrievalPort;
  readonly context: QAuthorisedEvidenceContext;
  /** The last result, for developer smokes and evals. Never a public path. */
  readonly lastResult: () => AuthorisedRetrievalResult | null;
};

/** Bounded: "is there anything at all?" does not need an exact count. */
const CORPUS_PROBE_LIMIT = 100;

export function createQEvidenceRetrieval(
  dependencies: QEvidenceRetrievalDependencies,
): QEvidenceRetrieval {
  const { sql, repositories, retrieval, hydration, knowledge, logger } =
    dependencies;
  let last: AuthorisedRetrievalResult | null = null;

  const port: QRetrievalPort = {
    retrieve: async (
      request: QOrchestrationSubjectContext,
      plan: PermittedContextPlan,
    ): Promise<QRetrievalOutcome> => {
      const envelope = envelopeFromPlan(plan);
      // A plan that reaches no chunk-backed scope is not a failure: this
      // actor's authorised context for this purpose is canonical structured
      // state, and the answer is built from tools rather than documents.
      const references =
        envelope.constraints.length === 0
          ? 0
          : await hydration.countAuthorised(sql, {
              tenantId: envelope.tenantId,
              constraints: envelope.constraints,
              limit: CORPUS_PROBE_LIMIT,
            });
      // Counts and identifiers only. The number stays on the server: the
      // graph checkpoints the outcome's kind and nothing else.
      logger?.debug(
        {
          qRunId: request.runId,
          planId: plan.planId,
          constraints: envelope.constraints.length,
        },
        "authorised retrieval scope resolved",
      );
      return { kind: "AUTHORISED_REFERENCES", referenceCount: references };
    },
  };

  const context: QAuthorisedEvidenceContext = {
    assemble: async (request) => {
      const envelope = envelopeFromPlan(request.plan);
      if (envelope.constraints.length === 0) {
        return {
          facts: [],
          subjectDescription:
            "no authorised source documents are available for this question; answer from canonical state and the conversation, and say plainly when you cannot",
        };
      }

      // The person's own words are the query. No model is spent rewriting
      // them: decomposition is a later specialist's job, and a deterministic
      // query is one fewer place for an injected instruction to be laundered
      // into a search.
      const history = await repositories.messages.listForRun(
        sql,
        request.tenantId,
        request.runId,
        8,
      );
      const latest = [...history].reverse().find((m) => m.role === "USER");
      if (latest === undefined) {
        return {
          facts: [],
          subjectDescription: "no question was available to search for",
        };
      }

      const result = await retrieval.retrieve({
        query: latest.content,
        envelope,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      last = result;

      // The retrieval hierarchy (§23): canonical structured state answers
      // first, through the Tool Registry, which is why nothing here reaches
      // for it. Then what Capital Q already understands, which carries its
      // own evidence and confidence. Then the documents themselves.
      //
      // Knowledge is listed BEFORE the passages it was derived from because
      // it is the settled reading of them; it does not replace them, and
      // both travel so the model can see the passage behind the summary.
      const knowledgeFacts =
        knowledge === undefined
          ? []
          : await authorisedKnowledgeFacts(request.plan);

      return {
        facts: [...knowledgeFacts, ...assembleAuthorisedFacts(result)],
        subjectDescription: describeRetrieval(result),
      };
    },
  };

  /**
   * What Capital Q currently understands about this run's subjects, as
   * facts the prompt may reason over.
   *
   * Every reading goes through the permission-aware query service under the
   * plan's own envelope, so an understanding this actor may not have is
   * never a row. Confidence travels with the statement: an answer that says
   * "moderate confidence, document-supported" is honest in a way that
   * "ARR is 2.4m" is not.
   */
  async function authorisedKnowledgeFacts(
    plan: PermittedContextPlan,
  ): Promise<readonly AuthorisedFact[]> {
    if (knowledge === undefined) {
      return [];
    }
    const constraints = knowledgeConstraintsFor(plan);
    if (constraints.length === 0) {
      return [];
    }
    const companies = plan.subjects.flatMap((subject) =>
      subject.kind === "COMPANY" ? [subject.companyId] : [],
    );
    const facts: AuthorisedFact[] = [];
    for (const companyId of companies) {
      const known = await knowledge.currentForSubject(
        { tenantId: plan.tenantId, constraints },
        { subjectType: "COMPANY", subjectId: companyId },
      );
      for (const entry of known) {
        facts.push({
          scope: "KNOWLEDGE_OBJECTS",
          statement: entry.object.statement,
          truthClass: entry.object.truthClass,
          evidenceStatus: entry.object.evidenceStatus,
          // Confidence reaches the model as a word, because that is what it
          // is. There is no number to round, inflate or misread.
          source: `Capital Q's current understanding · ${entry.object.confidenceClass} confidence · ${String(entry.evidence.length)} supporting evidence item(s)`,
        });
      }
    }
    return facts;
  }

  return { port, context, lastResult: () => last };
}
