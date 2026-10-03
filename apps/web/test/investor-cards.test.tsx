// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveredInvestorDtoSchema } from "@capital-q/contracts";

const askAbout = vi.fn();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout }),
}));
vi.mock("@/features/q-aperture", () => ({ QAperture: () => null }));

const { InvestorCards } = await import("@/features/investors/investor-cards");

afterEach(cleanup);

const investor = (coverUrl: string | null) =>
  DiscoveredInvestorDtoSchema.parse({
    investorOrganisationId: "1c4b9266-350c-409d-9582-04a0f771b8a8",
    displayName: "Rift Valley Seed Fund",
    investorType: "VENTURE_FUND",
    websiteUrl: null,
    hqCountry: "KE",
    publicDescription: null,
    deploymentState: null,
    inboundPreference: null,
    photoUrl: null,
    coverUrl,
    reasons: [],
  });

describe("investor cards (demo audit 2026-10-03)", () => {
  it("draws no empty grey band when the investor set no cover", () => {
    const { container } = render(<InvestorCards items={[investor(null)]} />);
    expect(container.querySelector(".aspect-\\[4\\/1\\]")).toBeNull();
  });

  it("offers Ask Q about fit as a draft, outside the card's link", () => {
    render(<InvestorCards items={[investor(null)]} />);
    const ask = screen.getByRole("button", { name: "Ask Q about fit" });
    expect(ask.closest("a")).toBeNull();
    fireEvent.click(ask);
    expect(askAbout).toHaveBeenCalledWith(
      expect.stringContaining("Rift Valley Seed Fund"),
    );
  });
});
