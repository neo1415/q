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

const { ReturningWelcome } =
  await import("../src/features/home/returning-welcome");
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
