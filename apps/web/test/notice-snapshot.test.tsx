// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  NotificationDtoSchema,
  type NotificationDto,
} from "@capital-q/contracts";

import { NoticeSnapshot } from "../src/features/work/notice-snapshot";
import {
  resetNoticeStore,
  seedNoticesForReview,
  useNotices,
  type NoticeState,
} from "../src/features/work/notice-store";

/**
 * CLS (batch 7, live 0.31 at 390 on /work): the page said "Nothing waits
 * for you" until this tab's notice read landed, then grew by every notice.
 * The server's read rides with the page: it is what the server renders,
 * what hydration renders, and what shows until this tab's own read lands.
 */
function Count() {
  const notices = useNotices();
  return (
    <p data-count={String(notices.items?.length ?? "none")}>
      {notices.items === null ? "unknown" : `${notices.items.length} notices`}
    </p>
  );
}

function notice(id: string): NotificationDto {
  return NotificationDtoSchema.parse({
    id,
    kind: "REMINDER",
    title: "A reminder",
    body: null,
    linkPath: null,
    read: false,
    createdAt: "2026-11-07T10:00:00.000Z",
    priority: "NEEDS_YOU",
  });
}
const ONE = notice("9b0a6a2e-5d0f-4a8e-9a43-0f3a1d2c4b51");
const TWO = notice("2f8c1d77-0b6e-4c3a-8f21-7e5d9a0b1c62");
const snapshot: NoticeState = {
  items: [ONE, TWO],
  unread: 2,
  failed: false,
};

afterEach(() => {
  resetNoticeStore();
});

describe("the page's notice snapshot", () => {
  it("is what the server and hydration render, with no mismatch", async () => {
    const tree = (
      <NoticeSnapshot value={snapshot}>
        <Count />
      </NoticeSnapshot>
    );
    const html = renderToString(tree);
    expect(html).toContain("2 notices");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(() => {
      hydrateRoot(container, tree, {
        onRecoverableError: (error) => errors.push(error),
      });
      return Promise.resolve();
    });
    expect(errors).toEqual([]);
    // The tab's own read has not landed: still the server's two.
    expect(container.querySelector("p")?.dataset.count).toBe("2");
    container.remove();
  });

  it("gives way to this tab's own read once it lands", () => {
    render(
      <NoticeSnapshot value={snapshot}>
        <Count />
      </NoticeSnapshot>,
    );
    expect(screen.getByText("2 notices")).toBeTruthy();
    act(() => {
      seedNoticesForReview({ items: [ONE], unread: 1, failed: false });
    });
    expect(screen.getByText("1 notices")).toBeTruthy();
  });

  it("without a snapshot, is today's store (unknown until read)", () => {
    render(<Count />);
    expect(screen.getByText("unknown")).toBeTruthy();
  });
});
