import type {
  QArtifactContent,
  QArtifactSection,
  QChart,
  QSlide,
} from "@capital-q/contracts";

import {
  formatAmount,
  instrumentLabel,
  type OwnDeckFacts,
  type OwnDeckFigure,
} from "./deck-figures.js";
import {
  capitalise,
  clampAtWord,
  lowerFirst,
  nounPhrase,
  slideTopic,
  STAT_TOPICS,
} from "./deck-writer.js";
import { SLIDE_TITLES } from "./pitch-deck.js";

/**
 * Deck quality (lead review 2026-10-08): the founder's own deck, shaped
 * from the founder's own records rather than from sentences about them.
 *
 * The record-built deck headlined a valuation cap as "the raise", cut
 * figure labels mid-clause, showed a confirmed team as an empty
 * placeholder, set a financial position as one long sentence, and ended
 * on the ask with no closing. Every one of those has a structured answer
 * in the founder's own records — the round, its use of funds, the team,
 * and the confirmed reading of their own deck (label, value, as-of date)
 * — so these slides are built from those, by code, with:
 *
 * - a title that is the slide's one-sentence takeaway, made from its own
 *   figures, and the topic as a small eyebrow (`kicker`);
 * - figures with short, complete labels, and dates rather than "Start";
 * - the raise headlined by the amount sought, never by a cap or a
 *   valuation (those stay a secondary line), and its use of funds as a
 *   donut when the founder gave shares;
 * - "company-reported" said once, as a footnote, never as a point;
 * - a closing slide: the one-line ask and who to talk to.
 *
 * Nothing here is a model, and nothing states a number the records do not
 * hold: every figure drawn joins the grounding the checks read.
 */

/** What a shaped deck rests on, said plainly, for the checks downstream. */
export type ShapedDeck = {
  readonly content: QArtifactContent;
  readonly grounding: readonly string[];
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((name, index) => [
    [name, index],
    [name.slice(0, 3), index],
  ]),
);

type When = {
  readonly year: number;
  readonly month: number;
  readonly day: number | null;
};

