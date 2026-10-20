import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Badges (doc 18 §57) carry semantic status only: status, verification,
 * scope, exception. Never marketing ("Hot", "Top pick", "94% match").
 * The text is the meaning; the tone is reinforcement.
 */

export const BADGE_TONES = [
  "neutral",
  "accent",
  "positive",
  "warning",
  "danger",
] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

const toneClass: Record<BadgeTone, string> = {
  neutral:
    "bg-(--cq-surface-subtle) text-(--cq-text-secondary) border-(--cq-border-subtle)",
  accent: "bg-(--cq-accent-soft) text-(--cq-text-primary) border-transparent",
  positive:
    "bg-(--cq-positive-soft) text-(--cq-text-primary) border-transparent",
  warning: "bg-(--cq-warning-soft) text-(--cq-text-primary) border-transparent",
  danger: "bg-(--cq-danger-soft) text-(--cq-text-primary) border-transparent",
};

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "className"> & {
  readonly tone?: BadgeTone | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 cq-caption font-medium",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
