import type { UnicornPotentialDto } from "@capital-q/contracts";
import {
  INVESTOR_ELIGIBLE_SCOPES,
  type InvestabilityInputs,
} from "../investability/inputs.js";
import {
  UNICORN_PILLARS,
  UNICORN_WEAKNESS_RULES,
  type PillarId,
} from "./method-v1.js";
type Source =
  UnicornPotentialDto["pillars"][number]["criteria"][number]["sources"][number];
export type UnicornObservation = {
  readonly pillar: PillarId;
  readonly criterion: "A" | "B";
  readonly grade: number;
  readonly source: Source;
  readonly reliability: number;
  readonly stale: boolean;
  readonly conflicted: boolean;
  readonly rule: string;
};
const reliabilityOf = (s: Source): number =>
  s.truthClass === "Q_INFERENCE"
    ? 0.25
    : s.evidenceStatus === "PLATFORM_VERIFIED" ||
        s.evidenceStatus === "EXTERNALLY_VERIFIED"
      ? 1
      : s.evidenceStatus === "MULTI_SOURCE_SUPPORTED"
        ? 0.85
        : s.evidenceStatus === "DOCUMENT_SUPPORTED"
          ? 0.7
          : s.evidenceStatus === "SELF_REPORTED"
            ? 0.5
            : 0;
/** Admissible canonical sources only. Unconfirmed reads and transcripts remain Q inference. */
function sourcesOf(inputs: InvestabilityInputs): Source[] {
  if (!inputs.profile.listed) return [];
  const out: Source[] = [];
  for (const claim of inputs.claims) {
    if (
      !(INVESTOR_ELIGIBLE_SCOPES as readonly string[]).includes(
        claim.visibilityScope,
      ) ||
      claim.lifecycleStatus === "SUPERSEDED"
    )
      continue;
    out.push({
      id: claim.id,
      revision: claim.assertedAt,
      at: claim.assertedAt,
      kind: "CLAIM",
      label: claim.statement,
      truthClass: claim.truthClass,
      evidenceStatus: claim.evidenceStatus,
      visibilityScope:
        claim.visibilityScope === "public_external"
          ? "public_external"
          : "network_visible",
      lifecycleStatus: claim.lifecycleStatus,
    });
  }
  for (const founder of inputs.founders) {
    if (founder.visibilityScope !== "network_visible") continue;
    out.push({
      id: founder.id,
      revision: inputs.profile.updatedAt ?? "undated",
      at: inputs.profile.updatedAt,
      kind: "FOUNDER_BACKGROUND",
      label: `Founder ${founder.title} ${founder.detail ?? ""}`,
      truthClass: "USER_CLAIM",
      evidenceStatus: founder.documentSupported
        ? "DOCUMENT_SUPPORTED"
        : "SELF_REPORTED",
      visibilityScope: "network_visible",
      lifecycleStatus: "CURRENT",
    });
  }
  if (inputs.deck !== null) {
    for (const section of inputs.deck.sections) {
      if (section.status === "NOT_IN_DECK" || section.status === "UNCLEAR")
        continue;
      for (const [index, fact] of section.facts.entries()) {
        if (
          fact.value === null ||
          fact.unknownReason !== null ||
          fact.truthClass === "Q_INFERENCE"
        )
          continue;
        out.push({
          id: `${inputs.deck.extractionId}:${section.section}:${String(index)}`,
          revision: inputs.deck.readAt,
          at:
            fact.asOf !== null && Number.isFinite(Date.parse(fact.asOf))
              ? new Date(fact.asOf).toISOString()
              : null,
          kind: "DECK_SECTION",
          label: `${fact.label}: ${fact.value}`,
          truthClass: fact.truthClass,
          evidenceStatus: fact.evidenceStatus,
          visibilityScope: "network_visible",
          lifecycleStatus:
            section.status === "CONTRADICTORY" ? "CONTRADICTORY" : "CURRENT",
        });
      }
    }
  }
  return out.sort(
    (a, b) => a.id.localeCompare(b.id) || a.revision.localeCompare(b.revision),
  );
}
/** Three anchored semantic rules per criterion; no grade for mere topic/presence. */
export function observeUnicornPotential(
  inputs: InvestabilityInputs,
  asOf: string,
): readonly UnicornObservation[] {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error("Invalid assessment timestamp");
  const out: UnicornObservation[] = [];
  for (const source of sourcesOf(inputs)) {
    const quality = reliabilityOf(source);
    if (
      quality === 0 ||
      source.truthClass === "Q_INFERENCE" ||
      source.truthClass === "UNKNOWN"
    )
      continue;
    for (const pillar of UNICORN_PILLARS) {
      for (const [index, criterion] of pillar.criteria.entries()) {
        const text = source.label.slice(0, 4000);
        // Forecasts may support only the explicitly forecast-labelled limited rule.
        const forecast =
          /\b(forecast|projection|projected|target|planned)\b/iu.test(text);
        const adverse = criterion.adverse.test(text) && !forecast;
        const weakness =
          UNICORN_WEAKNESS_RULES[pillar.id][index === 0 ? 0 : 1].test(text) &&
          !forecast;
        const limited = criterion.limited.test(text);
        const positive =
          criterion.positive.test(text) &&
          !forecast &&
          !/\b(no|not|never|unproven|unverified)\b/iu.test(text);
        if (!adverse && !weakness && !limited && !positive) continue;
        const date = source.at === null ? NaN : Date.parse(source.at);
        const periodYears =
          pillar.id === "P4"
            ? [...text.matchAll(/\b(20\d\d)\b/gu)].map((m) => Number(m[1]))
            : [];
        const oldPeriod =
          periodYears.length > 0 &&
          Math.max(...periodYears) < new Date(now).getUTCFullYear();
        const stale =
          oldPeriod ||
          source.lifecycleStatus === "STALE" ||
          !Number.isFinite(date) ||
          date > now ||
          now - date > criterion.freshnessDays * 86400000;
        const sustained =
          /\b(sustained|repeated|consecutive)\b/iu.test(text) &&
          /\b(?:20\d\d|\d+ (?:months|quarters|years))\b/iu.test(text);
        const documented = quality >= 0.85;
        const grade = adverse
          ? 0
          : weakness
            ? 1
            : positive
              ? sustained && documented
                ? 4
                : 3
              : 2;
        out.push({
          pillar: pillar.id,
          criterion: index === 0 ? "A" : "B",
          grade: quality <= 0.5 ? Math.min(3, grade) : grade,
          source,
          reliability: stale ? quality * 0.5 : quality,
          stale,
          conflicted:
            source.lifecycleStatus === "DISPUTED" ||
            source.lifecycleStatus === "CONTRADICTORY" ||
            ((adverse || weakness) && positive),
          rule: `${pillar.id}.${index === 0 ? "A" : "B"}.${adverse ? "adverse" : weakness ? "weakness" : positive ? "demonstrated" : "limited"}`,
        });
      }
    }
  }
  return out;
}
