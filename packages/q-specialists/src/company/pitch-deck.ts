import type {
  QArtifactContent,
  QArtifactSection,
  QChart,
  QPublicFinding,
  QSlide,
  QVisualDirection,
} from "@capital-q/contracts";
import type { CompanyIntelligenceDimension } from "@capital-q/q-core";

import type { CompanyFinding, CompanyIntelligenceResult } from "./contracts.js";
import { inventsFigures, recordOpening } from "./investment-brief.js";

/**
 * The investor deck Q composes (QX-004 §2, §3, §4, §6).
 *
 * Composed from the same findings the investment brief is composed from,
 * for the same reason: a deck is the document a founder puts in front of
 * an investor, so it is the last place to let a model write a plausible
 * number. Every bullet is a finding the specialist already produced under
 * the run's authorised plan, carrying the truth class, evidence status
 * and confidence it carried there, and the section behind each slide
 * keeps all of it so a reader can check what a slide is standing on.
 *
 * Three things this deliberately will not do:
 *
 * **It will not fill a slide.** A deck with nothing to say about traction
 * has no traction slide. The dimension becomes a gap — in the founder's
 * own document, named — because a missing slide is a conversation with
 * their investor and a convincing empty one is a problem with it.
 *
 * **It will not invent a number to draw.** A chart is composed only where
 * the record already carries the figures, and it carries, in its own
 * words, where they came from. Where it cannot say, there is no chart and
 * the numbers stay in the prose (§4, §6).
 *
 * **It will not decide how anything looks.** The direction is a named
 * choice stored on the deck; the renderer reads it. Nothing here emits a
 * size, a position or a colour, so a viewer and a PPTX writer produce the
 * same deck rather than two that diverge.
 */

/** What each dimension is called on a slide, and the order a deck reads in. */
export const SLIDE_TITLES: Readonly<
  Record<CompanyIntelligenceDimension, string>
> = {
  DESCRIPTION: "What we do",
  PRODUCT: "Product",
  MARKET: "Market",
  BUSINESS_MODEL: "How we make money",
  CUSTOMERS: "Customers",
  TRACTION: "Traction",
  FINANCIAL: "Financial position",
  TEAM: "Team",
  STRATEGY: "Where we are going",
  CAPITAL_OBJECTIVE: "The raise",
};

/**
 * The order an investor reads a deck in, which is not the order an
 * analyst reads a brief in: the problem and what the company does come
 * first, the ask comes last, and the evidence sits in the middle.
 */
export const DECK_ORDER: readonly CompanyIntelligenceDimension[] = [
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
export const GAP_LABELS: Readonly<
  Record<CompanyIntelligenceDimension, string>
> = {
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

/** Dimensions whose points read as steps in order, drawn as a flow. */
const FLOWING: ReadonlySet<CompanyIntelligenceDimension> = new Set([
  "BUSINESS_MODEL",
  "STRATEGY",
]);
/** A step's words must fit under its marker. */
const FLOW_STEP_MAX = 110;

/** Dimensions where a chart is worth drawing if the numbers are there. */
const CHARTABLE: ReadonlySet<CompanyIntelligenceDimension> = new Set([
  "TRACTION",
  "FINANCIAL",
  "CUSTOMERS",
  "CAPITAL_OBJECTIVE",
]);

const BULLET_MAX = 180;
const BULLETS_PER_SLIDE = 5;

const PUBLIC_COVER_LINE =
  "Preliminary · built from public sources · not verified by Capital Q";
const PUBLIC_SUMMARY_NOTE =
  "This is a preliminary deck built only from public sources. Capital Q holds no record of the company and has verified none of it; what the sources do not say is listed as not known.";

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
    evidenceRefs: [],
  };
}

/**
 * A finding as a bullet.
 *
 * Shortened at a sentence boundary where one is available, because a
 * bullet cut mid-clause reads as a mistake rather than as a summary, and
 * a deck full of ellipses is the generic AI deck. What is never done is
 * rewriting it: the words are the specialist's, validated, and a bullet
 * is not the place to improve on them.
 */
function bullet(finding: CompanyFinding): string | null {
  const statement = finding.statement.trim();
  if (statement.length === 0) return null;
  if (statement.length <= BULLET_MAX) {
    return statement.replace(/\s+/g, " ");
  }
  const cut = statement.slice(0, BULLET_MAX);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > 60 ? cut.slice(0, stop) : cut.trimEnd()).replace(/\s+/g, " ");
}

/**
 * How a finding reads in the section behind a slide.
 *
 * Qualified exactly as the brief qualifies it: a deck that presents
 * somebody's claim and an externally verified fact in the same voice is
 * the deck that gets an investor's trust wrongly, and the slide's bullet
 * is short enough that the qualification has to live somewhere.
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

/**
 * A labelled number inside one finding, if it plainly carries one.
 *
 * Deliberately narrow. This reads a figure and the words immediately
 * around it and nothing else: it does not parse a sentence, and where the
 * reading is not obvious it returns nothing, because a chart built on a
 * misread sentence is worse than no chart. Currency symbols and suffixes
 * are kept out of the value and put on the chart's unit, so the value
 * stays a decimal string a reader can check against the statement.
 */
