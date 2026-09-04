import { cx } from "@capital-q/ui";

import type { SaveStatus } from "../controller";

/**
 * Quiet autosave feedback. A polite live region that only has content on
 * meaningful transitions, so screen readers hear "Saved" once rather than a
 * stream of updates.
 */
const label: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save",
};

export function SaveStatusIndicator({
  status,
}: {
  readonly status: SaveStatus;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-status={status}
      className={cx(
        "cq-caption",
        status === "failed"
          ? "text-(--cq-danger)"
          : "text-(--cq-text-tertiary)",
      )}
    >
      {label[status]}
    </span>
  );
}
