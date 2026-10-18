// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QMeetingAssistantDto } from "@capital-q/contracts";

const record: QMeetingAssistantDto = {
  meetingId: "00000000-0000-4000-8000-000000000301",
  status: "DONE",
  attendees: [{ name: "Ngozi O.", side: "INVESTOR" }],
  agreements: ["Diligence starts this week."],
  commitments: [
    {
      party: "Savanna Seed Partners",
      amount: "$250,000",
      firmness: "SOFT",
      quote: "Typically 250 to 500",
    },
  ],
  transcript: [{ speaker: "Ngozi O.", text: "Hello." }],
  summary: null,
  flags: [
    { kind: "RISK", text: "Two customers hold most deposits.", speaker: null },
  ],
  followUps: [{ text: "Send the cap table", owner: "Ajopot" }],
  failure: null,
  declined: null,
  updatedAt: "2026-10-02T15:40:00Z",
};

vi.mock("../src/features/schedule/meeting-q-actions", () => ({
  readMeetingQAction: () => Promise.resolve({ ok: true, value: record }),
  bringMeetingQAction: vi.fn(),
  dismissMeetingQAction: vi.fn(),
}));
vi.mock("../src/features/q-swarm/q-swarm", () => ({ QSwarm: () => null }));

const { MeetingQ } = await import("../src/features/schedule/meeting-q");

afterEach(cleanup);

describe("the meeting record (design-48)", () => {
  it("leads with Next and keeps money as said, with its firmness", async () => {
    render(<MeetingQ meetingId={record.meetingId} ended />);
    await act(async () => {
      await Promise.resolve();
    });
    const labels = [...document.querySelectorAll("h4")].map(
      (h) => h.textContent,
    );
    expect(labels).toEqual([
      "Next",
      "Agreed",
      "Money mentioned",
      "Worth knowing",
      "Who was there",
    ]);
    expect(screen.getByText(/\$250,000 · Soft/u)).toBeTruthy();
    expect(screen.getByText("Full transcript · 1 line")).toBeTruthy();
  });
});