function figureIn(
  statement: string,
): { readonly value: string; readonly unit: string } | null {
  const match =
    /(?:^|[\s(])(?<currency>[$£€₦₹¥₵])?\s?(?<number>\d[\d,]*(?:\.\d+)?)\s?(?<suffix>%|k|m|bn|b)?\b/i.exec(
      statement,
    );
  const groups = match?.groups;
  if (groups === undefined) return null;
  const raw = groups["number"];
  if (raw === undefined) return null;
  const value = raw.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  // A four-digit number on its own is far more often a year than a datum.
  if (/^(19|20)\d{2}$/.test(value) && groups["currency"] === undefined) {
    return null;
  }
  const currency = groups["currency"];
  const suffix = groups["suffix"]?.toLowerCase();
  const unit =
    suffix === "%"
      ? "%"
      : currency === undefined
        ? (suffix ?? "")
        : `${currency}${suffix ?? ""}`;
  return { value, unit: unit.length === 0 ? "count" : unit };
}

/**
 * A chart for a dimension, or nothing.
 *
 * Nothing is the common answer and the right one. Two findings in the
 * same dimension must carry comparable figures — the same unit — before
 * there is anything to plot, and the chart records which statements it
 * read so the number on it can be traced back to the sentence it came
 * from (§4).
 */
function chartFor(
  findings: readonly CompanyFinding[],
  publicOnly: boolean,
): QChart | null {
  const points: { label: string; value: string }[] = [];
  const sources: string[] = [];
  let unit: string | null = null;
  for (const finding of findings) {
    const figure = figureIn(finding.statement);
    if (figure === null) continue;
    if (unit === null) unit = figure.unit;
    if (figure.unit !== unit) continue;
    const label = bullet(finding)?.slice(0, 60);
    if (label === undefined || label === null) continue;
    points.push({ label, value: figure.value });
    sources.push(finding.statement.trim());
    if (points.length >= 6) break;
  }
  if (points.length < 2 || unit === null) return null;
  return {
    kind: "COLUMN",
    measure: publicOnly ? "From public sources" : "From the record",
    unit,
    points,
    grounding:
      `${publicOnly ? "Read from public sources, unverified" : "Read from what Capital Q holds"}: ${sources.join("; ")}`.slice(
        0,
        300,
      ),
  };
}

/**
 * Headline figures for a slide without a chart: each the figure exactly as
 * the statement writes it, beside the words it counts. At most three, and
 * only where a statement plainly carries one; otherwise nothing.
 */
function figuresFor(
  findings: readonly CompanyFinding[],
): { value: string; label: string }[] {
  const figures: { value: string; label: string }[] = [];
  for (const finding of findings) {
    if (figureIn(finding.statement) === null) continue;
    const written =
      /(?:[$£€₦₹¥₵]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|m\b|bn\b|b\b)?/i.exec(
        finding.statement,
      )?.[0];
    const label = bullet(finding);
    if (written === undefined || label === null) continue;
    const value = written.trim();
    if (value.length === 0 || value.length > 24) continue;
    figures.push({ value, label: label.slice(0, 90) });
    if (figures.length >= 3) break;
  }
  return figures;
}

export type ComposedPitchDeck = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
};

/**
 * Compose the deck from what the specialist already established.
 *
 * `companyName` is the canonical name the run resolved, never a name a
 * model produced. `direction` is the founder's choice of how it should
 * look, recorded on the deck for the renderer; it changes nothing about
 * what the deck says.
 */
