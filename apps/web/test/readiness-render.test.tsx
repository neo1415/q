// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReadinessDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/capital",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../src/features/readiness/readiness-actions", () => ({
  markPlanStepAction: vi.fn(() => Promise.resolve({ ok: true })),
  answerQuestionAction: vi.fn(() =>
    Promise.resolve({ ok: true, remaining: 0 }),
  ),
  setAsideQuestionAction: vi.fn(() =>
    Promise.resolve({ ok: true, remaining: 0 }),
  ),
}));

import { ActionPlanBoard } from "../src/features/readiness/action-plan-board";
import { FollowUpStack } from "../src/features/readiness/follow-up-stack";
import { ReadinessSection } from "../src/features/readiness/readiness-section";

/** Q.03/Q.04/Q.01 on screen: words and shapes, never a percentage. */

const READINESS: ReadinessDto = {
  companyId: "11111111-1111-4111-8111-111111111111",
  rulesVersion: "readiness-rules/v1",
  revision: 2,
  assessedAt: "2026-10-07T00:00:00.000Z",
  stageCode: "seed",
  pillars: [
    {
      pillar: "FOUNDER",
      label: "Team",
      status: "STRONG",
      summary: "On record: Founders named, Founder identity verified.",
      evidence: [
        {
          label: "2 founders, 2 full-time",
          source: "PROFILE",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          note: "Your profile",
          ref: null,
        },
      ],
      improve: [],
    },
    {
      pillar: "BUSINESS_ECONOMICS",
      label: "Financials",
      status: "UNKNOWN",
      summary: "No burn, runway, margin or unit economics shared.",
      evidence: [],
      improve: ["Add monthly burn."],
    },
  ],
  blockers: [
    {
      id: "raise.use-of-funds",
      pillar: "INVESTMENT_READINESS",
      kind: "MISSING",
      title: "No use of funds",
      why: "A target with no plan for the money reads as unfinished.",
      actionKey: "use-of-funds",
    },
  ],
  actions: [
    {
      key: "use-of-funds",
      pillar: "INVESTMENT_READINESS",
      closesGapId: "raise.use-of-funds",
      priority: "NOW",
      title: "Name your use of funds",
      why: "A target with no plan for the money reads as unfinished.",
      next: "Say where the money goes.",
      doneWhen: "The raise lists where the money goes.",
      owner: "WITH_Q",
      ownerLabel: "Q drafts, you approve",
      state: "OPEN",
      doneAt: null,
      href: "/capital",
      askQ: "Draft my use of funds.",
    },
    {
      key: "confirm-founders",
      pillar: "FOUNDER",
      closesGapId: "team.founders",
      priority: "NEXT",
      title: "Confirm who the founders are",
      why: "Investors back people first.",
      next: "Add the founders.",
      doneWhen: "Founder count is on your profile.",
      owner: "FOUNDER",
      ownerLabel: "You",
      state: "DONE_BY_EVIDENCE",
      doneAt: null,
      href: "/profile",
      askQ: null,
    },
  ],
  followUps: [
    {
      questionId: "22222222-2222-4222-8222-222222222222",
      question: "Monthly deliveries: which figure is current?",
      why: "Investors will compare your deck and your report.",
      reason: "CONTRADICTION",
      pillar: "COMMERCIAL_VALIDATION",
      readings: ["Deck: 1,200 a month", "March report: 860 a month"],
      quickAnswers: ["1,200 is current", "860 is current"],
      typed: "NONE",
      answerable: true,
      editHref: null,
      askedAt: "2026-10-07T00:00:00.000Z",
    },
  ],
  uncertainty: ["Statuses come from what you've shared."],
};

describe("readiness on screen", () => {
  it("shows each pillar's status in words, unknown neutral, and no percentage", () => {
    const { container } = render(<ReadinessSection readiness={READINESS} />);
    expect(screen.getAllByText("Not shared yet").length).toBeGreaterThan(0);
    expect(screen.getByText("No use of funds")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/\d\s?%/u);
    expect(
      container.querySelector('[data-readiness-status="UNKNOWN"]'),
    ).not.toBeNull();
  });

  it("puts the plan in Now / Next / Done with an owner and Q's offer", () => {
    render(<ActionPlanBoard readiness={READINESS} />);
    expect(screen.getByText("Name your use of funds")).toBeTruthy();
    expect(screen.getByText("Q drafts, you approve")).toBeTruthy();
    expect(screen.getByText("Let Q do it")).toBeTruthy();
    expect(screen.getByText("Closed by evidence")).toBeTruthy();
  });

  it("asks one question at a time with the readings the founder chooses between", async () => {
    const actions = await import("../src/features/readiness/readiness-actions");
    render(<FollowUpStack followUps={READINESS.followUps} />);
    expect(screen.getByText("Deck: 1,200 a month")).toBeTruthy();
    fireEvent.click(screen.getByText("860 is current"));
    await vi.waitFor(() => {
      expect(actions.answerQuestionAction).toHaveBeenCalledWith(
        "22222222-2222-4222-8222-222222222222",
        { kind: "QUICK", index: 1 },
        expect.stringMatching(/^fu-/u),
      );
    });
  });
});
