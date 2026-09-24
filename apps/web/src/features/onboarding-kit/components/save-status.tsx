import { cx } from "@capital-q/ui";
import { Check, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import type { SaveStatus } from "../controller";

/**
 * Quiet autosave feedback. A polite live region that only has content on
 * meaningful transitions, so screen readers hear "Saved" once rather than a
 * stream of updates. It is a status line, never a notice: a save that fails
 * is reported by the screen's own InlineNotice with a Retry, and this line
 * only says so in words.
 */
const label: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving",
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
        "cq-status-line",
        status === "failed" && "text-(--cq-danger)",
      )}
    >
      {status === "saved" ? (
        <Check
          aria-hidden="true"
          size={ICON_SIZE.compact - 2}
          strokeWidth={ICON_STROKE}
        />
      ) : null}
      {label[status]}
      {status === "saving" ? (
        <span aria-hidden="true" className="inline-flex gap-0.5">
          <span className="cq-working-dot">·</span>
          <span className="cq-working-dot">·</span>
          <span className="cq-working-dot">·</span>
        </span>
      ) : null}
    </span>
  );
}
