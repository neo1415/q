import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { KnowledgeWriteGate } from "../knowledge/write-gate.js";
import type { StatementEvidencePort } from "./statement-recorder.js";

/**
 * A founder's answer to an investor's question becomes recorded knowledge
 * (founder documents, 2026-10-08), through the architecture that already
 * exists: a USER_STATEMENT evidence source whose external reference is the
 * question, an evidence item carrying the founder's own words, and a
 * knowledge candidate through the Knowledge Write Gate with USER_CLAIM.
 *
 * The words are the founder's own, typed by them and sent on the screen
 * (or approved exactly on Q's card): the person is the confirmation, so the
 * gate may persist it, and it stays a claim. Attaching a document does not
 * make it verified; the evidence status the investor sees says which.
 * Visibility is derived by the gate from the source (founder-private):
 * what the investor reads is the answer they were sent, never this record.
 */

export type InvestorAnswerCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly questionId: string;
  /** "Paying customers": what the question was about; null: their own question. */
  readonly about: string | null;
  readonly answer: string;
  readonly correlationId: CorrelationId;
};

export type InvestorAnswerRecorded = {
  readonly evidenceItemId: string | null;
  readonly knowledgeObjectId: string | null;
};

export type InvestorAnswerRecorder = {
  readonly record: (
    command: InvestorAnswerCommand,
  ) => Promise<InvestorAnswerRecorded>;
};

const SUMMARY_MAX = 2_000;
const STATEMENT_MAX = 500;

/** `diligence.answer.paying_customers`; `diligence.answer.general` without a subject. */
export function answerKnowledgeKey(about: string | null): string {
  const slug = (about ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "n$1")
    .slice(0, 60);
  return `diligence.answer.${slug.length === 0 ? "general" : slug}`;
}

export function createInvestorAnswerRecorder(dependencies: {
  readonly evidence: StatementEvidencePort;
  readonly gate: Pick<KnowledgeWriteGate, "submit">;
  readonly clock?: (() => Date) | undefined;
}): InvestorAnswerRecorder {
  const clock = dependencies.clock ?? (() => new Date());
  return {
    record: async (command) => {
      const words = command.answer.trim();
      if (words.length === 0) {
        return { evidenceItemId: null, knowledgeObjectId: null };
      }
      const source = await dependencies.evidence.registerStatementSource(
        command.actor,
        {
          companyId: command.companyId,
          title: "Answer to an investor's question",
          externalReference: `diligence-question:${command.questionId}`,
        },
        command.correlationId,
      );
      const knowledgeKey = answerKnowledgeKey(command.about);
      const item = await dependencies.evidence.createStatementItem(
        command.actor,
        {
          sourceId: source.id,
          evidenceType: `statement.${knowledgeKey}`,
          summary: words.slice(0, SUMMARY_MAX),
          validFrom: null,
        },
        command.correlationId,
      );
      const result = await dependencies.gate.submit({
        actor: command.actor,
        correlationId: command.correlationId,
        automatic: true,
        candidate: {
          subject: { subjectType: "COMPANY", subjectId: command.companyId },
          knowledgeType: "fact",
          knowledgeKey,
          statement:
            words.length <= STATEMENT_MAX
              ? words
              : `${words.slice(0, STATEMENT_MAX - 1)}…`,
          structuredValue: null,
          truthClassProposal: "USER_CLAIM",
          supportingClaimIds: [],
          supportingEvidenceItemIds: [item.id],
          supportingSourceIds: [source.id],
          validFrom: clock().toISOString(),
          validTo: null,
          definitionQualifier: null,
          measurementBasis: "ACTUAL",
          correctsEarlier: false,
          lineage: [],
          reason: "USER_ANSWERED_INVESTOR_QUESTION",
        },
      });
      return {
        evidenceItemId: item.id,
        knowledgeObjectId: result.outcome === "REJECTED" ? null : result.objectId,
      };
    },
  };
}
