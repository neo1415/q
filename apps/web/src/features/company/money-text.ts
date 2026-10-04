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
