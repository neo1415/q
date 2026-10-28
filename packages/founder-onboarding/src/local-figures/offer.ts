import type { OnboardingResponseValue } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ExtractedBlock } from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  sameResponseValue,
  type OnboardingSessionRepository,
} from "@capital-q/onboarding";
import type { UserId } from "@capital-q/security";

import {
  CURRENCY_OPTIONS,
  FOUNDER_JOURNEY_TYPE,
} from "../definition/founder-v1.js";
import { FOUNDER_FINANCIAL_STEPS } from "../definition/founder-v4.js";
import { financialCurrency } from "../integration/financial-claims.js";
import {
  extractLocalFigures,
  localFiguresApply,
  type LocalFigureCandidate,
} from "./extract.js";
import { localFigureRationale, localFigureRefs } from "./provenance.js";
import { MEASURE_STEPS, MEASURE_TARGET_FIELDS } from "./steps.js";

/**
 * The worker hook (owner decision 2026-10-28): when a founder's financial
 * document (management accounts, a financial model) finishes processing,
 * its key figures are read by code, in the worker, from the blocks the
 * parser just produced, and offered to the founder through the onboarding
 * suggestion they already know (Keep / Change / Not this). No model, no
 * network, no read of the document outside the worker, and nothing becomes
 * a fact until the founder confirms it.
 *
 * Idempotent per document version: a figure already offered from this
 * version (pending, kept, changed or refused) is never offered again, and
 * one equal to their current answer is nothing new. A refused value is
 * never offered again by the runtime itself.
 */

export const LOCAL_FIGURE_SKIP_REASONS = [
  "NOT_FINANCIAL",
  "NOT_A_COMPANY_DOCUMENT",
  "NO_FIGURES",
  "NO_ACTIVE_SESSION",
] as const;
export type LocalFigureSkipReason = (typeof LOCAL_FIGURE_SKIP_REASONS)[number];

export type LocalFigureOfferResult =
  | {
      readonly kind: "OFFERED";
      readonly sessionId: string;
      /** Counts only: never a value. */
      readonly read: number;
      readonly offered: number;
      readonly alreadyOffered: number;
      readonly notOffered: number;
    }
  | {
      readonly kind: "SKIPPED";
      readonly reason: LocalFigureSkipReason;
      readonly read: number;
    };

export type LocalFigureOfferDependencies = {
  readonly sql: DatabaseExecutor;
  readonly sessions: Pick<OnboardingSessionRepository, "findActive">;
  readonly responses: {
    readonly listCurrent: (
      executor: DatabaseExecutor,
      sessionId: never,
    ) => Promise<
      readonly {
        readonly stepKey: string;
        readonly value: OnboardingResponseValue;
      }[]
    >;
  };
  /**
   * The steps already offered from this document version in this session,
   * whatever became of the offer. The composition reads the suggestions'
   * own refs; nothing else is needed.
   */
  readonly offeredFromVersion: (
    executor: DatabaseExecutor,
    sessionId: string,
    documentVersionId: string,
  ) => Promise<ReadonlySet<string>>;
  /** The onboarding runtime's internal, never-browser-reachable creation. */
  readonly createSuggestion: (command: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly targetField: string;
    readonly suggestedValue: OnboardingResponseValue;
    readonly sourceRefs: readonly {
      readonly sourceType: string;
      readonly sourceId: string;
    }[];
    readonly confidence: string | null;
    readonly rationale: string | null;
  }) => Promise<unknown>;
  readonly logger?: Logger | undefined;
};

export type LocalFigureDocument = {
  readonly tenantId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly companyId: string | null;
  readonly documentType: string;
  readonly title: string;
  readonly createdByUserId: string | null;
};

const CURRENCY_KEYS = new Set(CURRENCY_OPTIONS.map((o) => o.optionKey));

function valueFor(candidate: LocalFigureCandidate): OnboardingResponseValue {
  const { value } = candidate;
  return {
    type: "RANGE",
    value: value.kind === "MONEY" ? value.amount : value.value,
  };
}

export type LocalFigureOffers = {
  readonly onDocumentProcessed: (input: {
    readonly document: LocalFigureDocument;
    readonly blocks: readonly ExtractedBlock[];
  }) => Promise<LocalFigureOfferResult>;
};

