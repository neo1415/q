"use client";

import "@/features/relationships/crm.css";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cx } from "@capital-q/ui";

export {
  accountButton,
  fieldClassName,
  type AccountButtonVariant,
} from "./account-styles";

/**
 * The account pages' shared pieces (profile, settings, memory, plan,
 * usage, team, verification, reviews; chosen designs 2026-10-21): the
 * design's buttons, the switch that says On or Off in words, the radio
 * list with a description under each choice, the field frame, and a toast
 * that can carry one action (Undo). Tokens only; motion stops under
 * reduced motion (crm.css).
 */

/** While the server confirms: the label, then a bar growing under it. */
export function Pending({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <span>{children}</span>
      <span aria-hidden="true" className="cq-crm-pending-bar" />
    </>
  );
}

/**
 * The switch with its state in words beside it ("On", "Off"), so it never
 * relies on colour. The caller owns the state and what a change does.
 */
export function WordSwitch({
  on,
  onChange,
  label,
  onWord,
  offWord,
  disabled = false,
  ...rest
}: {
  readonly on: boolean;
  readonly onChange: (next: boolean) => void;
  /** What it switches, for assistive technology. */
  readonly label: string;
  readonly onWord: string;
  readonly offWord: string;
  readonly disabled?: boolean | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 px-0.5 text-[13px] font-medium text-(--cq-text-secondary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60 aria-checked:text-(--cq-text-primary)"
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative h-6 w-10 flex-none rounded-full transition-colors duration-(--cq-motion-fast)",
          on ? "bg-(--cq-positive)" : "bg-(--cq-border)",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] start-[3px] size-[18px] rounded-full bg-(--cq-surface-raised) shadow-(--cq-shadow-xs) transition-transform duration-200 ease-(--cq-ease) motion-reduce:transition-none",
            on ? "translate-x-4 rtl:-translate-x-4" : null,
          )}
        />
      </span>
      <span className="min-w-[22px]">{on ? onWord : offWord}</span>
    </button>
  );
}

export type RadioChoice<K extends string> = {
  readonly key: K;
  readonly title: string;
  readonly description?: string | undefined;
  readonly disabled?: boolean | undefined;
};

/**
 * The design's radio list: each choice a bordered row with a dot, its name
 * and one line under it. The chosen one is outlined and its dot filled.
 */
export function RadioList<K extends string>({
  label,
  choices,
  value,
  onChange,
  name,
}: {
  readonly label: string;
  readonly choices: readonly RadioChoice<K>[];
  readonly value: K | null;
  readonly onChange: (key: K) => void;
  /** Distinguishes two lists on one page (data-radio). */
  readonly name: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      {choices.map((choice) => {
        const on = choice.key === value;
        return (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={choice.disabled}
            onClick={() => onChange(choice.key)}
            data-radio={name}
            data-choice={choice.key}
            className={cx(
              "cq-crm-press flex min-h-[52px] items-start gap-3 rounded-(--cq-radius-lg) border bg-(--cq-surface-raised) px-3.5 py-3 text-start transition-[border-color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) active:scale-[0.99] disabled:opacity-60",
              on
                ? "border-(--cq-text-secondary) shadow-[0_0_0_3px_var(--cq-accent-soft)]"
                : "border-(--cq-border)",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "relative mt-px size-5 flex-none rounded-full border-[1.5px] bg-(--cq-surface-raised)",
                on ? "border-(--cq-text-primary)" : "border-(--cq-border)",
              )}
            >
              {on ? (
                <span className="absolute inset-1 rounded-full bg-(--cq-text-primary)" />
              ) : null}
            </span>
            <span className="min-w-0">
              <b className="block text-[15px] font-medium text-(--cq-text-primary)">
                {choice.title}
              </b>
              {choice.description === undefined ? null : (
                <small className="mt-0.5 block text-[13px] leading-[1.45] text-(--cq-text-secondary)">
                  {choice.description}
                </small>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The design's segmented choice: a stone track, the chosen option raised
 * on the sheet colour. For a few short, exclusive choices in a row.
 */
export function Segments<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  ...rest
}: {
  readonly label: string;
  readonly options: readonly { readonly key: K; readonly label: string }[];
  readonly value: K | null;
  readonly onChange: (key: K) => void;
  readonly disabled?: boolean | undefined;
} & { readonly [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-[10px] bg-(--cq-surface-strong) p-[3px]"
      {...rest}
    >
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            data-choice={option.key}
            className={cx(
              "inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60 lg:min-h-[38px]",
              on
                ? "bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_var(--cq-border-subtle)]"
                : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled field: the label above, an optional hint under it. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly htmlFor: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[13px] font-medium text-(--cq-text-secondary)"
      >
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <small className="text-xs text-(--cq-text-tertiary)">{hint}</small>
      )}
    </div>
  );
}

type ToastMessage = {
  readonly text: string;
  readonly action?:
    { readonly label: string; readonly run: () => void } | undefined;
};
type ToastApi = (message: string | ToastMessage) => void;
const ToastContext = createContext<ToastApi | null>(null);

/**
 * One dark toast at a time, announced politely, optionally with one
 * action (Undo). Rises from the bottom on desktop, drops from the top on a
 * phone. It stays a little longer when it carries an action.
 */
export function AccountToastProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: string | ToastMessage) => {
    const value = typeof next === "string" ? { text: next } : next;
    setMessage(value);
    setShown(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setShown(false),
      value.action === undefined ? 2800 : 5000,
    );
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
          "cq-crm-toast fixed inset-x-3 top-3 z-(--cq-z-toast) mx-auto flex min-h-[46px] max-w-md items-center gap-3 rounded-(--cq-radius-md) bg-(--cq-text-primary) py-1.5 ps-4 pe-2 text-sm text-(--cq-text-inverse) shadow-(--cq-shadow-overlay) lg:top-auto lg:bottom-7 lg:w-max",
          shown
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-3 opacity-0 lg:translate-y-3",
        )}
        data-account-toast
      >
        <span className="min-w-0 flex-1 py-1.5">{message?.text}</span>
        {message?.action === undefined ? null : (
          <button
            type="button"
            className="inline-flex min-h-[34px] items-center rounded-(--cq-radius-md) px-2.5 font-medium text-(--cq-gold-light) hover:bg-(--cq-text-secondary)/30"
            onClick={() => {
              message.action?.run();
              setShown(false);
            }}
            data-toast-action
          >
            {message.action.label}
          </button>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** The page's toast; a no-op outside a provider (tests, previews). */
export function useAccountToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

function noop(): void {}
