// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Perf lane 2026-10-16: a CRM tab that changes only the query has no route
 * loading state; the tapped tab marks itself at once while its view is
 * read, and the view about to change dims through `[data-link-pending]`.
 */

const status = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", async (actual) => ({
  ...(await actual<typeof import("next/link")>()),
  useLinkStatus: () => ({ pending: status.pending }),
}));

const { LinkPending } = await import("../src/components/link-pending");
const { HUB_PAGE_PENDING } =
  await import("../src/features/relationships/hub-view");

afterEach(() => {
  cleanup();
  status.pending = false;
});

describe("a tapped CRM tab answers at once", () => {
  it("marks the tab only while its view is being read", () => {
    const { container, rerender } = render(<LinkPending />);
    expect(container.querySelector("[data-link-pending]")).toBeNull();
    status.pending = true;
    rerender(<LinkPending />);
    const mark = container.querySelector("[data-link-pending]");
    expect(mark).not.toBeNull();
    // Decorative: the link itself says where it goes.
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });

  it("dims what is about to change, never the header with its tabs", () => {
    expect(HUB_PAGE_PENDING).toContain(
      "[&:has([data-link-pending])>:not(header)]:opacity-60",
    );
  });
});
