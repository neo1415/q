import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V35,
  COMPANY_ANALYST_V36,
  CompanyAnalystV35ResultSchema,
  CompanyAnalystV36ResultSchema,
  createDefaultPromptRegistry,
  EXECUTION_LANES,
  spokenFormWithin,
  spokenOnlyFacts,
  turnExecutionClassOf,
  type ExecutionReading,
} from "../src/index.js";

/**
 * RC3 (Q voice audit, 15 Nov 2026): one authoritative result with a concise
 * spoken form (COMPANY_ANALYST v36), the code check that the spoken form adds
 * no figure or name, and the execution class read from the turn reader.
 */
describe("COMPANY_ANALYST v36: the spoken form", () => {
  const base = {
    answer: "Tensorgate leads on fit.",
    responseShape: "CONCISE",
    insufficientEvidence: false,
    recommendation: null,
  };

  it("was active on schema v36 (until v37), on v35's template, with v35 deprecated", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(38);
    expect(registry.get("COMPANY_ANALYST", 35)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V36.template).toBe(COMPANY_ANALYST_V35.template);
    expect(COMPANY_ANALYST_V36.output).toMatchObject({
      kind: "STRUCTURED",
      schemaVersion: 36,
      schema: CompanyAnalystV36ResultSchema,
    });
  });

  it("is additive: a v35 answer is a v36 answer with no spoken form", () => {
    const v35 = CompanyAnalystV35ResultSchema.parse(base);
    expect(CompanyAnalystV36ResultSchema.parse(v35).spoken).toBeNull();
    expect(
      CompanyAnalystV36ResultSchema.parse({ ...base, spoken: "Short." }).spoken,
    ).toBe("Short.");
  });
});

describe("spoken form within the full answer", () => {
  const answer =
    "## Tensorgate\n\nTensorgate reports **$4m ARR** (self-reported), up from $2.3 million last year, with 120 customers. Shiftwell is earlier: €50,000 MRR. The main risk is concentration: two customers make up 40% of revenue.";

  it("keeps a short spoken form whose figures and names are all in the answer", () => {
    const spoken = spokenFormWithin(
      "Tensorgate reports 4 million in ARR, up from 2.3 million, with 120 customers. The main risk is concentration: two customers are 40% of revenue. The details are on your screen.",
      answer,
    );
    expect(spoken?.version).toBe(1);
    expect(spoken?.text).toContain("Tensorgate reports 4 million");
  });

  it("drops a spoken form that adds a figure the answer does not hold", () => {
    expect(
      spokenFormWithin("Tensorgate reports 5 million in ARR.", answer),
    ).toBeNull();
    // The "4" of "$4m" is not "4 billion".
    expect(
      spokenFormWithin("Tensorgate reports 4 billion in ARR.", answer),
    ).toBeNull();
    // "€50,000" said as "50 billion" (audit RC1) is a different figure.
    expect(spokenOnlyFacts("Shiftwell does 50 billion MRR.", answer)).toEqual({
      figures: ["50 billion"],
      names: [],
    });
  });

  it("drops a spoken form that adds a name the answer does not hold", () => {
    expect(
      spokenFormWithin("Tensorgate and Halyard Security lead.", answer),
    ).toBeNull();
    expect(spokenOnlyFacts("Nixo is the best fit.", answer).names).toContain(
      "Nixo",
    );
  });

  it("reads a quarter as one word, so one the answer says is not an unknown name", () => {
    const plan = "Three account managers start in Q1 and six engineers in Q2.";
    expect(
      spokenOnlyFacts("Account managers start in Q1.", plan).names,
    ).toEqual([]);
    expect(spokenOnlyFacts("Engineers start in Q3.", plan).names).toEqual([
      "Q3",
    ]);
  });

  it("drops markdown, a list or more than three sentences", () => {
    expect(spokenFormWithin("**Tensorgate** leads.", answer)).toBeNull();
    expect(
      spokenFormWithin(
        "Tensorgate leads. Shiftwell is earlier. The risk is concentration. The details are on your screen.",
        answer,
      ),
    ).toBeNull();
    expect(spokenFormWithin("   ", answer)).toBeNull();
    expect(spokenFormWithin(null, answer)).toBeNull();
  });
});

