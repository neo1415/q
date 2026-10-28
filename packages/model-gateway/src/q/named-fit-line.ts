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
  return `${canonicalName} is not in this ranking, and Capital Q has no fit for it that it can show you: a company enters your ranked recommendations only once it is eligible for Discover (for example, after its verification is complete). So whether it qualifies for your mandate can't be confirmed from Capital Q's fit yet; its profile is open if you want me to go through what it states.`;
}
