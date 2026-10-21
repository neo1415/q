// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  RehearsalsHome,
  researchedCaption,
  researchedHref,
} from "@/features/rehearsal/rehearsals-home";

/**
 * Demo rehearsal access on the Rehearsals page: the five prepared Qatar
 * entities are people to practise with, each opening a lobby sheet for its
 * own persona, labelled as a simulation, with no connection needed.
 */

afterEach(cleanup);

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${String(n)}`;
const ORG = (n: number) => `b0075742-0000-4000-8000-0000000000c${String(n)}`;

const researched = [
  {
    externalPersonId: ID(1),
    investorOrganisationId: null,
    name: "Shadi Qishta",
    entityKind: "PERSON" as const,
    roleLine: null,
  },
  {
    externalPersonId: ID(2),
    investorOrganisationId: ORG(1),
    name: "QInvest LLC",
    entityKind: "ORGANIZATION" as const,
    roleLine: "QInvest investment professional",
  },
  {
    externalPersonId: ID(3),
    investorOrganisationId: ORG(3),
    name: "Muhannad Taslaq",
    entityKind: "PERSON" as const,
    roleLine: null,
  },
  {
    externalPersonId: ID(4),
    investorOrganisationId: null,
    name: "Invest Qatar",
    entityKind: "GOVERNMENT_AGENCY" as const,
    roleLine: "Invest Qatar investment-promotion officer",
  },
  {
    externalPersonId: ID(5),
    investorOrganisationId: ORG(2),
    name: "AlRayan Investment",
    entityKind: "ORGANIZATION" as const,
    roleLine: "AlRayan Investment advisory professional",
  },
];

const home = (list: typeof researched | undefined) =>
  render(
    <RehearsalsHome
      basePath="/rehearsals"
      partners={{
        role: "FOUNDER",
        upcoming: [],
        people: [],
        ...(list === undefined ? {} : { researched: list }),
      }}
      history={{ rehearsals: [] }}
      allowance={null}
      withId={null}
    />,
  );

describe("Researched rehearsals on the Rehearsals page", () => {
  it("offers all five as people to practise with, each starting its own persona, with no connection step", () => {
    home(researched);
    const grid = screen.getByRole("list", { name: "People to practise with" });
    const cards = within(grid).getAllByRole("button");
    expect(cards).toHaveLength(5);
    for (const name of researched.map((r) => r.name)) {
      expect(within(grid).getByText(name)).toBeTruthy();
    }
    expect(
      within(grid).getAllByText(/Research-informed simulation/u),
    ).toHaveLength(5);
    // Each card opens the lobby sheet; its Start goes to that persona.
    const hrefs: (string | null)[] = [];
    for (const [index] of researched.entries()) {
      const card = within(
        screen.getByRole("list", { name: "People to practise with" }),
      ).getAllByRole("button")[index];
      if (card === undefined) throw new Error("card");
      fireEvent.click(card);
      const start = screen.getByRole("link", { name: /Start rehearsal/u });
      hrefs.push(start.getAttribute("href"));
      expect(
        screen.getByText(/No connection or request is needed/u),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    }
    expect(hrefs).toEqual([
      `/rehearsals/person/${ID(1)}`,
      `/rehearsals/investor/${ORG(1)}`,
      `/rehearsals/investor/${ORG(3)}`,
      `/rehearsals/person/${ID(4)}`,
      `/rehearsals/investor/${ORG(2)}`,
    ]);
    // Entitled founders with no relationships are not told to go find investors.
    expect(screen.queryByText(/Once you’re in touch with/u)).toBeNull();
  });

  it("names Invest Qatar as an investment-promotion officer, not an investor", () => {
    const agency = researched[3];
    if (agency === undefined) throw new Error("fixture");
    expect(researchedCaption(agency)).toBe(
      "Research-informed simulation: Invest Qatar investment-promotion officer",
    );
    expect(researchedCaption(agency)).not.toMatch(/mandate|fund|VC/iu);
    expect(researchedHref(agency)).toBe(`/rehearsals/person/${ID(4)}`);
  });

  it("offers nobody, and says how to find someone, when there is no entitlement", () => {
    home(undefined);
    expect(
      screen.queryByRole("list", { name: "People to practise with" }),
    ).toBeNull();
    expect(screen.getByText("No investors to practise with yet")).toBeTruthy();
    cleanup();
    home([]);
    expect(
      screen.queryByRole("list", { name: "People to practise with" }),
    ).toBeNull();
  });
});
