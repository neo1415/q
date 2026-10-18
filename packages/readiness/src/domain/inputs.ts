import type {
  DeckSectionCode,
  EvidenceStatus,
  TruthClass,
} from "@capital-q/contracts";

/**
 * Everything the assessment reads, gathered for ONE company, the
 * founder's own, before any rule runs. Absent is null (not shared), never
 * zero: the rules turn null into "Not shared yet", never into a weakness.
 */
export type ReadinessClaimInput = {
  readonly id: string;
  readonly claimType: string;
  readonly claimKey: string;
  readonly statement: string;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus:
    | "CURRENT"
    | "HISTORICAL"
    | "SUPERSEDED"
    | "DISPUTED"
    | "CONTRADICTORY"
    | "STALE";
};

export type ReadinessDeckSection = {
  readonly section: DeckSectionCode;
  readonly score: number;
  /** The rubric's word for the score ("CLEAR"). */
  readonly level: string;
  readonly atStandard: boolean;
  readonly improve: string | null;
};

export type ReadinessDeckFigure = {
  readonly section: DeckSectionCode;
  readonly label: string;
  readonly value: string;
  readonly asOf: string | null;
};

export type ReadinessFollowUpInput = {
  readonly factKey: string;
  readonly reason: string;
};

export type ReadinessInputs = {
  readonly stageCode: string | null;
  readonly profile: {
    readonly description: boolean;
    readonly website: boolean;
    readonly categories: number;
  };
  readonly team: {
    readonly founderCount: number | null;
    readonly fullTimeFounderCount: number | null;
    readonly teamSize: number | null;
    readonly founderBackgrounds: number;
    readonly verifiedFounderIdentities: number;
  };
  readonly verification: {
    readonly organisation: boolean;
    readonly domain: boolean;
  };
  readonly claims: readonly ReadinessClaimInput[];
  /** Null: no deck uploaded. */
  readonly deck: {
    readonly documentId: string;
    /** Null: Q has not read it yet (unknown, not missing). */
    readonly sections: readonly ReadinessDeckSection[] | null;
    /**
     * F29: figures from sections of Q's reading the founder confirmed (or
     * wrote themselves). The deck's own claims: USER_CLAIM, SELF_REPORTED.
     * Absent or empty: none confirmed yet.
     */
    readonly figures?: readonly ReadinessDeckFigure[] | undefined;
  } | null;
  /** Null: the data room could not be read. */
  readonly dataRoom: {
    readonly checklist: readonly {
      readonly code: string;
      readonly folderCode: string;
      readonly label: string;
      readonly present: boolean;
    }[];
  } | null;
  /** Null: no current raise recorded. */
  readonly raise: {
    readonly target: string;
    readonly useOfFunds: boolean;
    readonly instrument: boolean;
    readonly valuation: boolean;
    readonly targetCloseDate: boolean;
  } | null;
  /** Pending follow-up questions (a CONTRADICTION one marks its fact). */
  readonly followUps: readonly ReadinessFollowUpInput[];
};

/** "pre_seed" 1, "seed" 2, "series_a" 3, "series_b"+ 4; unknown: seed. */
export function stageRank(stageCode: string | null): 1 | 2 | 3 | 4 {
  const code = (stageCode ?? "").toLowerCase();
  if (code.includes("pre")) return 1;
  if (code.includes("series_a") || code === "a") return 3;
  if (/series_[b-z]|growth|late/.test(code)) return 4;
  if (code.includes("idea") || code.includes("concept")) return 1;
  return 2;
}
