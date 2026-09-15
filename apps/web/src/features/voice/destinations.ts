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
  INTERVIEW: null,
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
