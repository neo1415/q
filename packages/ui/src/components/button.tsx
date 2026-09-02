import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Buttons (doc 18 §§46–51). Four semantic variants, no decorative ones. One
 * primary action per local decision area is the caller's discipline.
 *
 * Sizes are mobile-first: `regular` is a 44 px touch control and relaxes to
 * 40 px on large screens; `compact` is for dense desktop contexts and keeps a
 * 44 px hit area through its outer padding box.
 */

export const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "quiet",
  "danger",
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ["compact", "regular", "large"] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-(--cq-motion-fast) disabled:pointer-events-none disabled:opacity-50";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-(--cq-accent) text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)",
  secondary:
    "border border-(--cq-border) bg-(--cq-surface) text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)",
  quiet:
    "bg-transparent text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)",
  danger: "bg-(--cq-danger) text-(--cq-text-inverse) hover:opacity-90",
};

const sizeClass: Record<ButtonSize, string> = {
  compact: "h-8 px-3 cq-label",
  regular: "h-11 px-4 cq-body-sm lg:h-10",
  large: "h-12 px-5 cq-body",
};

export function buttonClassName(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "regular",
  className?: string,
): string {
  return cx(base, variantClass[variant], sizeClass[size], className);
}

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> & {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "regular",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A square icon-only control. The accessible name is mandatory: an icon
 * button without a label is a button a screen reader cannot describe.
 */
export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "aria-label" | "children"
> & {
  readonly "aria-label": string;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: Exclude<ButtonSize, "large"> | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

const iconSizeClass: Record<Exclude<ButtonSize, "large">, string> = {
  compact: "size-8",
  regular: "size-11 lg:size-10",
};

export function IconButton({
  variant = "quiet",
  size = "regular",
  className,
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={cx(
        base,
        variantClass[variant],
        iconSizeClass[size],
        "p-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
