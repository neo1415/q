import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  createInterviewer,
  spokenFigure,
  spokenMoney,
} from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * Q speaks like an analyst, not like a database (Workstream A).
 *
 * Two things the live transcript did that no institutional product
 * should. It read its own stored integers out — "Minimum cheque: 50000.
 * Is that right?" — which is a machine reciting a column. And it asked
 * "Which mandate are we defining?", which is the platform's internal
 * vocabulary said to somebody who came to describe how they invest and
 * has no way to answer it.
 *
 * Canonical data does not change: 50000 is still what goes to the owning
 * service. Only the rendering does.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

describe("figures are rendered the way a person says them", () => {
  it("names millions and billions and groups everything else", () => {
    expect(spokenFigure(50_000)).toBe("50,000");
    expect(spokenFigure(3_000_000)).toBe("3 million");
    expect(spokenFigure(1_500_000)).toBe("1.5 million");
    expect(spokenFigure(2_000_000_000)).toBe("2 billion");
    expect(spokenFigure(4)).toBe("4");
  });

  it("puts the session's own currency in front of money", () => {
    expect(spokenMoney(50_000, "eur")).toBe("€50,000");
    expect(spokenMoney(3_000_000, "eur")).toBe("€3 million");
    expect(spokenMoney(250_000, "gbp")).toBe("£250,000");
    // No currency recorded is not a licence to invent dollars.
    expect(spokenMoney(50_000, null)).toBe("50,000");
  });

  it("never reads a raw stored figure back at the person", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Zino",
        "I1.deployment_status": "actively_investing",
        "I2.currency": "eur",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Noted.",
        answers: [
          {
            stepKey: "I2.cheque_min",
            value: "50000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "We start at fifty thousand euros."),
    );

    expect(outcome.reply).toContain("€50,000");
    expect(outcome.reply).not.toMatch(/\b50000\b/);
  });

  it("reports progress in spoken figures too", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_typical",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Zino",
        "I2.currency": "eur",
        "I2.cheque_min": "3000000",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "Here's where we are.",
        answerFromState: "PROGRESS",
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "where are we?"));

    expect(outcome.reply).toContain("€3 million");
    expect(outcome.reply).not.toContain("3000000");
  });
});

describe("the platform's own vocabulary stays inside the platform", () => {
  it("resolves the only mandate itself rather than asking about one", async () => {
    /**
     * The journey requires a mandate before anything in I2 can be
     * written, and its candidates exist on the view only while that step
     * is current — so the model has no identifier to answer with and the
     * interview stalls there while every cheque and stage behind it is
     * refused. The journey's own `suggestedMandateId` says when there is
     * nothing to choose, so the platform acts on it and says nothing.
     */
    const world = investorSession({
      currentStepKey: "I1.mandate_context",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Zino",
        "I1.deployment_status": "actively_investing",
      },
      mandates: {
        candidates: ["55555555-5555-4555-8555-000000000001"],
        suggested: "55555555-5555-4555-8555-000000000001",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, intent: "OPENING", reply: "Where were we?" }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, ""));

    expect(world.recordedValue("I1.mandate_context")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "INVESTOR_MANDATE",
      resourceIds: ["55555555-5555-4555-8555-000000000001"],
    });
    expect(outcome.reply).not.toMatch(/mandate/i);
    expect(outcome.asking?.stepKey).not.toBe("I1.mandate_context");
  });

  it("keeps internal vocabulary out of a progress answer", async () => {
    /**
     * Found in a real local conversation: asked "where are we so far?",
     * Q answered with the count and then "We are on this one: Which
     * mandate are we defining." The progress sentence is composed by the
     * runtime from the step's raw prompt, so it walked straight past the
     * rule the rest of the interview follows. One place names a step to
     * a person, and this is a caller of it.
     */
    const world = investorSession({
      currentStepKey: "I1.mandate_context",
      recorded: {
        "I0.investor_type": "family_office",
        "I0.organisation_name": "Zino",
      },
      mandates: { candidates: [], suggested: null },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "Here's where we are.",
        answerFromState: "PROGRESS",
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "where are we so far?"));

    expect(outcome.reply).toContain("2 of 35 answered");
    expect(outcome.reply).not.toMatch(/mandate/i);
    expect(outcome.reply).toContain("main investment strategy");
  });

  it("does not report a reference the platform resolved as their progress", async () => {
    // Live: "Are we setting up your main investment strategy, or a
    // different one: 1 recorded" — a row count, offered to a person as
    // an account of their own progress, for a choice they never made.
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: {
        "I0.investor_type": "family_office",
        "I0.organisation_name": "Zino",
        "I1.mandate_context": "55555555-5555-4555-8555-000000000001",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "Here's where we are.",
        answerFromState: "PROGRESS",
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "where are we?"));

    expect(outcome.reply).toContain("Zino");
    expect(outcome.reply).not.toContain("1 recorded");
    expect(outcome.reply).not.toMatch(/investment strategy:/i);
  });

  it("asks in plain words when there is a genuine choice to make", async () => {
    const world = investorSession({
      currentStepKey: "I1.mandate_context",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Zino",
        "I1.deployment_status": "actively_investing",
      },
      mandates: {
        candidates: [
          "55555555-5555-4555-8555-000000000001",
          "55555555-5555-4555-8555-000000000002",
        ],
        // Two drafts: the journey does not preselect, so Q must ask.
        suggested: null,
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Sorry, say again?",
        answers: [
          {
            stepKey: "I1.mandate_context",
            value: "not an identifier",
            confidence: "MEDIUM",
            clarity: "SETTLED",
          },
        ],
        askNext: "I1.mandate_context",
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "erm"));

    // Nothing recorded, and the question a person hears is about
    // investment strategy, not about a mandate context.
    expect(world.recordedValue("I1.mandate_context")).toBeUndefined();
    expect(outcome.reply).toContain("main investment strategy");
    expect(outcome.reply).not.toMatch(/mandate context/i);
  });
});
