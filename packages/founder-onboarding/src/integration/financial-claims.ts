import { createAuthorizationService } from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";
import {
  createPostgresCompanyQueryPort,
  type Company,
} from "@capital-q/companies";
import type { CorrelationId } from "@capital-q/contracts";
import {
  createSavepointTransactionManager,
  type TransactionContext,
} from "@capital-q/database";
import {
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  createPostgresEvidenceRepositories,
  EvidenceSourceIdSchema,
  type EvidenceService,
} from "@capital-q/evidence";
import { CURRENCY_OPTIONS, FOUNDER_STEPS } from "../definition/founder-v1.js";
import {
  FOUNDER_FINANCIAL_STEPS,
  REVENUE_TREND_OPTIONS,
} from "../definition/founder-v4.js";
import {
  decimal,
  singleSelect,
  type ResponseValues,
} from "@capital-q/onboarding";
import {
  createKnowledgeWriteGate,
  createPostgresContradictionRepository,
  createPostgresKnowledgeRepository,
  type KnowledgeWriteGate,
  type KnowledgeWriteResult,
} from "@capital-q/q-knowledge";
import type { ActorContext } from "@capital-q/security";

import type { FounderDomainDependencies } from "./services.js";

/**
 * Q.01 financials: a founder's figure becomes the founder's own claim.
 *
 * Each answer in the financials block is written through the Knowledge
 * Write Gate exactly as a founder's statement in a Q conversation is: a
 * USER_STATEMENT evidence source (founder_private, HIGHLY_CONFIDENTIAL), an
 * evidence item quoting the answer (SELF_REPORTED), and a knowledge
 * candidate proposed as USER_CLAIM. The gate derives visibility (the
 * narrowest input: founder_private) and confidence; nothing here can make
 * a figure verified, public or investor-visible. Disclosure to an investor
 * is a separate, explicit share (Context Firewall: cash, burn and runway
 * together are the liquidity inference, and COMPANY_PRIVATE_FINANCIALS has
 * no disclosure path at all).
 *
 * Unknown stays unknown: a skipped step writes nothing, and a money figure
 * without a currency is not recorded as money in a guessed currency.
 */

export type FinancialClaim = {
  readonly stepKey: string;
  readonly knowledgeKey: string;
  /** Capital Q's wording of what the founder said. */
  readonly statement: string;
  readonly structuredValue: Readonly<Record<string, string>>;
};

/** The knowledge key each financial step's answer is recorded under. */
export const FINANCIAL_KNOWLEDGE_KEYS: Readonly<Record<string, string>> = {
  [FOUNDER_FINANCIAL_STEPS.monthlyRevenue]: "financial.monthly_revenue",
  [FOUNDER_FINANCIAL_STEPS.revenueTrend]: "financial.revenue_trend",
  [FOUNDER_FINANCIAL_STEPS.grossMargin]: "financial.gross_margin",
  [FOUNDER_FINANCIAL_STEPS.monthlyBurn]: "financial.burn_rate",
  [FOUNDER_FINANCIAL_STEPS.cash]: "financial.cash_balance",
  [FOUNDER_FINANCIAL_STEPS.runway]: "financial.runway_months",
  [FOUNDER_FINANCIAL_STEPS.minCheque]: "capital.min_cheque",
};

const MONEY_WORDS: Readonly<Record<string, string>> = {
  [FOUNDER_FINANCIAL_STEPS.monthlyRevenue]: "revenue last month was",
  [FOUNDER_FINANCIAL_STEPS.monthlyBurn]: "monthly net burn is",
  [FOUNDER_FINANCIAL_STEPS.cash]: "cash in the bank is",
  [FOUNDER_FINANCIAL_STEPS.minCheque]: "the smallest cheque they would take is",
};

const CURRENCY_KEYS = new Set(CURRENCY_OPTIONS.map((o) => o.optionKey));

/**
 * The currency a money step is in: the reporting currency the founder
 * picked, or for the cheque the raise's own currency first. Null when none
 * was given; the figure is then not recorded as money at all.
 */
export function financialCurrency(
  stepKey: string,
  values: ResponseValues,
): string | null {
  const order =
    stepKey === FOUNDER_FINANCIAL_STEPS.minCheque
      ? [FOUNDER_STEPS.currency, FOUNDER_FINANCIAL_STEPS.currency]
      : [FOUNDER_FINANCIAL_STEPS.currency, FOUNDER_STEPS.currency];
  for (const key of order) {
    const code = singleSelect(values, key);
    if (code !== null && CURRENCY_KEYS.has(code)) return code.toUpperCase();
  }
  return null;
}

