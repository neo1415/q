import type { CorrelationId } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { KnowledgeWriteResult } from "../knowledge/contracts.js";
import type { KnowledgeWriteGate } from "../knowledge/write-gate.js";

/**
 * A person's clarification in a Q conversation becomes recorded knowledge
 * (CQ-Q-RESEARCH-001 §20-§23, §40).
 *
 * "Kenya was a pilot; we stopped operating there last year." is the
 * person's own statement about their own company. It is persisted through
 * the architecture that already exists — a USER_STATEMENT evidence source
 * whose external reference is the Q run, an evidence item carrying the
 * quoted words with a `statement` locator, and a knowledge candidate through
 * the Knowledge Write Gate — so that a new conversation retrieves it as
 * "Capital Q's current understanding" with USER_CLAIM truth class,
 * SELF_REPORTED evidence status and LOW confidence. Nothing here is
 * canonical company state: that changes only through the owning company
 * service with its own confirmation rules, never from a conversation.
 *
 * The guard against a model inventing a statement is the QUOTE: the words
 * the model attributes to the person must occur verbatim (case- and
 * whitespace-insensitively) in the person's own message, or nothing is
 * recorded. A model paraphrase is not the person speaking.
 */

export type StatementEvidencePort = {
  readonly registerStatementSource: (
    actor: ActorContext,
    input: {
      readonly companyId: string;
      readonly title: string;
      /** The Q run the statement was made in; provenance only. */
      readonly externalReference: string;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
  readonly createStatementItem: (
    actor: ActorContext,
    input: {
      readonly sourceId: string;
      readonly evidenceType: string;
      readonly summary: string;
      readonly validFrom: string | null;
    },
    correlationId: CorrelationId,
  ) => Promise<{ readonly id: string }>;
};

export type ConversationStatement = {
  /** The person's words, verbatim, as the model attributed them. */
  readonly quote: string;
  /** The plain proposition the words establish, in Capital Q's wording. */
  readonly statement: string;
  /** Dotted lower_snake_case key, e.g. operations.market.kenya */
  readonly knowledgeKey: string;
  /** ISO date when the statement is about a period; null when it is current. */
  readonly validFrom: string | null;
};

export type RecordStatementCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly runId: string;
  /** The person's latest message. The quote must occur in it. */
  readonly userText: string;
  readonly statement: ConversationStatement;
  readonly correlationId: CorrelationId;
};

export type RecordStatementOutcome =
  | { readonly recorded: true; readonly result: KnowledgeWriteResult }
  | {
      readonly recorded: false;
      readonly reason:
        | "QUOTE_NOT_IN_MESSAGE"
        | "INVALID_STATEMENT"
        | "EVIDENCE_REFUSED"
        | "KNOWLEDGE_REFUSED";
      readonly result?: KnowledgeWriteResult | undefined;
    };

export type ConversationStatementRecorder = {
  readonly record: (
    command: RecordStatementCommand,
  ) => Promise<RecordStatementOutcome>;
};

const KNOWLEDGE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const QUOTE_MAX = 400;
const STATEMENT_MAX = 500;

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

/** True when every word of the quote occurs, in order, in the person's message. */
export function quoteOccursIn(quote: string, userText: string): boolean {
  const needle = normalise(quote);
  if (needle.length < 3 || needle.length > QUOTE_MAX) {
    return false;
  }
  return normalise(userText).includes(needle);
}

export function createConversationStatementRecorder(dependencies: {
  readonly evidence: StatementEvidencePort;
  readonly gate: Pick<KnowledgeWriteGate, "submit">;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): ConversationStatementRecorder {
  const { evidence, gate, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  return {
    record: async (command) => {
      const { statement } = command;
      if (!quoteOccursIn(statement.quote, command.userText)) {
        return { recorded: false, reason: "QUOTE_NOT_IN_MESSAGE" };
      }
      const text = statement.statement.trim();
      if (
        text.length === 0 ||
        text.length > STATEMENT_MAX ||
        !KNOWLEDGE_KEY.test(statement.knowledgeKey) ||
        statement.knowledgeKey.length > 128 ||
        (statement.validFrom !== null &&
          Number.isNaN(Date.parse(statement.validFrom)))
      ) {
        return { recorded: false, reason: "INVALID_STATEMENT" };
      }
      let sourceId: string;
      let itemId: string;
      try {
        sourceId = (
          await evidence.registerStatementSource(
            command.actor,
            {
              companyId: command.companyId,
              title: "Clarification in a Q conversation",
              externalReference: `q-run:${command.runId}`,
            },
            command.correlationId,
          )
        ).id;
        itemId = (
          await evidence.createStatementItem(
            command.actor,
            {
              sourceId,
              evidenceType: `statement.${statement.knowledgeKey}`,
              summary: statement.quote.trim().slice(0, 2_000),
              validFrom:
                statement.validFrom === null
                  ? null
                  : new Date(statement.validFrom).toISOString(),
            },
            command.correlationId,
          )
        ).id;
      } catch (error: unknown) {
        logger?.warn(
          {
            runId: command.runId,
            reason: error instanceof Error ? error.name : "unknown",
          },
          "conversation statement was not recorded as evidence",
        );
        return { recorded: false, reason: "EVIDENCE_REFUSED" };
      }
      const result = await gate.submit({
        actor: command.actor,
        correlationId: command.correlationId,
        // The person's own statement about their own company, quoted
        // verbatim: the human is the confirmation. Truth class stays
        // USER_CLAIM and confidence LOW; nothing is verified by saying it.
        automatic: true,
        candidate: {
          subject: { subjectType: "COMPANY", subjectId: command.companyId },
          knowledgeType: "fact",
          knowledgeKey: statement.knowledgeKey,
          statement: text,
          structuredValue: null,
          truthClassProposal: "USER_CLAIM",
          supportingClaimIds: [],
          supportingEvidenceItemIds: [itemId],
          supportingSourceIds: [sourceId],
          validFrom:
            statement.validFrom === null
              ? clock().toISOString()
              : new Date(statement.validFrom).toISOString(),
          validTo: null,
          definitionQualifier: null,
          measurementBasis: "ACTUAL",
          correctsEarlier: false,
          lineage: [],
          reason: "USER_CLARIFIED_IN_CONVERSATION",
        },
      });
      if (result.outcome === "REJECTED") {
        logger?.warn(
          { runId: command.runId, reason: result.reason },
          "conversation statement refused by the knowledge gate",
        );
        return { recorded: false, reason: "KNOWLEDGE_REFUSED", result };
      }
      logger?.info(
        {
          runId: command.runId,
          knowledgeKey: statement.knowledgeKey,
          outcome: result.outcome,
          reason: result.reason,
          status: result.status,
        },
        "conversation statement recorded",
      );
      return { recorded: true, result };
    },
  };
}