export function createLocalFigureOffers(
  dependencies: LocalFigureOfferDependencies,
): LocalFigureOffers {
  const { sql, logger } = dependencies;
  return {
    onDocumentProcessed: async ({ document, blocks }) => {
      if (!localFiguresApply(document)) {
        return { kind: "SKIPPED", reason: "NOT_FINANCIAL", read: 0 };
      }
      if (document.companyId === null || document.createdByUserId === null) {
        return { kind: "SKIPPED", reason: "NOT_A_COMPANY_DOCUMENT", read: 0 };
      }
      const { candidates } = extractLocalFigures(blocks);
      if (candidates.length === 0) {
        return { kind: "SKIPPED", reason: "NO_FIGURES", read: 0 };
      }
      const session = await dependencies.sessions.findActive(
        sql,
        document.createdByUserId as UserId,
        FOUNDER_JOURNEY_TYPE,
        { subjectType: "COMPANY", subjectId: document.companyId },
      );
      if (session === null) {
        return {
          kind: "SKIPPED",
          reason: "NO_ACTIVE_SESSION",
          read: candidates.length,
        };
      }
      const [current, offered] = await Promise.all([
        dependencies.responses.listCurrent(sql, session.id as never),
        dependencies.offeredFromVersion(
          sql,
          session.id,
          document.documentVersionId,
        ),
      ]);
      const values = new Map(current.map((r) => [r.stepKey, r.value]));
      const reference = {
        documentId: document.documentId,
        documentVersionId: document.documentVersionId,
      };

      let created = 0;
      let alreadyOffered = 0;
      let notOffered = 0;
      let currencyProposed = false;
      const create = async (
        stepKey: string,
        targetField: string,
        suggestedValue: OnboardingResponseValue,
        candidate: LocalFigureCandidate,
      ): Promise<boolean> => {
        try {
          await dependencies.createSuggestion({
            sessionId: session.id,
            stepKey,
            targetField,
            suggestedValue,
            sourceRefs: localFigureRefs(candidate, reference),
            confidence: candidate.confidence === "HIGH" ? "0.9" : "0.7",
            rationale: localFigureRationale(candidate, document),
          });
          return true;
        } catch (error: unknown) {
          // Off their path, refused before, or a value the step's schema
          // refuses: the runtime's decision, logged by code only.
          logger?.info(
            {
              sessionId: session.id,
              stepKey,
              refused: error instanceof Error ? error.name : "unknown",
            },
            "local figure not offered",
          );
          return false;
        }
      };

      for (const candidate of candidates) {
        const stepKey = MEASURE_STEPS[candidate.measure];
        const targetField = MEASURE_TARGET_FIELDS[candidate.measure];
        if (stepKey === undefined || targetField === undefined) {
          notOffered += 1;
          continue;
        }
        if (offered.has(stepKey)) {
          alreadyOffered += 1;
          continue;
        }
        const suggestedValue = valueFor(candidate);
        const answered = values.get(stepKey);
        if (
          answered !== undefined &&
          sameResponseValue(answered, suggestedValue)
        ) {
          alreadyOffered += 1;
          continue;
        }
        if (candidate.value.kind === "MONEY") {
          // The currency the document states is kept, never relabelled: a
          // figure is offered only in their reporting currency, or with
          // that currency proposed beside it when they have not chosen one.
          // "$" alone is offered only to a founder who reports in USD.
          const reporting = financialCurrency(stepKey, values);
          const stated = candidate.value.currency;
          const fits = candidate.value.currencyCertain
            ? reporting === null || reporting === stated
            : reporting === "USD" && stated === "USD";
          if (!fits) {
            notOffered += 1;
            continue;
          }
          if (reporting === null) {
            if (!CURRENCY_KEYS.has(stated.toLowerCase())) {
              notOffered += 1;
              continue;
            }
            if (
              !currencyProposed &&
              !offered.has(FOUNDER_FINANCIAL_STEPS.currency)
            ) {
              currencyProposed = await create(
                FOUNDER_FINANCIAL_STEPS.currency,
                "financial.currency",
                { type: "SINGLE_SELECT", optionKey: stated.toLowerCase() },
                candidate,
              );
              if (currencyProposed) created += 1;
            }
          }
        }
        if (await create(stepKey, targetField, suggestedValue, candidate)) {
          created += 1;
        } else {
          notOffered += 1;
        }
      }
      return {
        kind: "OFFERED",
        sessionId: session.id,
        read: candidates.length,
        offered: created,
        alreadyOffered,
        notOffered,
      };
    },
  };
}
