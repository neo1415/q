import { STAGE_LADDER } from "../domain/fit.js";
import { DECLARED_TAXONOMY_SOURCES } from "../eligibility/policy.js";
import type { MandateSnapshotForEligibility } from "../eligibility/ports.js";
import {
  STRUCTURED_GENERATOR_ID,
  STRUCTURED_GENERATOR_VERSION,
  type CandidateDimension,
  type CandidateProvenance,
  type CandidateReasonCode,
  type MatchedNode,
} from "./contracts.js";

/**
 * The pure half of the structured generator: what an ACTIVE mandate
 * positively asks for, and how dimension hits become one provenance per
 * canonical company. No I/O, no model, no randomness.
 */

/** Preference classes that express positive intent. AVOID and HARD_EXCLUSION never retrieve. */
const POSITIVE_CLASSES: readonly string[] = ["MUST", "STRONG", "NICE"];

/** The geography vocabulary and its "anywhere" node: an unrestricted preference narrows nothing. */
export const GEOGRAPHY_VOCABULARY = "geography";
export const UNRESTRICTED_GEOGRAPHY_CODE = "global";

export type StructuredIntent = {
  /** Distinct, sorted stage codes the mandate positively wants; empty means no stage signal. */
  readonly stageCodes: readonly string[];
  /** Distinct, sorted ISO country codes from positive `geography.country` constraints. */
  readonly countryCodes: readonly string[];
  /** Distinct, sorted declared positive taxonomy preference node ids (any vocabulary). */
  readonly taxonomyNodeIds: readonly string[];
  readonly cheque: {
    readonly minCheque: string | null;
    readonly maxCheque: string | null;
    readonly currency: string | null;
  };
};

function ladderSlice(
  min: string | null,
  max: string | null,
): readonly string[] {
  const ladder = STAGE_LADDER as readonly string[];
  const from = min === null ? 0 : ladder.indexOf(min);
  const to = max === null ? ladder.length - 1 : ladder.indexOf(max);
  if (from < 0 || to < 0 || from > to) return [];
  return ladder.slice(from, to + 1);
}

/**
 * Positive stage intent: codes named by positive `stage` constraints
 * (EQ/IN name them; NEQ/NOT_IN name the rest of the ladder), plus the
 * declared min/max range. A mandate that says nothing about stage has no
 * stage signal — and loses no candidates for it, because the union means
 * another dimension can still find them.
 */
export function deriveStructuredIntent(
  mandate: Pick<
    MandateSnapshotForEligibility,
    "constraints" | "taxonomyPreferences"
  > & {
    readonly stage?:
      | {
          readonly minStageCode: string | null;
          readonly maxStageCode: string | null;
        }
      | undefined;
    readonly cheque?:
      | {
          readonly min?: string | undefined;
          readonly max?: string | undefined;
          readonly currency: string;
        }
      | null
      | undefined;
  },
): StructuredIntent {
  const stages = new Set<string>();
  const countries = new Set<string>();
  const ladder = STAGE_LADDER as readonly string[];

  for (const constraint of mandate.constraints) {
    if (
      constraint.automatedUse !== "ELIGIBLE" ||
      constraint.isHardExclusion ||
      !POSITIVE_CLASSES.includes(constraint.importance) ||
      constraint.value.kind !== "codes"
    ) {
      continue;
    }
    const codes = constraint.value.values;
    if (constraint.dimension === "stage") {
      if (constraint.operator === "EQ" || constraint.operator === "IN") {
        for (const code of codes) if (ladder.includes(code)) stages.add(code);
      } else if (
        constraint.operator === "NEQ" ||
        constraint.operator === "NOT_IN"
      ) {
        for (const code of ladder) if (!codes.includes(code)) stages.add(code);
      }
    } else if (constraint.dimension === "geography.country") {
      // "Anywhere but X" is unbounded and narrows nothing; only named
      // countries are a retrieval signal.
      if (constraint.operator === "EQ" || constraint.operator === "IN") {
        for (const code of codes) countries.add(code.toUpperCase());
      }
    }
  }
  if (mandate.stage !== undefined) {
    const { minStageCode, maxStageCode } = mandate.stage;
    if (minStageCode !== null || maxStageCode !== null) {
      for (const code of ladderSlice(minStageCode, maxStageCode))
        stages.add(code);
    }
  }

  const nodes = new Set<string>();
  for (const preference of mandate.taxonomyPreferences) {
    if (
      preference.isExclusion ||
      !POSITIVE_CLASSES.includes(preference.preferenceStrength) ||
      !(DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(
        preference.source,
      )
    ) {
      continue;
    }
    nodes.add(preference.nodeId);
  }

  return {
    stageCodes: [...stages].sort(),
    countryCodes: [...countries].sort(),
    taxonomyNodeIds: [...nodes].sort(),
    cheque: {
      minCheque: mandate.cheque?.min ?? null,
      maxCheque: mandate.cheque?.max ?? null,
      currency: mandate.cheque?.currency ?? null,
    },
  };
}

/** One dimension's finding for one company, before merging. */
export type DimensionHit = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly dimension: CandidateDimension;
  readonly reasonCode: CandidateReasonCode;
  readonly matchedNode?: MatchedNode | undefined;
};

