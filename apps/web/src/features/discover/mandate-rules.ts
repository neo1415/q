/**
 * Words for a declared mandate rule, by its dimension code (ADR 0020).
 * The code is the investor's own rule, never a value in it; a code this
 * table does not know is spelled out rather than hidden, because hiding a
 * rule that could not be checked is the defect this exists to prevent.
 */
const RULE_LABELS: Readonly<Record<string, string>> = {
  stage: "stage",
  "geography.country": "country",
  taxonomy: "sector",
  red_flag: "red-flag",
};

export function ruleLabel(code: string): string {
  return RULE_LABELS[code] ?? code.replace(/[._]/g, " ");
}

/** "stage", "stage and country", "stage, country and sector". */
export function ruleList(codes: readonly string[]): string {
  const labels = codes.map(ruleLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
}
