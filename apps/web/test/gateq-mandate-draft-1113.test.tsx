// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InvestorMandateDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { mandateDraftText } =
  await import("../src/features/gateq/mandate-draft");
const { PolicyEditor } = await import("../src/features/gateq/policy-editor");

/**
 * GateQ B2 (owner, 13 Nov): "Draft my GateQ rules with Q" from the
 * investor's authorised mandate. Their active mandate, in words, fills the
 * rules editor; they see and change it, Q drafts, they publish.
 */
const mandate = {
  id: "11111111-1111-4111-8111-111111111111",
  investorOrganisationId: "22222222-2222-4222-8222-222222222222",
  name: "Savanna Seed Fund I",
  status: "ACTIVE",
  effectiveFrom: null,
  effectiveTo: null,
  discoveryMode: null,
  chequeRange: { currency: "USD", min: "250000", max: "1000000" },
  minStageCode: "pre_seed",
  maxStageCode: "seed",
  rawMandateText: "We back B2B software and fintech founders in Africa.",
  constraints: [],
  taxonomyPreferences: [
    {
      nodeId: "33333333-3333-4333-8333-333333333333",
      vocabularyCode: "industry",
      canonicalCode: "fintech",
      preferenceStrength: "PREFERRED",
      isExclusion: false,
    },
    {
      nodeId: "44444444-4444-4444-8444-444444444444",
      vocabularyCode: "geography",
      canonicalCode: "NG",
      preferenceStrength: "PREFERRED",
      isExclusion: false,
    },
    {
      nodeId: "55555555-5555-4555-8555-555555555555",
      vocabularyCode: "industry",
      canonicalCode: "online_betting",
      preferenceStrength: "EXCLUDED",
      isExclusion: true,
    },
  ],
  version: 3,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
} as unknown as InvestorMandateDto;

afterEach(cleanup);

describe("their mandate, in words, for the rules editor", () => {
  it("says only what the mandate states, exclusions as exclusions", () => {
    const text = mandateDraftText(mandate);
    expect(text).toContain("We invest from pre-seed to seed stage.");
    expect(text).toContain("USD 250,000 to USD 1,000,000");
    expect(text).toContain("industry: fintech.");
    expect(text).toContain("geography: Nigeria.");
    expect(text).toContain("We do not invest in online betting.");
    expect(text).toContain("We back B2B software and fintech founders");
  });

  it("with no rules yet, the editor starts from it, and says so", () => {
    const text = mandateDraftText(mandate);
    render(<PolicyEditor hasRules={false} fromMandate={text} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      text,
    );
    expect(
      document.querySelector("[data-gateq-mandate-filled]")?.textContent,
    ).toMatch(/nothing is published until you do it/u);
  });

  it("with rules already, one button fills it in; without a mandate, none", async () => {
    const text = mandateDraftText(mandate);
    render(<PolicyEditor hasRules fromMandate={text} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("");
    await userEvent.click(
      screen.getByRole("button", { name: "Use my Capital Q mandate" }),
    );
    expect(box.value).toBe(text);
    cleanup();
    render(<PolicyEditor hasRules fromMandate={null} />);
    expect(
      screen.queryByRole("button", { name: "Use my Capital Q mandate" }),
    ).toBeNull();
  });
});
