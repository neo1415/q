import type { HTMLAttributes, ReactNode } from "react";

import {
  AlertTriangle,
  CircleAlert,
  Check,
  ICON_SIZE,
  ICON_STROKE,
  Info,
} from "../icons/index.js";
import { cx } from "../primitives/class-names.js";

/**
 * Calm state patterns: inline notices, empty states, error states, the
 * permission-safe "not available" state, skeletons and progress. Tone is
 * specific and actionable; no giant red blocks, no fake activity.
 */

// ---------------------------------------------------------------------------
// InlineNotice
// ---------------------------------------------------------------------------

export const NOTICE_TONES = ["info", "positive", "warning", "danger"] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

const noticeTone: Record<
  NoticeTone,
  { readonly frame: string; readonly icon: string; readonly Icon: typeof Info }
> = {
  info: {
    frame: "border-(--cq-border-subtle) bg-(--cq-surface-subtle)",
    icon: "text-(--cq-info)",
    Icon: Info,
  },
  positive: {
    frame: "border-transparent bg-(--cq-positive-soft)",
    icon: "text-(--cq-positive)",
    Icon: Check,
  },
  warning: {
    frame: "border-transparent bg-(--cq-warning-soft)",
    icon: "text-(--cq-warning)",
    Icon: AlertTriangle,
  },
  danger: {
    frame: "border-transparent bg-(--cq-danger-soft)",
    icon: "text-(--cq-danger)",
    Icon: CircleAlert,
  },
};

export type InlineNoticeProps = {
  readonly tone?: NoticeTone | undefined;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly action?: ReactNode | undefined;
  readonly className?: string | undefined;
};

export function InlineNotice({
  tone = "info",
  title,
  children,
  action,
  className,
}: InlineNoticeProps) {
  const { frame, icon, Icon } = noticeTone[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cx(
        "flex items-start gap-3 rounded-md border px-3 py-3 text-(--cq-text-primary)",
        frame,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        size={ICON_SIZE.regular}
        strokeWidth={ICON_STROKE}
        className={cx("mt-0.5 shrink-0", icon)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title !== undefined ? (
          <p className="cq-body-sm font-medium">{title}</p>
        ) : null}
        <div className="cq-body-sm text-(--cq-text-secondary)">{children}</div>
        {action !== undefined ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState / ErrorState / AccessUnavailable
// ---------------------------------------------------------------------------

type StateBlockProps = Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "title"
> & {
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
};

export function EmptyState({
  title,
  description,
  action,
  compact = false,
  className,
  ...rest
}: StateBlockProps) {
  return (
    <section
      data-state="empty"
      aria-label={title}
      className={cx(
        "flex flex-col gap-2 rounded-lg border border-dashed border-(--cq-border) text-(--cq-text-primary)",
        compact ? "px-4 py-5" : "px-5 py-8",
        className,
      )}
      {...rest}
    >
      <h3 className={compact ? "cq-body font-medium" : "cq-title-md"}>
        {title}
      </h3>
      {description !== undefined ? (
        <p className="cq-body-sm max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
          {description}
        </p>
      ) : null}
      {action !== undefined ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}

export function ErrorState({
  title,
  description,
  action,
  compact = false,
  className,
  ...rest
}: StateBlockProps) {
  return (
    <section
      role="alert"
      data-state="error"
      className={cx(
        "flex gap-3 rounded-lg border border-(--cq-border) bg-(--cq-surface) text-(--cq-text-primary)",
        compact ? "px-4 py-4" : "px-5 py-6",
        className,
      )}
      {...rest}
    >
      <CircleAlert
        aria-hidden="true"
        size={ICON_SIZE.prominent}
        strokeWidth={ICON_STROKE}
        className="mt-0.5 shrink-0 text-(--cq-danger)"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="cq-body font-medium">{title}</h3>
        {description !== undefined ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">{description}</p>
        ) : null}
        {action !== undefined ? <div className="pt-2">{action}</div> : null}
      </div>
    </section>
  );
}

/**
 * Permission-safe unavailability. Deliberately identical whether the
 * resource is private, absent or out of scope: the browser never learns
 * which, because the browser never decides authorization.
 */
export function AccessUnavailable({
  action,
  className,
}: {
  readonly action?: ReactNode | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <EmptyState
      title="This content isn't available in your current context."
      description="If you expected to see it here, switch to the organisation it belongs to or ask the person who shared it."
      action={action}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton / Progress
// ---------------------------------------------------------------------------

export function Skeleton({
  className,
  lines = 1,
}: {
  readonly className?: string | undefined;
  readonly lines?: number | undefined;
}) {
  return (
    <div aria-hidden="true" className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cx(
            "h-4 animate-pulse rounded-sm bg-(--cq-surface-strong)",
            index === lines - 1 && lines > 1 ? "w-2/3" : "w-full",
          )}
        />
      ))}
    </div>
  );
}

export type ProgressProps = {
  readonly label: string;
  /** 0–100. Omit for an indeterminate, labelled activity indicator. */
  readonly value?: number | undefined;
  readonly className?: string | undefined;
};

export function Progress({ label, value, className }: ProgressProps) {
  const determinate = value !== undefined;
  const clamped = determinate ? Math.max(0, Math.min(100, value)) : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="cq-label text-(--cq-text-secondary)">{label}</span>
        {clamped !== undefined ? (
          <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
            {clamped}%
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1 w-full overflow-hidden rounded-full bg-(--cq-surface-strong)"
      >
        <div
          className={cx(
            "h-full rounded-full bg-(--cq-accent) transition-[width] duration-(--cq-motion-slow)",
            !determinate && "w-1/3 animate-pulse",
          )}
          style={clamped !== undefined ? { width: `${clamped}%` } : undefined}
        />
      </div>
    </div>
  );
}
