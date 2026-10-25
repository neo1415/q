"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  BOARD_COLUMNS,
  type BoardItem,
  type BoardItemStatus,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ICON_SIZE,
  ICON_STROKE,
  Move,
  Plus,
  Trash2,
} from "@capital-q/ui/icons";

import {
  addBoardItemAction,
  listBoardAction,
  moveBoardItemAction,
  updateBoardItemAction,
  type BoardResult,
} from "./board-actions";
import {
  COLUMN_LABELS,
  columnsOf,
  isSamePlace,
  moved,
  movedWords,
  placeOf,
  stepped,
  type BoardColumns,
  type BoardKey,
  type BoardPlace,
} from "./board-model";
import { useT } from "@/features/i18n/language";

/**
 * The work board (owner 2026-10-23): the person's own documents,
 * companies, tasks, notes and Q's work, in To do, Doing and Done.
 *
 * Every way to move an item does the same thing: drag it (mouse, pen or
 * touch, by its handle), pick it up with the keyboard (Space, then the
 * arrow keys, Space again to drop, Escape to put it back), or choose a
 * column from its Move menu. A move shows at once and is confirmed by the
 * server; if the server refuses, it goes back and the board is read again.
 * Q reads and changes the same board, as the person.
 */

const KIND_LABELS: Readonly<Record<BoardItem["kind"], string>> = {
  DOCUMENT: "Document",
  COMPANY: "Company",
  TASK: "Task",
  NOTE: "Note",
  WORK_JOB: "Q's work",
};

const ARROWS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function hrefOf(item: BoardItem): string | null {
  if (item.refId === null) return null;
  if (item.kind === "DOCUMENT") {
    return `/documents?open=${encodeURIComponent(item.refId)}`;
  }
  if (item.kind === "COMPANY") {
    return `/company/${encodeURIComponent(item.refId)}`;
  }
  return null;
}

type Drag = {
  readonly itemId: string;
  readonly pointerId: number;
  /** The board as it was when the item was picked up, to put it back. */
  readonly before: BoardColumns;
};