describe("turn execution class, from the reader's structured reading", () => {
  const read = (over: Partial<ExecutionReading>): ExecutionReading => ({
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    hasPriorResult: true,
    ...over,
  });

  it("routes each class", () => {
    expect(turnExecutionClassOf(read({ kind: "SMALL_TALK" }))).toBe(
      "CONVERSATIONAL_ACK",
    );
    expect(turnExecutionClassOf(read({ answerKind: "FOLLOW_UP" }))).toBe(
      "CONTEXTUAL_FOLLOW_UP",
    );
    expect(turnExecutionClassOf(read({ fromShown: true }))).toBe(
      "CONTEXTUAL_FOLLOW_UP",
    );
    expect(turnExecutionClassOf(read({ preparedSubject: "MANDATE" }))).toBe(
      "ANSWER_FROM_CONTEXT",
    );
    expect(
      turnExecutionClassOf(read({ kind: "TOOL_REQUEST", navigates: true })),
    ).toBe("NAVIGATION");
    expect(turnExecutionClassOf(read({ questionKind: "FIT" }))).toBe(
      "STRUCTURED_QUERY",
    );
    expect(turnExecutionClassOf(read({ answerKind: "ANALYSIS" }))).toBe(
      "COMPLEX_ANALYSIS",
    );
    expect(turnExecutionClassOf(read({ compare: true }))).toBe("MULTI_SOURCE");
    expect(turnExecutionClassOf(read({ partsCount: 2 }))).toBe("MULTI_SOURCE");
    expect(turnExecutionClassOf(read({ kind: "RESEARCH_REQUEST" }))).toBe(
      "PUBLIC_RESEARCH",
    );
    expect(
      turnExecutionClassOf(read({ answerKind: "FOLLOW_UP", asksForWeb: true })),
    ).toBe("PUBLIC_RESEARCH");
    expect(turnExecutionClassOf(read({ replyTo: "WAITING_CARD" }))).toBe(
      "CONSEQUENTIAL_ACTION",
    );
    expect(turnExecutionClassOf(read({ asksAction: true }))).toBe(
      "CONSEQUENTIAL_ACTION",
    );
  });

  it("takes a reduced lane only when the reader positively said so", () => {
    expect(turnExecutionClassOf(null)).toBe("COMPLEX_ANALYSIS");
    // Nothing shown yet: nothing to follow up on.
    expect(
      turnExecutionClassOf(
        read({ answerKind: "FOLLOW_UP", hasPriorResult: false }),
      ),
    ).toBe("COMPLEX_ANALYSIS");
    // A low-confidence reading keeps the full path.
    expect(
      turnExecutionClassOf(
        read({ answerKind: "FOLLOW_UP", confidence: "LOW" }),
      ),
    ).toBe("COMPLEX_ANALYSIS");
    // New information is needed: a name not shown yet, or attached files.
    expect(
      turnExecutionClassOf(
        read({ answerKind: "FOLLOW_UP", namesSomethingNew: true }),
      ),
    ).toBe("COMPLEX_ANALYSIS");
    expect(
      turnExecutionClassOf(
        read({ answerKind: "FOLLOW_UP", carriesDocuments: true }),
      ),
    ).toBe("COMPLEX_ANALYSIS");
  });

  it("lets only the conversational lanes reuse evidence or skip the web", () => {
    expect(EXECUTION_LANES.CONTEXTUAL_FOLLOW_UP).toEqual({
      reuseEvidence: true,
      publicWeb: false,
      answerModelCalls: 1,
    });
    expect(EXECUTION_LANES.STRUCTURED_QUERY.reuseEvidence).toBe(false);
    expect(EXECUTION_LANES.PUBLIC_RESEARCH.publicWeb).toBe(true);
    expect(EXECUTION_LANES.COMPLEX_ANALYSIS.reuseEvidence).toBe(false);
  });
});
