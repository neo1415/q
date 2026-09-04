import type {
  TaxonomyAbstentionReason,
  TaxonomyClassificationResolution,
  TaxonomyMatchType,
} from "@capital-q/contracts";

import type { TaxonomyNode } from "../../contracts/index.js";
import {
  TAXONOMY_RATIONALE_MAX_LENGTH,
  type TaxonomyCandidate,
  type TaxonomyClassificationCandidate,
} from "../contracts/index.js";
import type { TaxonomyClassificationPolicy } from "./policy.js";
import { lexicalConfidence } from "./scoring.js";

/**
 * Merge, dedupe, rank, ambiguity, abstention. Pure and deterministic.
 *
 *   tier 0  canonical-code exact
 *   tier 1  exact alias / exact display name
 *   tier 2  lexical
 *
 * Exact tiers always outrank lexical similarity. One exact-tier node is
 * EXACT; several are AMBIGUOUS (an alias may legitimately name nodes in
 * more than one vocabulary, and the classifier never picks one). With no
 * exact hit, lexical hits at or above the minimum are CANDIDATES unless the
 * two best in one vocabulary are materially indistinguishable; nothing at
 * all, or nothing above the minimum, is ABSTAINED.
 */

export type ResolvedCandidates = {
  readonly resolution: TaxonomyClassificationResolution;
  readonly candidates: readonly TaxonomyClassificationCandidate[];
  readonly abstentionReason?: TaxonomyAbstentionReason | undefined;
};

export type MergedCandidate = {
  readonly node: TaxonomyNode;
  readonly matchTypes: ReadonlySet<TaxonomyMatchType>;
  readonly tier: number;
  readonly lexicalScore: number;
  readonly rationale: readonly string[];
};

const TIER: Record<TaxonomyMatchType, number> = {
  CANONICAL_CODE_EXACT: 0,
  ALIAS_EXACT: 1,
  DISPLAY_NAME_EXACT: 1,
  LEXICAL: 2,
};

const MATCH_TYPE_ORDER: readonly TaxonomyMatchType[] = [
  "CANONICAL_CODE_EXACT",
  "ALIAS_EXACT",
  "DISPLAY_NAME_EXACT",
  "LEXICAL",
];

/** Short, observable, platform-text-only. Never the user's input, never reasoning. */
function rationaleFor(candidate: TaxonomyCandidate): string {
  switch (candidate.matchType) {
    case "CANONICAL_CODE_EXACT":
      return "Exact canonical code match.";
    case "ALIAS_EXACT":
      return `Exact curated alias match ("${candidate.matchedText}").`;
    case "DISPLAY_NAME_EXACT":
      return "Display name matched exactly.";
    case "LEXICAL":
      return `Lexical match on "${candidate.matchedText}"${
        candidate.detail === undefined ? "" : ` (${candidate.detail})`
      }.`;
  }
}

export function mergeCandidates(
  raw: readonly TaxonomyCandidate[],
): readonly MergedCandidate[] {
  type Draft = {
    node: TaxonomyNode;
    matchTypes: Set<TaxonomyMatchType>;
    tier: number;
    lexicalScore: number;
    rationale: string[];
  };
  const byNode = new Map<string, Draft>();
  for (const candidate of raw) {
    const tier = TIER[candidate.matchType];
    const existing = byNode.get(candidate.node.id);
    if (existing === undefined) {
      byNode.set(candidate.node.id, {
        node: candidate.node,
        matchTypes: new Set([candidate.matchType]),
        tier,
        lexicalScore: candidate.matchType === "LEXICAL" ? candidate.score : 0,
        rationale: [rationaleFor(candidate)],
      });
      continue;
    }
    if (!existing.matchTypes.has(candidate.matchType)) {
      existing.matchTypes.add(candidate.matchType);
      existing.rationale.push(rationaleFor(candidate));
    }
    existing.tier = Math.min(existing.tier, tier);
    if (candidate.matchType === "LEXICAL") {
      existing.lexicalScore = Math.max(existing.lexicalScore, candidate.score);
    }
  }
  return [...byNode.values()];
}

