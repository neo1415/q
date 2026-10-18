// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UnicornPotentialDtoSchema,
  UNICORN_POTENTIAL_CAVEAT,
  type FounderApplicationDto,
} from "@capital-q/contracts";

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout: vi.fn() }),
}));

vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  claimAction: vi.fn(),
  claimEvidenceCompleteAction: vi.fn(),
  claimEvidenceUploadAction: vi.fn(),
  confirmClaimCodeAction: vi.fn(),
  searchClaimableAction: vi.fn(),
}));
vi.mock("../src/features/team/team-actions", () => ({
  askToJoinAction: vi.fn(),
}));

import { GateqUnicornAssessment } from "../src/features/gateq/page/unicorn-assessment";
import { FounderApplications } from "../src/features/gateq/page/founder-views";
import { syntheticUnicornAssessment } from "./fixtures/unicorn-potential";

const value = {
  companyId: "00000000-0000-4000-8000-000000000001",
  assessment: {
    ...syntheticUnicornAssessment,
    missing: ["Share dated retention cohorts"],
  },
};
const application: FounderApplicationDto = {
  applicationId: "00000000-0000-4000-8000-000000000002",
  fund: "Synthetic investor",
  sentAt: "2026-10-17T12:00:00.000Z",
  status: "SENT",
  reasonCode: null,
  message: null,
};
afterEach(cleanup);

describe("GateQ current company assessment", () => {
  it("shows nothing when the authorized server payload omits premium assessment", () => {
    const { container } = render(<GateqUnicornAssessment value={undefined} />);
    expect(container.innerHTML).toBe("");
  });
  it("preserves the score, evidence labels and distinction from frozen application and decisions", () => {
    expect(UnicornPotentialDtoSchema.safeParse(value.assessment).success).toBe(
      true,
    );
    render(<GateqUnicornAssessment value={value} />);
    expect(
      screen.getByRole("heading", { name: "Current company assessment" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Separate from the application frozen at submission/),
    ).toBeTruthy();
    expect(screen.getByText(UNICORN_POTENTIAL_CAVEAT)).toBeTruthy();
    expect(document.querySelector("summary")?.textContent).toContain("50/100");
    expect(document.querySelectorAll("[data-unicorn-pillar]")).toHaveLength(12);
    expect(
      screen.getAllByText(/user claim · self reported · current/),
    ).toHaveLength(24);
  });
  it("does not infer founder premium access from application presence", () => {
    render(<FounderApplications state="full" applications={[application]} />);
    expect(screen.getByText("Synthetic investor")).toBeTruthy();
    expect(screen.queryByTestId("gateq-unicorn-assessment")).toBeNull();
  });
  it("shows one current assessment for repeated applications by the same canonical company", () => {
    render(
      <FounderApplications
        state="full"
        applications={[
          { ...application, unicornPotential: value },
          {
            ...application,
            applicationId: "00000000-0000-4000-8000-000000000003",
            fund: "Second synthetic investor",
            unicornPotential: value,
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId("gateq-unicorn-assessment")).toHaveLength(1);
    expect(screen.getByText("Second synthetic investor")).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: "Add evidence in your documents",
          hidden: true,
        })
        .getAttribute("href"),
    ).toBe("/documents?tab=mine");
    expect(
      screen.queryByRole("button", {
        name: "Draft an evidence request with Q",
        hidden: true,
      }),
    ).toBeNull();
  });
});
