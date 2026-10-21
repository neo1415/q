// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KybDtoSchema, type InvitationPreviewDto } from "@capital-q/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/features/onboarding-kit/material-actions", () => ({}));
vi.mock("@/features/reviews/review-actions", () => ({}));
vi.mock("@/features/billing/billing-actions", () => ({}));
vi.mock("@/features/profile/profile-actions", () => ({}));
vi.mock("@/features/team/team-actions", () => ({}));
vi.mock("@/features/auth", () => ({ SignOutButton: () => null }));

const { tierMark, tierRows, planEnquiry } =
  await import("@/features/billing/plan-board");
const { PLAN_TIERS } = await import("@/features/billing/plan-tiers");
const { findingTarget } = await import("@/features/profile/found-section");
const { KybSection } = await import("@/features/reviews/kyb-form");
const { JoinCard } = await import("@/features/team/join-card");
const { workspaceLine } = await import("@/features/welcome/workspace-choice");

afterEach(cleanup);

const investorTier = PLAN_TIERS.tiers[1];
const founderTier = PLAN_TIERS.tiers[0];
const fundTier = PLAN_TIERS.tiers[2];

describe("plan and billing, three plans side by side", () => {
  it("marks each tier in words, never colour alone", () => {
    expect(tierMark(investorTier, true, "INVESTOR")).toBe("YOURS");
    expect(tierMark(fundTier, false, "INVESTOR")).toBe("TEAMS");
    expect(tierMark(founderTier, false, "INVESTOR")).toBe("OTHER_SIDE");
    expect(tierMark(founderTier, false, "FOUNDER")).toBe("YOUR_SIDE");
  });

  it("takes each tier's rows from the billing catalogue, limits as plain numbers", () => {
    const rows = tierRows(investorTier, {
      plans: [
        {
          key: "investor_pro",
          version: 1,
          name: "Investor Pro",
          description: "",
          audience: "INVESTOR",
          selfServe: true,
          features: [
            {
              key: "q.research",
              name: "Research",
              kind: "MONTHLY",
              unitPlural: "searches",
              included: true,
              limit: 100,
            },
            {
              key: "q.rehearsals",
              name: "Pitch rehearsals",
              kind: "MONTHLY",
              unitPlural: "rehearsals",
              included: false,
              limit: null,
            },
          ],
        },
      ],
    });
    expect(rows.map((row) => [row.name, row.value])).toEqual([
      ["Research", "Up to 100"],
      ["Pitch rehearsals", "Not included"],
    ]);
    // Without a catalogue, the tier's own highlights, said as included.
    expect(tierRows(investorTier, null).every((row) => row.included)).toBe(
      true,
    );
  });

  it("words a Talk to us request for the person who answers it", () => {
    expect(planEnquiry("Fund", 4, " We share deal flow. ")).toBe(
      "Plan enquiry: Fund, for 4 people. We share deal flow.",
    );
  });
});

describe("what Q found in public", () => {
  it("approves into the one field a finding belongs to, and nothing else", () => {
    expect(findingTarget("COMPANY", "presence.self_description")?.field).toBe(
      "shortDescription",
    );
    expect(
      findingTarget("INVESTOR_ORGANISATION", "presence.what_they_do")?.field,
    ).toBe("publicDescription");
    expect(findingTarget("PERSON", "presence.self_description")?.field).toBe(
      "headline",
    );
    // A milestone has no field of its own: it is something to ask Q about.
    expect(findingTarget("COMPANY", "presence.milestone")).toBeNull();
  });
});

describe("verification in three steps", () => {
  it("walks who, the company as registered, then check and send", () => {
    const kyb = KybDtoSchema.parse({
      standing: "NOT_REQUESTED",
      submission: null,
      organisationName: "Ajopot",
      organisationKind: "COMPANY",
      person: {
        standing: "NOT_REQUESTED",
        declineReason: null,
        submission: null,
      },
    });
    render(<KybSection kyb={kyb} />);
    expect(screen.getByText("Who is asking")).toBeTruthy();
    const next = () => screen.getByRole("button", { name: "Continue" });
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your name as on your ID"), {
      target: { value: "Ada Obi" },
    });
    fireEvent.change(screen.getByLabelText("Your role"), {
      target: { value: "Founder & CEO" },
    });
    fireEvent.click(next());
    expect(screen.getByText("Your company, as registered")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Registered legal name"), {
      target: { value: "Ajopot Ltd" },
    });
    fireEvent.change(screen.getByLabelText("Registration number"), {
      target: { value: "RC 12345" },
    });
    fireEvent.change(screen.getByLabelText("Country of registration"), {
      target: { value: "ng" },
    });
    fireEvent.click(next());
    expect(screen.getByText("Check and send")).toBeTruthy();
    expect(screen.getByText("Ada Obi, Founder & CEO")).toBeTruthy();
    expect(screen.getByText("Ajopot Ltd, NG")).toBeTruthy();
    expect(screen.getByText("None, sent without one")).toBeTruthy();
  });
});

const PREVIEW: InvitationPreviewDto = {
  state: "PENDING",
  organisationName: "Harbourline Capital",
  kind: "FIRM",
  role: "MEMBER",
  email: "priya@harbourline.example",
  invitedByName: "Ada Obi",
  memberCount: 3,
  memberInitials: ["AO", "JF", "SN"],
};

describe("joining a team, and every link state", () => {
  it("says who invited them, the role and what it may do, who is there, and when it expires", () => {
    render(
      <JoinCard
        token="tok"
        preview={PREVIEW}
        signedInAs="priya@harbourline.example"
        keeps={null}
        alreadyIn={false}
        invitation={{
          invitationId: "00000000-0000-4000-8000-000000000001",
          expiresAt: new Date(
            Date.now() + 5 * 86_400_000 - 60_000,
          ).toISOString(),
        }}
      />,
    );
    expect(
      screen.getByText("Ada Obi invited you to join Harbourline Capital"),
    ).toBeTruthy();
    expect(screen.getByText("As member")).toBeTruthy();
    expect(screen.getByText("3 people work here")).toBeTruthy();
    expect(document.body.textContent).toMatch(/Expires in 5 days/u);
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("an expired, cancelled or partial link says what happened and who to ask", () => {
    const { rerender } = render(
      <JoinCard
        token="tok"
        preview={{ ...PREVIEW, state: "EXPIRED" }}
        signedInAs={null}
        keeps={null}
        alreadyIn={false}
      />,
    );
    expect(screen.getByText("This invitation has expired")).toBeTruthy();
    rerender(
      <JoinCard
        token="tok"
        preview={null}
        signedInAs={null}
        keeps={null}
        alreadyIn={false}
      />,
    );
    expect(screen.getByText("This invitation link isn't valid")).toBeTruthy();
  });
});

describe("choosing a workspace", () => {
  it("says what each workspace is and the person's role there", () => {
    expect(
      workspaceLine({
        organisationId: "00000000-0000-4000-8000-000000000001",
        name: "Harbourline Capital",
        kind: "FIRM",
        organisationType: "investment_firm",
        role: "ADMIN",
        memberCount: 3,
        active: false,
        companyId: null,
      }),
    ).toBe("Investor workspace. You are an admin");
  });
});
