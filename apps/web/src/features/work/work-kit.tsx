"use client";

import "./work.css";

import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { Check, FileText, Shield } from "@capital-q/ui/icons";

import { crmButton, Segmented } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

/**
 * Work's shared pieces, as the chosen designs draw them (2026-10-21): the
 * approval track, tags with their marks, step marks, the prepared message,
 * what it rests on, the check line, and the Tasks / How Q is handling it /
 * Cost switch. Tokens only; meaning is always a word as well as a mark.
 */

/** A 44px control; primary reads the page's option scope (gold, ink). */
export function workButton(
  variant: "primary" | "secondary" | "quiet" | "done" = "secondary",
  extra?: string,
): string {
  if (variant !== "primary") return crmButton(variant, extra);
  return crmButton(
    "secondary",
    cx(
      "border-0 bg-[var(--cq-primary-action,var(--cq-accent))] text-[var(--cq-on-primary-action,var(--cq-text-inverse))] hover:border-0 hover:bg-[var(--cq-primary-action-hover,var(--cq-accent-hover))]",
      extra,
    ),
  );
}

export type TrackStep = "done" | "now" | "next";

/**
 * Where a prepared action is: Prepared, Recommended, your yes, then what
 * happens. Each step has its word and a mark; the gold one is yours.
 */
export function Track({
  at,
  labels,
}: {
  /** The index of the step that is now; past the end, all are done. */
  readonly at: number;
  readonly labels: readonly string[];
}) {
  const t = useT();
  return (
    <ol className="cq-wk-track" aria-label={t("Where this is")}>
      {labels.map((label, index) => {
        const step: TrackStep =
          index < at ? "done" : index === at ? "now" : "next";
        return (
          <li key={label} data-step={step}>
            <span className="cq-wk-tm" aria-hidden="true">
              {step === "done" ? <Check strokeWidth={3} /> : null}
            </span>
            <span>
              {t(label)}
              {step === "done" ? (
                <span className="sr-only">{t(", done")}</span>
              ) : step === "now" ? (
                <span className="sr-only">{t(", now")}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export const TRACK_SEND = ["Prepared", "Recommended", "Your yes", "Sent"];

export type WorkTagTone = "stone" | "move" | "positive" | "gap" | "claim";

export function WorkTag({
  tone = "stone",
  icon,
  children,
  className,
}: {
  readonly tone?: WorkTagTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span className={cx("cq-wk-tag", className)} data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}

/** "Not known yet": hatched, with its words. Never a zero. */
export function UnknownTag() {
  const t = useT();
  return (
    <WorkTag tone="gap" icon={<i className="cq-wk-hatch" aria-hidden="true" />}>
      {t("Not known yet")}
    </WorkTag>
  );
}

/** A step's mark: a tick, the live ring, a held ring, or an empty ring. */
export function StepMark({
  state,
}: {
  readonly state: "done" | "now" | "next" | "held";
}) {
  if (state === "done") {
    return (
      <span className="cq-wk-tick" aria-hidden="true">
        <Check strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className="cq-wk-ring"
      aria-hidden="true"
      data-now={state === "now" ? true : undefined}
      data-held={state === "held" ? true : undefined}
    />
  );
}

/** The prepared message, word for word, as it will go. */
export function MessageBox({
  label = "What Q will send, word for word",
  children,
  editing = false,
}: {
  readonly label?: string;
  readonly children: ReactNode;
  readonly editing?: boolean;
}) {
  const t = useT();
  return (
    <div className="cq-wk-msg" data-editing={editing ? true : undefined}>
      <div className="cq-label font-normal text-(--cq-text-tertiary)">
        {t(label)}
      </div>
      {children}
    </div>
  );
}

/** What it rests on: each source a document mark and its words. */
export function BasedOn({ items }: { readonly items: readonly string[] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-0.5 cq-label font-normal text-(--cq-text-tertiary)">
        {t("Based on")}
      </span>
      {items.map((item) => (
        <WorkTag key={item} icon={<FileText aria-hidden="true" />}>
          {t(item)}
        </WorkTag>
      ))}
    </div>
  );
}

/** The one line that says what was checked, with the shield. */
export function CheckLine({ children }: { readonly children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-1.5 cq-label font-normal text-(--cq-text-tertiary)">
      <Shield size={14} aria-hidden="true" className="shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export type WorkView = "work" | "team" | "cost";

/** Tasks, How Q is handling it, Cost: one switch, in place. */
export function WorkSwitch({
  value,
  onChange,
  costLabel,
}: {
  readonly value: WorkView;
  readonly onChange: (view: WorkView) => void;
  readonly costLabel?: string | undefined;
}) {
  const t = useT();
  return (
    <Segmented
      label={t("More about Q’s work")}
      value={value}
      onChange={onChange}
      className="rounded-full [&>button]:rounded-full"
      options={[
        {
          key: "work",
          label: t("Tasks"),
          dataAttribute: { "data-work-view": "work" },
        },
        {
          key: "team",
          label: t("How Q is handling it"),
          dataAttribute: { "data-work-view": "team" },
        },
        {
          key: "cost",
          label: costLabel ?? t("Cost"),
          dataAttribute: { "data-work-view": "cost" },
        },
      ]}
    />
  );
}

/** Money as the ledger has it ("1.843210" -> "$1.84"), never a float sum. */
export function usdWords(amount: string | number): string {
  const micros =
    typeof amount === "number"
      ? Math.round(amount * 1_000_000)
      : Math.round(Number(amount) * 1_000_000);
  if (!Number.isFinite(micros)) return "$0.00";
  const cents = Math.round(micros / 10_000);
  return `$${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}
