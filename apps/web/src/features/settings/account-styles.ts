import { cx } from "@capital-q/ui";

/**
 * The account pages' class names (chosen designs 2026-10-21), in a plain
 * module so server and client components both use them.
 */

export type AccountButtonVariant = "primary" | "secondary" | "quiet" | "done";

const VARIANT: Readonly<Record<AccountButtonVariant, string>> = {
  primary:
    "bg-[var(--cq-primary-action,var(--cq-accent))] text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]",
  secondary:
    "border border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-text-tertiary)",
  quiet:
    "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
  done: "bg-(--cq-positive-soft) text-(--cq-positive)",
};

/**
 * The design's button: 44px everywhere, radius 8, gives when pressed.
 * `sm` is the design's small button (13px words, tighter sides), still
 * 44px tall so a thumb finds it.
 */
export function accountButton(
  variant: AccountButtonVariant = "secondary",
  size: "regular" | "sm" = "regular",
  extra?: string,
): string {
  return cx(
    "cq-crm-press relative inline-flex min-h-11 items-center justify-center gap-2 overflow-hidden rounded-(--cq-radius-md) font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:pointer-events-none disabled:opacity-60",
    size === "sm" ? "gap-1.5 px-3 text-[13px]" : "px-4 text-sm",
    variant === "quiet" ? "px-2.5" : null,
    VARIANT[variant],
    extra,
  );
}

/** The design's input frame: 44px, radius 8, an accent ring on focus. */
export const fieldClassName =
  "min-h-11 w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2.5 text-[15px] text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) transition-[border-color,box-shadow] duration-(--cq-motion-fast) outline-none focus:border-(--cq-text-secondary) focus:shadow-[0_0_0_3px_var(--cq-accent-soft)] disabled:opacity-60";
