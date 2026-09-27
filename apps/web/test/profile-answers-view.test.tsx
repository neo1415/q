// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileAnswers } from "../src/features/profile/profile-answers-view";

afterEach(cleanup);

describe("ProfileAnswers", () => {
  it("shows values, 'Not added' with an Add link, and an Edit link to the existing edit path", () => {
    render(
      <ProfileAnswers
        journey="investor"
        state={{
          status: "READ",
          groups: [
            {
              id: "cheque",
              label: "Cheque size",
              lines: [
                {
                  stepKey: "I2.cheque_min",
                  title: "Smallest",
                  value: "USD 250,000",
                },
                { stepKey: "I2.cheque_max", title: "Largest", value: null },
              ],
            },
          ],
        }}
      />,
    );
    const group = screen.getByRole("region", { name: "Cheque size" });
    expect(within(group).getByText("USD 250,000")).toBeTruthy();
    expect(within(group).getByText("Not added")).toBeTruthy();
    expect(
      within(group)
        .getByRole("link", { name: "Add largest" })
        .getAttribute("href"),
    ).toBe("/onboarding/investor?review=1");
    expect(
      within(group)
        .getByRole("link", { name: "Edit cheque size" })
        .getAttribute("href"),
    ).toBe("/onboarding/investor?review=1");
    // Evidence on demand only (R23): one closed disclosure, no chips.
    expect(screen.getByText("How this is known").closest("details")?.open).toBe(
      false,
    );
  });

  it("sends a raise that is already a capital objective to Capital", () => {
    render(
      <ProfileAnswers
        journey="founder"
        state={{
          status: "READ",
          groups: [
            {
              id: "raise",
              label: "Raise",
              lines: [
                {
                  stepKey: "F6.target_amount",
                  title: "Target",
                  value: "EUR 2,000,000",
                },
                {
                  stepKey: "objective.stage",
                  title: "Round stage",
                  value: null,
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Edit raise" }).getAttribute("href"),
    ).toBe("/capital");
  });

  it("points to setup when nothing was answered", () => {
    render(<ProfileAnswers journey="founder" state={{ status: "NONE" }} />);
    expect(
      screen.getByRole("link", { name: "Set up with Q" }).getAttribute("href"),
    ).toBe("/onboarding/founder");
  });
});
