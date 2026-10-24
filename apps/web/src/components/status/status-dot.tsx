import { cx } from "@capital-q/ui";

/**
 * One status grammar everywhere work or a relationship has a state (owner
 * reference design, 24 Oct): a small dot and one short label, never a
 * filled badge, capitals or a coloured row. The label always carries the
 * meaning; the dot only echoes it (WCAG 1.4.1). The dot breathes only
 * while something is actually being worked on.
 */
export type StatusTone =
  "working" | "active" | "waiting" | "done" | "failed" | "idle";

const DOT: Readonly<Record<StatusTone, string>> = {
  working: "bg-(--cq-accent)",
  // Under way, but nothing is being worked on this second: no breathing.
  active: "bg-(--cq-accent)",
  waiting: "bg-(--cq-warning)",
  done: "bg-(--cq-positive)",
  failed: "bg-(--cq-danger)",
  idle: "border-[1.5px] border-(--cq-text-tertiary) bg-transparent",
};

export function StatusDot({
  tone,
  label,
  className,
}: {
  readonly tone: StatusTone;
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-(--cq-text-secondary)",
        className,
      )}
      data-status={tone}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-2 flex-none rounded-full",
          DOT[tone],
          tone === "working" ? "cq-status-breathe" : "",
        )}
      />
      {label}
    </span>
  );
}
