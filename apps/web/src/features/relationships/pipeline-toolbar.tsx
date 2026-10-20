"use client";

import {
  forwardRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { cx } from "@capital-q/ui";
import { Download, ICON_SIZE, Search } from "@capital-q/ui/icons";

import {
  crmButton,
  CrmSheet,
  ProgressButton,
  UnknownValue,
} from "./crm-kit";
import { useT } from "@/features/i18n/language";

/**
 * The Pipeline's bar (design 2026-10-20, "One list, three layouts"): the
 * search on the left; the layout switch and Export on the right; then the
 * state chips with their counts. One bar for List, Table and Board.
 */

export const PipelineSearch = forwardRef<
  HTMLInputElement,
  {
    readonly side: "INVESTOR" | "COMPANY";
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** A server search submits; the List filters as you type. */
    readonly onSubmit?: ((event: FormEvent) => void) | undefined;
    readonly type?: "search" | "text";
    readonly label?: string | undefined;
    readonly children?: ReactNode;
  } & { readonly [data: `data-${string}`]: string | boolean | undefined }
>(function PipelineSearch(
  { side, value, onChange, onSubmit, type = "text", label, children, ...rest },
  ref,
) {
  const t = useT();
  const words =
    side === "INVESTOR" ? t("Search companies") : t("Search investors");
  const field = (
    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-sm text-(--cq-text-tertiary) transition-[border-color,box-shadow] duration-(--cq-motion-fast) focus-within:border-(--cq-text-secondary) focus-within:shadow-[0_0_0_3px_var(--cq-accent-soft)] sm:min-w-[260px]">
      <Search size={15} aria-hidden="true" className="flex-none" />
      <input
        ref={ref}
        type={type}
        aria-label={label ?? words}
        placeholder={words}
        value={value}
        maxLength={120}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
        {...rest}
      />
    </label>
  );
  return onSubmit === undefined ? (
    <div className="flex min-w-0 flex-[1_1_100%] items-center gap-2 sm:flex-initial">
      {field}
      {children}
    </div>
  ) : (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label={t("Pipeline filters")}
      className="flex min-w-0 flex-[1_1_100%] items-center gap-2 sm:flex-initial"
    >
      {field}
      {children}
    </form>
  );
});

export type StateChip = {
  readonly key: string;
  readonly label: string;
  /** Null: not known here, so no number is shown (never a 0). */
  readonly count: number | null;
  readonly on: boolean;
  readonly onSelect: () => void;
};

/** The state chips: All, Needs you, then each state with relationships. */
export function StateChips({
  chips,
  label,
}: {
  readonly chips: readonly StateChip[];
  readonly label: string;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={chip.on}
          onClick={chip.onSelect}
          data-filter={chip.key}
          className={cx(
            "cq-crm-press inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-9",
            chip.on
              ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-surface-raised)"
              : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:border-(--cq-text-tertiary) hover:text-(--cq-text-primary)",
          )}
        >
          {chip.count === null
            ? t(chip.label)
            : t(`${chip.label} ${String(chip.count)}`)}
        </button>
      ))}
    </div>
  );
}

/** Suitability as the designs draw it: "86/100", or not enough evidence. */
export function SuitabilityFigure({
  value,
  words = "Not enough evidence",
}: {
  readonly value: number | null;
  readonly words?: string;
}) {
  const t = useT();
  return value === null ? (
    <UnknownValue>{t(words)}</UnknownValue>
  ) : (
    <span className="cq-numeric" data-pipeline-score="suitability">
      <b className="text-[15px] font-semibold text-(--cq-text-primary)">
        {String(value)}
      </b>
      <small className="ms-px text-xs text-(--cq-text-tertiary)">/100</small>
    </span>
  );
}

/**
 * Export, as a sheet that says what goes in the file before it is made.
 * The download is fetched under the person's session and checked again
 * on the server; the button says Downloaded only once the file arrived.
 */
export function PipelineExport({
  href,
  count,
  scope,
  selected = 0,
  iconOnly = false,
}: {
  /** Null: this view cannot be exported just now (said, not hidden). */
  readonly href: string | null;
  /** How many relationships the file holds, when known. */
  readonly count: number | null;
  /** "all states", "In diligence", "your search": what the rows are. */
  readonly scope: string;
  readonly selected?: number;
  readonly iconOnly?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const download = async () => {
    if (href === null) return;
    setPhase("pending");
    setProblem(null);
    try {
      const response = await fetch(href, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "capital-q-relationships.csv";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPhase("done");
    } catch {
      setPhase("idle");
      setProblem(
        t("The selected view could not be exported. Reload it and try again."),
      );
    }
  };
  const label =
    selected > 0 ? t(`Export ${String(selected)} selected`) : t("Export");
  return (
    <>
      <button
        type="button"
        className={crmButton(
          "secondary",
          iconOnly ? "size-11 px-0 lg:size-auto lg:px-3" : undefined,
        )}
        onClick={() => {
          setPhase("idle");
          setOpen(true);
        }}
        aria-label={selected === 0 ? t("Export filtered CSV") : label}
        data-pipeline-export
      >
        <Download size={ICON_SIZE.compact} aria-hidden="true" />
        <span className={iconOnly ? "hidden lg:inline" : undefined}>{label}</span>
      </button>
      <CrmSheet
        open={open}
        onOpenChange={setOpen}
        title={selected > 0 ? label : t("Export filtered CSV")}
        sub={t("The same filters are checked again when the file is made")}
        data-pipeline-export-sheet
      >
        <div className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
          <h3 className="text-[13px] font-medium text-(--cq-text-secondary)">
            {t("What goes in the file")}
          </h3>
          <div className="flex flex-col gap-2 text-sm text-(--cq-text-primary)">
            <span>
              {selected > 0
                ? t(`${String(selected)} selected relationships`)
                : count === null
                  ? t(`Every relationship in this view, ${scope}`)
                  : count === 1
                    ? t(`1 relationship, ${scope}`)
                    : t(`${String(count)} relationships, ${scope}`)}
            </span>
            <span>
              {t("Columns: counterpart, state, since, next step")}
            </span>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Your private notes are never exported.")}
            </span>
          </div>
        </div>
        <ProgressButton
          phase={phase}
          disabled={href === null}
          idle={
            <>
              <Download size={ICON_SIZE.compact} aria-hidden="true" />
              {t("Download CSV")}
            </>
          }
          done={t("Downloaded")}
          onClick={() => void download()}
        />
        {href === null ? (
          <p className="text-sm text-(--cq-text-secondary)">
            {t("This view can't be exported just now. Reload and try again.")}
          </p>
        ) : null}
        {problem === null ? null : (
          <p role="alert" className="text-sm text-(--cq-text-secondary)">
            {problem}
          </p>
        )}
      </CrmSheet>
    </>
  );
}
