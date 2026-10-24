// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardItem, BoardItemStatus } from "@capital-q/contracts";

const moveBoardItemAction = vi.fn();
const updateBoardItemAction = vi.fn();
const addBoardItemAction = vi.fn();
const listBoardAction = vi.fn();
vi.mock("@/features/board/board-actions", () => ({
  moveBoardItemAction: (...args: unknown[]) =>
    moveBoardItemAction(...args) as unknown,
  updateBoardItemAction: (...args: unknown[]) =>
    updateBoardItemAction(...args) as unknown,
  addBoardItemAction: (...args: unknown[]) =>
    addBoardItemAction(...args) as unknown,
  listBoardAction: (...args: unknown[]) => listBoardAction(...args) as unknown,
}));

import {
  columnsOf,
  isSamePlace,
  moved,
  placeOf,
  stepped,
} from "../src/features/board/board-model";
import { pinKeyOf } from "../src/features/board/keep-on-board";
import { WorkBoard } from "../src/features/board/work-board";

/**
 * The work board (owner 2026-10-23): one set of rules for a drag, a key
 * and the Move menu; a move shows at once and goes back if the server
 * refuses; the keyboard can do everything the pointer can, and says what
 * happened.
 */

const ID = (n: number) => `b0000000-0000-4000-8000-00000000000${String(n)}`;

function item(
  n: number,
  title: string,
  status: BoardItemStatus = "TODO",
): BoardItem {
  return {
    id: ID(n),
    kind: "TASK",
    refId: null,
    title,
    notes: null,
    status,
    position: `${String(n * 1024)}`,
    dueOn: null,
    workJobId: null,
    createdBy: "PERSON",
    revision: 1,
    createdAt: "2026-10-23T21:00:00.000Z",
    updatedAt: "2026-10-23T21:00:00.000Z",
  };
}

const ITEMS = [
  item(1, "Hire a head of sales"),
  item(2, "Close the bridge"),
  item(3, "Research the market", "DOING"),
];

const titles = (status: string) =>
  within(
    document.querySelector(`[data-board-column="${status}"]`) as HTMLElement,
  )
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("span, a")?.textContent);

describe("board model", () => {
  it("moves within and between columns, keeping the order of the rest", () => {
    const columns = columnsOf(ITEMS);
    const next = moved(columns, ID(2), { status: "TODO", index: 0 });
    expect(next.TODO.map((one) => one.title)).toEqual([
      "Close the bridge",
      "Hire a head of sales",
    ]);
    const across = moved(columns, ID(1), { status: "DOING", index: 9 });
    expect(across.DOING.map((one) => [one.title, one.status])).toEqual([
      ["Research the market", "DOING"],
      ["Hire a head of sales", "DOING"],
    ]);
    expect(placeOf(across, ID(1))).toEqual({ status: "DOING", index: 1 });
    expect(isSamePlace(columns, ID(2), { status: "TODO", index: 5 })).toBe(
      true,
    );
    expect(isSamePlace(columns, ID(2), { status: "DONE", index: 0 })).toBe(
      false,
    );
  });

  it("steps with the arrow keys and stops at the edges", () => {
    const columns = columnsOf(ITEMS);
    expect(
      stepped(columns, { status: "TODO", index: 0 }, "ArrowUp"),
    ).toBeNull();
    expect(stepped(columns, { status: "TODO", index: 0 }, "ArrowDown")).toEqual(
      {
        status: "TODO",
        index: 1,
      },
    );
    expect(
      stepped(columns, { status: "TODO", index: 1 }, "ArrowRight"),
    ).toEqual({
      status: "DOING",
      index: 1,
    });
    expect(
      stepped(columns, { status: "TODO", index: 0 }, "ArrowLeft"),
    ).toBeNull();
    expect(
      stepped(columns, { status: "DOING", index: 0 }, "ArrowRight"),
    ).toEqual({
      status: "DONE",
      index: 0,
    });
  });

  it("keys a pinned document the same way every time, as a UUID", async () => {
    const key = await pinKeyOf("artifact-1");
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(await pinKeyOf("artifact-1")).toBe(key);
    expect(await pinKeyOf("artifact-2")).not.toBe(key);
  });
});

