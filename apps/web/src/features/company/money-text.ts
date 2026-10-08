/** "USD 1,500,000" from a decimal string, without ever becoming a float. */
export function moneyText(money: {
  readonly amount: string;
  readonly currency: string;
}): string {
  const [whole = "0", fraction = ""] = money.amount.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = /^0*$/.test(fraction) ? "" : `.${fraction}`;
  return `${money.currency} ${negative ? "-" : ""}${grouped}${cents}`;
}

const SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  NGN: "₦",
};

/**
 * "$4M", "£1.5M", "KES 250K": the short form a summary reads at a glance,
 * from the decimal string by string arithmetic (one decimal, truncated,
 * never rounded up into a bigger raise than was said).
 */
export function compactMoneyText(money: {
  readonly amount: string;
  readonly currency: string;
}): string {
  const digits = (money.amount.split(".")[0] ?? "0").replace(/^-?0*/, "");
  const prefix = SYMBOLS[money.currency] ?? `${money.currency} `;
  const scaled = (power: number, unit: string) => {
    const whole = digits.slice(0, digits.length - power);
    const tenth = digits.charAt(digits.length - power);
    return `${prefix}${whole}${tenth === "0" || tenth === "" ? "" : `.${tenth}`}${unit}`;
  };
  if (digits.length > 9) return scaled(9, "B");
  if (digits.length > 6) return scaled(6, "M");
  if (digits.length > 3) return scaled(3, "K");
  return `${prefix}${digits === "" ? "0" : digits}`;
}
