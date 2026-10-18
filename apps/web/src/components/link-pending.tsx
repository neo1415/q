"use client";

import { useLinkStatus } from "next/link";

/**
 * Perf lane 2026-10-16 (owner: "superfast page navigation has now become
 * slow"): a tab that changes only the address's query (CRM Overview,
 * Pipeline, its List/Table/Board) has no route loading state, so the old
 * view sat still for the whole server read, 0.4-2 s hosted, as if the tap
 * did nothing. Rendered inside a `<Link>`, this marks the tapped tab at
 * once while its view is read; the page around it dims what is about to
 * change through `[data-link-pending]` (CSS `:has`), never a spinner over
 * everything. Decorative: the link itself still says where it goes.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      data-link-pending
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 bg-(--cq-accent) motion-safe:animate-pulse"
    />
  );
}