/** "September 2026", "September 30, 2026", "2026-12-18" → a date, or null. */
export function whenOf(text: string | null | undefined): When | null {
  if (text === null || text === undefined) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (iso !== null) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]) - 1,
      day: Number(iso[3]),
    };
  }
  const named =
    /\b([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/.exec(text) ?? null;
  if (named !== null) {
    const month = MONTH_INDEX[(named[1] ?? "").toLowerCase()];
    if (month === undefined) return null;
    return {
      year: Number(named[3]),
      month,
      day: named[2] === undefined ? null : Number(named[2]),
    };
  }
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(text);
  if (dayFirst !== null) {
    const month = MONTH_INDEX[(dayFirst[2] ?? "").toLowerCase()];
    if (month === undefined) return null;
    return { year: Number(dayFirst[3]), month, day: Number(dayFirst[1]) };
  }
  return null;
}

/** "Sep 2026", or "18 Dec 2026" when the day is known. */
export function shortDate(when: When): string {
  const month = MONTHS[when.month] ?? "";
  return when.day === null
    ? `${month} ${String(when.year)}`
    : `${String(when.day)} ${month} ${String(when.year)}`;
}

/** The hedge a written value carries ("About $39,000"), and the value. */
function plainValue(written: string): {
  readonly value: string;
  readonly hedged: boolean;
} {
  const hedged =
    /^(?:about|approximately|approx\.?|around|near|nearly|roughly|~)\s*/i;
  const value = written.trim().replace(hedged, "").trim();
  return { value, hedged: value !== written.trim() };
}

/** A figure's value as a slide shows it: the leading amount, ≤ 24 characters. */
function figureValue(written: string): string | null {
  const { value } = plainValue(written.split(/;|\bto\b/)[0] ?? written);
  const match =
    /^(?:[$£€₦₹¥₵]|R\$|R(?=\d)|(?:USD|NGN|ZAR|KES|GHS|EUR|GBP)\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k|m|bn|million|billion)?/iu.exec(
      value,
    );
  if (match === null) return null;
  const shown = match[0].trim();
  return shown.length <= 24 ? shown : null;
}

const find = (
  figures: readonly OwnDeckFigure[],
  section: string,
  label: RegExp,
): OwnDeckFigure | undefined =>
  figures.find(
    (figure) =>
      figure.section === section &&
      label.test(figure.label) &&
      figure.value !== null &&
      figure.value.trim().length > 0,
  );

/** The statement a figure rests on, as the checks read it. */
const statement = (figure: OwnDeckFigure): string =>
  `${figure.label}: ${figure.value ?? ""}${figure.asOf === null ? "" : ` (${figure.asOf})`}.`;

/** A heading, at most 60 characters, cut at a word. */
const headline = (text: string): string => clampAtWord(capitalise(text), 60);

type Draft = {
  sections: QArtifactSection[];
  slides: QSlide[];
  grounding: string[];
};

/**
 * Put `slide` where the slide about `topic` is (or after `after`), with a
 * section of its own holding the founder's records it was made from — so
 * the words step treats it as already a slide.
 */
function place(
  draft: Draft,
  content: QArtifactContent,
  topic: string,
  slide: Omit<QSlide, "section">,
  body: readonly string[],
): void {
  const section = draft.sections.length;
  draft.sections.push({
    heading: topic,
    body: body.join(" ").slice(0, 6_000),
    findings: [],
  });
  const at = draft.slides.findIndex(
    (existing, index) =>
      index > 0 &&
      existing.layout !== "TITLE" &&
      ((existing.section > 0
        ? content.sections[existing.section]?.heading
        : existing.title) === topic ||
        existing.kicker === topic),
  );
  const next: QSlide = { ...slide, section };
  if (at >= 0) draft.slides.splice(at, 1, next);
  else draft.slides.push(next);
  // Any other slide on the same topic (a placeholder asking for what the
  // records now hold) goes: one slide per topic.
  draft.slides = draft.slides.filter(
    (existing, index) =>
      existing === next ||
      index === 0 ||
      existing.layout === "TITLE" ||
      ((existing.section > 0 && existing.section < content.sections.length
        ? content.sections[existing.section]?.heading
        : existing.title) !== topic &&
        existing.kicker !== topic),
  );
}

const REPORTED = "Figures as reported by the company.";

/** The raise, headlined by the amount sought; the cap a secondary line. */
function raiseSlide(
  draft: Draft,
  content: QArtifactContent,
  facts: OwnDeckFacts,
  figures: readonly OwnDeckFigure[],
): string | null {
  const round = facts.round;
  if (round === null) return null;
  const amount = formatAmount(round.amount, round.currency);
  if (amount === null) return null;
  const instrument = instrumentLabel(round.instrument);
  const stage = round.name?.trim().toLowerCase() ?? null;
  const close = whenOf(
    round.targetClose ??
      find(figures, "THE_ASK", /target close/i)?.value ??
      null,
  );
  const cap =
    round.valuationCap === null || round.valuationCap === undefined
      ? figureValue(find(figures, "THE_ASK", /valuation cap/i)?.value ?? "")
      : formatAmount(round.valuationCap.amount, round.valuationCap.currency);
  const minimum = figureValue(
    find(figures, "THE_ASK", /minimum (?:cheque|check|ticket)/i)?.value ?? "",
  );
  // "on a SAFE", "on a convertible note", "in a priced equity round".
  const on =
    instrument === null
      ? ""
      : /equity/i.test(instrument)
        ? ` in a ${instrument} round`
        : ` on a ${instrument}`;
  const ask = `${amount}${stage === null ? "" : ` ${stage}`}${on}`;
  const lines: string[] = [];
  lines.push(
    `We are raising ${ask}${close === null ? "" : `, closing ${shortDate(close)}`}.`,
  );
  const uses = useOfFunds(round.useOfFunds);
  const secondary = [
    cap === null ? null : `a ${cap} valuation cap`,
    minimum === null ? null : `a ${minimum} minimum cheque`,
  ].filter((part): part is string => part !== null);
  const bullets: string[] = [];
  if (secondary.length > 0) {
    bullets.push(`Terms: ${secondary.join(" and ")}.`);
    lines.push(`Terms: ${secondary.join(" and ")}.`);
  }
  if (uses.chart === null && uses.parts.length > 0) {
    bullets.unshift(`Use of funds: ${uses.parts.join("; ")}.`);
  }
  if (round.useOfFunds !== null) lines.push(round.useOfFunds);
  draft.grounding.push(...lines);
  place(
    draft,
    content,
    SLIDE_TITLES.CAPITAL_OBJECTIVE,
    {
      layout: uses.chart === null ? "BULLETS" : "CHART",
      kicker: SLIDE_TITLES.CAPITAL_OBJECTIVE,
      title: headline(
        `Raising ${ask}${close === null ? "" : `, closing ${shortDate(close)}`}`,
      ),
      bullets,
      bulletsRight: [],
      figures: [
        {
          value: amount,
          label:
            stage === null
              ? instrument === null
                ? "This round"
                : capitalise(`${instrument} round`)
              : `${capitalise(stage)} round${instrument === null ? "" : ` (${instrument})`}`,
        },
        ...(close === null
          ? []
          : [{ value: shortDate(close), label: "Target close" }]),
      ],
      ...(uses.chart === null ? {} : { chart: uses.chart }),
    },
    lines,
  );
  return ask;
}

/**
 * "Engineering: 35% (USD 630,000); Sales: 30% …" as donut parts, when
 * every part gives a share and they make a whole; otherwise the parts as
 * words.
 */
export function useOfFunds(summary: string | null): {
  readonly chart: QChart | null;
  readonly parts: readonly string[];
} {
  if (summary === null || summary.trim().length === 0) {
    return { chart: null, parts: [] };
  }
  const pieces = summary
    .split(/;\s*|\n+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  const shares = pieces.map((piece) =>
    /^(.+?)\s*[:—–-]\s*(\d+(?:\.\d+)?)\s*%/.exec(piece),
  );
  const parts = pieces.map((piece) =>
    piece.replace(/\s*\((?:[A-Z]{3}|[$£€₦])\s?[\d,.]+[kmb]?\)\s*$/i, "").trim(),
  );
  const total = shares.reduce(
    (sum, match) => sum + (match === null ? 0 : Number(match[2])),
    0,
  );
  if (
    shares.length >= 2 &&
    shares.length <= 8 &&
    shares.every((match) => match !== null) &&
    Math.abs(total - 100) <= 1
  ) {
    return {
      chart: {
        kind: "DONUT",
        measure: "Use of funds",
        unit: "%",
        points: shares.map((match) => ({
          label: clampAtWord(capitalise(match?.[1] ?? ""), 60),
          value: match?.[2] ?? "0",
        })),
        grounding: clampAtWord(`The founder's use of funds: ${summary}`, 300),
        source: "the founder's raise plan",
      },
      parts,
    };
  }
  return { chart: null, parts: parts.map((part) => part.toLowerCase()) };
}

/** The team as people: names and roles from the founder's own records. */
function teamSlide(
  draft: Draft,
  content: QArtifactContent,
  facts: OwnDeckFacts,
): void {
  const team = facts.team
    .filter((member) => member.name.trim().length > 0)
    .slice(0, 6);
  if (team.length === 0) return;
  const lines = team.map((member) =>
    clampAtWord(
      member.role === null || member.role.trim().length === 0
        ? `${member.name.trim()} — ${member.founder ? "Founder" : "Team"}`
        : `${member.name.trim()} — ${member.role.trim()}`,
      120,
    ),
  );
  const founders = team.filter((member) => member.founder);
  const names = founders.map((member) => member.name.trim());
  const title =
    names.length === 0
      ? SLIDE_TITLES.TEAM
      : names.length === 1
        ? `Led by ${names[0] ?? ""}`
        : `Led by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  const size = facts.teamSize ?? null;
  const count = facts.founderCount ?? null;
  const subtitle =
    size === null || size <= team.length
      ? undefined
      : `A team of ${String(size)}${count === null ? "" : `, including ${String(count)} founders`}.`;
  draft.grounding.push(...lines, ...(subtitle === undefined ? [] : [subtitle]));
  place(
    draft,
    content,
    SLIDE_TITLES.TEAM,
    {
      layout: "BULLETS",
      kicker: SLIDE_TITLES.TEAM,
      title: headline(title),
      bullets: lines,
      bulletsRight: [],
      ...(subtitle === undefined ? {} : { subtitle }),
    },
    [...lines, ...(subtitle === undefined ? [] : [subtitle])],
  );
}

/** Cash, burn and break-even as figures; the caveat a footnote. */
function financialSlide(
  draft: Draft,
  content: QArtifactContent,
  figures: readonly OwnDeckFigure[],
): void {
  const cash = find(figures, "FINANCIALS", /^cash\b/i);
  const burn = find(
    figures,
    "FINANCIALS",
    /current monthly (?:net )?burn|^monthly (?:net )?burn|^net burn/i,
  );
  const planned = find(
    figures,
    "FINANCIALS",
    /planned monthly (?:net )?burn|burn after raise/i,
  );
  const runway = find(figures, "FINANCIALS", /runway/i);
  const breakEven = find(figures, "FINANCIALS", /break-?even/i);
  const shown: { value: string; label: string; source: OwnDeckFigure }[] = [];
  const cashValue = figureValue(cash?.value ?? "");
  if (cash !== undefined && cashValue !== null) {
    const at = whenOf(cash.asOf);
    shown.push({
      value: cashValue,
      label: at === null ? "Cash" : `Cash at ${shortDate(at)}`,
      source: cash,
    });
  }
  const burnValue = figureValue(burn?.value ?? "");
  if (burn !== undefined && burnValue !== null) {
    shown.push({
      value: burnValue,
      label: plainValue(burn.value ?? "").hedged
        ? "Monthly net burn (approx.)"
        : "Monthly net burn",
      source: burn,
    });
  }
  const runwayValue = figureValue(runway?.value ?? "");
  if (runway !== undefined && runwayValue !== null) {
    shown.push({ value: runwayValue, label: "Runway", source: runway });
  }
  const evenAt = /\bQ[1-4]\s+\d{4}\b|\b(?:19|20)\d{2}\b/.exec(
    breakEven?.value ?? "",
  );
  if (breakEven !== undefined && evenAt !== null && shown.length < 3) {
    shown.push({
      value: evenAt[0],
      label: /plan/i.test(breakEven.value ?? "")
        ? "Planned break-even"
        : "Break-even",
      source: breakEven,
    });
  }
  if (shown.length < 2) return;
  const bullets: string[] = [];
  const plannedValue = figureValue(planned?.value ?? "");
  if (planned !== undefined && plannedValue !== null) {
    bullets.push(
      `After the raise, net burn is planned at ${plainValue(planned.value ?? "").hedged ? "about " : ""}${plannedValue} a month.`,
    );
  }
  const [first, second] = shown;
  const title =
    cash !== undefined &&
    burn !== undefined &&
    cashValue !== null &&
    burnValue !== null
      ? `${cashValue} in cash, ${plainValue(burn.value ?? "").hedged ? "about " : ""}${burnValue} net burn a month`
      : `${first?.value ?? ""} ${lowerFirst(first?.label ?? "")}, ${second?.value ?? ""} ${lowerFirst(second?.label ?? "")}`;
  const rests = [
    ...shown.map((figure) => statement(figure.source)),
    ...(planned === undefined ? [] : [statement(planned)]),
  ];
  draft.grounding.push(...rests);
  place(
    draft,
    content,
    SLIDE_TITLES.FINANCIAL,
    {
      layout: "BULLETS",
      kicker: SLIDE_TITLES.FINANCIAL,
      title: headline(title),
      bullets,
      bulletsRight: [],
      figures: shown.slice(0, 4).map(({ value, label }) => ({ value, label })),
      footnote: REPORTED,
    },
    rests,
  );
}

/** TAM, SAM and SOM as figures (drawn as rings), when the deck gives them. */
function marketSlide(
  draft: Draft,
  content: QArtifactContent,
  figures: readonly OwnDeckFigure[],
): void {
  const pick = (code: string) => {
    const all = figures.filter(
      (figure) =>
        figure.section === "MARKET" &&
        new RegExp(`^${code}\\b`, "i").test(figure.label) &&
        figureValue(figure.value ?? "") !== null,
    );
    // A count of buyers reads as the market more plainly than a value.
    return (
      all.find((figure) => !/[$£€₦₹¥₵]|bn\b/.test(figure.value ?? "")) ?? all[0]
    );
  };
  const found = (["TAM", "SAM", "SOM"] as const)
    .map((code) => ({ code, figure: pick(code) }))
    .filter(
      (
        entry,
      ): entry is { code: "TAM" | "SAM" | "SOM"; figure: OwnDeckFigure } =>
        entry.figure !== undefined,
    );
  if (found.length < 2) return;
  const prose = content.sections
    .filter((section) => section.heading === SLIDE_TITLES.MARKET)
    .map((section) => section.body)
    .join(" ");
  const shown = found.map(({ code, figure }) => {
    const value = figureValue(figure.value ?? "") ?? "";
    // What the number counts, read from the market prose after it
    // ("420,000 VAT-filing businesses"), else from the deck's own label.
    const after = new RegExp(
      `${value.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&")}\\s+([^.;,]+)`,
    ).exec(prose)?.[1];
    const rest = (figure.value ?? "").slice(
      (figure.value ?? "").indexOf(value) + value.length,
    );
    const noun =
      nounPhrase(after ?? "", 5) ||
      nounPhrase(rest.split(";")[0] ?? "", 5) ||
      nounPhrase(figure.label.replace(new RegExp(`^${code}\\s*`, "i"), ""), 5);
    return {
      value,
      label: `${capitalise(noun.length > 0 ? noun : "Market")} (${code})`,
      noun,
      figure,
    };
  });
  const tam = shown[0];
  const rests = shown.map(({ figure }) => statement(figure));
  draft.grounding.push(...rests);
  place(
    draft,
    content,
    SLIDE_TITLES.MARKET,
    {
      layout: "BULLETS",
      kicker: SLIDE_TITLES.MARKET,
      title: headline(
        tam === undefined || tam.noun.length === 0
          ? SLIDE_TITLES.MARKET
          : `A market of ${tam.value} ${lowerFirst(tam.noun)}`,
      ),
      bullets: [],
      bulletsRight: [],
      figures: shown.map(({ value, label }) => ({ value, label })),
      footnote: "Company estimates; not independently verified.",
    },
    rests,
  );
}

