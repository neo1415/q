import type {
  DeckSectionCode,
  DeckSectionReading,
  DeckSectionReviewAction,
  OnboardingResponseValue,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ResponseValues } from "@capital-q/onboarding";

import { FOUNDER_JOURNEY_TYPE } from "../definition/founder-v1.js";
import { FOUNDER_FINANCIAL_STEPS } from "../definition/founder-v4.js";
import {
  canonicalDecimal,
  financialClaimFor,
  groupDecimal,
  type FinancialClaim,
} from "./financial-claims.js";

/**
 * Q.01: deterministic contradiction follow-ups for a founder's figures.
 *
 * When the founder states a figure their own deck also states, and the two
 * differ, Q asks which is current ("your deck says monthly revenue is
 * USD 14,000; you told me USD 18,000"). Nothing here is a model and nothing
 * here decides: both readings stay on record (the deck reading untouched,
 * the founder's answer as their own claim) until the founder chooses, and
 * the choice commits through the interview's own validated answer.
 *
 * Only a deck section the founder confirmed counts as "the deck says": an
 * unreviewed reading is Q's, not theirs. No materiality threshold is
 * invented (the Write Gate has none either): two exact figures in the same
 * currency that differ are a disagreement; a different currency or a
 * figure that cannot be parsed is incomparable and asks nothing.
 */

const COMPARED_STEPS = [
  FOUNDER_FINANCIAL_STEPS.monthlyRevenue,
  FOUNDER_FINANCIAL_STEPS.grossMargin,
  FOUNDER_FINANCIAL_STEPS.monthlyBurn,
  FOUNDER_FINANCIAL_STEPS.cash,
  FOUNDER_FINANCIAL_STEPS.runway,
] as const;

export const FINANCIAL_CHECK_STEPS: ReadonlySet<string> = new Set<string>([
  ...COMPARED_STEPS,
  FOUNDER_FINANCIAL_STEPS.currency,
]);

const LABELS: Readonly<Record<string, RegExp>> = {
  [FOUNDER_FINANCIAL_STEPS.monthlyRevenue]:
    /\b(mrr|monthly (recurring )?revenue|revenue (per|a|each) month|monthly sales)\b/i,
  [FOUNDER_FINANCIAL_STEPS.grossMargin]: /\bgross margins?\b/i,
  [FOUNDER_FINANCIAL_STEPS.monthlyBurn]: /\b(net )?burn( rate)?\b/i,
  [FOUNDER_FINANCIAL_STEPS.cash]:
    /\bcash( balance| in (the )?bank| on hand)?\b/i,
  [FOUNDER_FINANCIAL_STEPS.runway]: /\brunway\b/i,
};

const WORDS: Readonly<Record<string, string>> = {
  [FOUNDER_FINANCIAL_STEPS.monthlyRevenue]: "monthly revenue",
  [FOUNDER_FINANCIAL_STEPS.grossMargin]: "gross margin",
  [FOUNDER_FINANCIAL_STEPS.monthlyBurn]: "monthly burn",
  [FOUNDER_FINANCIAL_STEPS.cash]: "cash in the bank",
  [FOUNDER_FINANCIAL_STEPS.runway]: "runway",
};

