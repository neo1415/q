import type {
  QArtifactContent,
  QArtifactSection,
  QPublicFinding,
} from "@capital-q/contracts";
import {
  COMPANY_INTELLIGENCE_DIMENSIONS,
  type CompanyIntelligenceDimension,
} from "@capital-q/q-core";

import type { CompanyFinding, CompanyIntelligenceResult } from "./contracts.js";

/**
 * The investment brief Q composes (QX-003D; ADR 0013).
 *
 * Composed, not written by a model from scratch. Every sentence in a
 * section comes from a finding the specialist already produced under the
 * run's authorised plan — the same findings a person reads in the answer,
 * carrying the same truth class, evidence status and confidence they
 * carried there. Nothing is added to make a section look finished.
 *
 * That is the whole design, and it is deliberate. A brief is the document
 * somebody sends to an investor, so it is the last place to let a model
 * write a plausible number. The model's contribution is the synthesis the
 * specialist already validated, and it appears once, as the opening
 * paragraph, after a grounding check that refuses any figure the record
 * does not carry.
 *
 * What is absent is as important as what is here:
 *
 * **No fabricated facts.** A dimension the record is silent on produces no
 * section. It produces a gap, in the person's own document, saying what is
 * missing — because "unknown" is information an investor should see and
 * an empty heading is not.
 *
 * **No scores.** There is no readiness number, no rating and no percentage
 * anywhere in a brief, because Capital Q computes none and a document is
 * exactly where an invented one would survive longest.
 *
 * **No canonical truth.** Composing this changes nothing about the
 * company. A statement here stays a statement here.
 */

/** The heading each dimension gets, and the order they read in. */
const SECTION_HEADINGS: Readonly<Record<CompanyIntelligenceDimension, string>> =
  {
    DESCRIPTION: "What the company does",
    PRODUCT: "Product",
    MARKET: "Market",
    BUSINESS_MODEL: "Business model",
    CUSTOMERS: "Customers",
    TRACTION: "Traction",
    FINANCIAL: "Financial position",
    TEAM: "Team",
    STRATEGY: "Strategy",
    CAPITAL_OBJECTIVE: "Capital objective",
  };

const SECTION_ORDER: readonly CompanyIntelligenceDimension[] = [
  "DESCRIPTION",
  "PRODUCT",
  "MARKET",
  "BUSINESS_MODEL",
  "CUSTOMERS",
  "TRACTION",
  "FINANCIAL",
  "TEAM",
  "STRATEGY",
  "CAPITAL_OBJECTIVE",
];

/** What a gap is called when the record says nothing about a dimension. */
const GAP_LABELS: Readonly<Record<CompanyIntelligenceDimension, string>> = {
  DESCRIPTION: "What the company does",
  PRODUCT: "Product detail",
  MARKET: "Market and where it sits",
  BUSINESS_MODEL: "How it makes money",
  CUSTOMERS: "Customers",
  TRACTION: "Traction",
  FINANCIAL: "Financial performance and runway",
  TEAM: "Team",
  STRATEGY: "Strategy and roadmap",
  CAPITAL_OBJECTIVE: "What is being raised, and for what",
};

const BODY_MAX = 6_000;

/**
 * Every number in a piece of prose.
 *
 * Deliberately crude and deliberately inclusive: a percentage, a currency
 * amount, a count, a year, a multiple. The check below compares what the
 * prose claims against what the record carries, and a guard that missed a
 * figure would be worse than none.
 */
function figuresIn(text: string): readonly string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((figure) =>
    figure.replace(/[,.]+$/, ""),
  );
}

/**
 * Whether a piece of prose invents a figure.
 *
 * True when it states a number the authorised material does not. This is
 * the property doc 12 cares about most in a generated document: a model
 * asked to write persuasively will reach for "40 customers" and "£1.2m
 * ARR", and neither belongs in a brief unless the record holds it.
 *
 * Exported because it is the thing worth testing directly.
 */
export function inventsFigures(
  prose: string,
  grounding: readonly string[],
): boolean {
  const known = new Set(figuresIn(grounding.join(" ")));
  return figuresIn(prose).some((figure) => !known.has(figure));
}

/** The public projection of a finding: no evidence identifiers travel. */
function toPublicFinding(finding: CompanyFinding): QPublicFinding {
  return {
    findingId: finding.findingId,
    type: finding.type,
    statement: finding.statement,
    truthClass: finding.truthClass,
    evidenceStatus: finding.evidenceStatus,
    confidence: finding.confidence,
    subjects: [...finding.subjects],
    // A reference is only identifiers, and whether a reader may see the
    // document behind one is disclosure's decision at render time.
    evidenceRefs: [],
  };
}

/**
 * How a finding reads as a sentence.
 *
 * The statement, and then what kind of thing it is — because a brief that
 * presents somebody's claim and an externally verified fact in the same
 * voice is the document that gets an investor's trust wrongly.
 */
