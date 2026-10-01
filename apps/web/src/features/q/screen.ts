import type {
  QScreenContext,
  QScreenRoute,
  QViewingMoment,
} from "@capital-q/contracts";

import { viewingOf, type QMomentSource } from "./q-moment";

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
  "/daily": "DAILY",
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

/**
 * What the page says is in front of the person (R18/R21): the Discover
 * card's company, and its pitch and position when one is playing or
 * paused. Registered by the page (through the global Q moment source) and
 * read at every turn, so "what is this about?" asked into an open dock or
 * a live voice line is about the card on screen at that instant -- not
 * the one showing when Q was opened.
 */
let focusSource: QMomentSource | null = null;

export function setScreenFocusSource(source: QMomentSource | null): void {
  focusSource = source;
}

function focusNow() {
  try {
    return focusSource?.() ?? null;
  } catch {
    return null;
  }
}

/** The pitch moment on screen now, as the run contract carries it; or none. */
export function currentViewing(): QViewingMoment | undefined {
  const focus = focusNow();
  return focus?.kind === "PITCH_MOMENT" && UUID.test(focus.companyId)
    ? viewingOf(focus)
    : undefined;
}

/** What is on screen now: the route's context, the focused company, the open document. */
export function currentScreen(
  pathname: string = window.location.pathname,
): QScreenContext {
  let screen = screenOf(pathname);
  const focus = focusNow();
  if (
    screen.companyId === undefined &&
    focus !== null &&
    UUID.test(focus.companyId)
  ) {
    screen = { ...screen, companyId: focus.companyId.toLowerCase() };
  }
  const zone = deviceTimeZone();
  if (zone !== undefined) screen = { ...screen, timeZone: zone };
  return openDocumentId === null || screen.documentId !== undefined
    ? screen
    : { ...screen, documentId: openDocumentId };
}

const ZONE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * The device's IANA zone, so "tomorrow at 2 PM" is resolved where the
 * person is (live test 2026-09-28 #2). Anything the contract would refuse
 * is left out rather than failing the question.
 */
function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ZONE.test(zone) && zone.length <= 64 ? zone : undefined;
  } catch {
    return undefined;
  }
}
