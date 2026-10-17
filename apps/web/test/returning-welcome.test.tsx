// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The welcome-back cards act for real (CQ-WEB-030): a navigation card is a
 * link to its route, and a Q card starts an ordinary run through the same
 * server action the composer uses, then opens that conversation on Home.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const askQAction = vi.fn();
vi.mock("../src/features/q/actions", () => ({
  askQAction: (...args: unknown[]) => askQAction(...args) as unknown,
}));

const claimSetupReminderAction = vi.fn(() => Promise.resolve(true));
const remindSetupLaterAction = vi.fn(() => Promise.resolve(true));
vi.mock("../src/features/home/setup-nudge-actions", () => ({
  claimSetupReminderAction: () => claimSetupReminderAction(),
  remindSetupLaterAction: () => remindSetupLaterAction(),
}));

const { resetSetupReminderClaim } =
  await import("../src/features/home/use-claim-when-seen");
const { ReturningWelcome } =
  await import("../src/features/home/returning-welcome");
const { chooseReturningCards, returningGreeting } =
  await import("../src/features/home/returning");

const COMPANY = "11111111-1111-4111-8111-111111111111";

const facts = {
  context: { kind: "FOUNDER", companyId: COMPANY, label: "Northbank" },
  unfinished: null,
  name: "Ada Lovelace",
  feed: "UNKNOWN",
  pitch: "YES",
  deck: { kind: "NONE" },
} as const;

function renderWelcome() {
  render(
    <ReturningWelcome
      greeting={returningGreeting(facts)}
      cards={chooseReturningCards(facts)}
      subject={{ companyId: COMPANY }}
    />,
  );
}

beforeEach(() => {
  push.mockReset();
  askQAction.mockReset();
  claimSetupReminderAction.mockClear();
  remindSetupLaterAction.mockClear();
  resetSetupReminderClaim();
});
afterEach(cleanup);

describe("ReturningWelcome", () => {
  it("greets them by name as a heading, with one open question", () => {
    renderWelcome();
    expect(
      screen.getByRole("heading", { name: "Welcome back, Ada." }),
    ).toBeTruthy();
    expect(screen.getByText("What's on your mind today?")).toBeTruthy();
  });

  // Owner 2026-10-17: nothing under the greeting but what needs them.
  it("shows no quick-link cards under the greeting", () => {
    renderWelcome();
    expect(screen.queryByRole("link", { name: /Your pitch video/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Create your investor deck/ }),
    ).toBeNull();
    expect(document.querySelector("[data-q-returning-cards]")).toBeNull();
  });
});

describe("ReturningWelcome inside the Q surface (K)", () => {
  it("an unfinished setup shows where it left off in Q's own words, and one welcome", () => {
    const partway = {
      ...facts,
      unfinished: "founder",
      setupReminder: "WELCOME",
      setup: {
        covered: ["Company"],
        pending: "Which stage are you at right now?",
      },
    } as const;
    render(
      <ReturningWelcome
        greeting={returningGreeting(partway)}
        cards={chooseReturningCards(partway)}
        subject={{ companyId: COMPANY }}
      />,
    );
    expect(screen.getByText("Which stage are you at right now?")).toBeTruthy();
    expect(screen.getAllByText(/welcome back/i)).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: /Continue setup/ }).getAttribute("href"),
    ).toBe("/onboarding/founder?from=home");
  });
});

describe("the setup reminder on the welcome (one prompt a day, at most)", () => {
  const partway = (setupReminder?: "WELCOME" | "BRIEFING") =>
    ({
      ...facts,
      context: { kind: "NONE" },
      unfinished: "investor",
      setup: { covered: [], pending: "What cheque size do you write?" },
      ...(setupReminder === undefined ? {} : { setupReminder }),
    }) as const;

  function renderFor(value: ReturnType<typeof partway>) {
    render(
      <ReturningWelcome
        greeting={returningGreeting(value)}
        cards={chooseReturningCards(value)}
        subject={undefined}
      />,
    );
  }

  it("on a reminder day it prompts once, and counts the reminder once seen", async () => {
    renderFor(partway("WELCOME"));
    expect(
      screen.getByRole("link", { name: /Continue your mandate/ }),
    ).toBeTruthy();
    expect(screen.getByText("What cheque size do you write?")).toBeTruthy();
    await waitFor(() => {
      expect(claimSetupReminderAction).toHaveBeenCalledTimes(1);
    });
  });

  it("Later takes the reminder away at once and puts it off", async () => {
    renderFor(partway("WELCOME"));
    await userEvent.click(
      screen.getByRole("button", { name: "Remind me next week" }),
    );
    expect(remindSetupLaterAction).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("link", { name: /Continue your mandate/ }),
    ).toBeNull();
    expect(screen.queryByText("What cheque size do you write?")).toBeNull();
  });

  for (const surface of [undefined, "BRIEFING"] as const) {
    it(`says nothing about the setup when the reminder is ${surface ?? "not due"}`, () => {
      const value = partway(surface);
      renderFor(value);
      expect(returningGreeting(value).question).not.toMatch(/part-way/);
      expect(screen.queryByRole("link", { name: /Continue/ })).toBeNull();
      expect(screen.queryByText("What cheque size do you write?")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Remind me next week" }),
      ).toBeNull();
      expect(claimSetupReminderAction).not.toHaveBeenCalled();
    });
  }
});
