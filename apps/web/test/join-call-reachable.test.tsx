// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipStatusDto } from "@capital-q/contracts";

/**
 * "Have Q join a call" is one tap from the relationship's More menu (QA
 * 390 px: it lived only behind Book a call, so nobody found it). The same
 * join form opens: a meet.google.com link, then Send Q in.
 */
const joins: { relationshipId: string; meetLink: string }[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/relationships",
}));
vi.mock("../src/features/integrations/relationship-mail", () => ({
  RelationshipMail: () => null,
}));
vi.mock("../src/features/relationships/relationship-diligence", () => ({
  RelationshipDiligence: () => null,
}));
vi.mock("../src/features/relationships/relationship-commitment", () => ({
  RelationshipCommitment: () => null,
}));
vi.mock("../src/features/relationships/relationship-errands", () => ({
  RelationshipErrands: () => <button type="button">Let Q handle this</button>,
}));
vi.mock("../src/features/schedule/relationship-schedule", () => ({
  RelationshipSchedule: () => null,
}));
vi.mock("../src/features/relationships/relationship-outcome", () => ({
  RelationshipOutcome: () => null,
}));
vi.mock("../src/features/schedule/schedule-actions", () => ({
  joinCallAction: (input: { relationshipId: string; meetLink: string }) => {
    joins.push(input);
    return Promise.resolve(
      input.meetLink.startsWith("https://meet.google.com/")
        ? { ok: true, value: { id: "m1" } }
        : {
            ok: false,
            message:
              "Q joins Google Meet calls: paste a link like https://meet.google.com/abc-defg-hij.",
          },
    );
  },
}));

const { RelationshipDetail } =
  await import("../src/features/relationships/relationship-detail");

afterEach(() => {
  cleanup();
  joins.length = 0;
  window.history.replaceState(null, "", "/");
});

const at = "2026-10-03T10:00:00Z";
function rel(state: RelationshipStatusDto["state"]): RelationshipStatusDto {
  return {
    relationshipId: "00000000-0000-4000-8000-000000000101",
    companyId: "00000000-0000-4000-8000-000000000102",
    investorOrganisationId: "00000000-0000-4000-8000-000000000103",
    state,
    stateSince: at,
    milestones: [{ state: "CONNECTED", at }],
    nextStep: "FOLLOW_UP",
    projectorVersion: "v2",
  };
}

const profile = {
  photoUrl: null,
  about: null,
  location: null,
  websiteUrl: null,
  chips: [],
  profileHref: null,
};

function page(state: RelationshipStatusDto["state"]) {
  return render(
    <RelationshipDetail
      side="COMPANY"
      counterpart="Savanna Seed Partners"
      relationship={rel(state)}
      actions={null}
      absentSentence=""
      askQ={false}
      profile={profile}
      readAt={Date.parse(at)}
      basePath="/relationships/investor/x"
    />,
  );
}

describe("Have Q join a call, from More", () => {
  it("sits in More beside Let Q handle this, a full touch target", () => {
    const { container } = page("CONNECTED");
    const more = container.querySelector("details[data-next-more]");
    expect(more).not.toBeNull();
    const menu = within(more as HTMLElement);
    expect(menu.getByText("Let Q handle this")).toBeTruthy();
    const join = menu.getByRole("button", { name: "Have Q join a call" });
    // h-11: 44 px on a phone.
    expect(join.className).toMatch(/\bh-11\b/);
  });

  it("opens the join form and sends Q in on a Meet link only", async () => {
    page("CONNECTED");
    fireEvent.click(screen.getByRole("button", { name: "Have Q join a call" }));
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByLabelText("Google Meet link");
    const send = within(dialog).getByRole("button", { name: "Send Q in" });

    fireEvent.change(link, { target: { value: "https://zoom.us/j/1" } });
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect((await within(dialog).findByRole("status")).textContent).toContain(
      "Q joins Google Meet calls",
    );

    fireEvent.change(link, {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
    });
    expect(
      (await within(dialog).findByText(/Q is on its way into the call/))
        .textContent,
    ).toContain("Q (Capital Q notes)");
    expect(joins.at(-1)).toEqual({
      relationshipId: "00000000-0000-4000-8000-000000000101",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("is not offered before the two sides are connected", () => {
    page("INTEREST_EXPRESSED");
    expect(
      screen.queryByRole("button", { name: "Have Q join a call" }),
    ).toBeNull();
  });
});
