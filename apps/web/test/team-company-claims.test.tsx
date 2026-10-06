// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const decide = vi.fn();
vi.mock("../src/features/team/team-actions", () => ({
  decideCompanyClaimAction: (...args: unknown[]) =>
    decide(...args) as Promise<unknown>,
}));

import { CompanyClaims } from "../src/features/team/company-claims";

/** P14: a company's admins let in (as a Member) or decline a claim on Team. */

afterEach(() => {
  cleanup();
  decide.mockReset();
});

const CLAIM = {
  requestId: "00000000-0000-4000-8000-0000000000d1",
  companyId: "00000000-0000-4000-8000-0000000000c1",
  companyName: "Ledgerline",
  requesterName: "Emeka Chukwu",
  method: "WORK_EMAIL" as const,
  workEmailDomain: "ledgerline.example",
  emailConfirmed: true,
  requestedAt: "2026-10-06T10:00:00.000Z",
};

describe("CompanyClaims", () => {
  it("shows nothing when nobody asked", () => {
    const { container } = render(<CompanyClaims initial={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lets a claimant in as a Member, naming the domain, never the address", async () => {
    decide.mockResolvedValue({ ok: true, value: { status: "APPROVED" } });
    render(<CompanyClaims initial={[CLAIM]} />);
    expect(
      screen.getByText(/at ledgerline.example \(confirmed\)/u),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Let in" }));
    expect(
      await screen.findByText(
        /Emeka Chukwu can now work on Ledgerline as a Member/u,
      ),
    ).toBeTruthy();
    expect(decide).toHaveBeenCalledWith(CLAIM.companyId, CLAIM.requestId, true);
  });
});