export type MergedCandidate = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly provenance: CandidateProvenance;
};

function compareNodes(a: MatchedNode, b: MatchedNode): number {
  return (
    a.preferredNodeId.localeCompare(b.preferredNodeId) ||
    a.matchedNodeId.localeCompare(b.matchedNodeId)
  );
}

/**
 * Merge dimension hits by canonical company id: one candidate, every
 * reason it earned, dimensions and reasons sorted, ordered by company id.
 * The order is reproducibility, not desirability; nothing here counts
 * matches to rank.
 */
export function mergeDimensionHits(
  hits: readonly DimensionHit[],
  options: {
    readonly taxonomyVersion: Readonly<Record<string, number>> | null;
    readonly poolMax: number;
  },
): {
  readonly candidates: readonly MergedCandidate[];
  readonly truncated: boolean;
} {
  const byCompany = new Map<
    string,
    {
      tenantId: string;
      dimensions: Set<CandidateDimension>;
      reasons: Set<CandidateReasonCode>;
      nodes: Map<string, MatchedNode>;
    }
  >();
  for (const hit of hits) {
    const entry = byCompany.get(hit.companyId) ?? {
      tenantId: hit.tenantId,
      dimensions: new Set<CandidateDimension>(),
      reasons: new Set<CandidateReasonCode>(),
      nodes: new Map<string, MatchedNode>(),
    };
    entry.dimensions.add(hit.dimension);
    entry.reasons.add(hit.reasonCode);
    if (hit.matchedNode !== undefined) {
      entry.nodes.set(
        `${hit.matchedNode.preferredNodeId}|${hit.matchedNode.matchedNodeId}`,
        hit.matchedNode,
      );
    }
    byCompany.set(hit.companyId, entry);
  }
  const ordered = [...byCompany.keys()].sort();
  const truncated = ordered.length > options.poolMax;
  const candidates = ordered.slice(0, options.poolMax).map((companyId) => {
    const entry = byCompany.get(companyId);
    if (entry === undefined) throw new Error("merge lost a company");
    return {
      companyId,
      tenantId: entry.tenantId,
      provenance: {
        generatorId: STRUCTURED_GENERATOR_ID,
        generatorVersion: STRUCTURED_GENERATOR_VERSION,
        matchedDimensions: [...entry.dimensions].sort(),
        reasonCodes: [...entry.reasons].sort(),
        matchedNodes: [...entry.nodes.values()].sort(compareNodes).slice(0, 64),
        taxonomyVersion: options.taxonomyVersion,
      },
    };
  });
  return { candidates, truncated };
}