const SYMBOLS: readonly (readonly [RegExp, string])[] = [
  [/US\$|\$/, "USD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/₦/, "NGN"],
  [/KSh/i, "KES"],
  [/₹/, "INR"],
  [/S\$/, "SGD"],
];
const ISO = /\b(USD|EUR|GBP|NGN|KES|ZAR|AED|INR|SGD)\b/i;
const SCALE: Readonly<Record<string, number>> = {
  k: 3,
  thousand: 3,
  m: 6,
  mn: 6,
  million: 6,
  b: 9,
  bn: 9,
  billion: 9,
};

/** "1.5" scaled by 10^shift, as an exact decimal string (no float). */
function shiftDecimal(figure: string, shift: number): string {
  const [whole = "0", fraction = ""] = figure.split(".");
  const digits = `${whole}${fraction.padEnd(shift, "0")}`;
  const rest = fraction.length > shift ? fraction.slice(shift) : "";
  return canonicalDecimal(rest.length === 0 ? digits : `${digits}.${rest}`);
}

/** A number in a deck's own words: "14,000", "$1.2m", "18k", "72%". */
export function parseDeckNumber(raw: string): {
  readonly amount: string;
  readonly currency: string | null;
  readonly percent: boolean;
} | null {
  const match =
    /(-?\d[\d,]*(?:\.\d+)?)\s*(k|thousand|mn|m|million|bn|b|billion)?\b/i.exec(
      raw,
    );
  if (match === null) return null;
  // Two numbers in one value ("14k to 18k") is a range, not a figure.
  if ((raw.match(/\d[\d,.]*/g) ?? []).length > 1) return null;
  const figure = (match[1] ?? "").replace(/,/g, "");
  const scale =
    match[2] === undefined ? 0 : (SCALE[match[2].toLowerCase()] ?? 0);
  const amount =
    scale === 0 ? canonicalDecimal(figure) : shiftDecimal(figure, scale);
  const iso = ISO.exec(raw)?.[1]?.toUpperCase() ?? null;
  const symbol = SYMBOLS.find(([pattern]) => pattern.test(raw))?.[1] ?? null;
  return { amount, currency: iso ?? symbol, percent: raw.includes("%") };
}

export type DeckReading = {
  readonly documentId: string;
  readonly sections: readonly DeckSectionReading[];
  /** The whole reading was confirmed by the founder (F26). */
  readonly confirmed: boolean;
  /** The newest review per section. */
  readonly reviews: readonly {
    readonly section: DeckSectionCode;
    readonly action: DeckSectionReviewAction;
  }[];
};

export type DeckFigure = {
  readonly stepKey: string;
  readonly amount: string;
  readonly currency: string | null;
  readonly asOf: string | null;
  readonly pages: readonly number[];
  readonly documentId: string;
};

function sectionConfirmed(reading: DeckReading, section: DeckSectionCode) {
  const review = reading.reviews.find((r) => r.section === section);
  if (review !== undefined) return review.action === "CONFIRM";
  return reading.confirmed;
}

/** The figures a founder-confirmed deck section states, by financial step. */
export function deckFinancialFigures(reading: DeckReading): DeckFigure[] {
  const out: DeckFigure[] = [];
  for (const section of reading.sections) {
    if (section.section !== "TRACTION" && section.section !== "FINANCIALS") {
      continue;
    }
    if (!sectionConfirmed(reading, section.section)) continue;
    for (const fact of section.facts) {
      if (fact.kind !== "FIGURE" || fact.value === null) continue;
      const stepKey = COMPARED_STEPS.find((key) =>
        (LABELS[key] ?? /$^/).test(fact.label),
      );
      if (stepKey === undefined) continue;
      if (out.some((figure) => figure.stepKey === stepKey)) continue;
      const parsed = parseDeckNumber(fact.value);
      if (parsed === null) continue;
      out.push({
        stepKey,
        amount: parsed.amount,
        currency: parsed.currency,
        asOf: fact.asOf,
        pages: fact.pages,
        documentId: reading.documentId,
      });
    }
  }
  return out;
}

export type FinancialQuestion = {
  readonly stepKey: string;
  readonly factKey: string;
  readonly question: string;
  readonly why: string;
  readonly reason: "CONTRADICTION";
  readonly readings: readonly string[];
  readonly options: readonly {
    readonly label: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }[];
  readonly sourceRefs: readonly {
    readonly sourceType: string;
    readonly sourceId: string;
  }[];
};

function display(claim: FinancialClaim): string {
  const value = claim.structuredValue;
  if (value["kind"] === "MONEY") {
    return `${value["currency"] ?? ""} ${groupDecimal(value["amount"] ?? "")}`;
  }
  if (value["kind"] === "PERCENTAGE") return `${value["value"] ?? ""}%`;
  return `${value["value"] ?? ""} months`;
}

function statedAmount(claim: FinancialClaim): string {
  const value = claim.structuredValue;
  return value["kind"] === "MONEY"
    ? (value["amount"] ?? "")
    : (value["value"] ?? "");
}

/**
 * Compares what the founder said with what their confirmed deck says.
 * Pure: same answers and same reading, same questions.
 */
export function financialContradictions(
  values: ResponseValues,
  deck: readonly DeckFigure[],
): FinancialQuestion[] {
  const questions: FinancialQuestion[] = [];
  for (const figure of deck) {
    const claim = financialClaimFor(figure.stepKey, values);
    if (claim === null) continue;
    const kind = claim.structuredValue["kind"];
    if (kind === "MONEY") {
      // A different or unstated currency is incomparable, never a conflict.
      if (figure.currency !== claim.structuredValue["currency"]) continue;
    }
    const stated = statedAmount(claim);
    if (stated === figure.amount) continue;
    const words = WORDS[figure.stepKey] ?? "this figure";
    const said = display(claim);
    const deckClaim: FinancialClaim = {
      ...claim,
      structuredValue:
        kind === "MONEY"
          ? { ...claim.structuredValue, amount: figure.amount }
          : { ...claim.structuredValue, value: figure.amount },
    };
    const deckSays = display(deckClaim);
    const where =
      figure.pages.length === 0
        ? "Pitch deck"
        : `Pitch deck, page ${figure.pages.join(", ")}`;
    questions.push({
      stepKey: figure.stepKey,
      factKey: claim.knowledgeKey,
      question: `Your deck says ${words} is ${deckSays}; you told me ${said}. Which is current?`,
      why: "Investors compare the deck with what you tell them. Both figures stay on record until you choose; nothing is overwritten.",
      reason: "CONTRADICTION",
      readings: [
        `${where}${figure.asOf === null ? "" : ` (as of ${figure.asOf})`}: ${deckSays}`,
        `What you told Q: ${said}`,
      ],
      options: [
        {
          label: `${deckSays} (the deck)`,
          stepKey: figure.stepKey,
          value: { type: "RANGE", value: figure.amount },
        },
        {
          label: `${said} (what I said)`,
          stepKey: figure.stepKey,
          value: { type: "RANGE", value: stated },
        },
      ],
      sourceRefs: [
        { sourceType: "EVIDENCE_DOCUMENT", sourceId: figure.documentId },
      ],
    });
  }
  return questions;
}

export type FounderFinancialCheckDependencies = {
  readonly sql: DatabaseExecutor;
  readonly sessions: {
    readonly findById: (
      executor: DatabaseExecutor,
      sessionId: never,
    ) => Promise<{
      readonly id: string;
      readonly journeyType: string;
      readonly status: string;
      readonly subject: {
        readonly subjectType: string;
        readonly subjectId: string;
      } | null;
    } | null>;
  };
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
  readonly questions: {
    readonly listForFact?:
      | ((
          executor: DatabaseExecutor,
          sessionId: never,
          factKey: string,
        ) => Promise<
          readonly {
            readonly reason: string;
            readonly readings: readonly string[];
            readonly status: string;
          }[]
        >)
      | undefined;
  };
  /** The company's current deck reading, or null (no deck, or not read). */
  readonly deckReading: (
    executor: DatabaseExecutor,
    companyId: string,
  ) => Promise<DeckReading | null>;
  readonly recordQuestions: (command: {
    readonly sessionId: string;
    readonly questions: readonly FinancialQuestion[];
  }) => Promise<unknown>;
  readonly logger?: Logger | undefined;
};

export type FounderFinancialCheck = {
  readonly onResponseCommitted: (event: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly responseId: string;
  }) => Promise<{
    readonly kind: "SKIPPED" | "CHECKED";
    readonly asked: number;
  }>;
};

