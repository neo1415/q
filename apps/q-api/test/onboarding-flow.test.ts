import { describe, expect, it } from "vitest";

import type { OnboardingState } from "@capital-q/q-tools";

import {
  firstNameOf,
  onboardingFlowFor,
  withNextQuestion,
  withoutAnsweredQuestions,
  withoutAskOfAnswered,
} from "../src/voice/onboarding-flow.js";

const step = (
  stepKey: string,
  over: Partial<OnboardingState["steps"][number]> = {},
): OnboardingState["steps"][number] => ({
  stepKey,
  question: `Question ${stepKey}?`,
  kind: "TEXT",
  required: false,
  status: "OPEN",
  value: null,
  ...over,
});

const state = (
  steps: OnboardingState["steps"],
  next: OnboardingState["next"],
): OnboardingState => ({
  journey: "founder",
  currentStepKey: null,
  canComplete: false,
  completed: false,
  steps,
  checks: [],
  next,
  minutesLeft: 6,
});

describe("onboarding flow (owner 2026-10-16)", () => {
  it("offers a skip on an optional next question", () => {
    const flow = onboardingFlowFor({
      journey: "founder",
      opening: false,
      state: state(
        [step("F1.website", { priority: "IMPORTANT", coverage: "MISSING" })],
        [{ stepKey: "F1.website", reason: "IMPORTANT_MISSING" }],
      ),
      firstName: null,
      knownName: null,
    });
    expect(flow.note).toMatch(/we can come back to this/);
    expect(withNextQuestion("Saved.", flow, false)).toMatch(/\?.*skip it\.$/);
  });

  it("when essentials are done: says so, names what is optional, offers to finish or go on", () => {
    const flow = onboardingFlowFor({
      journey: "founder",
      opening: false,
      state: state(
        [
          step("F1.stage", {
            required: true,
            priority: "ESSENTIAL",
            status: "ANSWERED",
            coverage: "CONFIRMED_SAVED",
          }),
          step("F4.functions", {
            priority: "OPTIONAL",
            coverage: "DEFERRABLE",
          }),
        ],
        [{ stepKey: "F4.functions", reason: "OPTIONAL_OFFER" }],
      ),
      firstName: null,
      knownName: null,
    });
    expect(flow.essentialsDone).toBe(true);
    expect(flow.next).toBeNull();
    expect(flow.note).toMatch(/Every essential is covered/);
    expect(flow.note).toContain("Question F4.functions?");
    expect(withNextQuestion("All saved.", flow, false)).toMatch(
      /finish now, or keep going/,
    );
    expect(withNextQuestion("All done.", flow, true)).toBe("All done.");
  });

  it("reads a first name, never a whole name or an email", () => {
    expect(firstNameOf("Ines Duarte")).toBe("Ines");
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it("takes out a question the record already answers (live 2026-10-16)", () => {
    const reply =
      "Your description and team are noted. In a sentence or two, what does the company do?";
    const out = withoutAnsweredQuestions(
      reply,
      state(
        [
          step("F1.description", {
            status: "ANSWERED",
            question: "What does it do?",
          }),
        ],
        [],
      ),
      { "F1.description": "In a sentence or two, what does the company do?" },
    );
    expect(out).toBe("Your description and team are noted.");
  });
});

// Live 2026-10-29: the deck's team size of 3 was kept (06:11:48), and at
// 06:13 Q asked "how many people work at Ajali Health today, including the
// three founders?" -- a paraphrase no wording check could match.
describe("a reply whose declared question the record already answered", () => {
  const answered = state(
    [step("F4.team_size", { status: "ANSWERED" }), step("F4.full_time")],
    [],
  );
  const reply =
    "Thanks, Daniel. One final essential: how many people work at Ajali Health today, including the three founders?";

  it("loses its question, so the backstop asks what is really open", () => {
    expect(withoutAskOfAnswered(reply, "F4.team_size", answered, [])).toBe(
      "Thanks, Daniel.",
    );
  });

  it("keeps a question about a step still open, or answered in this turn", () => {
    expect(withoutAskOfAnswered(reply, "F4.full_time", answered, [])).toBe(
      reply,
    );
    expect(
      withoutAskOfAnswered(reply, "F4.team_size", answered, ["F4.team_size"]),
    ).toBe(reply);
    expect(withoutAskOfAnswered(reply, null, answered, [])).toBe(reply);
  });
});

describe("QA F-48: Q greets by a given name, or none", () => {
  it("never greets with the first word of their organisation's name", () => {
    expect(firstNameOf("Ama Mensah", "Tamarind Ledger")).toBe("Ama");
    expect(
      firstNameOf("Audit Ridge Capital", "Audit Ridge Capital"),
    ).toBeNull();
    expect(firstNameOf("audit team", "Audit Ridge")).toBeNull();
    expect(firstNameOf("Ama Mensah")).toBe("Ama");
  });
});

describe("a saved answer that wants evidence is never asked again (QA F-132, 25 Oct)", () => {
  const evidence = state(
    [
      step("F1.categories", { status: "ANSWERED", value: "Logistics" }),
      step("F5.customers", {
        question: "How many paying customers do you have?",
        status: "ANSWERED",
        value: "1,200",
        priority: "IMPORTANT",
        coverage: "EVIDENCE_NEEDED",
      }),
    ],
    [{ stepKey: "F5.customers", reason: "EVIDENCE_NEEDED" }],
  );
  const flow = onboardingFlowFor({
    journey: "founder",
    opening: false,
    state: evidence,
    firstName: null,
    knownName: null,
  });

  it("asks for the document, not the answer, and brings no controls with it", () => {
    expect(flow.next?.question).toBe(
      "Do you have something that shows your paying customers, such as a customer list or your accounts?",
    );
    expect(flow.next?.evidence).toBe(true);
  });

  it("the skip offer is said once, after the one question", () => {
    const reply = withNextQuestion(
      withoutAnsweredQuestions(
        "Thanks, I've noted Logistics (sector). How many paying customers do you have? We can come back to this if you'd rather skip it.",
        evidence,
        { "F5.customers": "How many paying customers do you have?" },
      ),
      flow,
      false,
    );
    expect(reply).toBe(
      "Thanks, I've noted Logistics (sector). Do you have something that shows your paying customers, such as a customer list or your accounts? We can come back to this if you'd rather skip it.",
    );
  });
});
