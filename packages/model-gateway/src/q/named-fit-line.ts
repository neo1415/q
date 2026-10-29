import {
  FIT_PARAMETER_LABELS,
  FitProfileDtoSchema,
  fitScoreOutOf10,
  type FitProfileDto,
} from "@capital-q/contracts";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import { itemsOf, nameKey } from "./named-company-fact.js";

/**
 * Stress 2026-10-28 (J3): "find eligible seed-stage B2B fintech
 * opportunities in my geographies, and tell me whether LedgerBridge
 * qualifies and why" came back as the ranked cards alone; the named
 * company was never answered. When a list question also names a company
 * the list does not hold, code answers that half from Capital Q's own fit
 * for it, read through the same tools and plan: the criteria it meets,
 * misses and leaves unknown. Where Capital Q cannot show a fit for it, that
 * is said plainly, never guessed.
 */

const SEARCH = "search_companies";
const FIT = "fit_profile";
const COMPANY = "get_company";

type MandateRead = {
  readonly status?: unknown;
  readonly stage?: {
    readonly minStageCode?: unknown;
    readonly maxStageCode?: unknown;
  };
  readonly taxonomyPreferences?: unknown;
};

type Preference = {
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly isExclusion: boolean;
};

/** Their active mandate, from get_investor_mandate's output; null: none. */
function activeMandate(data: unknown): MandateRead | null {
  if (typeof data !== "object" || data === null) return null;
  const mandates: unknown = Reflect.get(data, "mandates");
  if (!Array.isArray(mandates)) return null;
  for (const entry of mandates as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const mandate = entry as MandateRead;
    if (mandate.status === "ACTIVE") return mandate;
  }
  return null;
}

function preferencesOf(mandate: MandateRead): readonly Preference[] {
  const list = mandate.taxonomyPreferences;
  if (!Array.isArray(list)) return [];
  return (list as readonly unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const vocabularyCode: unknown = Reflect.get(entry, "vocabularyCode");
    const canonicalCode: unknown = Reflect.get(entry, "canonicalCode");
    const isExclusion: unknown = Reflect.get(entry, "isExclusion");
    return typeof vocabularyCode === "string" &&
      typeof canonicalCode === "string"
      ? [{ vocabularyCode, canonicalCode, isExclusion: isExclusion === true }]
      : [];
  });
}

const words = (code: string) => code.replace(/_/gu, " ").toLowerCase();