function sentence(finding: CompanyFinding): string {
  const qualifier =
    finding.truthClass === "VERIFIED"
      ? ""
      : finding.truthClass === "USER_CLAIM"
        ? " (stated by the company)"
        : finding.truthClass === "ESTIMATE"
          ? " (estimate)"
          : finding.truthClass === "Q_INFERENCE"
            ? " (Q's reading of the record)"
            : "";
  const statement = finding.statement.trim();
  const stopped = /[.!?]$/.test(statement) ? statement.slice(0, -1) : statement;
  return `${stopped}${qualifier}.`;
}

export type ComposedInvestmentBrief = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
};

/**
 * Compose the brief from what the specialist already established.
 *
 * `companyName` is the canonical name the run resolved, never a name a
 * model produced. `instruction` is the person's own steer and can only
 * change emphasis, never what the record says: it is recorded on the
 * version rather than obeyed here.
 */
export function composeInvestmentBrief(input: {
  readonly companyName: string;
  readonly result: CompanyIntelligenceResult;
}): ComposedInvestmentBrief | null {
  const { companyName, result } = input;
  const byDimension = new Map<CompanyIntelligenceDimension, CompanyFinding[]>();
  for (const finding of result.findings) {
    // A gap is not something the record says; it is something it does not.
    // Those become the gaps list rather than a section's prose.
    if (finding.type === "GAP") {
      continue;
    }
    const bucket = byDimension.get(finding.dimension) ?? [];
    bucket.push(finding);
    byDimension.set(finding.dimension, bucket);
  }

  const sections: QArtifactSection[] = [];
  const grounding = result.findings.map((finding) => finding.statement);

  /**
   * The opening paragraph, and the one place a model's prose appears.
   *
   * Used only if it invents no figure. When it does — or when there was
   * no synthesis, because the route was refused or the provider was out —
   * the brief opens with a plain sentence instead. A brief that opens
   * honestly is better than one that opens well.
   */
  const synthesis = result.synthesis?.trim() ?? "";
  const opening =
    synthesis.length > 0 && !inventsFigures(synthesis, grounding)
      ? synthesis
      : `This brief sets out what Capital Q holds on record about ${companyName}, and what it does not.`;
  sections.push({
    heading: "Summary",
    body: opening.slice(0, BODY_MAX),
    findings: [],
  });

  for (const dimension of SECTION_ORDER) {
    const findings = byDimension.get(dimension) ?? [];
    if (findings.length === 0) {
      continue;
    }
    const body = findings.map(sentence).join(" ").slice(0, BODY_MAX);
    sections.push({
      heading: SECTION_HEADINGS[dimension],
      body,
      findings: findings.slice(0, 12).map(toPublicFinding),
    });
  }

  // Contradictions are their own section: a brief that silently picked the
  // favourable number would be the exact failure doc 12 forbids.
  if (result.contradictions.length > 0) {
    sections.push({
      heading: "Unreconciled figures",
      body: result.contradictions
        .map(
          (contradiction) =>
            `The record carries more than one answer here: ${contradiction.statements.join(
              " — and — ",
            )}.`,
        )
        .join(" ")
        .slice(0, BODY_MAX),
      findings: [],
    });
  }

  // What is missing, named. Coverage the specialist computed, plus the
  // dimensions no finding reached at all.
  const covered = new Set(byDimension.keys());
  const gaps = COMPANY_INTELLIGENCE_DIMENSIONS.filter(
    (dimension) => !covered.has(dimension),
  ).map((dimension) => GAP_LABELS[dimension]);

  // A brief with nothing but a summary and a list of gaps is not a brief;
  // saying so is better than producing a document that says nothing.
  if (sections.length === 1) {
    return null;
  }

  return {
    title: `Investment brief — ${companyName}`.slice(0, 160),
    summary: (sections[0]?.body ?? opening).slice(0, 600),
    content: {
      sections: sections.slice(0, 24),
      gaps: gaps.slice(0, 24),
    },
  };
}

/**
 * Fold a set of revised section bodies into a composed brief.
 *
 * The revision changes how the brief reads, never what the record says.
 * A revised body is taken only when it invents no figure the grounding
 * material does not carry; otherwise the original body stands. So a model
 * asked to "make it punchier" can shorten a paragraph and cannot add a
 * customer count, and the failure mode of a bad revision is a brief that
 * did not change rather than one that became untrue.
 *
 * Findings are never revised. They are the record's own, they carry their
 * own truth class and confidence, and prose is not allowed to restate them.
 */
export function applyRevisedBodies(input: {
  readonly base: ComposedInvestmentBrief;
  /** Heading to revised body, as the model returned it. */
  readonly revised: ReadonlyMap<string, string>;
  readonly grounding: readonly string[];
}): ComposedInvestmentBrief {
  const sections = input.base.content.sections.map((section) => {
    const candidate = input.revised.get(section.heading)?.trim();
    if (
      candidate === undefined ||
      candidate.length === 0 ||
      inventsFigures(candidate, input.grounding)
    ) {
      return section;
    }
    return { ...section, body: candidate.slice(0, BODY_MAX) };
  });
  const summary = sections[0]?.body ?? input.base.summary;
  return {
    title: input.base.title,
    summary: summary.slice(0, 600),
    content: { ...input.base.content, sections },
  };
}
