import {
  EXTERNAL_REHEARSAL_DISCLAIMER,
  EXTERNAL_EVALUATION_AREA_NAMES,
  EXTERNAL_REHEARSAL_LABEL,
  type ExternalEvaluationBasisDto,
  type QRehearsalReviewDto,
} from "@capital-q/contracts";

import { plain } from "./external-persona.js";
import type { Scenario } from "./external-scenarios.js";

/**
 * The post-call evaluation of a rehearsal with a researched external
 * person. The graded review comes from the existing evaluation path (the
 * rehearsal-score prompt); this adds what code can say without a model:
 * which of the areas a real meeting tests were actually covered, what the
 * founder said on each, what was not covered, and the public sources the
 * rehearsal was informed by. Only those public sources are ever cited; the
 * review never claims what the real person thinks.
 */

export const EXTERNAL_EVALUATION_AREAS = EXTERNAL_EVALUATION_AREA_NAMES;
export type ExternalEvaluationArea = (typeof EXTERNAL_EVALUATION_AREAS)[number];

const TOPIC: Partial<Record<ExternalEvaluationArea, RegExp>> = {
  FINANCIALS:
    /\b(revenue|margin|burn|runway|cash|unit economics|arr|mrr|ebitda|profit|financials?|cac|ltv|gross)\b/iu,
  BUSINESS_MODEL:
    /\b(business model|make money|makes money|pricing|price|subscription|revenue model|monetis|monetiz|commission|take rate)\b/iu,
  MARKET_KNOWLEDGE:
    /\b(market|tam|sam|som|competitors?|segment|demand|industry|sector)\b/iu,
  DEFENSIBILITY:
    /\b(moat|defensib\w*|copy|copying|barrier|differentiat\w*|patent|advantage|proprietary|switching cost)\b/iu,
};

/** Review dimensions that grade an area directly. */
const FROM_DIMENSION: Partial<
  Record<
    ExternalEvaluationArea,
    QRehearsalReviewDto["dimensions"][number]["name"]
  >
> = {
  PITCH_CLARITY: "CLARITY",
  ANSWER_QUALITY: "EVIDENCE",
  OBJECTION_HANDLING: "HANDLING_PUSHBACK",
};

type SaidTurn = { readonly from: "THEM" | "YOU"; readonly text: string };

export type ExternalEvaluationBasis = ExternalEvaluationBasisDto;

const AREA_WORDS: Record<ExternalEvaluationArea, string> = {
  PITCH_CLARITY: "pitch clarity",
  FINANCIALS: "financials",
  BUSINESS_MODEL: "business model",
  MARKET_KNOWLEDGE: "market knowledge",
  DEFENSIBILITY: "defensibility",
  ANSWER_QUALITY: "answer quality",
  OBJECTION_HANDLING: "objection handling",
};

export function externalEvaluationBasis(input: {
  readonly turns: readonly SaidTurn[];
  readonly dimensions: QRehearsalReviewDto["dimensions"];
  readonly tips: readonly string[];
  readonly sources: readonly { label: string; url: string | null }[];
  readonly scenario?: Scenario | undefined;
}): ExternalEvaluationBasis {
  const mine = input.turns.filter((turn) => turn.from === "YOU");
  const areas = EXTERNAL_EVALUATION_AREAS.map((area) => {
    const dimensionName = FROM_DIMENSION[area];
    const dimension =
      dimensionName === undefined
        ? undefined
        : input.dimensions.find((d) => d.name === dimensionName);
    const pattern = TOPIC[area];
    const line =
      pattern === undefined
        ? undefined
        : mine.find((turn) => pattern.test(turn.text));
    const covered =
      pattern === undefined
        ? dimension !== undefined || mine.length > 0
        : line !== undefined;
    return {
      area,
      covered,
      rating: dimension?.rating ?? null,
      note:
        dimension?.note ??
        (covered
          ? "Covered in this call."
          : `Not covered in this call: have a clear answer on ${AREA_WORDS[area]} ready.`),
      youSaid: line === undefined ? null : plain(line.text, 200),
    };
  });
  const modeFocus = (input.scenario?.directions ?? []).map((direction) => {
    const line = mine.find((turn) => direction.keywords.test(turn.text));
    return {
      key: direction.key,
      label: direction.label,
      covered: line !== undefined,
      youSaid: line === undefined ? null : plain(line.text, 200),
    };
  });
  const gaps = [
    ...modeFocus
      .filter((focus) => !focus.covered)
      .map(
        (focus) =>
          `Prepare ${focus.label.toLowerCase()}: this kind of meeting tests it and it did not come up.`,
      ),
    ...areas
      .filter((a) => !a.covered)
      .map(
        (a) =>
          `Prepare ${AREA_WORDS[a.area]}: it did not come up in this call.`,
      ),
  ];
  return {
    label: EXTERNAL_REHEARSAL_LABEL,
    disclaimer: EXTERNAL_REHEARSAL_DISCLAIMER,
    sources: input.sources
      .filter(
        (s): s is { label: string; url: string } =>
          s.url !== null && s.url.startsWith("https://"),
      )
      .slice(0, 12)
      .map((source) => ({ label: source.label, url: source.url })),
    areas,
    beforeTheRealMeeting: [...input.tips, ...gaps].slice(0, 8),
    ...(input.scenario === undefined
      ? {}
      : { scenario: input.scenario.id, modeFocus }),
  };
}
