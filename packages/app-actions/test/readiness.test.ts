import { describe, expect, it } from "vitest";

import type { ReadinessDto } from "@capital-q/contracts";

import { actionByWords, readinessItems } from "../src/actions/readiness.js";
import type { AppActionPorts } from "../src/ports.js";

const action = (key: string, title: string) => ({
  key,
  pillar: "INVESTMENT_READINESS" as const,
  closesGapId: key,
  priority: "NOW" as const,
  title,
  why: "Why it matters.",
  next: "Do the thing.",
  doneWhen: "Done.",
  owner: "FOUNDER" as const,
  ownerLabel: "You",
  state: "OPEN" as const,
  doneAt: null,
  href: null,
  askQ: null,
});

const PLAN: ReadinessDto = {
  companyId: "11111111-1111-4111-8111-111111111111",
  rulesVersion: "readiness-rules/v1",
  revision: 1,
  assessedAt: "2026-10-07T00:00:00.000Z",
  stageCode: "seed",
  pillars: [
    {
      pillar: "BUSINESS_ECONOMICS",
      label: "Financials",
      status: "UNKNOWN",
      summary: "No burn shared.",
      evidence: [],
      improve: [],
    },
  ],
  blockers: [
    {
      id: "raise.deck",
      pillar: "INVESTMENT_READINESS",
      kind: "MISSING",
      title: "No pitch deck",
      why: "Investors ask for it first.",
      actionKey: "upload-deck",
    },
  ],
  actions: [
    action("upload-deck", "Upload your pitch deck"),
    action("use-of-funds", "Name your use of funds"),
  ],
  followUps: [
    {
      questionId: "22222222-2222-4222-8222-222222222222",
      question: "How many paying customers?",
      why: null,
      reason: "MATERIAL_GAP",
      pillar: "COMMERCIAL_VALIDATION",
      readings: [],
      quickAnswers: ["Under 10", "10 to 50"],
      typed: "NONE",
      answerable: true,
      editHref: null,
      askedAt: "2026-10-07T00:00:00.000Z",
    },
  ],
  uncertainty: [],
};

describe("readiness actions", () => {
  it("finds a plan step by key or by the words said, and never guesses a tie", () => {
    expect(actionByWords(PLAN, "upload-deck")?.key).toBe("upload-deck");
    expect(actionByWords(PLAN, "the deck upload")?.key).toBe("upload-deck");
    expect(actionByWords(PLAN, "funds")?.key).toBe("use-of-funds");
    expect(actionByWords(PLAN, "something else entirely")).toBeNull();
  });

  it("reads readiness, plan and questions in words, never as a number", async () => {
    const ports = {
      readiness: { read: () => Promise.resolve(PLAN) },
    } as unknown as AppActionPorts;
    const actor = {} as never;
    const readiness = await readinessItems(ports, actor, "readiness");
    expect(readiness?.[0]?.title).toBe("Could stop the raise: No pitch deck");
    expect(readiness?.find((item) => item.title === "Financials")?.status).toBe(
      "not shared yet",
    );
    const plan = await readinessItems(ports, actor, "plan");
    expect(plan?.[0]?.status).toBe("to do (now)");
    const questions = await readinessItems(ports, actor, "questions");
    expect(questions?.[0]?.facts["quickAnswers"]).toBe("Under 10 | 10 to 50");
  });

  it("is empty for anyone without a company of their own", async () => {
    const ports = {
      readiness: { read: () => Promise.resolve(null) },
    } as unknown as AppActionPorts;
    expect(await readinessItems(ports, {} as never, "plan")).toEqual([]);
  });
});
