"use client";

import { cx } from "@capital-q/ui";
import { ChevronDown, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

/**
 * A navigation group's disclosure button (founder direction 2026-10-07).
 * A real button with aria-expanded and aria-controls, at least 44 px tall.
 * Closed, it carries the group's waiting count, so what needs the person
 * is never hidden by folding the group away. The chevron turns; reduced
 * motion turns that off.
 */
export function NavGroupToggle({
  label,
  open,
  controls,
  waiting,
  onToggle,
  compact = false,
  size = "regular",
}: {
  readonly label: string;
  readonly open: boolean;
  readonly controls: string;
  /** Items in the group waiting on the person, shown while it is closed. */
  readonly waiting: number;
  readonly onToggle: () => void;
  /** The folded rail: an icon-sized button, its name in a tooltip. */
  readonly compact?: boolean;
  /** The phone's More sheet sets a step larger. */
  readonly size?: "regular" | "large";
}) {
  const count = !open && waiting > 0 ? waiting : null;
  const name =
    count === null ? label : `${label}, ${String(count)} waiting for you`;
  const chevron = (
    <ChevronDown
      aria-hidden="true"
      size={ICON_SIZE.regular - 2}
      strokeWidth={ICON_STROKE}
      className={cx(
        "flex-none text-(--cq-text-tertiary) transition-transform duration-(--cq-motion-fast) motion-reduce:transition-none",
        open ? null : "-rotate-90",
      )}
    />
  );
  const button = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={compact || count !== null ? name : undefined}
      onClick={onToggle}
      data-nav-group-toggle={label}
      className={cx(
        "relative flex min-h-11 items-center rounded-md text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
        compact
          ? "w-11 justify-center"
          : cx(
              "w-full gap-2 px-3 text-left font-medium",
              size === "large" ? "cq-label" : "cq-caption",
            ),
      )}
    >
      {compact ? null : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {count === null ? null : (
        <span
          aria-hidden="true"
          className={cx(
            "cq-caption cq-numeric font-semibold text-(--cq-accent)",
            compact ? "absolute top-1 right-1" : null,
          )}
        >
          {count}
        </span>
      )}
      {chevron}
    </button>
  );
  return compact ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