/** Customers over time as dated columns, the latest figures beside them. */
function tractionSlide(
  draft: Draft,
  content: QArtifactContent,
  figures: readonly OwnDeckFigure[],
): void {
  const traction = figures.filter(
    (figure) =>
      figure.section === "TRACTION" && figureValue(figure.value ?? "") !== null,
  );
  // A "prior X" figure and its "X" make a dated pair.
  let pair: { before: OwnDeckFigure; now: OwnDeckFigure } | null = null;
  for (const before of traction) {
    const base = /^(?:prior|previous|earlier|starting)\s+(.+)$/i.exec(
      before.label,
    )?.[1];
    if (base === undefined) continue;
    const now = traction.find(
      (figure) => figure.label.toLowerCase() === base.toLowerCase(),
    );
    if (now !== undefined) {
      pair = { before, now };
      break;
    }
  }
  if (pair === null) return;
  const from = whenOf(pair.before.asOf);
  const to = whenOf(pair.now.asOf);
  const fromValue = figureValue(pair.before.value ?? "");
  const toValue = figureValue(pair.now.value ?? "");
  if (from === null || to === null || fromValue === null || toValue === null) {
    return;
  }
  const number = (shown: string) => shown.replace(/[^\d.]/g, "");
  const chart: QChart = {
    kind: "COLUMN",
    measure: capitalise(pair.now.label),
    unit: "count",
    points: [
      { label: shortDate({ ...from, day: null }), value: number(fromValue) },
      { label: shortDate({ ...to, day: null }), value: number(toValue) },
    ],
    grounding: clampAtWord(
      `${statement(pair.before)} ${statement(pair.now)}`,
      300,
    ),
    source: "the company's own deck",
  };
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  const since =
    months === 12 ? "a year ago" : `in ${shortDate({ ...from, day: null })}`;
  const others = traction
    .filter(
      (figure) =>
        figure !== pair?.before &&
        figure !== pair?.now &&
        !/\b(?:history|growth|annuali[sz]ed|prior|previous)\b/i.test(
          figure.label,
        ),
    )
    .slice(0, 3)
    .map((figure) => {
      const value = figureValue(figure.value ?? "") ?? "";
      const extra = (figure.value ?? "")
        .slice((figure.value ?? "").indexOf(value) + value.length)
        .trim();
      const label = nounPhrase(
        `${figure.label}${extra.length > 0 ? ` ${extra}` : ""}`,
        6,
      );
      return { value, label: capitalise(label), source: figure };
    });
  const rests = [
    statement(pair.before),
    statement(pair.now),
    ...others.map((figure) => statement(figure.source)),
  ];
  draft.grounding.push(...rests);
  place(
    draft,
    content,
    SLIDE_TITLES.TRACTION,
    {
      layout: "CHART",
      kicker: SLIDE_TITLES.TRACTION,
      title: headline(
        `${toValue} ${lowerFirst(pair.now.label)}, up from ${fromValue} ${since}`,
      ),
      bullets: [],
      bulletsRight: [],
      figures: others.map(({ value, label }) => ({ value, label })),
      chart,
      footnote: `${REPORTED.replace(/\.$/, "")}, ${shortDate({ ...to, day: null })}.`,
    },
    rests,
  );
}

