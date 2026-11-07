// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { InvestorViewingDto } from "@capital-q/contracts";

import { InvestorViewers } from "../src/features/engagement/investor-viewers";

/**
 * Who viewed an investor (owner live test 7 Nov 2026): aggregates only, as
 * the projection decided them; below the floor, words, never a count.
 */
afterEach(cleanup);

const t = (text: string) => text;
const base: InvestorViewingDto = {
  investorOrganisationId: "f0000000-0000-4000-8000-0000000000aa",
  since: null,
  floorMet: false,
  floor: 3,
  sliceFloor: 5,
  passiveBatch: "WEEKLY",
  periods: [],
  slices: [],
};

describe("Who viewed you (investor analytics)", () => {
  it("below the floor says so, with no count", () => {
    render(<InvestorViewers data={base} t={t} />);
    const root = document.querySelector("[data-investor-viewers]");
    expect(root?.textContent).toContain(
      "Fewer than 3 founder organisations viewed your profile in a completed week.",
    );
    expect(root?.textContent).not.toMatch(/Week of/u);
  });

  it("shows completed weeks and combined slices, never a name", () => {
    render(
      <InvestorViewers
        data={{
          ...base,
          floorMet: true,
          periods: [
            {
              periodStart: "2026-10-26",
              organisations: 7,
              viewers: 7,
              profileViews: 8,
            },
          ],
          slices: [
            {
              dimension: "STAGE",
              slice: "pre_seed",
              organisations: 5,
              suppressed: false,
            },
            {
              dimension: "GEOGRAPHY",
              slice: "OTHER",
              organisations: null,
              suppressed: true,
            },
          ],
        }}
        t={t}
      />,
    );
    const text = document.querySelector("[data-investor-viewers]")?.textContent;
    expect(text).toContain("Week of 2026-10-26");
    expect(text).toContain("7 founder organisations · 8 profile views");
    expect(text).toContain("Pre seed");
    expect(text).toContain("Too few to show");
  });
});
