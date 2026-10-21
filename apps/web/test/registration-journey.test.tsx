// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner directive 2026-10-16, "Registration": the journey is chosen when the
 * account is created, that choice initialises the right setup, and Q never
 * asks "raising or investing?" a second time. An invitee chooses nothing.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const talk = vi.fn();
vi.mock("../src/features/voice/use-voice-interview", () => ({
  useVoiceInterview: () => ({
    active: false,
    notice: null,
    turn: null,
    client: {},
    voice: "FEMALE",
    talk,
    end: vi.fn(),
    chooseVoice: vi.fn(),
    clearNotice: vi.fn(),
  }),
}));
vi.mock("../src/features/voice/use-q-speech", () => ({
  useQSpeech: () => ({
    status: "idle",
    muted: false,
    say: () => Promise.resolve(),
    queue: () => undefined,
    stop: () => undefined,
    play: () => undefined,
    toggleMuted: () => undefined,
  }),
}));
vi.mock("../src/features/voice/use-follow-turn", () => ({
  useFollowTurn: () => undefined,
}));
vi.mock("../src/features/q-aperture", () => ({ QAperture: () => null }));
const signUp = vi.fn();
vi.mock("../src/auth/actions", () => ({
  signUpWithPasswordAction: (...args: unknown[]) => signUp(...args) as unknown,
  signInWithGoogleAction: vi.fn(),
}));
const switchOrganisationAction = vi.fn();
vi.mock("../src/features/team/team-actions", () => ({
  switchOrganisationAction: (id: string) =>
    switchOrganisationAction(id) as unknown,
}));
const chooseWorkspaceAction = vi.fn();
const keepWorkspaceAction = vi.fn();
vi.mock("../src/features/welcome/workspace-actions", () => ({
  chooseWorkspaceAction: (id: string) => chooseWorkspaceAction(id) as unknown,
  keepWorkspaceAction: () => keepWorkspaceAction() as unknown,
}));

const { WelcomeScreen } =
  await import("../src/features/welcome/welcome-screen");
const { SignUpForm } =
  await import("../src/features/auth/components/sign-up-form");
const { WorkspaceChoice } =
  await import("../src/features/welcome/workspace-choice");

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  talk.mockReset();
  signUp.mockReset();
  chooseWorkspaceAction.mockReset();
  keepWorkspaceAction.mockReset();
});
afterEach(cleanup);

describe("sign-up asks raising or investing, once", () => {
  it("offers both journeys and relabels the organisation for the one chosen", async () => {
    render(<SignUpForm next="/welcome" />);
    expect(screen.getByRole("radio", { name: /Raise capital/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Invest/ })).toBeTruthy();
    expect(screen.getByLabelText("Company or fund")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: /Invest/ }));
    expect(screen.getByLabelText("Fund or firm name")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: /Raise capital/ }));
    expect(screen.getByLabelText("Company name")).toBeTruthy();
  });

  it("refuses to submit without a journey, inline, before any round trip", async () => {
    render(<SignUpForm next="/welcome" />);
    await userEvent.type(screen.getByLabelText("Your name"), "Ada Obi");
    await userEvent.type(
      screen.getByLabelText("Email"),
      "ada@fictional.capitalq.local",
    );
    await userEvent.type(screen.getByLabelText("Password"), "a-long-password");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );
    expect(screen.getByText("Choose one to continue.")).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("carries the chosen journey through Google, which takes no sign-up fields", async () => {
    render(<SignUpForm next="/welcome" googleEnabled />);
    await userEvent.click(screen.getByRole("radio", { name: /Invest/ }));
    const nexts = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="next"]'),
    ].map((input) => input.value);
    expect(nexts).toContain("/welcome?journey=investor");
  });

  it("asks an invitee nothing about journeys or organisations", () => {
    render(<SignUpForm next="/join/abcdefghijklmnopqrstuvwxyz0123456789" />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText(/Company|Fund/)).toBeNull();
    expect(screen.getByText("Create your account to join")).toBeTruthy();
  });
});

describe("the welcome after a journey was chosen", () => {
  it("does not ask the role question; Start opens that journey's interview by voice", async () => {
    render(<WelcomeScreen knownName="Ada" journey="founder" />);
    expect(screen.getByText(/Let's set up your company/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(push).toHaveBeenCalledWith("/onboarding/founder?talk=1");
    // Q's own role-asking welcome line is never opened.
    expect(talk).not.toHaveBeenCalled();
    expect(document.querySelector("[data-q-role-question]")).toBeNull();
  });

  it("“Prefer to type?” opens the chosen journey's form", async () => {
    render(<WelcomeScreen knownName="Ada" journey="investor" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Prefer to type?" }),
    );
    expect(push).toHaveBeenCalledWith("/onboarding/investor");
    expect(document.querySelector("[data-persona-cards]")).toBeNull();
  });

  it("lets somebody who meant the other journey correct it", async () => {
    render(<WelcomeScreen knownName="Ada" journey="investor" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Here to raise instead?" }),
    );
    expect(document.querySelector("[data-persona-cards]")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("without a chosen journey, asks as before", async () => {
    render(<WelcomeScreen knownName="Ada" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Prefer to type?" }),
    );
    expect(document.querySelector("[data-q-role-question]")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("choosing a workspace on arrival", () => {
  const workspaces = [
    {
      organisationId: "11111111-1111-4111-8111-111111111111",
      name: "Harbourline Cargo",
      kind: "COMPANY",
      organisationType: "company",
      role: "OWNER",
      memberCount: 2,
      active: true,
      companyId: "22222222-2222-4222-8222-222222222222",
    },
    {
      organisationId: "33333333-3333-4333-8333-333333333333",
      name: "Savanna Seed",
      kind: "FIRM",
      organisationType: "investment_firm",
      role: "MEMBER",
      memberCount: 4,
      active: false,
      companyId: null,
    },
  ] as const;

  it("lists each workspace with what it is and the person's role there", () => {
    render(<WorkspaceChoice name="Ada" workspaces={workspaces} />);
    expect(
      screen.getByText("Company workspace. You are an owner"),
    ).toBeTruthy();
    expect(
      screen.getByText("Investor workspace. You are a member"),
    ).toBeTruthy();
    // The one they used last says so, in words.
    expect(screen.getByText("Last used")).toBeTruthy();
    expect(
      screen.getByText(
        "Switch any time from your name in the sidebar. Nothing moves between workspaces.",
      ),
    ).toBeTruthy();
  });

  it("switches to the one chosen, then goes Home", async () => {
    chooseWorkspaceAction.mockResolvedValue({ ok: true });
    render(<WorkspaceChoice name="Ada" workspaces={workspaces} />);
    await userEvent.click(screen.getByRole("button", { name: /Savanna Seed/ }));
    expect(chooseWorkspaceAction).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("keeping the current one switches nothing", async () => {
    keepWorkspaceAction.mockResolvedValue({ ok: true });
    render(<WorkspaceChoice name="Ada" workspaces={workspaces} />);
    await userEvent.click(
      screen.getByRole("button", { name: /Harbourline Cargo/ }),
    );
    expect(chooseWorkspaceAction).not.toHaveBeenCalled();
    expect(keepWorkspaceAction).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("says so when the switch is refused, and stays", async () => {
    chooseWorkspaceAction.mockResolvedValue({
      ok: false,
      message: "That didn't go through. Please try again.",
    });
    render(<WorkspaceChoice name="Ada" workspaces={workspaces} />);
    await userEvent.click(screen.getByRole("button", { name: /Savanna Seed/ }));
    expect(screen.getByRole("alert").textContent).toContain(
      "didn't go through",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
