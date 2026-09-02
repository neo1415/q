import type { ReactNode } from "react";

import { Check, ICON_SIZE } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";

/**
 * Tap-first choice lists with real form semantics: a ChoiceList is a
 * fieldset of native radios, a MultiChoiceList a fieldset of native
 * checkboxes. The visible row is the label, so one tap selects, keyboard and
 * screen readers get the platform behaviour, and selection is announced --
 * never signalled by colour alone.
 */

export type ChoiceOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
};

type ChoiceFrameProps = {
  readonly legend: string;
  readonly legendHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly id: string;
};

function ChoiceFrame({
  id,
  legend,
  legendHidden = false,
  description,
  error,
  children,
}: ChoiceFrameProps) {
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3"
      aria-describedby={
        error !== undefined
          ? `${id}-error`
          : description !== undefined
            ? `${id}-description`
            : undefined
      }
      aria-invalid={error !== undefined ? true : undefined}
    >
      <legend
        className={cx(
          "cq-label text-(--cq-text-primary)",
          legendHidden && "sr-only",
        )}
      >
        {legend}
      </legend>
      {description !== undefined ? (
        <p
          id={`${id}-description`}
          className="cq-body-sm -mt-1 text-(--cq-text-secondary)"
        >
          {description}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">{children}</div>
      {error !== undefined ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="cq-caption text-(--cq-danger)"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

const rowClass =
  "relative flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-(--cq-motion-fast) has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--cq-focus-ring)";
const rowIdle =
  "border-(--cq-border) bg-(--cq-surface) hover:border-(--cq-border-strong)";
const rowSelected = "border-(--cq-accent) bg-(--cq-accent-soft)";

function RowText({ option }: { readonly option: ChoiceOption }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="cq-body font-medium text-(--cq-text-primary)">
        {option.label}
      </span>
      {option.description !== undefined ? (
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {option.description}
        </span>
      ) : null}
    </span>
  );
}

function Mark({
  selected,
  round,
}: {
  readonly selected: boolean;
  readonly round: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex size-5 shrink-0 items-center justify-center border transition-colors duration-(--cq-motion-fast)",
        round ? "rounded-full" : "rounded-xs",
        selected
          ? "border-(--cq-accent) bg-(--cq-accent) text-(--cq-text-inverse)"
          : "border-(--cq-border-strong) bg-(--cq-surface-raised)",
      )}
    >
      {selected ? <Check size={ICON_SIZE.compact - 2} strokeWidth={3} /> : null}
    </span>
  );
}

export type ChoiceListProps = {
  readonly id: string;
  readonly name: string;
  readonly legend: string;
  readonly legendHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly options: readonly ChoiceOption[];
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
};

export function ChoiceList({
  id,
  name,
  legend,
  legendHidden,
  description,
  error,
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceListProps) {
  return (
    <ChoiceFrame
      id={id}
      legend={legend}
      legendHidden={legendHidden}
      description={description}
      error={error}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
            data-selected={selected ? "" : undefined}
            className={cx(
              rowClass,
              selected ? rowSelected : rowIdle,
              disabled && "opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <RowText option={option} />
            <Mark selected={selected} round />
          </label>
        );
      })}
    </ChoiceFrame>
  );
}

export type MultiChoiceListProps = {
  readonly id: string;
  readonly name: string;
  readonly legend: string;
  readonly legendHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly options: readonly ChoiceOption[];
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  /** Values that clear every other selection when chosen (e.g. "Nothing yet"). */
  readonly exclusiveValues?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
};

export function MultiChoiceList({
  id,
  name,
  legend,
  legendHidden,
  description,
  error,
  options,
  values,
  onChange,
  exclusiveValues = [],
  disabled = false,
}: MultiChoiceListProps) {
  function toggle(value: string) {
    const isExclusive = exclusiveValues.includes(value);
    if (values.includes(value)) {
      onChange(values.filter((entry) => entry !== value));
      return;
    }
    if (isExclusive) {
      onChange([value]);
      return;
    }
    onChange([
      ...values.filter((entry) => !exclusiveValues.includes(entry)),
      value,
    ]);
  }

  return (
    <ChoiceFrame
      id={id}
      legend={legend}
      legendHidden={legendHidden}
      description={description}
      error={error}
    >
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <label
            key={option.value}
            data-selected={selected ? "" : undefined}
            className={cx(
              rowClass,
              selected ? rowSelected : rowIdle,
              disabled && "opacity-50",
            )}
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => toggle(option.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <RowText option={option} />
            <Mark selected={selected} round={false} />
          </label>
        );
      })}
    </ChoiceFrame>
  );
}
