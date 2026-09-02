import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Form fields (doc 18 §§52–53). Every field carries a real label; the
 * placeholder is never the accessible name. Mobile-first 44 px controls.
 */

/** Control styling without a width, for composed rows (e.g. currency + amount). */
export const fieldControlBaseClassName =
  "rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border-strong) disabled:opacity-50 aria-invalid:border-(--cq-danger)";

export const fieldControlClassName = `w-full ${fieldControlBaseClassName}`;

type FieldFrameProps = {
  readonly id: string;
  readonly label: string;
  readonly labelHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
};

export function FieldFrame({
  id,
  label,
  labelHidden = false,
  description,
  error,
  children,
}: FieldFrameProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cx(
          "cq-label text-(--cq-text-primary)",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </label>
      {children}
      {description !== undefined && error === undefined ? (
        <p
          id={`${id}-description`}
          className="cq-caption text-(--cq-text-secondary)"
        >
          {description}
        </p>
      ) : null}
      {error !== undefined ? (
        <p
          id={`${id}-error`}
          className="cq-caption text-(--cq-danger)"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(
  id: string,
  description: string | undefined,
  error: string | undefined,
): string | undefined {
  if (error !== undefined) {
    return `${id}-error`;
  }
  return description === undefined ? undefined : `${id}-description`;
}

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "id"
> & {
  readonly id: string;
  readonly label: string;
  readonly labelHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
};

export function Input({
  id,
  label,
  labelHidden,
  description,
  error,
  className,
  ...rest
}: InputProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      labelHidden={labelHidden}
      description={description}
      error={error}
    >
      <input
        id={id}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        className={cx(fieldControlClassName, "h-11 cq-body lg:h-10", className)}
        {...rest}
      />
    </FieldFrame>
  );
}

export type TextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "id"
> & {
  readonly id: string;
  readonly label: string;
  readonly labelHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
};

/** Grows with its content (field-sizing) rather than clipping it. */
export function Textarea({
  id,
  label,
  labelHidden,
  description,
  error,
  className,
  rows = 3,
  ...rest
}: TextareaProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      labelHidden={labelHidden}
      description={description}
      error={error}
    >
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        className={cx(
          fieldControlClassName,
          "cq-body min-h-11 resize-none py-2.5 [field-sizing:content]",
          className,
        )}
        {...rest}
      />
    </FieldFrame>
  );
}
