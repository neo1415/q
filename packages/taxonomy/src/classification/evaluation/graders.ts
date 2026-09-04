import type { TaxonomyClassificationResolution } from "@capital-q/contracts";

import type { TaxonomyVersionSet } from "../../contracts/index.js";
import type { TaxonomyClassificationResult } from "../contracts/index.js";
import type { TaxonomyEvalFixture, TaxonomyNodeRef } from "./fixtures.js";

/**
 * Deterministic graders for the taxonomy golden eval (doc 24 §297).
 * Metrics: exact top-1, lexical top-1 / top-k, multi-label precision and
 * recall, ambiguity correctness, abstention correctness. Exact-match and
 * lexical results are reported separately so an exact-alias fixture set
 * can never be presented as natural-language accuracy. Code asserts the
 * hard invariants; nothing here calls a model.
 */

export type TaxonomyEvalGrade = {
  readonly fixtureId: string;
  readonly kind: TaxonomyEvalFixture["kind"];
  readonly resolution: TaxonomyClassificationResolution;
  readonly returned: readonly string[];
  readonly top1Hit: boolean | null;
  readonly topKHit: boolean | null;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly abstained: boolean;
  /** The hard invariant for this fixture kind held. */
  readonly passed: boolean;
};

const key = (ref: TaxonomyNodeRef): string => `${ref[0]}/${ref[1]}`;

export function gradeFixture(
  fixture: TaxonomyEvalFixture,
  result: TaxonomyClassificationResult,
): TaxonomyEvalGrade {
  const returned = result.candidates.map(
    (candidate) => `${candidate.vocabularyCode}/${candidate.canonicalCode}`,
  );
  const abstained = result.resolution === "ABSTAINED";
  const base = {
    fixtureId: fixture.id,
    kind: fixture.kind,
    resolution: result.resolution,
    returned,
    abstained,
  };

  switch (fixture.kind) {
    case "EXACT": {
      const expected = key(fixture.expected.top1);
      const top1Hit = returned[0] === expected;
      return {
        ...base,
        top1Hit,
        topKHit: returned.includes(expected),
        precision: null,
        recall: null,
        passed: top1Hit && result.resolution === "EXACT",
      };
    }
    case "LEXICAL": {
      const expected = key(fixture.expected.top1);
      const k = fixture.expected.k;
      const top1Hit = returned[0] === expected;
      const topKHit = returned.slice(0, k).includes(expected);
      return {
        ...base,
        top1Hit,
        topKHit,
        precision: null,
        recall: null,
        passed: topKHit && !abstained,
      };
    }
    case "MULTI_LABEL": {
      const relevant = new Set(fixture.expected.relevant.map(key));
      const hits = returned.filter((code) => relevant.has(code)).length;
      const precision = returned.length === 0 ? 0 : hits / returned.length;
      const recall = relevant.size === 0 ? 0 : hits / relevant.size;
      return {
        ...base,
        top1Hit: null,
        topKHit: null,
        precision,
        recall,
        passed: recall >= fixture.expected.minimumRecall && !abstained,
      };
    }
    case "AMBIGUOUS": {
      const expected = new Set(fixture.expected.among.map(key));
      const covered = [...expected].every((code) => returned.includes(code));
      return {
        ...base,
        top1Hit: null,
        topKHit: covered,
        precision: null,
        recall: null,
        passed: result.resolution === "AMBIGUOUS" && covered,
      };
    }
    case "ABSTAIN":
      return {
        ...base,
        top1Hit: null,
        topKHit: null,
        precision: null,
        recall: null,
        passed: abstained && returned.length === 0,
      };
  }
}

export type TaxonomyEvalReport = {
  readonly classifierVersion: string;
  readonly taxonomyVersionSet: TaxonomyVersionSet;
  readonly fixtureVersion: string;
  readonly fixtureCount: number;
  readonly exact: {
    readonly count: number;
    readonly top1Accuracy: number;
  };
  readonly lexical: {
    readonly count: number;
    readonly top1Accuracy: number;
    readonly topKAccuracy: number;
  };
  readonly multiLabel: {
    readonly count: number;
    readonly meanPrecision: number;
    readonly meanRecall: number;
  };
  readonly ambiguity: {
    readonly count: number;
    readonly correctlyAmbiguous: number;
  };
  readonly abstention: {
    readonly count: number;
    readonly correctAbstentions: number;
    /** Non-abstain fixtures the classifier abstained on anyway. */
    readonly falseAbstentions: number;
  };
  readonly failures: readonly string[];
  readonly grades: readonly TaxonomyEvalGrade[];
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 10_000) / 10_000;

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) *
          10_000,
      ) / 10_000;

export function summarizeEval(input: {
  readonly classifierVersion: string;
  readonly taxonomyVersionSet: TaxonomyVersionSet;
  readonly fixtureVersion: string;
  readonly grades: readonly TaxonomyEvalGrade[];
}): TaxonomyEvalReport {
  const { grades } = input;
  const of = (kind: TaxonomyEvalFixture["kind"]) =>
    grades.filter((grade) => grade.kind === kind);
  const exact = of("EXACT");
  const lexical = of("LEXICAL");
  const multi = of("MULTI_LABEL");
  const ambiguous = of("AMBIGUOUS");
  const abstain = of("ABSTAIN");
  return {
    classifierVersion: input.classifierVersion,
    taxonomyVersionSet: input.taxonomyVersionSet,
    fixtureVersion: input.fixtureVersion,
    fixtureCount: grades.length,
    exact: {
      count: exact.length,
      top1Accuracy: ratio(
        exact.filter((g) => g.top1Hit === true).length,
        exact.length,
      ),
    },
    lexical: {
      count: lexical.length,
      top1Accuracy: ratio(
        lexical.filter((g) => g.top1Hit === true).length,
        lexical.length,
      ),
      topKAccuracy: ratio(
        lexical.filter((g) => g.topKHit === true).length,
        lexical.length,
      ),
    },
    multiLabel: {
      count: multi.length,
      meanPrecision: mean(multi.map((g) => g.precision ?? 0)),
      meanRecall: mean(multi.map((g) => g.recall ?? 0)),
    },
    ambiguity: {
      count: ambiguous.length,
      correctlyAmbiguous: ambiguous.filter((g) => g.passed).length,
    },
    abstention: {
      count: abstain.length,
      correctAbstentions: abstain.filter((g) => g.passed).length,
      falseAbstentions: grades.filter(
        (g) => g.kind !== "ABSTAIN" && g.abstained,
      ).length,
    },
    failures: grades.filter((g) => !g.passed).map((g) => g.fixtureId),
    grades,
  };
}