describe("WorkBoard", () => {
  beforeEach(() => {
    moveBoardItemAction.mockReset();
    updateBoardItemAction.mockReset();
    listBoardAction.mockReset();
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
      run();
      return 0;
    });
  });

  it("moves an item with the keyboard: Space picks it up, arrows move it, Space drops it and the server is told once", async () => {
    moveBoardItemAction.mockResolvedValue({
      ok: true,
      value: { ...item(1, "Hire a head of sales", "DOING"), revision: 2 },
    });
    render(<WorkBoard initial={ITEMS} />);
    const handle = screen.getByRole("button", {
      name: "Move Hire a head of sales",
    });
    fireEvent.keyDown(handle, { key: " " });
    expect(screen.getByText(/picked up/u)).toBeTruthy();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    // It keeps its place in the next column (the top).
    expect(titles("DOING")).toEqual([
      "Hire a head of sales",
      "Research the market",
    ]);
    expect(moveBoardItemAction).not.toHaveBeenCalled();
    const moved = screen.getByRole("button", {
      name: "Move Hire a head of sales",
    });
    await act(async () => {
      fireEvent.keyDown(moved, { key: " " });
      await Promise.resolve();
    });
    expect(moveBoardItemAction).toHaveBeenCalledTimes(1);
    expect(moveBoardItemAction.mock.calls[0]?.[0]).toMatchObject({
      itemId: ID(1),
      request: { status: "DOING", index: 0, revision: 1 },
    });
    expect(screen.getByText(/moved to Doing, position 1 of 2/u)).toBeTruthy();
  });

  it("puts an item back with Escape and tells the server nothing", () => {
    render(<WorkBoard initial={ITEMS} />);
    const handle = screen.getByRole("button", {
      name: "Move Close the bridge",
    });
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(titles("TODO")).toEqual([
      "Close the bridge",
      "Hire a head of sales",
    ]);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Move Close the bridge" }),
      { key: "Escape" },
    );
    expect(titles("TODO")).toEqual([
      "Hire a head of sales",
      "Close the bridge",
    ]);
    expect(moveBoardItemAction).not.toHaveBeenCalled();
  });

  it("moves from the Move menu, and goes back and reads the board again when the server refuses", async () => {
    moveBoardItemAction.mockResolvedValue({
      ok: false,
      reason: "CONFLICT",
      message: "This item changed since you last saw it. Reload the board.",
    });
    listBoardAction.mockResolvedValue({
      ok: true,
      value: {
        items: ITEMS,
        columns: ["TODO", "DOING", "DONE"],
        visibility: "personal_private",
      },
    });
    render(<WorkBoard initial={ITEMS} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Move to: Hire a head of sales"), {
        target: { value: "DONE" },
      });
      await Promise.resolve();
    });
    expect(moveBoardItemAction.mock.calls[0]?.[0]).toMatchObject({
      request: { status: "DONE", index: 0 },
    });
    await screen.findByRole("alert");
    expect(titles("TODO")).toEqual([
      "Hire a head of sales",
      "Close the bridge",
    ]);
    expect(titles("DONE")).toEqual([]);
    expect(listBoardAction).toHaveBeenCalled();
  });

  it("drags an item by its handle into another column (pointer, so mouse, pen and touch alike)", async () => {
    moveBoardItemAction.mockResolvedValue({
      ok: true,
      value: { ...item(2, "Close the bridge", "DONE"), revision: 2 },
    });
    render(<WorkBoard initial={ITEMS} />);
    const done = document.querySelector(
      '[data-board-column="DONE"]',
    ) as HTMLElement;
    // jsdom has no layout: the pointer is over the Done column.
    document.elementsFromPoint = () => [done];
    const handle = screen.getByRole("button", {
      name: "Move Close the bridge",
    });
    handle.setPointerCapture = () => undefined;
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 600, clientY: 40 });
    expect(titles("DONE")).toEqual(["Close the bridge"]);
    expect(moveBoardItemAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.pointerUp(
        screen.getByRole("button", { name: "Move Close the bridge" }),
        { pointerId: 7 },
      );
      await Promise.resolve();
    });
    expect(moveBoardItemAction).toHaveBeenCalledTimes(1);
    expect(moveBoardItemAction.mock.calls[0]?.[0]).toMatchObject({
      itemId: ID(2),
      request: { status: "DONE", index: 0 },
    });
  });

  it("puts a dragged item back when the pointer is cancelled", () => {
    render(<WorkBoard initial={ITEMS} />);
    const done = document.querySelector(
      '[data-board-column="DONE"]',
    ) as HTMLElement;
    document.elementsFromPoint = () => [done];
    const handle = screen.getByRole("button", {
      name: "Move Close the bridge",
    });
    handle.setPointerCapture = () => undefined;
    fireEvent.pointerDown(handle, { button: 0, pointerId: 8 });
    fireEvent.pointerMove(handle, { pointerId: 8 });
    fireEvent.pointerCancel(
      screen.getByRole("button", { name: "Move Close the bridge" }),
      { pointerId: 8 },
    );
    expect(titles("DONE")).toEqual([]);
    expect(titles("TODO")).toEqual([
      "Hire a head of sales",
      "Close the bridge",
    ]);
    expect(moveBoardItemAction).not.toHaveBeenCalled();
  });

  it("says plainly when the board could not be read", () => {
    render(<WorkBoard initial={null} />);
    expect(screen.getByText(/couldn't be read just now/u)).toBeTruthy();
  });

  it("gives every control a name and a 44px target", () => {
    render(<WorkBoard initial={ITEMS} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-label") ?? button.textContent).not.toBe(
        "",
      );
    }
    for (const handle of document.querySelectorAll("[data-board-handle]")) {
      expect(handle.className).toMatch(/size-11/u);
    }
  });
});
