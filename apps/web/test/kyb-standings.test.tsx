// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KybDtoSchema } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/onboarding-kit/material-actions", () => ({}));
vi.mock("@/features/reviews/review-actions", () => ({}));

const { KybSection } = await import("@/features/reviews/kyb-form");

afterEach(cleanup);

describe("where verification stands (demo audit 2026-10-03)", () => {
  it("shows each standing as a row in words, with a shield beside verified only", () => {
    const kyb = KybDtoSchema.parse({
      standing: "VERIFIED",
      submission: null,
      organisationName: "Ajopot",
      organisationKind: "COMPANY",
      person: { standing: "VERIFIED", declineReason: null, submission: null },
    });
    render(<KybSection kyb={kyb} />);
    const rows = within(
      screen.getByRole("list", { name: "Where verification stands" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "YouVerified",
      "AjopotVerified",
    ]);
    // The word carries the meaning; the mark is decoration beside it.
    for (const row of rows) {
      expect(row.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });
});