export function createFounderFinancialCheck(
  dependencies: FounderFinancialCheckDependencies,
): FounderFinancialCheck {
  const { sql, sessions, responses, questions, deckReading, recordQuestions } =
    dependencies;
  const skipped = { kind: "SKIPPED" as const, asked: 0 };
  return {
    onResponseCommitted: async (event) => {
      if (!FINANCIAL_CHECK_STEPS.has(event.stepKey)) return skipped;
      const session = await sessions.findById(sql, event.sessionId as never);
      if (
        session === null ||
        session.journeyType !== FOUNDER_JOURNEY_TYPE ||
        session.status !== "ACTIVE" ||
        session.subject?.subjectType !== "COMPANY"
      ) {
        return skipped;
      }
      const reading = await deckReading(sql, session.subject.subjectId);
      if (reading === null) return skipped;
      const values = new Map(
        (await responses.listCurrent(sql, session.id as never)).map((r) => [
          r.stepKey,
          r.value,
        ]),
      );
      const found = financialContradictions(
        values,
        deckFinancialFigures(reading),
      );
      const fresh: FinancialQuestion[] = [];
      for (const question of found) {
        // The founder already settled (answered or set aside) this deck
        // reading, or the identical question is still waiting: never ask
        // it twice. A waiting question with an older answer is replaced.
        const earlier =
          questions.listForFact === undefined
            ? []
            : await questions.listForFact(
                sql,
                session.id as never,
                question.factKey,
              );
        const same = earlier.some(
          (q) =>
            q.reason === "CONTRADICTION" &&
            (q.status === "PENDING"
              ? q.readings.join("\n") === question.readings.join("\n")
              : q.status !== "SUPERSEDED" &&
                q.readings[0] === question.readings[0]),
        );
        if (!same) fresh.push(question);
      }
      if (fresh.length > 0) {
        await recordQuestions({ sessionId: session.id, questions: fresh });
        dependencies.logger?.info(
          { sessionId: session.id, asked: fresh.length },
          "founder financial contradictions asked",
        );
      }
      return { kind: "CHECKED", asked: fresh.length };
    },
  };
}