/** Margin and price as figures; the plans as one line. */
function modelSlide(
  draft: Draft,
  content: QArtifactContent,
  figures: readonly OwnDeckFigure[],
): void {
  const margin = find(figures, "BUSINESS_MODEL", /gross margin/i);
  const blended = find(
    figures,
    "BUSINESS_MODEL",
    /blended|average revenue|ARPU|ARPA/i,
  );
  const prices = figures.filter(
    (figure) =>
      figure.section === "BUSINESS_MODEL" &&
      /\b(?:price|plan|tier)\b/i.test(figure.label) &&
      figure.value !== null,
  );
  const marginValue = figureValue(margin?.value ?? "");
  const blendedValue = figureValue(blended?.value ?? "");
  const shown: { value: string; label: string }[] = [];
  if (margin !== undefined && marginValue !== null) {
    shown.push({ value: marginValue, label: "Gross margin" });
  }
  if (blended !== undefined && blendedValue !== null) {
    shown.push({
      value: blendedValue,
      label: plainValue(blended.value ?? "").hedged
        ? "Revenue per business a month (approx.)"
        : "Revenue per business a month",
    });
  }
  if (shown.length === 0) return;
  const plans = prices.slice(0, 3).flatMap((price) => {
    const value = figureValue(price.value ?? "");
    const name = price.label.replace(/\s*(?:price|plan|tier)$/i, "").trim();
    return value === null || name.length === 0 ? [] : [`${name} ${value}`];
  });
  const bullets =
    plans.length === 0
      ? []
      : [`Plans per entity a month: ${plans.join(", ")}.`];
  const rests = [
    ...(margin === undefined ? [] : [statement(margin)]),
    ...(blended === undefined ? [] : [statement(blended)]),
    ...prices.slice(0, 3).map(statement),
  ];
  draft.grounding.push(...rests);
  const subscription = content.deck?.slides.some(
    (slide) =>
      /subscription/i.test(slide.bullets.join(" ")) &&
      slideTopic(content, content.deck?.slides.indexOf(slide) ?? -1) ===
        SLIDE_TITLES.BUSINESS_MODEL,
  );
  place(
    draft,
    content,
    SLIDE_TITLES.BUSINESS_MODEL,
    {
      layout: "BULLETS",
      kicker: SLIDE_TITLES.BUSINESS_MODEL,
      title: headline(
        marginValue === null
          ? SLIDE_TITLES.BUSINESS_MODEL
          : `${marginValue} gross margin${subscription === true ? " on a monthly subscription" : ""}`,
      ),
      bullets,
      bulletsRight: [],
      figures: shown,
    },
    rests,
  );
}

