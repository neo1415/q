import type { QNavigateDestination } from "@capital-q/contracts";

/**
 * Which of Q's screens a run may be offered, by side and by role: the
 * sidebar's own rules (navigation.ts), moved out of capabilities.ts
 * unchanged (W3-A, shrink-only). The page and the API still decide.
 */

/** The run facts these rules read (a subset of QCapabilityRunFacts). */
export type ScreenFacts = {
  readonly company: boolean;
  readonly ownInvestorOrganisation: boolean;
  readonly organisationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
};

/** Screens that belong to a company's own people. */
export const COMPANY_SCREENS: ReadonlySet<QNavigateDestination> = new Set([
  "COMPANY_VISIBILITY",
  "VERIFICATION",
  "PITCH",
  "COMPANY_INTEREST",
  "NEW_PITCH",
]);

/**
 * Screens that belong to an investor organisation's own people. Live
 * 2026-10-30 (founder.ledgerbridge, "take me to my mandate"): MANDATE was
 * offered to everyone on Home Q, so a founder was told "Opening your
 * mandate…" and sent to an investor's page. A founder has no mandate.
 */
export const INVESTOR_SCREENS: ReadonlySet<QNavigateDestination> = new Set([
  "YOUR_COMPANIES",
  "MANDATE",
]);

/**
 * Q-NAV (decisions 109 and 110): the organisation admin's screens, for
 * anyone acting for an organisation (members see them read-only), the
 * sidebar's own rule (navigation.ts organisationGroup).
 */
export const ORGANISATION_SCREENS: ReadonlySet<QNavigateDestination> = new Set([
  "ORGANISATION",
  "ORGANISATION_MEMBERS",
  "ORGANISATION_ROLES",
  "ORGANISATION_PLAN",
  "ORGANISATION_ACTIVITY",
]);

/**
 * Q-NAV: the pipeline import, which the sidebar shows only to the
 * organisation's owners and admins. Q never offers a member a screen
 * their navigation does not show them; the page and the API still decide.
 */
export const MANAGER_SCREENS: ReadonlySet<QNavigateDestination> = new Set([
  "ORGANISATION_IMPORT",
  "PIPELINE_IMPORT",
]);

/** The sidebar's rule (navigation.ts): owners and admins manage. */
export function managesOrganisation(
  role: ScreenFacts["organisationRole"],
): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Whether these facts may be offered this screen, by side and by role. */
export function screenEligible(
  destination: QNavigateDestination,
  facts: ScreenFacts,
): boolean {
  return (
    (!COMPANY_SCREENS.has(destination) || facts.company) &&
    (!INVESTOR_SCREENS.has(destination) || facts.ownInvestorOrganisation) &&
    (!ORGANISATION_SCREENS.has(destination) ||
      facts.organisationRole !== null) &&
    (!MANAGER_SCREENS.has(destination) ||
      managesOrganisation(facts.organisationRole))
  );
}
