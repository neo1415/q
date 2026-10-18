import {
  type FitBand,
  type FitConfidence,
  type FitParameterResultDto,
  type FitProfileDto,
} from "@capital-q/contracts";

/**
 * Pure choices the fit surfaces share (ADR 0052), kept out of components
 * so they are tested once.
 */

/**
 * The three lines a card shows: the two strongest reasons, then the main
 * mismatch, or else the first unknown (what to ask about), or else a third
 * reason. Never two lines about the same parameter.
 */
export function cardReasons(
  profile: FitProfileDto,
): readonly FitParameterResultDto[] {
  const lead = profile.topReasons.slice(0, 2);
  const firstUnknown = profile.parameters.find(
    (p) => p.applicable && p.outcome === "UNKNOWN",
  );
  const third =
    profile.mainMismatch ?? firstUnknown ?? profile.topReasons[2] ?? null;
  const out = third === null ? lead : [...lead, third];
  return out.filter(
    (r, i) => out.findIndex((o) => o.parameter === r.parameter) === i,
  );
}

/** Relationship chips: up to three strong parameters and the first unknown. */
export function chipParameters(profile: FitProfileDto): {
  readonly strong: readonly FitParameterResultDto[];
  readonly unknown: FitParameterResultDto | null;
} {
  return {
    strong: profile.parameters
      .filter((p) => p.applicable && p.outcome === "STRONG")
      .slice(0, 3),
    unknown:
      profile.parameters.find((p) => p.applicable && p.outcome === "UNKNOWN") ??
      null,
  };
}

const BAND_ORDER: Readonly<Record<FitBand, number>> = {
  STRONG_FIT: 0,
  GOOD_FIT: 1,
  PARTIAL_FIT: 2,
  WEAK_FIT: 3,
  NOT_ENOUGH_INFORMATION: 4,
  OUTSIDE_MANDATE: 5,
};
const CONFIDENCE_ORDER: Readonly<Record<FitConfidence, number>> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

/**
 * "Best fit" order for a list: band, then confidence, then the number of
 * strong parameters. Words only reach the screen; this only sorts. A
 * company without a fit goes last, never first and never hidden.
 */
export function compareByFit(
  a: FitProfileDto | null,
  b: FitProfileDto | null,
): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  const strong = (p: FitProfileDto) =>
    p.parameters.filter((r) => r.applicable && r.outcome === "STRONG").length;
  return (
    BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
    CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
    strong(b) - strong(a)
  );
}

/** "Asked 2 days ago", from the page's own clock so server and browser agree. */
export function askedAgo(iso: string, now: number): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "Asked today";
  if (days === 1) return "Asked 1 day ago";
  if (days < 7) return `Asked ${String(days)} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "Asked 1 week ago" : `Asked ${String(weeks)} weeks ago`;
}
