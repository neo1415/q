// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QWorkDto } from "@capital-q/contracts";

import { instructionWords } from "../src/features/work/instruction-words";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout: vi.fn() }),
}));
const listWorkAction = vi.fn<() => Promise<unknown>>();
vi.mock("../src/features/work/work-actions", () => ({
  answerWorkAction: vi.fn(),
  listWorkAction: () => listWorkAction(),
  setAwayAction: vi.fn(),
  stopWorkAction: vi.fn(),
}));

const { WorkPanel } = await import("../src/features/work/work-panel");

beforeEach(() => {
  listWorkAction.mockReset();
  listWorkAction.mockReturnValue(new Promise(() => undefined));
});
afterEach(cleanup);

function work(
  id: string,
  status: QWorkDto["status"],
  summary: string,
  kind: QWorkDto["kind"] = "INVESTOR_OUTREACH",
) {
  return {
    id,
    kind,
    status,
    summary,
    createdAt: "2026-10-03T10:00:00Z",
    expiresAt: "2026-11-03T10:00:00Z",
    lanes: [],
  } satisfies QWorkDto;
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/**
 * design-48: production /work stayed on its skeleton. The list came from a
 * client server action queued behind the shell's own actions; a dropped or
 * thrown one rejected unhandled and the skeleton never left.
 */
describe("Q's work loading", () => {
  it("shows the server-read list at once, without asking the client action", () => {
    render(
      <WorkPanel
        variant="page"
        initial={[
          work("00000000-0000-4000-8000-000000000002", "ACTIVE", "Live plan"),
        ]}
      />,
    );
    expect(screen.getByText("Live plan")).toBeTruthy();
    expect(listWorkAction).not.toHaveBeenCalled();
  });

  it("turns a thrown action into the error state, not an endless skeleton", async () => {
    listWorkAction.mockRejectedValue(new Error("Failed to fetch"));
    render(<WorkPanel variant="page" />);
    await flush();
    expect(screen.getByText("Q's work couldn't load")).toBeTruthy();
    expect(
      screen.getByText(/nothing is sent without your approval/u),
    ).toBeTruthy();
  });

  it("shows the error state when the server read failed", () => {
    render(<WorkPanel variant="page" initial={null} initialFailed />);
    expect(screen.getByText("Q's work couldn't load")).toBeTruthy();
    expect(listWorkAction).not.toHaveBeenCalled();
  });
});

describe("the Q's work page", () => {
  it("leads with running plans and folds finished ones away", () => {
    render(
      <WorkPanel
        variant="page"
        initial={[
          work("00000000-0000-4000-8000-000000000001", "STOPPED", "Old plan"),
          work("00000000-0000-4000-8000-000000000002", "ACTIVE", "Live plan"),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Running" })).toBeTruthy();
    expect(screen.getByText("Finished · 1")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Live plan")).toBeLessThan(text.indexOf("Old plan"));
  });

  it("shows a standing instruction's own words and its spend against its limit", () => {
    render(
      <WorkPanel
        variant="page"
        initial={[
          work(
            "00000000-0000-4000-8000-000000000003",
            "ACTIVE",
            "Handle my investors -- 3 things on my own, the rest I ask; $0.2 of $5.00 this month.",
            "STANDING_INSTRUCTION",
          ),
        ]}
      />,
    );
    expect(screen.getByText("“Handle my investors”")).toBeTruthy();
    expect(screen.getByText("$0.20 of $5.00 this month (USD)")).toBeTruthy();
  });

  it("renders nothing on home when nothing runs", () => {
    const { container } = render(
      <WorkPanel
        variant="home"
        initial={[
          work("00000000-0000-4000-8000-000000000001", "STOPPED", "Old"),
        ]}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("instructionWords", () => {
  it("splits the running line", () => {
    expect(
      instructionWords(
        "Answer investors -- 0 things on my own, the rest I ask; $1.234 of $5 this month.",
      ),
    ).toEqual({
      goal: "Answer investors",
      how: "0 things on my own, the rest I ask",
      spend: "$1.23 of $5.00 this month (USD)",
      paused: null,
    });
  });

  it("reads a paused line", () => {
    expect(instructionWords("Paused (budget used): Answer investors")).toEqual({
      goal: "Answer investors",
      how: null,
      spend: null,
      paused: "budget used",
    });
  });

  it("shows any other line whole", () => {
    expect(instructionWords("Something new").goal).toBe("Something new");
  });
});