export function WorkBoard({
  initial,
}: {
  readonly initial: readonly BoardItem[] | null;
}) {
  const t = useT();
  const instructions = useId();
  const [columns, setColumns] = useState<BoardColumns>(() =>
    columnsOf(initial ?? []),
  );
  const [unavailable, setUnavailable] = useState(initial === null);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [grabbed, setGrabbed] = useState<{
    readonly itemId: string;
    readonly before: BoardColumns;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startSaving] = useTransition();

  const refresh = useCallback(async () => {
    const read = await listBoardAction();
    if (read.ok) {
      setColumns(columnsOf(read.value.items));
      setUnavailable(false);
    }
  }, []);

  const settle = useCallback(
    (result: BoardResult<BoardItem>, before: BoardColumns) => {
      if (result.ok) {
        // The server's word on the item (its revision, its column).
        setColumns((current) => {
          const place = placeOf(current, result.value.id);
          if (place === null) return current;
          return {
            ...current,
            [place.status]: current[place.status].map((item) =>
              item.id === result.value.id ? result.value : item,
            ),
          };
        });
        return;
      }
      setColumns(before);
      setError(t(result.message));
      if (result.reason === "CONFLICT" || result.reason === "NOT_FOUND") {
        void refresh();
      }
    },
    [refresh, t],
  );

  /** Send a move the board already shows; undone if the server refuses. */
  const commit = useCallback(
    (itemId: string, before: BoardColumns, after: BoardColumns) => {
      const from = placeOf(before, itemId);
      const to = placeOf(after, itemId);
      if (from === null || to === null) return;
      if (from.status === to.status && from.index === to.index) return;
      const item = before[from.status][from.index];
      setError(null);
      setAnnouncement(
        movedWords(item?.title ?? "", to, after[to.status].length, t),
      );
      startSaving(async () => {
        const result = await moveBoardItemAction({
          itemId,
          idempotencyKey: crypto.randomUUID(),
          request: {
            status: to.status,
            index: to.index,
            ...(item === undefined ? {} : { revision: item.revision }),
          },
        });
        settle(result, before);
      });
    },
    [settle, t],
  );

  const moveTo = (itemId: string, to: BoardPlace) => {
    const before = columns;
    if (isSamePlace(before, itemId, to)) return;
    const after = moved(before, itemId, to);
    setColumns(after);
    commit(itemId, before, after);
  };

  // --- keyboard: pick up, move, drop ------------------------------------

  const onHandleKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    item: BoardItem,
  ) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbed?.itemId === item.id) {
        commit(item.id, grabbed.before, columns);
        setGrabbed(null);
        return;
      }
      setGrabbed({ itemId: item.id, before: columns });
      setAnnouncement(
        `${item.title}: ${t("picked up. Use the arrow keys to move it, Space to drop it, Escape to cancel.")}`,
      );
      return;
    }
    if (event.key === "Escape" && grabbed?.itemId === item.id) {
      event.preventDefault();
      setColumns(grabbed.before);
      setGrabbed(null);
      setAnnouncement(`${item.title}: ${t("put back.")}`);
      return;
    }
    if (grabbed?.itemId !== item.id || !ARROWS.has(event.key)) return;
    event.preventDefault();
    const place = placeOf(columns, item.id);
    if (place === null) return;
    const next = stepped(columns, place, event.key as BoardKey);
    if (next === null) return;
    const after = moved(columns, item.id, next);
    setColumns(after);
    setAnnouncement(movedWords(item.title, next, after[next.status].length, t));
    // Focus follows the item into its new column.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-board-handle="${item.id}"]`)
        ?.focus();
    });
  };

  // --- pointer: drag by the handle -----------------------------------------

  const placeUnder = (
    x: number,
    y: number,
    itemId: string,
  ): BoardPlace | null => {
    const column = document
      .elementsFromPoint(x, y)
      .map((element) => element.closest<HTMLElement>("[data-board-column]"))
      .find((element): element is HTMLElement => element !== null);
    const status = column?.dataset["boardColumn"] as
      BoardItemStatus | undefined;
    if (column === undefined || status === undefined) return null;
    const cards = [
      ...column.querySelectorAll<HTMLElement>("[data-board-item]"),
    ].filter((card) => card.dataset["boardItem"] !== itemId);
    const index = cards.findIndex((card) => {
      const box = card.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return { status, index: index === -1 ? cards.length : index };
  };

  // A dragged item changes column, and its handle with it, so the drag is
  // followed on the window rather than on the handle it started from.
  const latest = useRef(columns);
  useEffect(() => {
    latest.current = columns;
  }, [columns]);

  const onPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    item: BoardItem,
  ) => {
    if (event.button !== 0 || drag.current !== null) return;
    event.preventDefault();
    const started: Drag = {
      itemId: item.id,
      pointerId: event.pointerId,
      before: latest.current,
    };
    drag.current = started;
    setDragging(item.id);
    const follow = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== started.pointerId) return;
      const to = placeUnder(move.clientX, move.clientY, started.itemId);
      if (to === null || isSamePlace(latest.current, started.itemId, to)) {
        return;
      }
      const next = moved(latest.current, started.itemId, to);
      latest.current = next;
      setColumns(next);
    };
    const end = (cancel: boolean) => (last: globalThis.PointerEvent) => {
      if (last.pointerId !== started.pointerId) return;
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancelDrag);
      drag.current = null;
      setDragging(null);
      if (cancel) {
        latest.current = started.before;
        setColumns(started.before);
        return;
      }
      commit(started.itemId, started.before, latest.current);
    };
    const drop = end(false);
    const cancelDrag = end(true);
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancelDrag);
  };

  // --- adding and removing ---------------------------------------------------

  const add = () => {
    const title = draft.trim();
    if (title.length === 0) return;
    setError(null);
    setDraft("");
    startSaving(async () => {
      const result = await addBoardItemAction({
        idempotencyKey: crypto.randomUUID(),
        request: { kind: "TASK", title },
      });
      if (!result.ok) {
        setDraft(title);
        setError(t(result.message));
        return;
      }
      setColumns((current) => ({
        ...current,
        TODO: [...current.TODO, result.value],
      }));
      setAnnouncement(`${title}: ${t("added to To do.")}`);
    });
  };

  const remove = (item: BoardItem) => {
    const before = columns;
    const place = placeOf(before, item.id);
    if (place === null) return;
    setColumns({
      ...before,
      [place.status]: before[place.status].filter((one) => one.id !== item.id),
    });
    setAnnouncement(`${item.title}: ${t("taken off your board.")}`);
    startSaving(async () => {
      const result = await updateBoardItemAction({
        itemId: item.id,
        request: { revision: item.revision, archived: true },
      });
      if (!result.ok) settle(result, before);
    });
  };

  if (unavailable) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-state="unavailable"
      >
        {t("Your board couldn't be read just now. Nothing on it has changed.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-board="work">
      <p id={instructions} className="sr-only">
        {t(
          "To move an item with the keyboard, press Space on its handle, use the arrow keys, then press Space to drop it or Escape to cancel.",
        )}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label className="sr-only" htmlFor={`${instructions}-new`}>
          {t("New task")}
        </label>
        <input
          id={`${instructions}-new`}
          value={draft}
          maxLength={300}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder={t("Add a task to your board")}
          className="min-h-11 flex-1 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
        />
        <button
          type="submit"
          className={cx(buttonClassName("secondary"), "min-h-11")}
          disabled={draft.trim().length === 0}
        >
          <Plus
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
          {t("Add")}
        </button>
      </form>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {BOARD_COLUMNS.map((status) => (
          <section
            key={status}
            data-board-column={status}
            aria-labelledby={`${instructions}-${status}`}
            className="flex min-h-32 flex-col gap-2 rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) p-3"
          >
            <h2
              id={`${instructions}-${status}`}
              className="cq-label text-(--cq-text-secondary)"
            >
              {t(COLUMN_LABELS[status])}{" "}
              <span className="text-(--cq-text-tertiary)">
                {String(columns[status].length)}
              </span>
            </h2>
            {columns[status].length === 0 ? (
              <p className="cq-body-sm text-(--cq-text-tertiary)">
                {t("Nothing here yet.")}
              </p>
            ) : null}
            <ol className="flex flex-col gap-2">
              {columns[status].map((item) => {
                const href = hrefOf(item);
                const lifted =
                  dragging === item.id || grabbed?.itemId === item.id;
                return (
                  <li
                    key={item.id}
                    data-board-item={item.id}
                    className={cx(
                      "flex items-start gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-2",
                      lifted ? "outline-2 outline-(--cq-focus-ring)" : "",
                    )}
                  >
                    <button
                      type="button"
                      data-board-handle={item.id}
                      aria-describedby={instructions}
                      aria-pressed={grabbed?.itemId === item.id}
                      aria-label={`${t("Move")} ${item.title}`}
                      className="flex size-11 shrink-0 touch-none items-center justify-center rounded-(--cq-radius-sm) text-(--cq-text-secondary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                      onKeyDown={(event) => {
                        onHandleKey(event, item);
                      }}
                      onPointerDown={(event) => {
                        onPointerDown(event, item);
                      }}
                    >
                      <Move
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                        aria-hidden
                      />
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {href === null ? (
                        <span className="text-(--cq-text-primary)">
                          {item.title}
                        </span>
                      ) : (
                        <Link
                          href={href}
                          className="text-(--cq-text-primary) underline-offset-2 hover:underline"
                        >
                          {item.title}
                        </Link>
                      )}
                      <span className="cq-body-sm text-(--cq-text-tertiary)">
                        {t(KIND_LABELS[item.kind])}
                        {item.dueOn === null
                          ? ""
                          : ` · ${t("due")} ${item.dueOn}`}
                        {item.workJobId === null ||
                        (item.attention ?? null) !== null
                          ? ""
                          : ` · ${item.status === "DONE" ? t("Q finished this") : t("Q is working on it")}`}
                        {item.createdBy === "Q" ? ` · ${t("added by Q")}` : ""}
                      </span>
                      {/* QA F-117: Q's job stopped or waits for them. */}
                      {item.attention === undefined ||
                      item.attention === null ? null : (
                        <span
                          className="cq-body-sm text-(--cq-text-primary)"
                          data-board-attention
                        >
                          {`${t("Needs you")}: ${t(item.attention)}`}
                        </span>
                      )}
                      {item.notes === null ? null : (
                        <span className="cq-body-sm text-(--cq-text-secondary)">
                          {item.notes}
                        </span>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`${item.id}-move`}>
                          {`${t("Move to")}: ${item.title}`}
                        </label>
                        <select
                          id={`${item.id}-move`}
                          value={item.status}
                          onChange={(event) => {
                            const to = event.target.value as BoardItemStatus;
                            moveTo(item.id, {
                              status: to,
                              index: columns[to].length,
                            });
                          }}
                          className="min-h-11 rounded-(--cq-radius-sm) border border-(--cq-border) bg-(--cq-surface) px-2 text-(--cq-text-primary)"
                        >
                          {BOARD_COLUMNS.map((column) => (
                            <option key={column} value={column}>
                              {t(COLUMN_LABELS[column])}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`${t("Take off your board")}: ${item.title}`}
                          className="flex size-11 items-center justify-center rounded-(--cq-radius-sm) text-(--cq-text-tertiary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                          onClick={() => {
                            remove(item);
                          }}
                        >
                          <Trash2
                            size={ICON_SIZE.compact}
                            strokeWidth={ICON_STROKE}
                            aria-hidden
                          />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
