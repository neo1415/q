import { cx } from "../primitives/class-names.js";
import type { QState } from "../tokens/index.js";

/**
 * The Q mark (doc 18 §33): a word-mark in a restrained accent frame. Not a
 * mascot, not a sparkle, not an orb, and not reused as a generic icon. State
 * is expressed through the frame's tone and is always accompanied by text
 * elsewhere; the mark never carries meaning alone.
 */

export const Q_MARK_SIZES = { sm: 24, md: 32, lg: 40 } as const;
export type QMarkSize = keyof typeof Q_MARK_SIZES;

const stateFrame: Record<QState, string> = {
  IDLE: "bg-(--cq-accent-soft) text-(--cq-accent)",
  LISTENING: "bg-(--cq-accent) text-(--cq-text-inverse)",
  WORKING: "bg-(--cq-accent) text-(--cq-text-inverse)",
  NEEDS_INPUT:
    "bg-(--cq-accent-soft) text-(--cq-accent) ring-2 ring-(--cq-accent)",
  NEEDS_APPROVAL:
    "bg-(--cq-accent) text-(--cq-text-inverse) ring-2 ring-(--cq-accent-soft)",
  COMPLETE: "bg-(--cq-accent-soft) text-(--cq-accent)",
  ERROR: "bg-(--cq-danger-soft) text-(--cq-danger)",
};

export type QMarkProps = {
  readonly size?: QMarkSize | undefined;
  readonly state?: QState | undefined;
  readonly className?: string | undefined;
};

export function QMark({ size = "md", state = "IDLE", className }: QMarkProps) {
  const px = Q_MARK_SIZES[size];
  return (
    <span
      aria-hidden="true"
      data-q-state={state}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md font-semibold tracking-tight transition-colors duration-(--cq-motion-base)",
        stateFrame[state],
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.55) }}
    >
      Q
    </span>
  );
}