export function composePitchDeck(input: {
  readonly companyName: string;
  readonly result: CompanyIntelligenceResult;
  readonly direction?: QVisualDirection | undefined;
  readonly accent?: string | undefined;
  /**
   * Where what the deck says came from (CQ-QACT-002). PUBLIC_SOURCES is
   * a company Capital Q holds no record of, described only by the public
   * web: the deck says so on its cover, and what the sources do not say
   * is a slide of its own, because unknowns are marked inside the deck
   * rather than being a reason not to make one.
   */
  readonly provenance?: "RECORD" | "PUBLIC_SOURCES" | undefined;
}): ComposedPitchDeck | null {
  const { companyName, result } = input;
  const publicOnly = input.provenance === "PUBLIC_SOURCES";
  const byDimension = new Map<CompanyIntelligenceDimension, CompanyFinding[]>();
  for (const finding of result.findings) {
    if (finding.type === "GAP") continue;
    const bucket = byDimension.get(finding.dimension) ?? [];
    bucket.push(finding);
    byDimension.set(finding.dimension, bucket);
  }

  const grounding = result.findings.map((finding) => finding.statement);
  const sections: QArtifactSection[] = [];
  const slides: QSlide[] = [];

  /**
   * The opening: the record's own description of the company, never Q's
   * conversational reply (CQ-QX-007). The chat answer is addressed to one
   * person about one request ("I am preparing your deck"); a cover slide
   * is addressed to investors. With no description on record the deck
   * opens with the company's name alone, which is a good title slide.
   */
  const described = recordOpening(result);
  const opening =
    described !== null && !inventsFigures(described, grounding)
      ? described
      : null;
  const subtitle =
    opening === null
      ? publicOnly
        ? PUBLIC_COVER_LINE
        : undefined
      : opening.split(/(?<=[.!?])\s/)[0]?.slice(0, 240);
  sections.push({
    heading: "Summary",
    body: publicOnly
      ? `${opening === null ? "" : `${opening} `}${PUBLIC_SUMMARY_NOTE}`
      : (opening ??
        `This deck sets out what Capital Q holds on record about ${companyName}, and what it does not.`),
    findings: [],
  });
  slides.push({
    layout: "TITLE",
    title: companyName,
    ...(subtitle === undefined || subtitle.length === 0 ? {} : { subtitle }),
    bullets: [],
    bulletsRight: [],
    section: 0,
  });

  for (const dimension of DECK_ORDER) {
    const findings = byDimension.get(dimension) ?? [];
    if (findings.length === 0) continue;

    const sectionIndex = sections.length;
    sections.push({
      heading: SLIDE_TITLES[dimension],
      body: findings.map(sentence).join(" ").slice(0, 6_000),
      findings: findings.slice(0, 12).map(toPublicFinding),
    });

    const chart = CHARTABLE.has(dimension)
      ? chartFor(findings, publicOnly)
      : null;
    const bullets = findings
      .map(bullet)
      .filter((line): line is string => line !== null)
      .slice(0, BULLETS_PER_SLIDE);
    if (chart !== null) {
      slides.push({
        layout: "CHART",
        title: SLIDE_TITLES[dimension],
        ...(bullets[0] === undefined ? {} : { subtitle: bullets[0] }),
        bullets: [],
        bulletsRight: [],
        chart,
        section: sectionIndex,
      });
      continue;
    }
    if (bullets.length === 0) continue;
    const figures = CHARTABLE.has(dimension) ? figuresFor(findings) : [];
    const flow =
      FLOWING.has(dimension) &&
      bullets.length >= 3 &&
      bullets.length <= 5 &&
      bullets.every((line) => line.length <= FLOW_STEP_MAX);
    slides.push({
      layout:
        bullets.length === 1 && figures.length === 0 ? "STATEMENT" : "BULLETS",
      title: SLIDE_TITLES[dimension],
      // A figure shown large is not repeated as a bullet under it.
      bullets:
        figures.length === 0
          ? bullets
          : bullets.filter(
              (line) =>
                !figures.some((figure) => line.startsWith(figure.label)),
            ),
      bulletsRight: [],
      ...(figures.length === 0 ? {} : { figures }),
      ...(flow ? { visual: "FLOW" as const } : {}),
      section: sectionIndex,
    });
  }

  // Contradictions get their own section, never a slide: an investor deck
  // is not where an unreconciled figure is argued out, and silently
  // picking the favourable one is the failure doc 12 forbids outright.
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
        .slice(0, 6_000),
      findings: [],
    });
  }

  const covered = new Set(byDimension.keys());
  const gaps = DECK_ORDER.filter((dimension) => !covered.has(dimension)).map(
    (dimension) => GAP_LABELS[dimension],
  );

  // A title slide and nothing behind it is not a deck. Saying so lets Q
  // ask for what is missing instead of handing somebody an empty one.
  if (slides.length < 3) {
    return null;
  }

  // Unknown stays unknown, and in a public-source deck it is said on a
  // slide: someone reading only the PDF must see what is not public.
  if (publicOnly && gaps.length > 0) {
    for (let at = 0; at < gaps.length; at += BULLETS_PER_SLIDE) {
      slides.push({
        layout: "BULLETS",
        title: "Not in public sources",
        bullets: gaps.slice(at, at + BULLETS_PER_SLIDE),
        bulletsRight: [],
        section: 0,
      });
    }
  }

  return {
    title: (publicOnly
      ? `${companyName} — preliminary deck from public sources`
      : `${companyName} — investor deck`
    ).slice(0, 160),
    summary: (sections[0]?.body ?? companyName).slice(0, 600),
    content: {
      sections: sections.slice(0, 24),
      gaps: gaps.slice(0, 24),
      deck: {
        slides: slides.slice(0, 24),
        direction: input.direction ?? "MINIMAL_INSTITUTIONAL",
        ...(input.accent === undefined ? {} : { accent: input.accent }),
        markIsDraft: publicOnly,
      },
    },
  };
}
