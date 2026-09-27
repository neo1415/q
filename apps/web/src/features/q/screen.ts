import type { QScreenContext, QScreenRoute } from "@capital-q/contracts";

/**
 * What is on screen as the person asks Q (R21): the route mapped onto the
 * closed screen list, and the canonical entity ids the route names. Not
 * pixels, and never authority: the Q API resolves each id for the asker or
 * drops it. The pitch being watched travels separately (`viewing`, R18).
 */
const EXACT: Readonly<Record<string, QScreenRoute>> = {
  "/home": "HOME",
  "/discover": "DISCOVER",
  "/capital": "CAPITAL",
  "/profile": "PROFILE",
  "/company/visibility": "COMPANY_VISIBILITY",
  "/relationships": "RELATIONSHIPS",
  "/company/interest": "COMPANY_INTEREST",
  "/pitch": "PITCH",
  "/verification": "VERIFICATION",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function screenOf(pathname: string): QScreenContext {
  const path = pathname.replace(/\/+$/, "") || "/";
  const exact = EXACT[path];
  if (exact !== undefined) return { route: exact };
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const [first, second, third] = segments;
  if (first === "onboarding") return { route: "ONBOARDING" };
  if (first === "company" && second !== undefined && UUID.test(second)) {
    return { route: "COMPANY", companyId: second.toLowerCase() };
  }
  if (first === "relationships" && third !== undefined && UUID.test(third)) {
    if (second === "company") {
      return { route: "RELATIONSHIP_COMPANY", companyId: third.toLowerCase() };
    }
    if (second === "investor") {
      return {
        route: "RELATIONSHIP_INVESTOR",
        investorOrganisationId: third.toLowerCase(),
      };
    }
  }
  return { route: "OTHER" };
}

/**
 * The document open in Q's viewer, if any (R21): one per tab, set by the
 * Q session while its viewer shows it. Part of what is on screen, so a
 * typed or spoken "what's in this?" is about that document.
 */
let openDocumentId: string | null = null;

export function setOpenDocument(documentId: string | null): void {
  openDocumentId =
    documentId !== null && UUID.test(documentId)
      ? documentId.toLowerCase()
      : null;
}

/** What is on screen now: the route's context, plus the open document. */
export function currentScreen(
  pathname: string = window.location.pathname,
): QScreenContext {
  const screen = screenOf(pathname);
  return openDocumentId === null || screen.documentId !== undefined
    ? screen
    : { ...screen, documentId: openDocumentId };
}
