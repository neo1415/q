// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamDto } from "@capital-q/contracts";

const inviteAction = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/team/team-actions", () => ({
  inviteAction: (...args: unknown[]) => inviteAction(...args) as unknown,
}));

import { expiresIn, TeamPage } from "../src/features/team/team-page";

afterEach(cleanup);

const DAY = 86_400_000;
const team: TeamDto = {
  organisation: {
    organisationId: "00000000-0000-4000-8000-000000000001",
    name: "Harbourline Capital",
    kind: "FIRM",
    organisationType: "investment_firm",
  },
  you: {
    membershipId: "00000000-0000-4000-8000-000000000011",
    role: "ADMIN",
    can: { invite: true, changeRoles: true, removeMembers: true, own: false },
  },
  ownerCount: 1,
  members: [
    {
      membershipId: "00000000-0000-4000-8000-000000000011",
      userId: "00000000-0000-4000-8000-000000000021",
      name: "Ada Obi",
      email: "ada@harbourline.example",
      title: null,
      role: "ADMIN",
      isYou: true,
      joinedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      membershipId: "00000000-0000-4000-8000-000000000012",
      userId: "00000000-0000-4000-8000-000000000022",
      name: "Priya Nair",
      email: "priya@harbourline.example",
      title: null,
      role: "MEMBER",
      isYou: false,
      joinedAt: "2026-09-04T00:00:00.000Z",
    },
  ],
  invitations: [
    {
      invitationId: "00000000-0000-4000-8000-000000000031",
      email: "ruth@harbourline.example",
      role: "MEMBER",
      state: "PENDING",
      sentAt: new Date(Date.now() - 2 * DAY).toISOString(),
      sentCount: 1,
      expiresAt: new Date(Date.now() + 5 * DAY - 60_000).toISOString(),
      invitedByName: "Ada Obi",
    },
  ],
  joinRequests: [],
  ownershipOffers: [],
};

describe("Team, invite first (chosen design 2026-10-21)", () => {
  it("puts the invite first, with what the chosen role can do under it", () => {
    render(<TeamPage initial={team} />);
    const invite = document.querySelector("[data-team-invite]");
    const people = screen.getByRole("heading", { name: "People" });
    expect(invite).toBeTruthy();
    // The invite comes before the people in the page.
    expect(
      invite?.compareDocumentPosition(people) ??
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      document.querySelector("[data-team-role-says]")?.textContent,
    ).toMatch(/^Member: reviews companies/u);
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "ADMIN" },
    });
    expect(
      document.querySelector("[data-team-role-says]")?.textContent,
    ).toMatch(/^Admin: invites people/u);
    expect(
      screen.getByPlaceholderText("name@harbourline.example"),
    ).toBeTruthy();
  });

  it("lists people and open invitations together, with each invitation's expiry", () => {
    render(<TeamPage initial={team} />);
    expect(screen.getByText("2 people, 1 invitation")).toBeTruthy();
    expect(screen.getByText("Member. Joined 4 Sept")).toBeTruthy();
    expect(screen.getByText("ruth@harbourline.example")).toBeTruthy();
    expect(
      screen.getByText("Member. Invited 2 days ago. Expires in 5 days."),
    ).toBeTruthy();
    // Someone else's role can be changed; your own cannot, you can leave.
    expect(screen.getAllByText("Change role")).toHaveLength(1);
    expect(screen.getByText("Leave")).toBeTruthy();
  });

  it("someone who may not invite is told who can, and sees no invite", () => {
    render(
      <TeamPage
        initial={{
          ...team,
          you: {
            ...team.you,
            role: "MEMBER",
            can: {
              invite: false,
              changeRoles: false,
              removeMembers: false,
              own: false,
            },
          },
          invitations: [],
        }}
      />,
    );
    expect(document.querySelector("[data-team-invite]")).toBeNull();
    expect(document.querySelector("[data-team-limited]")).toBeTruthy();
  });

  it("says an invitation's time left in words", () => {
    const now = new Date("2026-10-21T09:00:00Z");
    expect(expiresIn("2026-10-26T09:00:00Z", now)).toBe("Expires in 5 days");
    expect(expiresIn("2026-10-22T08:00:00Z", now)).toBe("Expires tomorrow");
    expect(expiresIn("2026-10-20T08:00:00Z", now)).toBe("Expires today");
  });
});
