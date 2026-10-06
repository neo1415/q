// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn<() => Promise<unknown>>();
vi.mock("../src/features/work/work-actions", () => ({
  listNoticesAction: () => list(),
  markReadAction: vi.fn(),
}));
vi.mock("../src/features/work/push-setting", () => ({
  PushSetting: () => null,
}));

const { NotificationCenter } =
  await import("../src/features/work/notification-center");
const { resetNoticeStore } = await import("../src/features/work/notice-store");

beforeEach(() => {
  // P9: the first read waits for the page to settle, so time is driven.
  vi.useFakeTimers();
  resetNoticeStore();
  list.mockReset();
  list.mockResolvedValue({ ok: true, value: { items: [], unread: 2 } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });

/**
 * design-48: the shell's server actions queue one at a time per tab. Two
 * bells (phone header, desktop sidebar) each read the list on mount and on
 * focus; production /settings read it 3 times in its first 4 s.
 */
describe("the shell's notification read", () => {
  it("is one read for both bells", async () => {
    const { getAllByRole } = render(
      <>
        <NotificationCenter />
        <NotificationCenter />
      </>,
    );
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    // Both bells show the same count.
    expect(
      getAllByRole("button", { name: "Notifications, 2 new" }),
    ).toHaveLength(2);
  });

  it("does not read again on focus right after a read", async () => {
    render(<NotificationCenter />);
    await settle();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("still says it failed when the read throws", async () => {
    list.mockRejectedValue(new Error("aborted"));
    const { container } = render(<NotificationCenter />);
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")).not.toBeNull();
  });
});