/** Plain grouping for a decimal string, e.g. "18000" -> "18,000". */
export function groupDecimal(amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** Canonical decimal text, so "18000.00" and "18000" compare equal. */
export function canonicalDecimal(amount: string): string {
  if (!amount.includes(".")) return amount.replace(/^(-?)0+(?=\d)/, "$1");
  const trimmed = amount.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed.replace(/^(-?)0+(?=\d)/, "$1");
}

/** The claim a committed financial answer makes, or null (unknown, or no currency). */
export function financialClaimFor(
  stepKey: string,
  values: ResponseValues,
): FinancialClaim | null {
  const knowledgeKey = FINANCIAL_KNOWLEDGE_KEYS[stepKey];
  if (knowledgeKey === undefined) return null;
  if (stepKey === FOUNDER_FINANCIAL_STEPS.revenueTrend) {
    const trend = singleSelect(values, stepKey);
    const label = REVENUE_TREND_OPTIONS.find((o) => o.optionKey === trend);
    if (trend === null || label === undefined) return null;
    return {
      stepKey,
      knowledgeKey,
      statement: `The founder said monthly revenue is: ${label.label.toLowerCase()}.`,
      structuredValue: { kind: "TEXT", value: trend },
    };
  }
  const raw = decimal(values, stepKey);
  if (raw === null) return null;
  const amount = canonicalDecimal(raw);
  if (stepKey === FOUNDER_FINANCIAL_STEPS.grossMargin) {
    return {
      stepKey,
      knowledgeKey,
      statement: `The founder said gross margin is ${amount}%.`,
      structuredValue: { kind: "PERCENTAGE", value: amount },
    };
  }
  if (stepKey === FOUNDER_FINANCIAL_STEPS.runway) {
    return {
      stepKey,
      knowledgeKey,
      statement: `The founder said runway is ${amount} months.`,
      structuredValue: { kind: "DURATION", value: amount, unit: "MONTH" },
    };
  }
  const currency = financialCurrency(stepKey, values);
  if (currency === null) return null;
  return {
    stepKey,
    knowledgeKey,
    statement: `The founder said ${MONEY_WORDS[stepKey] ?? "the figure is"} ${currency} ${groupDecimal(amount)}.`,
    structuredValue: { kind: "MONEY", amount, currency },
  };
}

/** Where a financial claim is recorded. A port so tests can see the call. */
export type FinancialKnowledgePort = {
  readonly record: (input: {
    readonly actor: ActorContext;
    readonly companyId: Company["id"];
    readonly claim: FinancialClaim;
    /** Provenance only: the onboarding session the answer was given in. */
    readonly sessionId: string;
    readonly correlationId: CorrelationId;
  }) => Promise<KnowledgeWriteResult | null>;
};

/**
 * The real recording, on the onboarding transaction: the evidence, the
 * knowledge and the answer commit together or not at all. No external call
 * is made inside it.
 */
export function createFinancialKnowledgePort(
  tx: TransactionContext,
  dependencies: FounderDomainDependencies,
): FinancialKnowledgePort {
  const sql = tx.sql;
  const transactions = createSavepointTransactionManager(tx);
  const repositories = createPostgresEvidenceRepositories();
  const evidence = createEvidenceService({
    sql,
    transactions,
    authorization: createAuthorizationService(
      createPostgresAuthorizationPolicySource({ sql }),
    ),
    subjects: createEvidenceSubjectResolverRegistry([
      createCompanyEvidenceSubjectResolver(
        createPostgresCompanyQueryPort({ sql }),
      ),
    ]),
    outbox: dependencies.outbox,
    audit: dependencies.audit,
    repositories,
  });
  const gate = createKnowledgeWriteGate({
    sql,
    transactions,
    knowledge: createPostgresKnowledgeRepository(),
    contradictions: createPostgresContradictionRepository(),
    evidence: repositories,
  });
  return createFinancialKnowledgeRecorder({ evidence, gate });
}

/** The narrow slices of the Evidence service and the Write Gate used here. */
export type FinancialKnowledgeCollaborators = {
  readonly evidence: Pick<
    EvidenceService,
    "registerEvidenceSource" | "createEvidenceItem"
  >;
  readonly gate: Pick<KnowledgeWriteGate, "submit">;
};

/**
 * Source (founder_private, HIGHLY_CONFIDENTIAL) → item (SELF_REPORTED) →
 * candidate (USER_CLAIM). Exported so the provenance it writes is tested.
 */
export function createFinancialKnowledgeRecorder({
  evidence,
  gate,
}: FinancialKnowledgeCollaborators): FinancialKnowledgePort {
  return {
    record: async ({ actor, companyId, claim, sessionId, correlationId }) => {
      const source = await evidence.registerEvidenceSource({
        actor,
        correlationId,
        input: {
          sourceType: "USER_STATEMENT",
          subject: { subjectType: "COMPANY", subjectId: companyId },
          title: "Answer in the founder interview",
          externalReference: `onboarding:${sessionId}:${claim.stepKey}`,
          reliabilityClass: "USER_STATEMENT",
          visibilityScope: "founder_private",
          sensitivityClass: "HIGHLY_CONFIDENTIAL",
        },
      });
      const now = new Date().toISOString();
      const item = await evidence.createEvidenceItem({
        actor,
        correlationId,
        input: {
          sourceId: EvidenceSourceIdSchema.parse(source.id),
          evidenceType: `statement.${claim.knowledgeKey}`,
          summary: claim.statement,
          locator: { kind: "statement" },
          evidenceStatus: "SELF_REPORTED",
          validFrom: now,
        },
      });
      return gate.submit({
        actor,
        correlationId,
        // The founder typed or confirmed this figure themselves: the person
        // is the confirmation. Truth class stays USER_CLAIM, evidence
        // SELF_REPORTED; nothing is verified by saying it.
        automatic: true,
        candidate: {
          subject: { subjectType: "COMPANY", subjectId: companyId },
          knowledgeType: "fact",
          knowledgeKey: claim.knowledgeKey,
          statement: claim.statement,
          structuredValue: { ...claim.structuredValue },
          truthClassProposal: "USER_CLAIM",
          supportingClaimIds: [],
          supportingEvidenceItemIds: [item.id],
          supportingSourceIds: [source.id],
          validFrom: now,
          validTo: null,
          definitionQualifier: null,
          measurementBasis: "ACTUAL",
          correctsEarlier: false,
          lineage: [],
          reason: "USER_ANSWERED_IN_INTERVIEW",
        },
      });
    },
  };
}
