// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QMemoryItemDto } from "@capital-q/contracts";

const forget = vi.fn((_id: string) => Promise.resolve({ ok: true }));
const correct = vi.fn((_id: string, _content: string) =>
  Promise.resolve({ ok: true as const }),
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/settings/memory-actions", () => ({
  forgetMemoryAction: (id: string) => forget(id),
  correctMemoryAction: (id: string, content: string) => correct(id, content),
}));

import { AccountToastProvider } from "../src/features/settings/account-kit";
import {
  memoryOrigin,
  QMemoryList,
} from "../src/features/settings/q-memory-list";

const SAID: QMemoryItemDto = {
  memoryItemId: "00000000-0000-4000-8000-000000000001",
  kind: "fact",
  content: "Never introduce me to crypto companies.",
  quote: "never introduce me to crypto companies",
  about: "YOU",
  learnedAt: "2026-10-03T09:00:00.000Z",
  origin: "SAID",
  forgetsAt: null,
};
const PASSING: QMemoryItemDto = {
  memoryItemId: "00000000-0000-4000-8000-000000000002",
  kind: "small_talk",
  content: "Looking at a second fund in early 2027.",
  quote: "a second fund in early 2027",
  about: "YOU",
  learnedAt: "2026-10-09T09:00:00.000Z",
  origin: "SAID",
  forgetsAt: "2027-01-07T09:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  forget.mockClear();
  correct.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderList(items: readonly QMemoryItemDto[]) {
  return render(
    <AccountToastProvider>
      <QMemoryList items={items} />
    </AccountToastProvider>,
  );
}

describe("What Q remembers (chosen design: grouped, forget in place)", () => {
  it("groups by where it came from and says how and when Q learned each", () => {
    renderList([SAID, PASSING]);
    expect(screen.getByText("Things you told Q")).toBeTruthy();
    expect(
      screen.getByText("Mentioned in passing (kept 90 days)"),
    ).toBeTruthy();
    expect(screen.getByText("You said this to Q, 3 Oct")).toBeTruthy();
    expect(
      screen.getByText("Mentioned to Q, 9 Oct. Forgotten on 7 Jan"),
    ).toBeTruthy();
    // Memory is not audit history, and the page says so.
    expect(document.body.textContent).toMatch(/stays in your audit history/u);
  });

  it("Forget hides it at once and offers Undo; Undo sends nothing", async () => {
    renderList([SAID]);
    fireEvent.click(screen.getByLabelText(`Forget: ${SAID.content}`));
    expect(screen.getByText("Forgotten. Q won’t use it again.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText(SAID.content)).toBeTruthy();
  });

  it("without Undo, the forget is sent through the memory route", async () => {
    renderList([SAID]);
    fireEvent.click(screen.getByLabelText(`Forget: ${SAID.content}`));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(forget).toHaveBeenCalledWith(SAID.memoryItemId);
    expect(screen.queryByText(SAID.content)).toBeNull();
  });

  it("an older server without origin still says something true", () => {
    const old = { ...SAID, origin: undefined, quote: null };
    expect(memoryOrigin(old)).toBe("Q learned this, 3 Oct");
    expect(memoryOrigin({ ...SAID, about: "COMPANY" })).toBe(
      "About your company. You said this to Q, 3 Oct",
    );
  });

  it("says so honestly when Q remembers nothing", () => {
    renderList([]);
    expect(
      screen.getByText("Q hasn’t remembered anything about you yet"),
    ).toBeTruthy();
  });
});