/** The last slide: the one-line ask and who to talk to. */
function closingSlide(
  draft: Draft,
  facts: OwnDeckFacts,
  company: string,
  ask: string | null,
): void {
  const last = draft.slides[draft.slides.length - 1];
  if (
    last !== undefined &&
    last.layout === "TITLE" &&
    draft.slides.length > 1
  ) {
    draft.slides.pop();
  }
  const lead = facts.team.find((member) => member.founder) ?? facts.team[0];
  const host = (() => {
    if (facts.website === null || facts.website === undefined) return null;
    try {
      return new URL(facts.website).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  // Who to talk to under the ask, and where to find the company.
  const person =
    lead === undefined
      ? null
      : `${lead.name.trim()}${lead.role === null ? "" : `, ${lead.role.trim()}`}`;
  draft.slides.push({
    layout: "TITLE",
    title: clampAtWord(
      ask === null ? company : `${company} is raising ${ask}`,
      100,
    ),
    ...(person === null ? {} : { subtitle: clampAtWord(person, 200) }),
    bullets: host === null ? [] : [`Website: ${host}`],
    bulletsRight: [],
    section: 0,
  });
}

/**
 * The founder's own deck from their own records (see the file comment).
 * Only for a deck about the actor's own company; a slide whose records
 * are missing keeps what the composer made of it.
 */
export function shapeOwnDeck(
  content: QArtifactContent,
  facts: OwnDeckFacts,
): ShapedDeck {
  const deck = content.deck;
  if (deck === undefined || deck.markIsDraft) {
    return { content, grounding: [] };
  }
  const draft: Draft = {
    sections: [...content.sections],
    slides: [...deck.slides],
    grounding: [],
  };
  const figures = facts.figures ?? [];
  marketSlide(draft, content, figures);
  modelSlide(draft, content, figures);
  tractionSlide(draft, content, figures);
  financialSlide(draft, content, figures);
  teamSlide(draft, content, facts);
  const ask = raiseSlide(draft, content, facts, figures);
  const company = deck.slides[0]?.title ?? "";
  closingSlide(draft, facts, company, ask);
  // A placeholder for what the records now hold is no longer a gap.
  const filled = new Set(
    draft.slides.flatMap((slide) =>
      slide.kicker === undefined ? [] : [slide.kicker],
    ),
  );
  return {
    content: {
      ...content,
      sections: draft.sections.slice(0, 24),
      gaps: content.gaps.filter((gap) => !filled.has(gap)),
      deck: { ...deck, slides: draft.slides.slice(0, 24) },
    },
    grounding: draft.grounding,
  };
}

/**
 * Every deck: a numbers slide titled only by its topic says its first
 * figure instead, and a slide whose title is a takeaway carries its topic
 * as the eyebrow, so the reader still knows where they are.
 */
export function withKickers(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    if (index === 0 || slide.layout === "TITLE" || slide.kicker !== undefined) {
      return slide;
    }
    const topic = slideTopic(content, index);
    if (topic.length === 0 || topic === "cover") return slide;
    // A numbers slide still titled by its topic says its first figure.
    const first = slide.figures?.[0];
    const said =
      topic === slide.title && first !== undefined && STAT_TOPICS.has(topic)
        ? `${first.value} ${lowerFirst(first.label)}`
        : slide.title;
    const title = said.length <= 60 ? said : slide.title;
    if (title === topic) return slide;
    return { ...slide, title, kicker: clampAtWord(topic, 40) };
  });
  return { ...content, deck: { ...deck, slides } };
}
