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
const { QSurfaceToolsContext } =
  await import("../src/features/q/q-surface-tools");
const { chooseReturningCards, returningGreeting } =
  await import("../src/features/home/returning");

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";

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
  it("greets them by name as a heading, with Q's question", () => {
    renderWelcome();
    expect(
      screen.getByRole("heading", { name: "Welcome back, Ada." }),
    ).toBeTruthy();
    expect(
      screen.getByText("What would you like to work on today?"),
    ).toBeTruthy();
  });

  it("a navigation card is a link to its route", () => {
    renderWelcome();
    expect(
      screen
        .getByRole("link", { name: /Your pitch video/ })
        .getAttribute("href"),
    ).toBe("/pitch");
    expect(
      screen
        .getByRole("link", { name: /Your company profile/ })
        .getAttribute("href"),
    ).toBe(`/company/${COMPANY}`);
  });

  it("a Q card asks Q about their own company and opens the conversation", async () => {
    askQAction.mockResolvedValue({
      ok: true,
      value: { runId: "r", conversationId: CONVERSATION },
    });
    renderWelcome();
    await userEvent.click(
      screen.getByRole("button", { name: /Create your investor deck/ }),
    );
    expect(askQAction).toHaveBeenCalledWith(
      "Create an investor deck for my company.",
      undefined,
      { companyId: COMPANY },
    );
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/home?c=${CONVERSATION}`);
    });
  });

  it("a refused ask says why and goes nowhere", async () => {
    askQAction.mockResolvedValue({
      ok: false,
      message: "Q isn't connected on this build yet.",
    });
    renderWelcome();
    const button = screen.getByRole("button", {
      name: /Create your investor deck/,
    });
    await userEvent.click(button);
    expect(
      await screen.findByText("Q isn't connected on this build yet."),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ReturningWelcome inside the Q surface (K)", () => {
  const ARTIFACT = "33333333-3333-4333-8333-333333333333";

  it("asks Q in this conversation and opens Q's deck beside it -- no page change", async () => {
    const ask = vi.fn();
    const openArtifact = vi.fn();
    const withDeck = {
      ...facts,
      deck: { kind: "PREPARED", artifactId: ARTIFACT },
    } as const;
    render(
      <QSurfaceToolsContext.Provider value={{ ask, openArtifact }}>
        <ReturningWelcome
          greeting={returningGreeting(withDeck)}
          cards={chooseReturningCards(withDeck)}
          subject={{ companyId: COMPANY }}
        />
      </QSurfaceToolsContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Your investor deck/ }),
    );
    expect(openArtifact).toHaveBeenCalledWith(ARTIFACT);
    expect(push).not.toHaveBeenCalled();
    expect(askQAction).not.toHaveBeenCalled();
  });

  it("an ask card is asked of the conversation underneath", async () => {
    const ask = vi.fn();
    render(
      <QSurfaceToolsContext.Provider value={{ ask, openArtifact: vi.fn() }}>
        <ReturningWelcome
          greeting={returningGreeting(facts)}
          cards={chooseReturningCards(facts)}
          subject={{ companyId: COMPANY }}
        />
      </QSurfaceToolsContext.Provider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Create your investor deck/ }),
    );
    expect(ask).toHaveBeenCalledWith("Create an investor deck for my company.");
    expect(askQAction).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

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
      screen.getByRole("button", { name: "Remind me later" }),
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
        screen.queryByRole("button", { name: "Remind me later" }),
      ).toBeNull();
      expect(claimSetupReminderAction).not.toHaveBeenCalled();
    });
  }
});
