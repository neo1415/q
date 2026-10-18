import type {
  ExploreReasonCode,
  ExploreRelatedReason,
  ExploreTileDto,
} from "@capital-q/contracts";

import { countryLabel, stageLabel } from "../company/declared-labels";

/**
 * Explore's words (E1-E5). Every tile says why it is shown, in plain words
 * from a closed list; exploration is labelled as exploration so the person
 * can trust the personalisation. Never a count, a percentage or "trending".
 */

export type FitKind = "fit" | "part" | "no" | "unk";

export const REASON_WORDS: Readonly<
  Record<ExploreReasonCode, { readonly text: string; readonly fit: FitKind }>
> = {
  MATCHES_MANDATE: { text: "Matches your mandate", fit: "fit" },
  CLOSE_TO_MANDATE: { text: "Close to your mandate", fit: "part" },
  LIKE_YOUR_SAVES: { text: "Like companies you saved", fit: "part" },
  NEAR_YOUR_COMPANY: { text: "Near your company's sector", fit: "part" },
  NEW_THIS_WEEK: { text: "New this week", fit: "part" },
  OUTSIDE_USUAL_FOCUS: { text: "Outside your usual focus", fit: "no" },
  ON_THE_NETWORK: { text: "On the network", fit: "unk" },
};

export const RELATED_WORDS: Readonly<Record<ExploreRelatedReason, string>> = {
  SAME_COMPANY: "Same founder",
  SAME_SECTOR: "Same sector",
  SAME_STAGE: "Same stage",
  SAME_GEOGRAPHY: "Same country",
};

/** "Seed · Health · Nigeria": what the company declared, unknowns left out. */
export function tileMeta(
  tile: Pick<
    ExploreTileDto,
    "currentStageCode" | "headquartersCountry" | "sectorNodeIds"
  >,
  sectorLabels: ReadonlyMap<string, string>,
): string {
  const sector = tile.sectorNodeIds
    .map((id) => sectorLabels.get(id))
    .find((label): label is string => label !== undefined);
  return [
    stageLabel(tile.currentStageCode),
    sector ?? null,
    countryLabel(tile.headquartersCountry),
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
}

/** "0:58": the pitch's stored length; nothing when it is not known. */
export function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

/** The tile's one line: the pitch's own title, else the company's line. */
export function tileHook(tile: ExploreTileDto): string {
  return tile.pitch.title ?? tile.shortDescription ?? "Pitch";
}
