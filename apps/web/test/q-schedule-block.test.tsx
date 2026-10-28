// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QScheduleBlock } from "@capital-q/contracts";

import type { QTurnObjectBlock } from "../src/features/q/conversation";

/**
 * Live 2026-10-28: "what's on my schedule today?" as a card. Calls with
 * their prep brief when it is ready, reminders, what waits for approval,
 * and the zone the times are in (UTC said as such when unknown).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/home",
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");

afterEach(() => {
  cleanup();
});

const BLOCK: QScheduleBlock = {
  kind: "SCHEDULE",
  title: "Your day",
  span: "TODAY",
  timeZone: null,
  calls: [
    {
      meetingId: "m-1",
      relationshipId: "91000000-0000-4000-8000-000000000001",
      purpose: "Intro call",
      startsAt: "2026-10-28T13:00:00.000Z",
      with: ["Amara Diallo-Benson"],
      organisedByYou: true,
      briefReady: true,
    },
    {
      meetingId: "m-2",
      relationshipId: null,
      purpose: "Follow-up",
      startsAt: "2026-10-28T15:00:00.000Z",
      with: [],
      organisedByYou: false,
      briefReady: false,
    },
  ],
  reminders: [
    {
      reminderId: "r-1",
      title: "Send the deck",
      dueAt: "2026-10-28T16:00:00.000Z",
      relationshipId: null,
    },
  ],
  approvals: ["Message Savanna Seed Partners"],
};

describe("the SCHEDULE block on screen", () => {
  it("renders calls, the prep brief where ready, reminders, approvals and the zone", () => {
    render(<QResultBlocks blocks={[BLOCK as QTurnObjectBlock]} />);
    expect(screen.getByText(/Intro call/u)).toBeTruthy();
    expect(screen.getByText(/With Amara Diallo-Benson/u)).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: "Open the prep brief" }),
    ).toHaveLength(1);
    expect(screen.getByText(/Booked by someone else/u)).toBeTruthy();
    expect(screen.getByText(/Send the deck/u)).toBeTruthy();
    expect(screen.getByText("Message Savanna Seed Partners")).toBeTruthy();
    expect(screen.getByText(/Times are in UTC/u)).toBeTruthy();
    // 13:00 UTC stays 13:00 when no zone is known.
    expect(screen.getByText(/13:00/u)).toBeTruthy();
  });

  it("says plainly when nothing is booked", () => {
    render(
      <QResultBlocks
        blocks={[
          {
            ...BLOCK,
            span: "WEEK",
            timeZone: "Africa/Lagos",
            calls: [],
            reminders: [],
            approvals: [],
          },
        ]}
      />,
    );
    expect(
      screen.getByText(/Nothing booked in the next seven days/u),
    ).toBeTruthy();
    expect(screen.getByText(/Times in Africa\/Lagos/u)).toBeTruthy();
  });
});
