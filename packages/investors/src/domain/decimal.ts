/**
 * Exact comparison of decimal strings (the CQ-CON-001 DecimalString shape).
 *
 * Money never becomes a JavaScript number: the two values are scaled to a
 * common number of fraction digits and compared as BigInt. Inputs are
 * expected to have passed DecimalStringSchema already; a malformed string
 * throws rather than silently comparing garbage.
 */
const EXACT_DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

function scaled(value: string, fractionDigits: number): bigint {
  const match = EXACT_DECIMAL.exec(value);
  if (match === null) {
    throw new TypeError(`not an exact decimal string: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "0";
  const fraction = (match[3] ?? "").padEnd(fractionDigits, "0");
  return sign * BigInt(`${whole}${fraction}`);
}

function fractionDigitsOf(value: string): number {
  const index = value.indexOf(".");
  return index === -1 ? 0 : value.length - index - 1;
}

export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const digits = Math.max(fractionDigitsOf(a), fractionDigitsOf(b));
  const left = scaled(a, digits);
  const right = scaled(b, digits);
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
