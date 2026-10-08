import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresEvidenceRepositories,
  EvidenceSourceIdSchema,
  type EvidenceService,
} from "@capital-q/evidence";
import {
  createInvestorAnswerRecorder,
  createKnowledgeWriteGate,
  createPostgresContradictionRepository,
  createPostgresKnowledgeRepository,
  type InvestorAnswerRecorder,
} from "@capital-q/q-knowledge";

/**
 * A founder's answer to an investor's question, recorded as their claim
 * (founder documents, 2026-10-08): a USER_STATEMENT source pointing at the
 * question (founder_private: the answer the investor reads is the one they
 * were sent, never this record), an item with the founder's words, and a
 * USER_CLAIM candidate through the Knowledge Write Gate. The same path Q's
 * conversation statements and the onboarding answers take.
 */
export function createInvestorAnswers(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly evidence: Pick<
    EvidenceService,
    "registerEvidenceSource" | "createEvidenceItem"
  >;
}): InvestorAnswerRecorder {
  const { evidence } = dependencies;
  const gate = createKnowledgeWriteGate({
    sql: dependencies.sql,
    transactions: dependencies.transactions,
    knowledge: createPostgresKnowledgeRepository(),
    contradictions: createPostgresContradictionRepository(),
    evidence: createPostgresEvidenceRepositories(),
  });
  return createInvestorAnswerRecorder({
    gate,
    evidence: {
      registerStatementSource: async (actor, input, correlationId) => {
        const source = await evidence.registerEvidenceSource({
          actor,
          correlationId,
          input: {
            sourceType: "USER_STATEMENT",
            subject: { subjectType: "COMPANY", subjectId: input.companyId },
            title: input.title,
            externalReference: input.externalReference,
            reliabilityClass: "USER_STATEMENT",
            visibilityScope: "founder_private",
            sensitivityClass: "CONFIDENTIAL",
          },
        });
        return { id: source.id };
      },
      createStatementItem: async (actor, input, correlationId) => {
        const item = await evidence.createEvidenceItem({
          actor,
          correlationId,
          input: {
            sourceId: EvidenceSourceIdSchema.parse(input.sourceId),
            evidenceType: input.evidenceType,
            summary: input.summary,
            locator: { kind: "statement" },
            evidenceStatus: "SELF_REPORTED",
            ...(input.validFrom === null ? {} : { validFrom: input.validFrom }),
          },
        });
        return { id: item.id };
      },
    },
  });
}
