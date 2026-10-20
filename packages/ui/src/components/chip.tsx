import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Chips (doc 18 §56): compact options and statuses. Pills are reserved for
 * exactly this. A selectable chip is a real button with `aria-pressed`, so
 * selection is announced and never signalled by colour alone.
 */

const chipBase =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 cq-label transition-colors duration-(--cq-motion-fast)";

export type ChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "className"> & {
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

export function Chip({ className, children, ...rest }: ChipProps) {
  return (
    <span
      className={cx(
        chipBase,
        "border-(--cq-border) bg-(--cq-surface) text-(--cq-text-secondary)",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export type ChoiceChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "aria-pressed" | "type"
> & {
  readonly selected: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

export function ChoiceChip({
  selected,
  className,
  children,
  ...rest
}: ChoiceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        chipBase,
        "min-h-11 cursor-pointer",
        selected
          ? "border-(--cq-accent) bg-(--cq-accent-soft) text-(--cq-text-primary)"
          : "border-(--cq-border) bg-(--cq-surface) text-(--cq-text-secondary) hover:border-(--cq-border-strong)",
        className,
      )}
      {...rest}
    >
      {selected ? (
        <span aria-hidden="true" className="text-(--cq-accent)">
          ✓
        </span>
      ) : null}
      {children}
    </button>
  );
}
