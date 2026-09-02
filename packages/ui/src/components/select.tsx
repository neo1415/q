import type { SelectHTMLAttributes } from "react";

import { ChevronDown, ICON_SIZE, ICON_STROKE } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import { FieldFrame, fieldControlClassName } from "./input.js";

/**
 * Native select behind the Capital Q field frame. Native on purpose: on a
 * phone it opens the platform picker, which is faster and more accessible
 * than any custom listbox for a short list.
 */

export type SelectOption = {
  readonly value: string;
  readonly label: string;
};

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className" | "id" | "children"
> & {
  readonly id: string;
  readonly label: string;
  readonly labelHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly options: readonly SelectOption[];
  readonly className?: string | undefined;
};

export function Select({
  id,
  label,
  labelHidden,
  description,
  error,
  placeholder,
  options,
  className,
  ...rest
}: SelectProps) {
  return (
    <FieldFrame
      id={id}
      label={label}
      labelHidden={labelHidden}
      description={description}
      error={error}
    >
      <div className="relative">
        <select
          id={id}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={
            error !== undefined
              ? `${id}-error`
              : description !== undefined
                ? `${id}-description`
                : undefined
          }
          className={cx(
            fieldControlClassName,
            "h-11 appearance-none cq-body pr-10 lg:h-10",
            className,
          )}
          {...rest}
        >
          {placeholder !== undefined ? (
            <option value="">{placeholder}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-(--cq-text-tertiary)"
        />
      </div>
    </FieldFrame>
  );
}
