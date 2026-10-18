import {
  Q_SLIDE_BULLET_MAX,
  type QArtifactContent,
  type QChart,
  type QSlide,
} from "@capital-q/contracts";

import {
  capitalise,
  clampAtWord,
  nounPhrase,
  slideTopic,
} from "./deck-writer.js";

/**
 * Deck quality (lead review 2026-10-08): the last pass over every deck,
 * by code. Figure labels are short complete noun phrases (a stored label
 * cut mid-clause is cut again at its first clause); no figure is labelled
 * by a bare unit ("10 · Years"); a list that states one measure per period
 * is drawn as a dated chart with a title that says the movement; and a
 * slide the tidying emptied gets its section's first sentence back rather
 * than going out blank.
 */

/** A label that is only a unit names nothing a reader can use. */
const UNIT_ONLY =
  /^(?:years?|months?|weeks?|days?|hours?|times|x|percent|per cent|people|units?)$/i;

const SERIES =
  /^(.*?)\s+(?:of|was|were|at|reached)?\s*((?:[A-Z]{1,3}\s?|[$£€₦₹¥₵])?\d[\d,.]*\s?(?:k|m|bn|million|billion)?)\s+(?:in|for|during)\s+(FY\s?\d{2,4}|(?:Q[1-4]\s)?(?:19|20)\d{2}|H[12]\s(?:19|20)\d{2})\.?$/i;

const AMOUNT =
  /^((?:[A-Z]{1,3}\s?|[$£€₦₹¥₵])?)(\d[\d,.]*)\s?(k|m|bn|million|billion)?$/i;

/**
 * Lines that state one measure per period ("Contracted ARR of R96m in
 * FY2023", "… R168m in FY2024", "… R214m in FY2025") as a dated column
 * chart and a title that says the movement; null unless every line is the
 * same measure in the same unit.
 */
export function seriesOf(lines: readonly string[]): {
  readonly chart: QChart;
  readonly title: string;
} | null {
  if (lines.length < 3 || lines.length > 8) return null;
  const parsed = lines.map((line) => SERIES.exec(line.trim()));
  if (parsed.some((match) => match === null)) return null;
  const measures = new Set(
    parsed.map((match) => (match?.[1] ?? "").trim().toLowerCase()),
  );
  if (measures.size !== 1) return null;
  const parts = parsed.map((match) => {
    const written = (match?.[2] ?? "").trim();
    const amount = AMOUNT.exec(written);
    return {
      written,
      prefix: (amount?.[1] ?? "").trim(),
      value: (amount?.[2] ?? "").replace(/,/g, ""),
      suffix: (amount?.[3] ?? "").toLowerCase(),
      period: (match?.[3] ?? "").replace(/\s+/g, " "),
    };
  });
  const units = new Set(parts.map((part) => `${part.prefix}${part.suffix}`));
  if (
    units.size !== 1 ||
    parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part.value))
  ) {
    return null;
  }
  const measure = capitalise(
    (parsed[0]?.[1] ?? "").trim().replace(/\s+(?:of|was|were)$/i, ""),
  );
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first === undefined || last === undefined || measure.length === 0) {
    return null;
  }
  return {
    chart: {
      kind: "COLUMN",
      measure: clampAtWord(measure, 80),
      unit: [...units][0] || "count",
      points: parts.map((part) => ({ label: part.period, value: part.value })),
      grounding: clampAtWord(`Read from the slide: ${lines.join("; ")}`, 300),
      source: "company record, as stated by the company",
    },
    title: clampAtWord(
      `${measure} grew from ${first.written} to ${last.written}`,
      60,
    ),
  };
}

export function tidyDeck(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    if (index === 0 || slide.layout === "TITLE") return slide;
    let next = slide;
    // A slide built from the founder's records (it carries its eyebrow
    // already) has its labels written; the rest are cut to a phrase.
    if (next.figures !== undefined && next.kicker === undefined) {
      const figures = next.figures.flatMap((figure) => {
        const label = capitalise(nounPhrase(figure.label));
        return label.length === 0 || UNIT_ONLY.test(label)
          ? []
          : [{ ...figure, label }];
      });
      const { figures: _figures, ...rest } = next;
      next = figures.length === 0 ? rest : { ...rest, figures };
    }
    if (next.chart === undefined && next.figures === undefined) {
      const series = seriesOf(next.bullets);
      if (series !== null) {
        next = {
          ...next,
          layout: "CHART",
          title: series.title,
          kicker: next.kicker ?? clampAtWord(slideTopic(content, index), 40),
          bullets: [],
          chart: series.chart,
        };
      }
    }
    // A line of three words or fewer is a fragment of the line before it
    // ("No upfront cost"): it joins that line rather than standing alone.
    if (
      next.kicker !== "Team" &&
      slideTopic(content, index) !== "Team" &&
      next.visual === undefined &&
      next.bullets.length > 1
    ) {
      const joined: string[] = [];
      for (const line of next.bullets) {
        const last = joined[joined.length - 1];
        const merged =
          last === undefined
            ? null
            : `${last.replace(/[.;,]+$/, "")}; ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
        // Only while the joined line still fits the contract's line limit.
        if (
          merged !== null &&
          line.split(/\s+/).length <= 3 &&
          merged.length <= Q_SLIDE_BULLET_MAX
        ) {
          joined[joined.length - 1] = merged;
          continue;
        }
        joined.push(line);
      }
      if (joined.length !== next.bullets.length) {
        next = {
          ...next,
          bullets: joined,
          ...(joined.length === 1 &&
          next.figures === undefined &&
          next.chart === undefined
            ? { layout: "STATEMENT" as const }
            : {}),
        };
      }
    }
    const empty =
      next.bullets.length === 0 &&
      next.bulletsRight.length === 0 &&
      next.figures === undefined &&
      next.chart === undefined &&
      next.image === undefined &&
      next.placeholder === undefined;
    if (empty) {
      const body = content.sections[next.section]?.body ?? "";
      const first = /^.*?[.!?](?=\s|$)/
        .exec(body.trim())?.[0]
        ?.replace(/\s*\((?:as )?(?:stated|reported) by the company\)/i, "");
      if (first !== undefined && first.length <= 180) {
        next = { ...next, layout: "STATEMENT", bullets: [first] };
      }
    }
    return next;
  });
  return { ...content, deck: { ...deck, slides } };
}