function countryName(code: string): string | null {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Stress 2026-10-28 (J3): a named company that is not in their Discover
 * (not eligible yet, so no ranked fit) still gets a line, set by code
 * against their declared mandate: its stage and country against the
 * mandate's, and what is unknown. Sector is never inferred: where the
 * company's declared sectors are not on the record shown to them, it is
 * said to be unknown. This is not Capital Q's fit score; nothing is scored.
 */
export function declaredCriteriaSentence(input: {
  readonly name: string;
  readonly company: {
    readonly currentStageCode?: unknown;
    readonly headquartersCountry?: unknown;
  };
  readonly mandate: unknown;
}): string | null {
  const mandate = activeMandate(input.mandate);
  if (mandate === null) return null;
  const met: string[] = [];
  const missed: string[] = [];
  const unknown: string[] = [];
  const stage =
    typeof input.company.currentStageCode === "string"
      ? input.company.currentStageCode
      : null;
  const min =
    typeof mandate.stage?.minStageCode === "string"
      ? mandate.stage.minStageCode
      : null;
  const max =
    typeof mandate.stage?.maxStageCode === "string"
      ? mandate.stage.maxStageCode
      : null;
  if (min !== null || max !== null) {
    if (stage === null) unknown.push("its stage");
    else if (stage === min || stage === max)
      met.push(`stage (${words(stage)})`);
    else if (min !== null && min === max)
      missed.push(`stage (${words(stage)}; your mandate is ${words(min)})`);
    else
      unknown.push(
        `whether its stage (${words(stage)}) sits in your ${words(min ?? "any")} to ${words(max ?? "any")} range`,
      );
  }
  const preferences = preferencesOf(mandate);
  const geographies = preferences.filter(
    (p) => p.vocabularyCode === "geography" && !p.isExclusion,
  );
  if (geographies.length > 0) {
    const country =
      typeof input.company.headquartersCountry === "string"
        ? countryName(input.company.headquartersCountry)
        : null;
    if (country === null) unknown.push("where it is based");
    else if (
      geographies.some((g) => words(g.canonicalCode) === country.toLowerCase())
    )
      met.push(`geography (based in ${country})`);
    else missed.push(`geography (based in ${country})`);
  }
  const sectors = preferences.filter((p) => p.vocabularyCode === "industry");
  if (sectors.length > 0) {
    const wanted = sectors
      .filter((p) => !p.isExclusion)
      .map((p) => words(p.canonicalCode));
    const excluded = sectors
      .filter((p) => p.isExclusion)
      .map((p) => words(p.canonicalCode));
    unknown.push(
      `its sector against yours (${[
        ...(wanted.length === 0 ? [] : [wanted.join(", ")]),
        ...(excluded.length === 0
          ? []
          : [`your exclusion: ${excluded.join(", ")}`]),
      ].join("; ")}), which the record shown to you does not declare`,
    );
  }
  const parts = [
    `${input.name} is not in your ranked recommendations yet (it is not eligible for Discover, for example until its verification is complete), so Capital Q has no fit score for it. Against your declared mandate:`,
    met.length === 0 ? null : `it meets ${met.join(" and ")}.`,
    missed.length === 0 ? null : `It misses on ${missed.join(" and ")}.`,
    unknown.length === 0
      ? null
      : `Not known: ${unknown.join("; ")}. Unknown is not a mismatch.`,
  ];
  return parts.filter((part): part is string => part !== null).join(" ");
}

/** The plain sentence for one fit profile: met, missed, unknown. */
export function namedFitSentence(name: string, profile: FitProfileDto): string {
  const pick = (keep: (outcome: string) => boolean) =>
    profile.parameters
      .filter((p) => p.applicable && keep(p.outcome))
      .map((p) => FIT_PARAMETER_LABELS[p.parameter].toLowerCase());
  const met = pick((o) => o === "STRONG" || o === "PARTIAL");
  const missed = profile.parameters.filter(
    (p) => p.applicable && p.outcome === "MISMATCH",
  );
  const unknown = pick((o) => o === "UNKNOWN");
  const score = fitScoreOutOf10(profile);
  const parts = [
    `${name}: Capital Q mandate fit ${score === null ? "not scored yet" : `${score}/10`}.`,
    met.length === 0 ? null : `It meets your mandate on ${met.join(", ")}.`,
    missed.length === 0
      ? "Nothing in your mandate rules it out."
      : `It misses on ${missed
          .map(
            (p) =>
              `${FIT_PARAMETER_LABELS[p.parameter].toLowerCase()} (${p.reason.replace(/[.\s]+$/u, "")})`,
          )
          .join("; ")}.`,
    unknown.length === 0
      ? null
      : `Not known yet: ${unknown.join(", ")}; unknown is not a mismatch.`,
  ];
  return parts.filter((part): part is string => part !== null).join(" ");
}

export async function namedCompanyFitLine(input: {
  readonly name: string;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  /** Their own get_investor_mandate read for this run, when it was made. */
  readonly mandate?: unknown;
}): Promise<string | null> {
  const { name, tools, context, available } = input;
  if (!available.has(SEARCH) || !available.has(FIT)) return null;
  const found: QToolCallOutcome | null = await tools
    .execute(
      {
        callId: "q-named-fit-search",
        name: SEARCH,
        arguments: { query: name, limit: 5 },
      },
      context,
    )
    .catch(() => null);
  const exact = (itemsOf(found) ?? []).filter(
    (item) => nameKey(item.canonicalName) === nameKey(name),
  );
  if (exact.length !== 1 || exact[0] === undefined) {
    return `${name}: I couldn't find exactly one company of that name on Capital Q, so I can't say whether it qualifies.`;
  }
  const { companyId, canonicalName } = exact[0];
  const fit = await tools
    .execute(
      { callId: "q-named-fit", name: FIT, arguments: { companyId } },
      context,
    )
    .catch(() => null);
  const data: unknown = fit?.result.ok === true ? fit.result.data : null;
  const status =
    typeof data === "object" && data !== null
      ? (data as { readonly status?: unknown }).status
      : null;
  const profile = FitProfileDtoSchema.safeParse(
    typeof data === "object" && data !== null
      ? (data as { readonly profile?: unknown }).profile
      : null,
  );
  if (status === "OK" && profile.success) {
    return namedFitSentence(canonicalName, profile.data);
  }
  // No ranked fit: their declared mandate against its record, by code.
  if (input.mandate !== undefined && available.has(COMPANY)) {
    const record = await tools
      .execute(
        {
          callId: "q-named-fit-company",
          name: COMPANY,
          arguments: { companyId },
        },
        context,
      )
      .catch(() => null);
    const company: unknown =
      record?.result.ok === true ? record.result.data : null;
    const line =
      typeof company === "object" && company !== null
        ? declaredCriteriaSentence({
            name: canonicalName,
            company,
            mandate: input.mandate,
          })
        : null;
    if (line !== null) return line;
  }
  return `${canonicalName} is not in this ranking, and Capital Q has no fit for it that it can show you: a company enters your ranked recommendations only once it is eligible for Discover (for example, after its verification is complete). So whether it qualifies for your mandate can't be confirmed from Capital Q's fit yet; its profile is open if you want me to go through what it states.`;
}
