import { cx } from "../primitives/class-names.js";
import { fieldControlBaseClassName, fieldControlClassName } from "./input.js";

/**
 * Money entry with exact string semantics. The value the caller receives is
 * the digits the founder typed (with at most one decimal point), never a
 * JavaScript number: financial amounts are decimal strings plus an ISO
 * currency everywhere in Capital Q. Formatting is presentation only.
 */

export type MoneyValue = {
  readonly amount: string;
  readonly currency: string;
};

export type CurrencyOption = {
  readonly code: string;
  readonly label: string;
};

export function sanitiseAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [integer = "", ...rest] = cleaned.split(".");
  const fraction = rest.join("").slice(0, 2);
  const normalisedInteger = integer.replace(/^0+(?=\d)/, "");
  return rest.length > 0
    ? `${normalisedInteger}.${fraction}`
    : normalisedInteger;
}

/** Groups thousands for display without ever parsing the amount as a float. */
export function formatAmountForDisplay(amount: string): string {
  if (amount === "") {
    return "";
  }
  const [integer = "", fraction] = amount.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction !== undefined ? `${grouped}.${fraction}` : grouped;
}

export type MoneyInputProps = {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly value: MoneyValue;
  readonly currencies: readonly CurrencyOption[];
  readonly onChange: (value: MoneyValue) => void;
  readonly disabled?: boolean | undefined;
};

export function MoneyInput({
  id,
  label,
  description,
  error,
  value,
  currencies,
  onChange,
  disabled = false,
}: MoneyInputProps) {
  const describedBy =
    error !== undefined
      ? `${id}-error`
      : description !== undefined
        ? `${id}-description`
        : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="cq-label text-(--cq-text-primary)">
        {label}
      </label>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`${id}-currency`}>
          Currency
        </label>
        <select
          id={`${id}-currency`}
          value={value.currency}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, currency: event.target.value })
          }
          className={cx(
            fieldControlBaseClassName,
            "h-11 w-28 shrink-0 cq-body lg:h-10",
          )}
        >
          {currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={formatAmountForDisplay(value.amount)}
          disabled={disabled}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={describedBy}
          placeholder="0"
          onChange={(event) =>
            onChange({ ...value, amount: sanitiseAmount(event.target.value) })
          }
          className={cx(
            fieldControlClassName,
            "h-11 min-w-0 flex-1 cq-body cq-numeric lg:h-10",
          )}
        />
      </div>
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
          role="alert"
          className="cq-caption text-(--cq-danger)"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
