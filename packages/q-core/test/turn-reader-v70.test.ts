import { describe, expect, it } from "vitest";

import {
  TURN_READER_V69,
  TURN_READER_V70,
  TurnReaderV70ResultSchema,
  V62_WORK_FROM_EARLIER,
  V70_DIRECTS_WORK,
  V70_PLAN_ASK,
  PLAN_F03_ASK,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Situation-first planning (design 2026-10-28, S3): a plan ask and a
 * direction to running work, read by meaning; additive over v65's output.
 */
const BASE = { kind: "QUESTION_TO_Q", confidence: "HIGH", transcript: "CLEAR" };

describe("TURN_READER v70: planAsk and directsWork", () => {
  it("is the active reader: v69 kept whole plus two rules after WORK FROM EARLIER", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(70);
    expect(TURN_READER_V69.status).toBe("DEPRECATED");
    expect(TURN_READER_V70.output).toMatchObject({
      schemaVersion: 70,
      onlyWhatApplies: true,
    });
    expect(TURN_READER_V70.template).toContain(
      `${V62_WORK_FROM_EARLIER}${V70_PLAN_ASK}${V70_DIRECTS_WORK}`,
    );
    expect(
      TURN_READER_V70.template.replace(
        `${V70_PLAN_ASK}${V70_DIRECTS_WORK}`,
        "",
      ),
    ).toBe(TURN_READER_V69.template);
  });

  it("reads by meaning in any language, with the owner's examples", () => {
    expect(V70_PLAN_ASK).toMatch(
      /by what it means, in any words and any language/u,
    );
    for (const said of [
      "how do I improve my chances with investors?",
      "what should I do this week?",
      "how do I get better deal flow?",
    ]) {
      expect(V70_PLAN_ASK).toContain(said);
    }
    expect(V70_PLAN_ASK).toMatch(/never instead of them/u);
    expect(V70_DIRECTS_WORK).toContain("focus on the fintech ones first");
    expect(V70_DIRECTS_WORK).toContain("drop the deck step");
  });

  it("reads a plan ask, and leaves it null by default", () => {
    const read = TurnReaderV70ResultSchema.parse({
      ...BASE,
      question: { kind: "ADVICE", text: "How do I improve my chances?" },
      nextSteps: true,
      planAsk: { kind: "IMPROVE", research: "MARKET", side: "FOUNDER" },
    });
    expect(read.planAsk).toEqual({
      kind: "IMPROVE",
      research: "MARKET",
      side: "FOUNDER",
      subject: "OWN",
      deliverable: "PLAN",
    });
    expect(read.nextSteps).toBe(true);
    expect(read.directsWork).toBe(false);
    const plain = TurnReaderV70ResultSchema.parse(BASE);
    expect(plain.planAsk).toBeNull();
    expect(plain.directsWork).toBe(false);
    // research and side default when only the kind is written.
    expect(
      TurnReaderV70ResultSchema.parse({ ...BASE, planAsk: { kind: "GOAL" } })
        .planAsk,
    ).toEqual({
      kind: "GOAL",
      research: "NONE",
      side: null,
      subject: "OWN",
      deliverable: "PLAN",
    });
  });

  it("reads a direction to running work", () => {
    expect(
      TurnReaderV70ResultSchema.parse({ ...BASE, directsWork: true })
        .directsWork,
    ).toBe(true);
  });

  it("a malformed value costs itself, never the reading; v65 fields are kept", () => {
    const read = TurnReaderV70ResultSchema.parse({
      ...BASE,
      planAsk: { kind: "SOMETHING" },
      directsWork: "yes",
      discoverWhom: "INVESTORS",
      replyTo: { kind: "NEW" },
    });
    expect(read.planAsk).toBeNull();
    expect(read.directsWork).toBe(false);
    expect(read.discoverWhom).toBe("INVESTORS");
    expect(read.replyTo).toEqual({ kind: "NEW", card: null });
  });

  it("addendum 3: the F03 ask is a clear ask about their own company, deliverable a document review", () => {
    expect(V70_PLAN_ASK).toContain(
      `"${PLAN_F03_ASK}" is planAsk {kind GOAL, subject OWN, deliverable DOCUMENT_REVIEW}`,
    );
    expect(V70_PLAN_ASK).toMatch(
      /Never read their own work as an unclear subject/u,
    );
    // The reading a model gives it (fake output): own company, a review
    // with confirmation, nothing asked about whom it concerns.
    const read = TurnReaderV70ResultSchema.parse({
      ...BASE,
      kind: "TOOL_REQUEST",
      teamJob: true,
      planAsk: { kind: "GOAL", deliverable: "DOCUMENT_REVIEW" },
    });
    expect(read.planAsk).toEqual({
      kind: "GOAL",
      research: "NONE",
      side: null,
      subject: "OWN",
      deliverable: "DOCUMENT_REVIEW",
    });
    expect(read.namedOther).toBeNull();
  });

  it("addendum 3: improving their chances is a plan about their own company", () => {
    expect(V70_PLAN_ASK).toContain(
      '"how do I improve my chances with investors?" is planAsk {kind IMPROVE, subject OWN, deliverable PLAN}',
    );
    const read = TurnReaderV70ResultSchema.parse({
      ...BASE,
      planAsk: { kind: "IMPROVE", side: "FOUNDER" },
    });
    expect(read.planAsk?.subject).toBe("OWN");
    expect(read.planAsk?.deliverable).toBe("PLAN");
  });
});
