"use client";

import "./crm.css";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RelationshipStateV2 } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import { StatusDot, type StatusTone } from "@/components/status/status-dot";
import { Check } from "@capital-q/ui/icons";
import { SheetClose, SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { STATE_WORDS } from "./relationship-words";
import { useT } from "@/features/i18n/language";

/**
 * The CRM's shared pieces, as the chosen designs draw them (2026-10-20):
 * buttons that give when pressed and show the server confirming, the
 * segmented switch, state tags, the unknown mark, the completion ring, the
 * sheet with its own header, Q's one-line note and a toast. Tokens only.
 */

export type CrmButtonVariant = "primary" | "secondary" | "quiet" | "done";

const VARIANT: Readonly<Record<CrmButtonVariant, string>> = {
  // A page scope may re-point the primary (the warm-charcoal options);
  // everywhere else it is the accent.
  primary:
    "bg-[var(--cq-primary-action,var(--cq-accent))] text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]",
  secondary:
    "border border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-text-tertiary)",
  quiet:
    "px-2.5 text-(--cq-text-secondary) hover:bg-(--cq-surface-strong) hover:text-(--cq-text-primary)",
  done: "bg-(--cq-positive-soft) text-(--cq-positive)",
};

/** A 44px control with 13px words, radius 8, that gives when pressed. */
export function crmButton(
  variant: CrmButtonVariant = "secondary",
  extra?: string,
): string {
  return cx(
    "cq-crm-press relative inline-flex min-h-11 items-center justify-center gap-1.5 overflow-hidden rounded-(--cq-radius-md) px-3 text-[13px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:pointer-events-none disabled:opacity-60",
    VARIANT[variant],
    extra,
  );
}

/**
 * A button for a consequential step: while the server confirms it shows
 * "Sending…" with a growing bar; once confirmed, the done words on the
 * positive tone. The press itself never claims success.
 */
export function ProgressButton({
  variant = "primary",
  phase,
  idle,
  done,
  pendingLabel,
  onClick,
  className,
  disabled = false,
  type = "button",
  ...rest
}: {
  readonly variant?: CrmButtonVariant;
  readonly phase: "idle" | "pending" | "done";
  readonly idle: ReactNode;
  readonly done: ReactNode;
  /** The words while the server confirms; "Sending…" when not given. */
  readonly pendingLabel?: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly type?: "button" | "submit";
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  const t = useT();
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || phase !== "idle"}
      aria-busy={phase === "pending"}
      className={crmButton(phase === "done" ? "done" : variant, className)}
      {...rest}
    >
      {phase === "pending" ? (
        <>
          <span>{pendingLabel ?? t("Sending…")}</span>
          <span aria-hidden="true" className="cq-crm-pending-bar" />
        </>
      ) : phase === "done" ? (
        <span className="cq-crm-swap inline-flex items-center gap-1.5">
          <Check size={14} aria-hidden="true" />
          {done}
        </span>
      ) : (
        idle
      )}
    </button>
  );
}

export type SegmentOption<K extends string> = {
  readonly key: K;
  readonly label: string;
  /** A link owns the state (refresh and Back recover it). */
  readonly href?: string | undefined;
  readonly dataAttribute?: Readonly<Record<string, string>> | undefined;
};

/**
 * The segmented switch: a stone track, the chosen option raised on the
 * sheet colour. Links when each option is its own address, buttons when
 * the page switches in place.
 */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  readonly label: string;
  readonly options: readonly SegmentOption<K>[];
  readonly value: K;
  readonly onChange?: ((key: K) => void) | undefined;
  readonly className?: string | undefined;
}) {
  const item = (on: boolean) =>
    cx(
      "relative inline-flex min-h-11 items-center gap-1.5 rounded-(--cq-radius-md) px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-[38px]",
      on
        ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_var(--cq-border-subtle)]"
        : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
    );
  return (
    <div
      role={onChange === undefined ? "group" : "radiogroup"}
      aria-label={label}
      className={cx(
        "inline-flex gap-0.5 rounded-[10px] bg-(--cq-surface-strong) p-[3px]",
        className,
      )}
    >
      {options.map((option) =>
        option.href !== undefined ? (
          <Link
            key={option.key}
            href={option.href}
            scroll={false}
            aria-current={option.key === value ? "page" : undefined}
            className={item(option.key === value)}
            {...option.dataAttribute}
          >
            {option.label}
          </Link>
        ) : (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.key === value}
            onClick={() => onChange?.(option.key)}
            className={item(option.key === value)}
            {...option.dataAttribute}
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  );
}

/** "Not enough evidence", "Not recorded": a dashed ring, never a zero. */
export function UnknownValue({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-tertiary)",
        className,
      )}
      data-unknown
    >
      <span
        aria-hidden="true"
        className="size-2.5 flex-none rounded-full border-[1.5px] border-dashed border-(--cq-text-tertiary)"
      />
      {children}
    </span>
  );
}

type TagTone = "positive" | "accent" | "stone" | "dash";

const TAG_TONE: Readonly<Record<TagTone, string>> = {
  positive: "bg-(--cq-positive-soft) text-(--cq-positive)",
  accent: "bg-(--cq-accent-soft) text-(--cq-accent)",
  stone: "bg-(--cq-surface-strong) text-(--cq-text-secondary)",
  dash: "border border-dashed border-(--cq-border) text-(--cq-text-tertiary)",
};

