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

/**
 * The display names a reader knows these codes by: the taxonomy's and the
 * onboarding definition's own labels, supplied by composition (this module
 * holds no vocabulary). A code no labeller knows is said as words, never
 * as a raw code.
 */
export type MandateLabels = {
  /** A taxonomy or definition code, optionally within a vocabulary. */
  readonly code: (code: string, vocabularyCode?: string) => string | undefined;
  readonly investorType: (code: string) => string | undefined;
  readonly deploymentState: (code: string) => string | undefined;
};

const NO_LABELS: MandateLabels = {
  code: () => undefined,
  investorType: () => undefined,
  deploymentState: () => undefined,
};

/** The last resort for a code nothing labels: words, not snake case. */
function words(code: string): string {
  const spaced = code.replace(/_/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Which vocabulary a constraint dimension's codes come from, when known. */
const DIMENSION_VOCABULARY: Readonly<Record<string, string>> = {
  stage: "company_stage",
  "geography.country": "geography",
  sector: "industry",
};

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

function valueOf(
  constraint: Constraint,
  label: (code: string, vocabulary?: string) => string,
): string {
  const value = constraint.value;
  const vocabulary = DIMENSION_VOCABULARY[constraint.dimension];
  switch (value.kind) {
    case "codes":
      return value.values.map((code) => label(code, vocabulary)).join(", ");
    case "amount":
      return amount(value.amount, value.currency);
    case "text":
      return value.text;
  }
}

/** One declared constraint as a sentence: its value, then how it counts. */
function sentence(text: string, how: string): string {
  // Free text is the person's own words: their full stop stays theirs, and
  // how the preference counts is said apart from it, never inside it.
  const trimmed = text.trim().replace(/[.!?]+$/, "");
  return `${trimmed} (${how}).`;
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
  labels: MandateLabels = NO_LABELS,
): OwnMandateDocument | null {
  const label = (code: string, vocabulary?: string): string =>
    labels.code(code, vocabulary) ?? words(code);
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
      : [
          `Invests as: ${labels.investorType(record.investorType) ?? words(record.investorType)}.`,
        ]),
    ...(record.deploymentState === null
      ? []
      : [
          `Deploying capital: ${labels.deploymentState(record.deploymentState) ?? words(record.deploymentState)}.`,
        ]),
    ...(mandate.discoveryMode === null
      ? []
      : [
          `Discovery: ${label(mandate.discoveryMode.toLowerCase(), "discovery_mode")}.`,
        ]),
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
        ? `${label(minStageCode, "company_stage")} to ${label(maxStageCode, "company_stage")}`
        : label(minStageCode ?? maxStageCode ?? "", "company_stage");
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
      .map((c) => sentence(valueOf(c, label), strength(c)))
      .join(" ")
      .slice(0, 6_000);
    sections.push({
      heading: DIMENSION_HEADINGS[dimension] ?? words(dimension),
      body,
      findings: [],
    });
  }
  // A dimension is stated whether it was filed as a constraint or as a
  // taxonomy preference in that vocabulary: absence in one is not absence.
  const preferredIn = (vocabulary: string) =>
    mandate.taxonomyPreferences.some((p) => p.vocabularyCode === vocabulary);
  if (!byDimension.has("geography.country") && !preferredIn("geography")) {
    gaps.push("Geography is not yet stated.");
  }
  const sectorVocabularies = new Set(["industry", "product_category"]);
  if (
    !byDimension.has("sector") &&
    !mandate.taxonomyPreferences.some((p) =>
      sectorVocabularies.has(p.vocabularyCode),
    )
  ) {
    gaps.push("Sectors are not yet stated.");
  }

  const preferred = mandate.taxonomyPreferences.filter((p) => !p.isExclusion);
  const excluded = mandate.taxonomyPreferences.filter((p) => p.isExclusion);
  if (preferred.length > 0) {
    sections.push({
      heading: "Categories they back",
      body: `${preferred.map((p) => label(p.canonicalCode, p.vocabularyCode)).join(", ")}.`,
      findings: [],
    });
  }
  if (excluded.length > 0) {
    sections.push({
      heading: "Categories excluded",
      body: `${excluded.map((p) => label(p.canonicalCode, p.vocabularyCode)).join(", ")}.`,
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
