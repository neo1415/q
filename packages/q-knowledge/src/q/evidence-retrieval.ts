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
  const { sql, repositories, retrieval, hydration, logger } = dependencies;
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
      return {
        facts: assembleAuthorisedFacts(result),
        subjectDescription: describeRetrieval(result),
      };
    },
  };

  return { port, context, lastResult: () => last };
}
