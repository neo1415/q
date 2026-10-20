import { cx } from "@capital-q/ui";

/**
 * A relationship's status as a pill (founder design 2026-09-28): a dot and
 * the words. The tone only echoes what the words say; the words always
 * carry the meaning (never colour alone). Pass is neutral, never red.
 */
export type StatusTone = "positive" | "waiting" | "attention" | "neutral";

const TONES: Readonly<Record<StatusTone, string>> = {
  positive:
    "border-(--cq-positive)/50 bg-(--cq-positive-soft) text-(--cq-text-primary) [--dot:var(--cq-positive)]",
  waiting:
    "border-(--cq-warning)/50 bg-(--cq-warning-soft) text-(--cq-text-primary) [--dot:var(--cq-warning)]",
  attention:
    "border-(--cq-accent)/50 bg-(--cq-accent-soft) text-(--cq-text-primary) [--dot:var(--cq-accent)]",
  neutral:
    "border-(--cq-border-subtle) bg-(--cq-surface) text-(--cq-text-secondary) [--dot:var(--cq-text-tertiary)]",
};

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: StatusTone;
  readonly children: string;
}) {
  return (
    <span
      className={cx(
        "cq-caption inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 whitespace-nowrap",
        TONES[tone],
      )}
      data-status-pill={tone}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-(--dot)" />
      {children}
    </span>
  );
}
