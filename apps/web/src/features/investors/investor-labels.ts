/**
 * Words for an investor organisation's own declared facts (ADR 0023).
 * Display only: every value comes from what the investor declared, and an
 * unknown code is shown as itself rather than guessed at.
 */

const TYPE_LABELS: Readonly<Record<string, string>> = {
  ANGEL: "Angel",
  VC: "Venture fund",
  FAMILY_OFFICE: "Family office",
  CVC: "Corporate venture",
  SYNDICATE: "Syndicate",
  ACCELERATOR: "Accelerator",
  SCOUT: "Scout",
  INSTITUTIONAL: "Institutional",
  OTHER: "Investor",
};

export function investorTypeLabel(code: string): string {
  return TYPE_LABELS[code] ?? code.replace(/_/g, " ").toLowerCase();
}

const DEPLOYMENT_LABELS: Readonly<Record<string, string>> = {
  ACTIVELY_INVESTING: "Actively investing",
  SELECTIVE: "Investing selectively",
  PAUSED: "Paused",
  EXPLORING_ONLY: "Exploring only",
};

export function deploymentLabel(state: string | null): string | null {
  return state === null
    ? null
    : (DEPLOYMENT_LABELS[state] ?? state.replace(/_/g, " ").toLowerCase());
}

/**
 * How founders may reach them, as a state -- only when it is not the usual
 * one (founder direction 2026-09-29: states, not sentences on every card).
 * Qualified requests are the default and say nothing; so does not saying.
 */
export function inboundLabel(
  preference: "CLOSED" | "QUALIFIED" | "OPEN" | null | undefined,
): string | null {
  switch (preference) {
    case "OPEN":
      return "Open to founders";
    case "CLOSED":
      return "Not taking requests";
    case "QUALIFIED":
    case null:
    case undefined:
      return null;
  }
}

export function initials(name: string): string {
  // Words that start with a letter or digit: "(fictional)" or "&" is not
  // part of anyone's initials.
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