function compare(a: MergedCandidate, b: MergedCandidate): number {
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }
  if (a.lexicalScore !== b.lexicalScore) {
    return b.lexicalScore - a.lexicalScore;
  }
  const vocabulary = a.node.vocabularyCode.localeCompare(b.node.vocabularyCode);
  return vocabulary !== 0
    ? vocabulary
    : a.node.canonicalCode.localeCompare(b.node.canonicalCode);
}

function exactConfidence(
  merged: MergedCandidate,
  policy: TaxonomyClassificationPolicy,
): string {
  if (merged.matchTypes.has("CANONICAL_CODE_EXACT")) {
    return policy.exactConfidence.CANONICAL_CODE_EXACT;
  }
  if (merged.matchTypes.has("ALIAS_EXACT")) {
    return policy.exactConfidence.ALIAS_EXACT;
  }
  return policy.exactConfidence.DISPLAY_NAME_EXACT;
}

function toCandidate(
  merged: MergedCandidate,
  rank: number,
  policy: TaxonomyClassificationPolicy,
): TaxonomyClassificationCandidate {
  const rationale = merged.rationale.join(" ");
  return {
    nodeId: merged.node.id,
    vocabularyCode: merged.node.vocabularyCode,
    canonicalCode: merged.node.canonicalCode,
    displayName: merged.node.displayName,
    rank,
    confidence:
      merged.tier <= 1
        ? exactConfidence(merged, policy)
        : lexicalConfidence(merged.lexicalScore, policy),
    matchTypes: MATCH_TYPE_ORDER.filter((type) => merged.matchTypes.has(type)),
    rationaleSummary:
      rationale.length <= TAXONOMY_RATIONALE_MAX_LENGTH
        ? rationale
        : `${rationale.slice(0, TAXONOMY_RATIONALE_MAX_LENGTH - 1)}…`,
  };
}

export function resolveCandidates(
  raw: readonly TaxonomyCandidate[],
  policy: TaxonomyClassificationPolicy,
  limit: number,
): ResolvedCandidates {
  const merged = [...mergeCandidates(raw)].sort(compare);
  const exact = merged.filter((candidate) => candidate.tier <= 1);

  if (exact.length === 1) {
    return {
      resolution: "EXACT",
      candidates: exact.map((c, i) => toCandidate(c, i + 1, policy)),
    };
  }
  if (exact.length > 1) {
    return {
      resolution: "AMBIGUOUS",
      candidates: exact
        .slice(0, limit)
        .map((c, i) => toCandidate(c, i + 1, policy)),
      abstentionReason: "AMBIGUOUS_CANDIDATES",
    };
  }

  const lexical = merged.filter(
    (candidate) =>
      candidate.lexicalScore >= policy.lexical.candidateMinimumScore,
  );
  if (lexical.length === 0) {
    return {
      resolution: "ABSTAINED",
      candidates: [],
      abstentionReason:
        merged.length === 0 ? "NO_CANDIDATES" : "LOW_CONFIDENCE",
    };
  }

  const top = lexical.slice(0, limit);
  const candidates = top.map((c, i) => toCandidate(c, i + 1, policy));
  const [first, second] = top;
  const ambiguous =
    first !== undefined &&
    second !== undefined &&
    first.node.vocabularyCode === second.node.vocabularyCode &&
    first.lexicalScore >= policy.lexical.strongScore &&
    second.lexicalScore >= policy.lexical.strongScore &&
    first.lexicalScore - second.lexicalScore <= policy.lexical.ambiguityMargin;

  return ambiguous
    ? {
        resolution: "AMBIGUOUS",
        candidates,
        abstentionReason: "AMBIGUOUS_CANDIDATES",
      }
    : { resolution: "CANDIDATES", candidates };
}
