import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { InvestorMandateDto } from "@capital-q/contracts";

vi.mock("server-only", () => ({}));

const { withDeclaredMandate } =
  await import("../src/features/profile/profile-answers");
const { declaredMandateLines } =
  await import("../src/features/profile/profile-data");

/**
 * P1-8 and P1-7 of the onboarding plan (2026-11-07).
 * - /profile's mandate shows the canonical mandate: Q's approved
 *   change_my_mandate writes the mandate, never the onboarding answers,
 *   so the page kept showing the old cheque.
 * - A finished founder setup is never stepped back into: the server
 *   refuses to move a finished session, so "?review=1" only showed an
 *   error.
 */

const mandate = (patch: Partial<InvestorMandateDto>): InvestorMandateDto => ({
  id: "a0000000-0000-4000-8000-000000000001",
  investorOrganisationId: "a0000000-0000-4000-8000-000000000002",
  name: "Main mandate",
  status: "ACTIVE",
  effectiveFrom: null,
  effectiveTo: null,
  discoveryMode: null,
  chequeRange: null,
  minStageCode: null,
  maxStageCode: null,
  rawMandateText: null,
  constraints: [],
  taxonomyPreferences: [],
  version: 2,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-07T10:00:00.000Z",
  ...patch,
});

const fromOnboarding = [
  {
    id: "mandate",
    label: "Investment mandate",
    lines: [{ stepKey: "I2.stages", title: "Stages", value: "Seed" }],
  },
  {
    id: "cheque",
    label: "Cheque size",
    lines: [
      { stepKey: "I2.cheque_min", title: "Smallest", value: "USD 100,000" },
      { stepKey: "I2.cheque_max", title: "Largest", value: "USD 500,000" },
    ],
  },
] as const;

describe("/profile shows the mandate as it stands now (P1-8)", () => {
  it("a cheque Q changed shows, not the onboarding answer it replaced", () => {
    const lines = declaredMandateLines(
      mandate({
        chequeRange: { currency: "USD", min: "250000", max: "1000000" },
      }),
    );
    const groups = withDeclaredMandate(fromOnboarding, lines);
    const cheque = groups.find((group) => group.id === "cheque");
    expect(cheque?.lines.map((line) => line.value)).toEqual([
      "USD 250,000",
      "USD 1,000,000",
    ]);
  });

  it("what the mandate doesn't state leaves the onboarding answer (unknown stays unknown)", () => {
    const groups = withDeclaredMandate(
      fromOnboarding,
      declaredMandateLines(mandate({})),
    );
    expect(groups).toEqual(fromOnboarding);
  });

  it("their own words for the mandate show under 'In your words'", () => {
    const groups = withDeclaredMandate(
      fromOnboarding,
      declaredMandateLines(
        mandate({ rawMandateText: "Early fintech in West Africa." }),
      ),
    );
    expect(groups.find((group) => group.id === "thesis")?.lines[0]?.value).toBe(
      "Early fintech in West Africa.",
    );
  });
});

describe("a finished founder setup is never stepped back into (P1-7)", () => {
  it("the founder screen never asks the server to move a finished session", () => {
    const root = process.cwd().endsWith("apps/web")
      ? process.cwd()
      : join(process.cwd(), "apps/web");
    const source = readFileSync(
      join(
        root,
        "src/features/founder-onboarding/founder-onboarding-screen.tsx",
      ),
      "utf8",
    );
    // "Keep improving" on the final step of an ACTIVE session may open the
    // review; a finished session must not be asked to move.
    expect(source).not.toMatch(/openReview/);
    expect(source).not.toMatch(
      /status\s*===\s*"complete"[\s\S]{0,240}openStep\(/,
    );
    const page = readFileSync(
      join(root, "app/(onboarding)/onboarding/founder/page.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/openReview/);
  });
});