const STATE_STATUS: Readonly<Record<RelationshipStateV2, StatusTone>> = {
  INVESTED: "done",
  IN_DILIGENCE: "active",
  MEETING_HELD: "active",
  CONNECTED: "idle",
  INTEREST_EXPRESSED: "waiting",
  DISCOVERED: "idle",
  // A pause or a pass is neutral, never an alarm.
  PAUSED: "idle",
  PASSED: "idle",
  DECLINED: "idle",
};

/** A small pill of words: the tone only echoes what the words say. */
export function Tag({
  tone,
  icon,
  children,
  className,
}: {
  readonly tone: TagTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
        TAG_TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Where a relationship stands: a dot and its word (status grammar). */
export function StateTag({
  state,
  label,
}: {
  readonly state: RelationshipStateV2;
  /** The side's own word for it, when it differs ("Awaiting reply"). */
  readonly label?: string | undefined;
}) {
  const t = useT();
  return (
    <span data-state-tag={state} className="contents">
      <StatusDot
        tone={STATE_STATUS[state]}
        label={t(label ?? STATE_WORDS[state])}
      />
    </span>
  );
}

/** The ring beside "Needs you": how much of today's list is done. */
export function CompletionRing({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}) {
  const t = useT();
  const c = 2 * Math.PI * 14;
  const share = total <= 0 ? 0 : Math.min(1, done / total);
  return (
    <svg
      viewBox="0 0 34 34"
      className="size-[34px] flex-none -rotate-90"
      role="img"
      aria-label={t(`${String(done)} of ${String(total)} done`)}
      data-completion={`${String(done)}/${String(total)}`}
    >
      <circle
        cx="17"
        cy="17"
        r="14"
        fill="none"
        strokeWidth="3.5"
        className="stroke-(--cq-surface-strong)"
      />
      <circle
        cx="17"
        cy="17"
        r="14"
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className="cq-crm-ring-fill stroke-(--cq-positive)"
      />
    </svg>
  );
}

/** The design's small Q: a letter in a ring, in the colour around it. */
export function QRing({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-grid size-5 flex-none place-items-center rounded-full border-[1.6px] border-current text-[11px] leading-none font-semibold",
        className,
      )}
    >
      Q
    </span>
  );
}

/** Q's one line, on the accent's soft tone, with its small print. */
export function QLine({
  children,
  small,
}: {
  readonly children: ReactNode;
  readonly small?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-(--cq-radius-lg) bg-(--cq-accent-soft) px-3.5 py-3 text-sm text-(--cq-text-primary)">
      <QRing className="mt-px text-(--cq-accent)" />
      <div className="min-w-0">
        {children}
        {small === undefined ? null : (
          <small className="mt-0.5 block text-xs text-(--cq-text-secondary)">
            {small}
          </small>
        )}
      </div>
    </div>
  );
}

/**
 * A sheet with the design's header: who it is about, one line under the
 * title, and Close. A side panel from desktop up, a bottom sheet on a
 * phone. The body staggers in.
 */
export function CrmSheet({
  open,
  onOpenChange,
  title,
  sub,
  avatar,
  charcoal = false,
  children,
  ...rest
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly sub?: string | undefined;
  readonly avatar?: ReactNode;
  /** A sheet is portalled out of the page: a warm-charcoal page says so. */
  readonly charcoal?: boolean | undefined;
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
          "rounded-t-2xl lg:w-[520px] lg:rounded-none [&>div:first-child]:lg:hidden [&>div:last-child]:px-0 [&>div:last-child]:pb-0",
          charcoal ? "cq-charcoal" : undefined,
        )}
      >
        <div className="flex flex-col" {...rest}>
          <div className="flex items-center gap-3 border-b border-(--cq-border-subtle) px-5 py-4">
            {avatar ?? null}
            <div className="min-w-0">
              <p className="truncate font-semibold text-(--cq-text-primary)">
                {title}
              </p>
              {sub === undefined ? null : (
                <p className="truncate text-xs text-(--cq-text-tertiary)">
                  {sub}
                </p>
              )}
            </div>
            <SheetClose>
              <button type="button" className={crmButton("quiet", "ms-auto")}>
                {t("Close")}
              </button>
            </SheetClose>
          </div>
          <div className="cq-crm-stagger flex flex-col gap-4 p-5">
            {children}
          </div>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

type ToastApi = (message: string) => void;
const ToastContext = createContext<ToastApi | null>(null);

/**
 * One toast at a time for a CRM page: dark, short, announced politely.
 * Rises from the bottom on desktop and drops from the top on a phone.
 */
export function CrmToastProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: string) => {
    setMessage(next);
    setShown(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2800);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cx(
          "cq-crm-toast pointer-events-none fixed inset-x-3 top-3 z-(--cq-z-toast) mx-auto flex min-h-[46px] max-w-md items-center gap-3 rounded-(--cq-radius-md) bg-(--cq-text-primary) px-4 py-2 text-sm text-(--cq-text-inverse) shadow-(--cq-shadow-overlay) lg:top-auto lg:bottom-7 lg:w-max",
          shown
            ? "translate-y-0 opacity-100"
            : "-translate-y-3 opacity-0 lg:translate-y-3",
        )}
        data-crm-toast
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

/** The page's toast; a no-op outside a provider (tests, previews). */
export function useCrmToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

function noop(): void {}
