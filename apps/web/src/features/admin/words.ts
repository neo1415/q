/**
 * The console shows operators coded values (failure classes, task classes,
 * statuses) as words: "POLICY_DENIED" reads "Policy denied". Unknown or
 * missing values read "Not stated".
 */
export function words(code: string | null | undefined): string {
  if (code === null || code === undefined || code.length === 0) {
    return "Not stated";
  }
  const text = code.replace(/[_.]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function when(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  return (
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/** Spend as text, never through a float: 2 decimals, 4 under a dollar. */
export function usd(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const places = whole === "0" ? 4 : 2;
  return `$${whole}.${fraction.padEnd(places, "0").slice(0, places)}`;
}

export const ROLE_WORDS: Readonly<Record<string, string>> = {
  platform_owner: "Platform owner",
  operator: "Operator",
  trust_and_safety: "Trust & safety",
  support: "Support",
  analyst: "Analyst (read-only)",
};
