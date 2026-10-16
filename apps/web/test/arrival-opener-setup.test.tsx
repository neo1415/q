// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArrivalData } from "../src/features/briefing/arrival";

/**
 * Today's setup reminder (lane ob2's continue-setup card) is one of the
 * things Q's opener counts (owner 2026-10-16), and shows with the rest
 * only once they choose to look; it is never mentioned on its own.
 */

const DATA: ArrivalData = {
  firstName: "Ada",
  timeZone: "Africa/Lagos",
  activity: {},
  hoursAway: 20,
  cards: [],
  waiting: [],
  attention: {
    items: [],
    activity: null,
    unread: [],
    readAt: "2026-10-16T09:00:00Z",
  },
  jobsDone: { n: 0, names: [] },
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/features/q/actions", () => ({ askQAction: vi.fn() }));
vi.mock("../src/features/home/setup-nudge-actions", () => ({
  claimSetupReminderAction: vi.fn(() => Promise.resolve(true)),
  remindSetupLaterAction: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("../src/features/briefing/arrival-actions", () => ({
  arrivalBriefingAction: vi.fn(),
  decideArrivalCardAction: vi.fn(() => Promise.resolve({ ok: true })),
  readArrivalWordsAction: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../src/features/briefing/arrival-browser", () => ({
  loadArrival: () => Promise.resolve(DATA),
}));
vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({ items: null }),
}));

const { pendingCount } = await import("../src/features/briefing/opener");
const { ReturningWelcome } =
  await import("../src/features/home/returning-welcome");
const { chooseReturningCards, returningGreeting, setupRemindersWaiting } =
  await import("../src/features/home/returning");
const { arrivalSpoken, resetArrival } =
  await import("../src/features/briefing/arrival-store");
const { resetArrivalGate } =
  await import("../src/features/briefing/arrival-gate");
const { resetSetupReminderClaim } =
  await import("../src/features/home/use-claim-when-seen");

const facts = {
  context: { kind: "NONE" },
  unfinished: "investor",
  name: "Ada Lovelace",
  feed: "UNKNOWN",
  pitch: "YES",
  deck: { kind: "NONE" },
  setup: { covered: [], pending: "What cheque size do you write?" },
  setupReminder: "WELCOME",
} as const;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetArrivalGate();
  resetArrival();
  resetSetupReminderClaim();
});
afterEach(cleanup);

describe("the setup reminder in Q's opener", () => {
  it("adds one to the count, and nothing when there is none", () => {
    expect(pendingCount({ ...DATA, setupReminders: 1 })).toBe(1);
    expect(pendingCount({ ...DATA, setupReminders: 0 })).toBe(0);
    expect(pendingCount(DATA)).toBe(0);
    expect(setupRemindersWaiting(facts)).toBe(1);
  });

  it("is counted, hidden until they choose to look, then shown with the rest", async () => {
    render(
      <ReturningWelcome
        greeting={returningGreeting(facts)}
        cards={chooseReturningCards(facts)}
        subject={undefined}
        setupReminders={setupRemindersWaiting(facts)}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const said = document.querySelector("[data-arrival-lowdown]")?.textContent;
    expect(said).toMatch(/You have 1 thing waiting\./u);
    // Counted, never mentioned on its own.
    expect(said).not.toMatch(/setup|mandate/iu);
    expect(arrivalSpoken()).not.toMatch(/setup|mandate/iu);
    expect(
      screen.queryByRole("link", { name: /Continue your mandate/u }),
    ).toBeNull();
    expect(screen.queryByText("What cheque size do you write?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Look at it" }));
    expect(
      screen.getByRole("link", { name: /Continue your mandate/u }),
    ).toBeTruthy();
  });
});
