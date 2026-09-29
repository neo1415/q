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

/** How founders may reach them, in the investor's own terms. */
export function inboundLabel(
  preference: "CLOSED" | "QUALIFIED" | "OPEN" | null | undefined,
): string {
  switch (preference) {
    case "OPEN":
      return "Takes requests from founders";
    case "QUALIFIED":
      return "Takes requests from companies that fit their criteria";
    case "CLOSED":
      return "Not taking requests from founders";
    case null:
    case undefined:
      return "Hasn't said how founders can reach them";
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
