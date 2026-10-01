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
  INVESTORS: "/investors",
  SEARCH: "/search",
  GATEWAY: "/gateway",
  MEMORY: "/settings/memory",
  NEW_PITCH: "/pitch/new",
  REHEARSALS: "/rehearsals",
  DOCUMENTS: "/documents",
  DAILY: "/daily",
  RESULTS: "/results",
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
