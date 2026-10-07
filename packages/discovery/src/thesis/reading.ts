import {
  ThesisReadingDtoSchema,
  type InvestorMandateDto,
  type ThesisObservedCount,
  type ThesisReadingDto,
  type ThesisSuggestion,
  type UpdateInvestorMandateRequest,
} from "@capital-q/contracts";

import { STAGE_LADDER } from "../domain/fit.js";

/**
 * Q.02 "How Q reads your thesis" (2026-10-07).
 *
 * Declared rules, observed behaviour and Q's inference, kept apart. Pure
 * and deterministic: the same mandate and decisions always read the same,
 * no model is called, and nothing here writes. Observed behaviour NEVER
 * rewrites the declared mandate: a suggestion is a proposed edit the
 * investor approves (or not); `thesisSuggestionPatch` turns an approved
 * one into the ordinary mandate update, at the version they read.
 *
 * Only saves and passes count. Viewing is not interest and is not read;
 * a save is "come back to this", never interest.
 */

export type ThesisDecision = {
  readonly decision: "SAVED" | "PASSED";
  readonly stageCode: string | null;
  /** ISO 3166-1 alpha-2, any case. */
  readonly country: string | null;
};

export type ThesisMandate = Pick<
  InvestorMandateDto,
  | "id"
  | "version"
  | "minStageCode"
  | "maxStageCode"
  | "chequeRange"
  | "constraints"
  | "taxonomyPreferences"
>;

/** Thresholds: below these, behaviour is too thin to suggest anything. */
export const THESIS_RULES = Object.freeze({
  version: "thesis-reading.v1",
  /** Saves from one undeclared country before Q suggests adding it. */
  addCountryMinSaves: 2,
  /** Passes at the declared earliest stage before Q suggests dropping it. */
  dropStageMinPasses: 4,
  /** ...and passes at least this many times the saves there. */
  dropStagePassRatio: 4,
});

const words = (code: string) => code.replace(/_/g, " ");

