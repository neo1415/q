import type { QVoiceDestination } from "@capital-q/contracts";

/**
 * Where a spoken "take me to…" may go (CQ-Q-VOICE-001 rework). The list is
 * fixed on the server; this maps each name to the one route it means. A
 * destination with no route here is ignored, never guessed.
 */
const ROUTES: Readonly<Record<QVoiceDestination, string | null>> = {
  HOME: "/home",
  PROFILE: "/profile",
  CAPITAL: "/capital",
  DISCOVER: "/discover",
  COMPANY_VISIBILITY: "/company/visibility",
  RELATIONSHIPS: "/relationships",
  SETTINGS: "/settings",
  VERIFICATION: "/verification",
  PITCH: "/pitch",
  COMPANY_INTEREST: "/company/interest",
  SAVED: "/discover/saved",
  PASSED: "/discover/passed",
  INVESTORS: "/investors",
  // Search lives at the top of Explore now (ADR 0055).
  SEARCH: "/explore",
  // GateQ has its own page (F2); /gateway redirects there.
  GATEWAY: "/gateq",
  MEMORY: "/settings/memory",
  USAGE: "/settings/usage",
  NEW_PITCH: "/pitch/new",
  REHEARSALS: "/rehearsals",
  DOCUMENTS: "/documents",
  DAILY: "/daily",
  RESULTS: "/results",
  YOUR_COMPANIES: "/discover?tab=yours",
  WORK: "/work",
  // voice-cards: every remaining page and tab (Explore is never Discover).
  EXPLORE: "/explore",
  PEOPLE_SEARCH: "/search",
  WORK_NEEDS: "/work?view=needs",
  WORK_PROGRESS: "/work?view=progress",
  WORK_DONE: "/work?view=done",
  WORK_TEAM: "/work?view=team",
  WORK_COST: "/work?view=cost",
  GATEQ_INBOX: "/gateq?tab=inbox",
  GATEQ_FIND: "/gateq?tab=find",
  GATEQ_CLAIM: "/gateq?tab=claim",
  GATEQ_APPLICATIONS: "/gateq?tab=applications",
  SAVED_COMPARE: "/discover/saved/compare",
  REVIEWS: "/reviews",
  TOP_INVESTORS: "/investors/top",
  INTERVIEW: null,
  INTERVIEW_FOUNDER: "/onboarding/founder?talk=1",
  INTERVIEW_INVESTOR: "/onboarding/investor?talk=1",
  FORM: null,
};

export function destinationPath(
  destination: QVoiceDestination | null,
): string | null {
  if (destination === null) {
    return null;
  }
  return ROUTES[destination];
}
