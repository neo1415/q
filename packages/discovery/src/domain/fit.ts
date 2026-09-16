import type { DiscoveryReason } from "../contracts.js";
import {
  preferenceWeight,
  reasonKindForVocabulary,
  SIGNAL_WEIGHT,
} from "./ranking.js";

/**
 * Explicit fit: what two declared profiles actually have in common
 * (doc 19, "explicit fit" before anything semantic).
 *
 * Pure functions over declared fields. Nothing here reads a database,
 * calls a model, or knows what anybody browsed. An absent field is
 * unknown, and unknown is never a penalty: a company with no declared
 * stage is not "a bad match", it is a company whose stage nobody has
 * said yet, and it simply earns nothing from that signal.
 */

/** The declared stage ladder. Order is the product's, not alphabetical. */
export const STAGE_LADDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c_plus",
] as const;

function stageRank(code: string | null): number | null {
  if (code === null) return null;
  const index = (STAGE_LADDER as readonly string[]).indexOf(code);
  return index < 0 ? null : index;
}

/**
 * Whether a company's declared stage sits in the mandate's declared range.
 * An open end is open: a mandate with no maximum has no maximum.
 */
export function stageInRange(
  companyStage: string | null,
  minStage: string | null,
  maxStage: string | null,
): boolean {
  const company = stageRank(companyStage);
  if (company === null) return false;
  const min = stageRank(minStage);
  const max = stageRank(maxStage);
  if (min === null && max === null) return false;
  if (min !== null && company < min) return false;
  if (max !== null && company > max) return false;
  return true;
}

export type DeclaredPreference = {
  readonly nodeId: string;
  readonly vocabulary: string;
  readonly label: string;
  readonly strength: string;
  readonly isExclusion: boolean;
};

export type DeclaredClassification = {
  readonly nodeId: string;
  readonly vocabulary: string;
  readonly label: string;
};

/**
 * A hard exclusion is a removal, never a low score (doc 19: hard
 * exclusions come only from declared rules). One excluded node the
 * counterpart carries is enough.
 */
export function isExcluded(
  preferences: readonly DeclaredPreference[],
  classifications: readonly DeclaredClassification[],
): boolean {
  const excluded = new Set(
    preferences.filter((p) => p.isExclusion).map((p) => p.nodeId),
  );
  if (excluded.size === 0) return false;
  return classifications.some((c) => excluded.has(c.nodeId));
}

export type FitOutcome = {
  readonly score: number;
  readonly reasons: readonly DiscoveryReason[];
};

/**
 * What a mandate and a company declared in common. At most one reason per
 * vocabulary, so a company classified under six industries cannot crowd
 * out the rest of the explanation; the strongest declared preference in
 * each vocabulary is the one named.
 */
export function explicitFit(input: {
  readonly preferences: readonly DeclaredPreference[];
  readonly classifications: readonly DeclaredClassification[];
  readonly companyStage: string | null;
  readonly minStage: string | null;
  readonly maxStage: string | null;
}): FitOutcome {
  const reasons: DiscoveryReason[] = [];
  let score = 0;

  if (stageInRange(input.companyStage, input.minStage, input.maxStage)) {
    score += SIGNAL_WEIGHT.stageInRange;
    reasons.push({
      kind: "STAGE_IN_RANGE",
      detail: (input.companyStage ?? "").replace(/_/g, " "),
    });
  }

  const carried = new Map(
    input.classifications.map((c) => [c.nodeId, c] as const),
  );
  const bestByVocabulary = new Map<
    string,
    { readonly weight: number; readonly label: string }
  >();
  for (const preference of input.preferences) {
    if (preference.isExclusion) continue;
    const held = carried.get(preference.nodeId);
    if (held === undefined) continue;
    const weight = preferenceWeight(preference.strength);
    const current = bestByVocabulary.get(preference.vocabulary);
    if (current === undefined || weight > current.weight) {
      bestByVocabulary.set(preference.vocabulary, {
        weight,
        label: held.label,
      });
    }
  }
  // Stable order, so the same slate explains itself the same way twice.
  for (const vocabulary of [...bestByVocabulary.keys()].sort()) {
    const match = bestByVocabulary.get(vocabulary);
    if (match === undefined) continue;
    score += match.weight;
    reasons.push({
      kind: reasonKindForVocabulary(vocabulary),
      detail: match.label,
    });
  }

  return { score, reasons: reasons.slice(0, 8) };
}

/**
 * What a founder may rank an investor on: the declared profile, and only
 * that. The investor's mandate is investor-private, and doc 19 §204.9
 * makes it release-blocking that it must not shape a founder's slate.
 */
export function declaredProfileFit(investor: {
  readonly deploymentState: string | null;
  readonly publicDescription: string | null;
  readonly websiteUrl: string | null;
  readonly hqCountry: string | null;
}): FitOutcome {
  const reasons: DiscoveryReason[] = [];
  let score = 0;

  if (investor.deploymentState === "ACTIVELY_INVESTING") {
    score += SIGNAL_WEIGHT.declaredActivelyDeploying;
    reasons.push({ kind: "DECLARED_DEPLOYING", detail: "actively investing" });
  } else if (investor.deploymentState === "SELECTIVE") {
    score += SIGNAL_WEIGHT.declaredSelectivelyDeploying;
    reasons.push({
      kind: "DECLARED_DEPLOYING",
      detail: "investing selectively",
    });
  }

  const filled = [
    investor.publicDescription,
    investor.websiteUrl,
    investor.hqCountry,
  ].filter((field) => field !== null && field.trim().length > 0).length;
  if (filled === 3) {
    score += SIGNAL_WEIGHT.profileComplete;
    reasons.push({
      kind: "PROFILE_COMPLETE",
      detail: "profile, website and location shared",
    });
  }

  return { score, reasons };
}
