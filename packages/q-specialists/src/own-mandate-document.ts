import type { QArtifactContent } from "@capital-q/contracts";
import type { GetInvestorMandateOutput } from "@capital-q/q-tools";

/**
 * A document of the person's OWN investment mandate, built from their
 * authoritative record (gap 3; ACC 2026-09-25: "give me my mandate as a
 * PDF" was answered "which company?" or "mandate in progress").
 *
 * Deterministic: every sentence states a value on their record, in their
 * record's own terms, and nothing is written that the record does not
 * hold. A mandate still being defined is marked as a draft in the title
 * and the summary, never presented as final. What the record leaves open
 * is listed as not yet stated, never filled in: unknown stays unknown.
 *
 * Money stays the exact decimal string the record holds.
 */

export const OWN_MANDATE_ARTIFACT_TYPE = "INVESTOR_MANDATE";

type Mandate = GetInvestorMandateOutput["mandates"][number];
type Constraint = Mandate["constraints"][number];

const DIMENSION_HEADINGS: Readonly<Record<string, string>> = {
  stage: "Stages",
  "geography.country": "Geography",
  sector: "Sectors",
  "business.attribute": "Business characteristics",
  "founder.business_attribute": "Founding team",
  green_flag: "What they look for",
  red_flag: "What they avoid",
  investment_role: "How they take part",
  "custom.text": "In their own words",
};

/** A code as a reader would say it: words, not snake case. */
function words(code: string): string {
  const spaced = code.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function amount(value: string, currency: string): string {
  const [whole = "0", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency.toUpperCase()} ${fraction === undefined ? grouped : `${grouped}.${fraction}`}`;
}

function strength(constraint: Constraint): string {
  if (constraint.isHardExclusion) return "never shown";
  switch (constraint.importance) {
    case "MUST":
      return "must match";
    case "STRONG":
      return "strong preference";
    case "NICE":
      return "nice to have";
    case "NEUTRAL":
      return "no preference";
    case "AVOID":
      return "ranked lower";
    case "HARD_EXCLUSION":
      return "never shown";
  }
}

function valueOf(constraint: Constraint): string {
  const value = constraint.value;
  switch (value.kind) {
    case "codes":
      return value.values.map(words).join(", ");
    case "amount":
      return amount(value.amount, value.currency);
    case "text":
      return value.text;
  }
}

export type OwnMandateDocument = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
  readonly draft: boolean;
};

/**
 * The document, or null when the record holds no mandate at all (then
 * there is nothing to build, and the caller says so).
 */
export function composeOwnMandateDocument(
  record: GetInvestorMandateOutput,
): OwnMandateDocument | null {
  // The active mandate when there is one; otherwise the one being defined.
  const mandate =
    record.mandates.find((m) => m.status === "ACTIVE") ?? record.mandates[0];
  if (mandate === undefined) return null;
  const draft = mandate.status !== "ACTIVE";
  const name = record.displayName.trim() || "Your organisation";
  const title = `${name}: investment mandate${draft ? " (draft)" : ""}`.slice(
    0,
    160,
  );

  const sections: QArtifactContent["sections"] = [];
  const gaps: string[] = [];

  const profile = [
    ...(record.investorType === null
      ? []
      : [`Invests as: ${words(record.investorType)}.`]),
    ...(record.deploymentState === null
      ? []
      : [`Deploying capital: ${words(record.deploymentState)}.`]),
    ...(mandate.discoveryMode === null
      ? []
      : [`Discovery: ${words(mandate.discoveryMode.toLowerCase())}.`]),
  ];
  if (profile.length > 0) {
    sections.push({
      heading: "Profile",
      body: profile.join(" "),
      findings: [],
    });
  }
  if (record.investorType === null)
    gaps.push("How they invest is not yet stated.");
  if (record.deploymentState === null) {
    gaps.push("Whether they are deploying capital is not yet stated.");
  }

  const cheque = mandate.cheque;
  const chequeLines =
    cheque === null
      ? []
      : [
          ...(cheque.min === undefined
            ? []
            : [`Minimum ${amount(cheque.min, cheque.currency)}.`]),
          ...(cheque.typical === undefined
            ? []
            : [`Typical ${amount(cheque.typical, cheque.currency)}.`]),
          ...(cheque.max === undefined
            ? []
            : [`Maximum ${amount(cheque.max, cheque.currency)}.`]),
        ];
  if (chequeLines.length > 0) {
    sections.push({
      heading: "Cheque",
      body: chequeLines.join(" "),
      findings: [],
    });
  } else {
    gaps.push("Cheque size is not yet stated.");
  }

  const { minStageCode, maxStageCode } = mandate.stage;
  const stageConstraints = mandate.constraints.filter(
    (c) => c.dimension === "stage",
  );
  if (minStageCode !== null || maxStageCode !== null) {
    const range =
      minStageCode !== null &&
      maxStageCode !== null &&
      minStageCode !== maxStageCode
        ? `${words(minStageCode)} to ${words(maxStageCode)}`
        : words(minStageCode ?? maxStageCode ?? "");
    sections.push({ heading: "Stages", body: `${range}.`, findings: [] });
  } else if (stageConstraints.length === 0) {
    gaps.push("Stages are not yet stated.");
  }

  const byDimension = new Map<string, Constraint[]>();
  for (const constraint of mandate.constraints) {
    if (constraint.dimension === "cheque.typical") continue;
    if (
      constraint.dimension === "stage" &&
      (minStageCode !== null || maxStageCode !== null)
    ) {
      continue;
    }
    const list = byDimension.get(constraint.dimension) ?? [];
    list.push(constraint);
    byDimension.set(constraint.dimension, list);
  }
  for (const [dimension, list] of byDimension) {
    const body = list
      .map((c) => `${valueOf(c)} (${strength(c)}).`)
      .join(" ")
      .slice(0, 6_000);
    sections.push({
      heading: DIMENSION_HEADINGS[dimension] ?? words(dimension),
      body,
      findings: [],
    });
  }
  if (!byDimension.has("geography.country")) {
    gaps.push("Geography is not yet stated.");
  }
  if (!byDimension.has("sector") && mandate.taxonomyPreferences.length === 0) {
    gaps.push("Sectors are not yet stated.");
  }

  const preferred = mandate.taxonomyPreferences.filter((p) => !p.isExclusion);
  const excluded = mandate.taxonomyPreferences.filter((p) => p.isExclusion);
  if (preferred.length > 0) {
    sections.push({
      heading: "Categories they back",
      body: `${preferred.map((p) => words(p.canonicalCode)).join(", ")}.`,
      findings: [],
    });
  }
  if (excluded.length > 0) {
    sections.push({
      heading: "Categories excluded",
      body: `${excluded.map((p) => words(p.canonicalCode)).join(", ")}.`,
      findings: [],
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: "Mandate",
      body: "Nothing is stated on this mandate yet.",
      findings: [],
    });
  }

  const summary = (
    draft
      ? `A draft: the mandate ${name} is still defining on Capital Q, as it stands now. Everything here is as they declared it.`
      : `The investment mandate ${name} declared on Capital Q. Everything here is as they declared it.`
  ).slice(0, 600);

  return {
    title,
    summary,
    draft,
    content: { sections: sections.slice(0, 24), gaps: gaps.slice(0, 24) },
  };
}
