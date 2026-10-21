"use client";

import "@/features/relationships/crm.css";

import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";
import {
  Check,
  FileText,
  Flag,
  ICON_SIZE,
  UserRound,
  X,
} from "@capital-q/ui/icons";
import { SheetClose, SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { QRing } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

/**
 * The Work pages' shared pieces as the chosen designs draw them
 * (2026-10-21: report, documents, pitch, rehearsals, The Q Daily): a
 * button whose primary follows the page's option (warm charcoal, near
 * black or the gold accent), evidence tags that say in words what a
 * finding rests on, the approval track, and the sheet with a pinned
 * footer. Tokens only; a page's option is a scope class, passed to the
 * sheet too because a sheet renders outside the page.
 */

export type WorkTone = "charcoal" | "ink" | "gold";

/** The scope class an option's tone is drawn in (globals.css). */
export function toneScope(tone: WorkTone): string {
  return tone === "charcoal" ? "cq-charcoal" : tone === "ink" ? "cq-ink" : "";
}

export type WorkButtonVariant = "primary" | "secondary" | "quiet" | "gold";

const VARIANT: Readonly<Record<WorkButtonVariant, string>> = {
  primary:
    "bg-[var(--cq-primary-action,var(--cq-accent))] text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]",
  gold: "bg-(--cq-accent) text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)",
  secondary:
    "border border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-border-strong)",
  quiet:
    "text-(--cq-text-primary) hover:bg-(--cq-surface-subtle) disabled:text-(--cq-text-tertiary)",
};

/** A 44px control, radius 8, that gives a little when pressed. */
export function workButton(
  variant: WorkButtonVariant = "secondary",
  extra?: string,
  size: "regular" | "small" | "large" = "regular",
): string {
  return cx(
    "cq-crm-press relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-(--cq-radius-md) font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:pointer-events-none disabled:opacity-60",
    size === "small"
      ? "min-h-11 px-3 text-[13px] lg:min-h-9"
      : size === "large"
        ? "min-h-[52px] px-[22px] text-[15px]"
        : "min-h-11 px-4 text-sm",
    VARIANT[variant],
    extra,
  );
}

export type WorkTagTone =
  "positive" | "accent" | "stone" | "warning" | "dash" | "brass";

const TAG_TONE: Readonly<Record<WorkTagTone, string>> = {
  positive: "bg-(--cq-positive-soft) text-(--cq-positive)",
  accent: "bg-(--cq-accent-soft) text-(--cq-accent)",
  brass: "bg-(--cq-accent-soft) text-(--cq-accent)",
  stone: "bg-(--cq-surface-strong) text-(--cq-text-secondary)",
  warning: "bg-(--cq-warning-soft) text-(--cq-warning)",
  dash: "border border-dashed border-(--cq-border) text-(--cq-text-tertiary)",
};

/** A small pill of words; the tone only echoes what the words say. */
export function WorkTag({
  tone,
  icon,
  children,
  className,
  ...rest
}: {
  readonly tone: WorkTagTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
        TAG_TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/** The hatched square "not known yet" carries: never a colour alone. */
export function UnknownMark() {
  return (
    <i
      aria-hidden="true"
      className="inline-block size-2.5 rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--cq-warning-soft)_0_2px,var(--cq-warning)_2px_4px)]"
    />
  );
}

export type EvidenceKind = "claim" | "inference" | "doc" | "unknown" | "stated";

/**
 * What a finding rests on, in words plus a mark: the founder's claim, Q's
 * inference, a document, or not known yet. Meaning never rests on colour.
 */
export function EvidenceTag({
  kind,
  claimant = "Founder’s claim",
}: {
  readonly kind: EvidenceKind;
  /** Whose claim it is, in the page's words ("Your claim"). */
  readonly claimant?: string;
}) {
  const t = useT();
  switch (kind) {
    case "claim":
      return (
        <WorkTag tone="brass" icon={<UserRound aria-hidden="true" />}>
          {t(claimant)}
        </WorkTag>
      );
    case "inference":
      return (
        <WorkTag tone="stone" icon={<QRing className="size-3.5 text-[8px]" />}>
          {t("Q’s inference")}
        </WorkTag>
      );
    case "doc":
      return (
        <WorkTag tone="positive" icon={<FileText aria-hidden="true" />}>
          {t("Document-supported")}
        </WorkTag>
      );
    case "stated":
      return (
        <WorkTag tone="positive" icon={<Flag aria-hidden="true" />}>
          {t("Their stated mandate")}
        </WorkTag>
      );
    case "unknown":
      return (
        <WorkTag tone="warning" icon={<UnknownMark />}>
          {t("Not known yet")}
        </WorkTag>
      );
  }
}

/** Prepare, Recommend, your yes, Execute: where a prepared action is. */
export const TRACK_STEPS = [
  "Prepared",
  "Recommended",
  "Your yes",
  "Sent",
] as const;

export function ApprovalTrack({
  at,
  labels = TRACK_STEPS,
}: {
  /** The step now waiting; past the end means every step is done. */
  readonly at: number;
  readonly labels?: readonly string[];
}) {
  const t = useT();
  return (
    <ol
      aria-label={t("Where this is")}
      className="m-0 flex list-none flex-nowrap gap-1 overflow-x-auto p-0 sm:flex-wrap sm:gap-1.5"
      data-work-track={String(at)}
    >
      {labels.map((label, index) => {
        const done = index < at;
        const now = index === at;
        return (
          <li
            key={label}
            aria-current={now ? "step" : undefined}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 ps-1 pe-2.5 text-[11px] whitespace-nowrap transition-colors duration-(--cq-motion-base) sm:text-xs",
              done
                ? "border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-positive)"
                : now
                  ? "border-(--cq-accent)/40 bg-(--cq-accent-soft) font-semibold text-(--cq-text-primary)"
                  : "border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-tertiary)",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "grid size-4 place-items-center rounded-full border-[1.5px]",
                done
                  ? "border-(--cq-positive) bg-(--cq-positive) text-(--cq-text-inverse)"
                  : now
                    ? "border-(--cq-accent) shadow-[0_0_0_3px_var(--cq-accent-soft)]"
                    : "border-(--cq-border)",
              )}
            >
              {done ? <Check size={10} strokeWidth={3} /> : null}
            </span>
            <span>{t(label)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The design's drawer: a side panel from desktop up (rounded on its open
 * edge), a bottom sheet on a phone; its header with an icon, a title and
 * Close; a scrolling body; and a footer pinned to the bottom for the
 * sheet's one decision.
 */
export function WorkSheet({
  open,
  onOpenChange,
  title,
  sub,
  icon,
  tone,
  footer,
  children,
  ...rest
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly sub?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: WorkTone | undefined;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  const t = useT();
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={title}
        side="side"
        bare
        className={cx(
          "rounded-t-[18px] lg:w-[520px] lg:rounded-s-xl lg:rounded-e-none [&>div:first-child]:lg:hidden [&>div:last-child]:px-0 [&>div:last-child]:pb-0",
          tone === undefined ? undefined : toneScope(tone),
        )}
      >
        <div className="flex min-h-full flex-col" {...rest}>
          <div className="flex items-center gap-3 border-b border-(--cq-border-subtle) px-5 py-4">
            {icon ?? null}
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold text-(--cq-text-primary)">
                {title}
              </p>
              {sub === undefined ? null : (
                <div className="text-xs text-(--cq-text-tertiary)">{sub}</div>
              )}
            </div>
            <SheetClose>
              <button
                type="button"
                aria-label={t("Close")}
                className={workButton("quiet", "size-11 px-0")}
              >
                <X size={ICON_SIZE.prominent} aria-hidden="true" />
              </button>
            </SheetClose>
          </div>
          <div className="cq-crm-stagger flex flex-1 flex-col gap-4 px-5 py-5">
            {children}
          </div>
          {footer === undefined || footer === null ? null : (
            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-3.5 [&>*:first-child]:max-sm:flex-[1_1_100%]">
              {footer}
            </div>
          )}
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

/** A tiny label above a value or a group, as the designs set it. */
export function WorkLabel({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span className={cx("text-xs text-(--cq-text-tertiary)", className)}>
      {children}
    </span>
  );
}

/** A dashed, centred empty state with its one way forward. */
export function WorkEmpty({
  title,
  children,
  action,
  icon,
  className,
  ...rest
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-2.5 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) px-6 py-7 text-center text-(--cq-text-secondary)",
        className,
      )}
      {...rest}
    >
      {icon === undefined ? null : (
        <span className="grid size-[52px] place-items-center rounded-[14px] bg-(--cq-accent-soft) text-(--cq-accent)">
          {icon}
        </span>
      )}
      <b className="text-base text-(--cq-text-primary)">{title}</b>
      {children === undefined ? null : (
        <div className="max-w-[460px] text-sm">{children}</div>
      )}
      {action === undefined ? null : (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
