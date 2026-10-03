// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipStatusDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/relationships",
}));
// The detail's data-reading children are out of scope here.
vi.mock("../src/features/integrations/relationship-mail", () => ({
  RelationshipMail: () => null,
}));
vi.mock("../src/features/relationships/relationship-diligence", () => ({
  RelationshipDiligence: () => <p>diligence body</p>,
}));
vi.mock("../src/features/relationships/relationship-commitment", () => ({
  RelationshipCommitment: () => null,
}));
vi.mock("../src/features/relationships/relationship-errands", () => ({
  RelationshipErrands: () => null,
}));
vi.mock("../src/features/schedule/relationship-schedule", () => ({
  RelationshipSchedule: () => null,
}));
vi.mock("../src/features/relationships/relationship-outcome", () => ({
  RelationshipOutcome: () => null,
}));

const { journeyStep } = await import("../src/features/relationships/journey");
const { RelationshipHero } =
  await import("../src/features/relationships/relationship-detail");

afterEach(cleanup);

const at = "2026-10-03T10:00:00Z";
function rel(
  state: RelationshipStatusDto["state"],
  milestones: readonly RelationshipStatusDto["state"][],
): RelationshipStatusDto {
  return {
    relationshipId: "00000000-0000-4000-8000-000000000101",
    companyId: "00000000-0000-4000-8000-000000000102",
    investorOrganisationId: "00000000-0000-4000-8000-000000000103",
    state,
    stateSince: at,
    milestones: milestones.map((m) => ({ state: m, at })),
    nextStep: "FOLLOW_UP",
    projectorVersion: "v2",
  };
}

const profile = {
  photoUrl: null,
  about: null,
  location: null,
  websiteUrl: null,
  chips: [],
  profileHref: null,
};

describe("the relationship journey (design-48)", () => {
  it("is the furthest step reached", () => {
    expect(journeyStep(rel("INTEREST_EXPRESSED", []))).toBe(1);
    expect(
      journeyStep(rel("IN_DILIGENCE", ["CONNECTED", "MEETING_HELD"])),
    ).toBe(4);
    // Paused keeps the step it reached; it never resets the bar.
    expect(journeyStep(rel("PAUSED", ["CONNECTED", "MEETING_HELD"]))).toBe(3);
    expect(journeyStep(rel("DECLINED", ["INTEREST_EXPRESSED"]))).toBeNull();
    expect(journeyStep(rel("DISCOVERED", []))).toBeNull();
  });

  it("says the state in words, with the step, and marks the current step", () => {
    render(
      <RelationshipHero
        counterpart="Savanna Seed Partners"
        relationship={rel("IN_DILIGENCE", ["CONNECTED", "MEETING_HELD"])}
        profile={profile}
      />,
    );
    const line = document.querySelector("[data-relationship-state]");
    expect(line?.textContent).toContain("In diligence · 4 of 5");
    expect(
      screen.getByText("Diligence").closest("li")?.getAttribute("aria-current"),
    ).toBe("step");
    expect(document.querySelector(".cq-glow-card")).toBeNull();
  });
});

describe("phone folds (design-48 v2)", () => {
  it("folds What happened and Diligence behind their headings, with the count", async () => {
    const { RelationshipDetail } =
      await import("../src/features/relationships/relationship-detail");
    const { container } = render(
      <RelationshipDetail
        side="FOUNDER"
        counterpart="Savanna Seed Partners"
        relationship={rel("IN_DILIGENCE", [
          "CONNECTED",
          "MEETING_HELD",
          "IN_DILIGENCE",
        ])}
        actions={null}
        absentSentence=""
        askQ={false}
        profile={profile}
        readAt={Date.parse(at)}
        basePath="/relationships/investor/x"
      />,
    );
    const history = container.querySelector(
      "details[data-collapsible=history]",
    );
    const diligence = container.querySelector(
      "details[data-collapsible=diligence]",
    );
    expect(history?.hasAttribute("open")).toBe(false);
    expect(diligence?.hasAttribute("open")).toBe(false);
    expect(history?.querySelector("summary")?.textContent).toContain(
      "What happened · 3",
    );
    // A link to #diligence lands inside the fold, which opens it.
    expect(diligence?.querySelector("#diligence")).not.toBeNull();
  });
});
