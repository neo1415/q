import { parseMoney, roundToCents } from "./money.js";

/**
 * "3", "3m", "$1.8m", "250k", "1,000", "₦450m", "1,5 M€", "1 500 000" →
 * a plain decimal string, or null. The currency the text states is not
 * returned here; callers that need it use parseMoney, which keeps it.
 */
export function parseFigure(text: string): string | null {
  const money = parseMoney(text);
  return money === null ? null : roundToCents(money.amount);
}
