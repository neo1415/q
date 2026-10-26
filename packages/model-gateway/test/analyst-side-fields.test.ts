import { describe, expect, it } from "vitest";

import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  ANALYST_LENIENT_FIELDS,
  ANALYST_RESULT_SCHEMA,
} from "../src/q/index.js";

/**
 * Production 2026-10-26 (run 186c0788, founder.maji-loop, "How investor-
 * ready is my company right now?", 42.9 s): the readiness answer was
 * refused whole over side fields, twice, and the turn paid two more model
 * calls. The exact refusals, as the gateway logged them:
 *
 *   round 1: clarifyingQuestions.0-2:invalid_type,
 *            userStatements.5.quote:too_small, userStatements.7.quote:too_small,
 *            userStatements:too_big
 *   round 2: clarifyingQuestions.0:invalid_type,
 *            companyFindings.5.truthClass:invalid_value,
 *            coverage.4.coverage:invalid_value,
 *            displayName:invalid_type, proposalStatus:invalid_type
 *
 * Side fields degrade; the answer and every valid reading are kept. An
 * invalid truth class costs its finding, never becomes another class.
 */

const OPTIONS = {
  invalidListItems: "DROP",
  lenientFields: ANALYST_LENIENT_FIELDS,
  unknownRootKeys: "DROP",
} as const;

const ANSWER =
  "You're close: your deck and traction are in place, and the data room is the gap.";

const base = {
  answer: ANSWER,
  responseShape: "CONCISE",
  findings: [],
  missingEvidence: ["Audited accounts are not on record yet."],
  contradictions: [],
  insufficientEvidence: false,
  recommendation: null,
  clarifyingQuestions: [],
  declined: false,
};

const statement = (n: number, quote = `we sell ${String(n)} litres a day`) => ({
  quote,
  statement: `They sell ${String(n)} litres a day.`,
  knowledgeKey: "traction.daily_volume",
  validFrom: null,
});

const finding = (truthClass: string, n: number) => ({
  dimension: "TRACTION",
  type: "FACT",
  statement: `Daily volume is ${String(n)} litres.`,
  truthClass,
  confidence: "MODERATE",
  citations: [],
  assumptions: [],
});

const coverage = (value: string, dimension: string) => ({
  dimension,
  coverage: value,
});

describe("a readiness answer is never refused over its side fields (run 186c0788)", () => {
  it("round 1: string questions and empty quotes are dropped, an over-long statements list keeps its first valid ones", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        ...base,
        clarifyingQuestions: [
          "Which round are you raising?",
          "Do you have audited accounts?",
          "Who leads the round?",
        ],
        userStatements: [
          statement(1),
          statement(2),
          statement(3),
          statement(4),
          statement(5),
          statement(6, ""),
          statement(7),
          statement(8, ""),
        ],
      }),
      ANALYST_RESULT_SCHEMA,
      OPTIONS,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.answer).toBe(ANSWER);
    expect(accepted.value.missingEvidence).toEqual([
      "Audited accounts are not on record yet.",
    ]);
    expect(accepted.value.clarifyingQuestions).toEqual([]);
    // Empty quotes dropped, then the first valid ones up to the bound.
    expect(accepted.value.userStatements.map((one) => one.quote)).toEqual([
      "we sell 1 litres a day",
      "we sell 2 litres a day",
      "we sell 3 litres a day",
      "we sell 4 litres a day",
      "we sell 5 litres a day",
    ]);
  });

  it("round 2: a bad truth class costs its finding (never another class); bad coverage, name and status flag degrade", () => {
    const dimensions = [
      "DESCRIPTION",
      "BUSINESS_MODEL",
      "PRODUCT",
      "MARKET",
      "CUSTOMERS",
      "TRACTION",
    ];
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        ...base,
        clarifyingQuestions: ["Which round are you raising?"],
        companyFindings: [
          finding("USER_CLAIM", 1),
          finding("USER_CLAIM", 2),
          finding("ESTIMATE", 3),
          finding("USER_CLAIM", 4),
          finding("USER_CLAIM", 5),
          finding("PROBABLY_TRUE", 6),
        ],
        coverage: dimensions.map((dimension, index) =>
          coverage(index === 4 ? "MOSTLY" : "SELF_REPORTED", dimension),
        ),
        displayName: "Amara",
        proposalStatus: "no",
      }),
      ANALYST_RESULT_SCHEMA,
      OPTIONS,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.answer).toBe(ANSWER);
    const findings = accepted.value.companyFindings;
    expect(findings.map((one) => one.statement)).toEqual([
      "Daily volume is 1 litres.",
      "Daily volume is 2 litres.",
      "Daily volume is 3 litres.",
      "Daily volume is 4 litres.",
      "Daily volume is 5 litres.",
    ]);
    // Never coerced to another class: the classes kept are those written.
    expect(findings.map((one) => one.truthClass)).toEqual([
      "USER_CLAIM",
      "USER_CLAIM",
      "ESTIMATE",
      "USER_CLAIM",
      "USER_CLAIM",
    ]);
    expect(accepted.value.coverage).toHaveLength(5);
    expect(accepted.value.displayName).toBeNull();
    expect(accepted.value.proposalStatus).toBe(false);
  });

  it("the answer itself is still refused when it is wrong", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ ...base, answer: 42 }),
      ANALYST_RESULT_SCHEMA,
      OPTIONS,
    );
    expect(accepted.ok).toBe(false);
  });
});
