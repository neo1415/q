// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationDto } from "@capital-q/contracts";

import { groupNotices } from "../src/features/work/notice-groups";

const list = vi.fn<() => Promise<unknown>>();
const markRead = vi.fn<(ids: readonly string[]) => Promise<unknown>>();
vi.mock("../src/features/work/work-actions", () => ({
  listNoticesAction: () => list(),
  markReadAction: (ids: readonly string[]) => markRead(ids),
}));
vi.mock("../src/features/work/push-setting", () => ({
  PushSetting: () => null,
}));

afterEach(() => {
  cleanup();
  list.mockReset();
  markRead.mockReset();
});

let n = 0;
function notice(over: Partial<NotificationDto>): NotificationDto {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "Q_WORK",
    title: "A notice",
    body: null,
    linkPath: "/work",
    read: false,
    createdAt: "2026-10-03T10:00:00Z",
    priority: "UPDATE",
    ...over,
  };
}

const NOW = new Date("2026-10-03T20:00:00Z");
const ASK = '5 things need your yes for "Find new founders"';

describe("groupNotices", () => {
  it("folds repeats of one ask into its newest, keeping every id", () => {
    const repeats = ["09:00", "12:00", "15:00", "18:00", "19:00"].map((t) =>
      notice({
        title: ASK,
        priority: "NEEDS_YOU",
        createdAt: `2026-10-03T${t}:00Z`,
      }),
    );
    const { needsYou } = groupNotices(repeats, NOW);
    expect(needsYou).toHaveLength(1);
    expect(needsYou[0]?.count).toBe(5);
    expect(needsYou[0]?.notice.createdAt).toBe("2026-10-03T19:00:00Z");
    expect(needsYou[0]?.ids).toHaveLength(5);
  });

  it("keeps different asks apart and puts updates under their day", () => {
    const { needsYou, days } = groupNotices(
      [
        notice({ title: ASK, priority: "NEEDS_YOU" }),
        notice({ title: "Cap table requested", priority: "NEEDS_YOU" }),
        notice({
          title: "Voltron is interested",
          createdAt: "2026-10-03T08:27:00Z",
        }),
        notice({
          title: "Savanna is interested",
          createdAt: "2026-10-02T12:00:00Z",
        }),
        notice({ title: "Older", createdAt: "2026-09-29T12:00:00Z" }),
      ],
      NOW,
    );
    expect(needsYou).toHaveLength(2);
    expect(days.map((day) => day.label)).toEqual([
      "Today",
      "Yesterday",
      "Tue 29 Sept",
    ]);
  });
});

describe("the notification centre", () => {
  it("shows one row for repeated asks and marks every folded notice read", async () => {
    const { NotificationCenter } =
      await import("../src/features/work/notification-center");
    const repeats = [1, 2, 3].map((h) =>
      notice({
        title: ASK,
        priority: "NEEDS_YOU",
        createdAt: `2026-10-03T0${String(h)}:00:00Z`,
      }),
    );
    list.mockResolvedValue({ ok: true, value: { items: repeats, unread: 3 } });
    markRead.mockResolvedValue({ ok: true, value: null });
    render(<NotificationCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 3 new" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByText(ASK)).toHaveLength(1);
    expect(screen.getByText(/latest of 3 like this/u)).toBeTruthy();
    // Seen is not dealt with: "Needs you" is not marked read on opening.
    expect(markRead).not.toHaveBeenCalled();
    // Opening the row is: every folded notice is marked read.
    fireEvent.click(
      screen.getByRole("link", { name: /5 things need your yes/u }),
    );
    expect(markRead).toHaveBeenCalledWith(
      repeats.map((item) => item.id).toReversed(),
    );
  });

  it("marks the updates shown read on opening, and leaves what needs you alone", async () => {
    // A fresh store: the shell's one read is shared, and was made above.
    vi.resetModules();
    const { NotificationCenter } =
      await import("../src/features/work/notification-center");
    const need = notice({ title: ASK, priority: "NEEDS_YOU" });
    const update = notice({ title: "Voltron is interested" });
    list.mockResolvedValue({
      ok: true,
      value: { items: [need, update], unread: 2 },
    });
    markRead.mockResolvedValue({ ok: true, value: null });
    render(<NotificationCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 2 new" }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(markRead).toHaveBeenCalledWith([update.id]);
  });
});

describe("a resolved notice leaves Needs you (live QA: Brightkloof)", () => {
  it("an answered interest notice -- read on the server -- moves to its day, with no Open", () => {
    const resolved = notice({
      kind: "INTEREST_RECEIVED",
      title: "Savanna Seed Partners is interested in Brightkloof",
      priority: "NEEDS_YOU",
      read: true,
      createdAt: "2026-10-03T08:00:00Z",
    });
    const open = notice({ title: ASK, priority: "NEEDS_YOU" });
    const { needsYou, days } = groupNotices([resolved, open], NOW);
    expect(needsYou.map((group) => group.notice.id)).toEqual([open.id]);
    expect(days).toEqual([
      expect.objectContaining({
        label: "Today",
        groups: [expect.objectContaining({ ids: [resolved.id] })],
      }),
    ]);
  });
});