export function stageWords(code: string): string {
  if (code.startsWith("series_")) {
    const rest = code.slice("series_".length).replace(/_plus$/, "+");
    return `Series ${rest.toUpperCase()}`;
  }
  const text = words(code).replace(/^pre seed$/, "pre-seed");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const REGIONS = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export function countryWords(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return code;
  try {
    return REGIONS?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

const listWords = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

type Geography = {
  readonly included: ReadonlySet<string> | null;
  readonly excluded: ReadonlySet<string>;
};

function geographyOf(mandate: ThesisMandate): Geography {
  let included: Set<string> | null = null;
  const excluded = new Set<string>();
  for (const constraint of mandate.constraints) {
    if (constraint.dimension !== "geography.country") continue;
    if (constraint.value.kind !== "codes") continue;
    const codes = constraint.value.values.map((v) => v.toUpperCase());
    if (
      constraint.isHardExclusion ||
      constraint.operator === "NOT_IN" ||
      constraint.operator === "NEQ"
    ) {
      for (const code of codes) excluded.add(code);
    } else if (constraint.operator === "IN" || constraint.operator === "EQ") {
      included ??= new Set();
      for (const code of codes) included.add(code);
    }
  }
  return { included, excluded };
}

function declaredRules(mandate: ThesisMandate): ThesisReadingDto["declared"] {
  const rules: { label: string; value: string }[] = [];
  const { minStageCode: min, maxStageCode: max } = mandate;
  if (min !== null || max !== null) {
    rules.push({
      label: "Stage",
      value:
        min !== null && max !== null
          ? min === max
            ? stageWords(min)
            : `${stageWords(min)} to ${stageWords(max)}`
          : min !== null
            ? `${stageWords(min)} and later`
            : `Up to ${stageWords(max ?? "")}`,
    });
  }
  const geography = geographyOf(mandate);
  if (geography.included !== null) {
    rules.push({
      label: "Countries",
      value: listWords([...geography.included].map(countryWords)),
    });
  }
  const sectors = mandate.taxonomyPreferences
    .filter((p) => !p.isExclusion && p.preferenceStrength !== "AVOID")
    .map((p) => words(p.canonicalCode));
  if (sectors.length > 0) {
    rules.push({ label: "Sectors", value: listWords(sectors.slice(0, 6)) });
  }
  const cheque = mandate.chequeRange;
  if (cheque !== null && (cheque.min !== undefined || cheque.max !== undefined)) {
    rules.push({
      label: "Cheque",
      value:
        cheque.min !== undefined && cheque.max !== undefined
          ? `${cheque.currency} ${cheque.min} to ${cheque.max}`
          : cheque.min !== undefined
            ? `${cheque.currency} ${cheque.min} or more`
            : `Up to ${cheque.currency} ${cheque.max ?? ""}`,
    });
  }
  const never = [
    ...[...geography.excluded].map(countryWords),
    ...mandate.taxonomyPreferences
      .filter((p) => p.isExclusion)
      .map((p) => words(p.canonicalCode)),
  ];
  if (never.length > 0) {
    rules.push({ label: "Never", value: listWords(never.slice(0, 6)) });
  }
  return rules.map((rule) => ({ ...rule, value: rule.value.slice(0, 300) }));
}

function countsOf(decisions: readonly ThesisDecision[]): ThesisObservedCount[] {
  const tally = new Map<string, ThesisObservedCount>();
  const bump = (
    decision: ThesisDecision["decision"],
    dimension: ThesisObservedCount["dimension"],
    value: string,
    label: string,
  ) => {
    const key = `${decision}|${dimension}|${value}`;
    const prior = tally.get(key);
    tally.set(key, {
      decision,
      dimension,
      value,
      label,
      count: (prior?.count ?? 0) + 1,
    });
  };
  for (const d of decisions) {
    if (d.stageCode !== null && d.stageCode.length > 0) {
      bump(d.decision, "STAGE", d.stageCode, stageWords(d.stageCode));
    }
    if (d.country !== null && /^[A-Za-z]{2}$/.test(d.country)) {
      const code = d.country.toUpperCase();
      bump(d.decision, "COUNTRY", code, countryWords(code));
    }
  }
  return [...tally.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.decision.localeCompare(b.decision) ||
        a.value.localeCompare(b.value),
    )
    .slice(0, 24);
}

const countOf = (
  counts: readonly ThesisObservedCount[],
  decision: ThesisDecision["decision"],
  dimension: ThesisObservedCount["dimension"],
  value: string,
) =>
  counts.find(
    (c) =>
      c.decision === decision && c.dimension === dimension && c.value === value,
  )?.count ?? 0;

export function readThesis(input: {
  readonly mandate: ThesisMandate | null;
  readonly decisions: readonly ThesisDecision[];
  readonly now: Date;
}): ThesisReadingDto {
  const { mandate, decisions } = input;
  const counts = countsOf(decisions);
  const saved = decisions.filter((d) => d.decision === "SAVED").length;
  const passed = decisions.length - saved;
  const inferred: string[] = [];
  const suggestions: ThesisSuggestion[] = [];

  if (mandate !== null) {
    const geography = geographyOf(mandate);
    if (geography.included !== null) {
      const outside = counts.filter(
        (c) =>
          c.decision === "SAVED" &&
          c.dimension === "COUNTRY" &&
          c.count >= THESIS_RULES.addCountryMinSaves &&
          geography.included?.has(c.value) === false &&
          !geography.excluded.has(c.value),
      );
      for (const c of outside.slice(0, 2)) {
        inferred.push(
          `You save companies in ${c.label}, though ${c.label} isn't in your declared countries.`,
        );
        suggestions.push({
          id: `ADD_COUNTRY:${c.value}`,
          kind: "ADD_COUNTRY",
          value: c.value,
          title: `Add ${c.label} to your countries?`,
          because: `You saved ${String(c.count)} companies in ${c.label}, outside the countries you declared.`,
          effect: `Your feed would start including companies in ${c.label}.`,
          truthClass: "Q_INFERENCE",
        });
      }
    }
    const min = mandate.minStageCode;
    const ladder = STAGE_LADDER as readonly string[];
    const at = min === null ? -1 : ladder.indexOf(min);
    const next = at < 0 ? undefined : ladder[at + 1];
    const maxAt =
      mandate.maxStageCode === null
        ? ladder.length - 1
        : ladder.indexOf(mandate.maxStageCode);
    if (min !== null && next !== undefined && at < maxAt) {
      const passes = countOf(counts, "PASSED", "STAGE", min);
      const saves = countOf(counts, "SAVED", "STAGE", min);
      if (
        passes >= THESIS_RULES.dropStageMinPasses &&
        passes >= THESIS_RULES.dropStagePassRatio * saves
      ) {
        const label = stageWords(min);
        inferred.push(
          `You pass on most ${label.toLowerCase()} companies, the earliest stage you declared.`,
        );
        suggestions.push({
          id: `DROP_STAGE:${min}`,
          kind: "DROP_STAGE",
          value: min,
          title: `Start your stages at ${stageWords(next).toLowerCase()}?`,
          because: `You passed ${String(passes)} of ${String(passes + saves)} ${label.toLowerCase()} companies you decided on.`,
          effect: `${label} companies would leave your feed.`,
          truthClass: "Q_INFERENCE",
        });
      }
    }
  }
  if (inferred.length === 0 && decisions.length > 0) {
    inferred.push(
      "What you save and pass lines up with what you declared. Q has nothing to suggest.",
    );
  }

  return ThesisReadingDtoSchema.parse({
    mandateId: mandate?.id ?? null,
    mandateVersion: mandate?.version ?? null,
    declared: mandate === null ? [] : declaredRules(mandate),
    observed: { saved, passed, counts },
    inferred: inferred.slice(0, 4),
    suggestions: suggestions.slice(0, 4),
    computedAt: input.now.toISOString(),
  });
}

/**
 * The mandate edit an approved suggestion makes, as the ordinary update
 * request at the version the investor read. Null when the suggestion no
 * longer applies to this mandate (already done, or the rule it edits is
 * gone): the caller says so and changes nothing.
 */
export function thesisSuggestionPatch(
  mandate: ThesisMandate,
  suggestionId: string,
  expectedVersion: number,
): UpdateInvestorMandateRequest | null {
  const [kind, value] = suggestionId.split(":");
  if (value === undefined || value.length === 0) return null;
  if (kind === "DROP_STAGE") {
    const ladder = STAGE_LADDER as readonly string[];
    if (mandate.minStageCode !== value) return null;
    const next = ladder[ladder.indexOf(value) + 1];
    if (next === undefined) return null;
    return { expectedVersion, minStageCode: next };
  }
  if (kind === "ADD_COUNTRY") {
    const code = value.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    const index = mandate.constraints.findIndex(
      (c) =>
        c.dimension === "geography.country" &&
        !c.isHardExclusion &&
        (c.operator === "IN" || c.operator === "EQ") &&
        c.value.kind === "codes",
    );
    const target = mandate.constraints[index];
    if (target === undefined || target.value.kind !== "codes") return null;
    // Declared codes keep the case the mandate stores them in.
    const lower = target.value.values.every((v) => v === v.toLowerCase());
    if (target.value.values.some((v) => v.toUpperCase() === code)) return null;
    const constraints = mandate.constraints.map((c, i) => {
      const { id: _id, ...rest } = c;
      if (i !== index || rest.value.kind !== "codes") return rest;
      return {
        ...rest,
        operator: "IN" as const,
        value: {
          kind: "codes" as const,
          values: [...rest.value.values, lower ? code.toLowerCase() : code],
        },
      };
    });
    return { expectedVersion, constraints };
  }
  return null;
}
