import type {
  QArtifactContent,
  QArtifactSection,
  QChart,
  QSlide,
} from "@capital-q/contracts";

import {
  capitalise,
  clampAtWord,
  HEADLINE_MAX,
  HEDGED,
  inCompanyVoice,
  NO_FIGURES,
  slideTopic,
  splitStatement,
  STAT_TOPICS,
  statFigure,
} from "./deck-writer.js";
import { DECK_ORDER, GAP_LABELS, SLIDE_TITLES } from "./pitch-deck.js";

/**
 * Deck wave 8 (live 2026-10-07, Ledgerline deck 164be413…): what the
 * polish step must not undo, and what a founder's own deck must not leave
 * empty.
 *
 * - Firm figures survive the polish: after the words step, every firm
 *   (non-hedged) number still sitting in a sentence is shown large, and a
 *   "from X to Y" movement becomes a small two-point chart. Hedged
 *   estimates stay in words, where their hedge is read with them.
 * - The cover's subtitle is a tagline, not the record's whole opening.
 * - "The raise" and "Team" are filled from the founder's own records when
 *   the deck is about their own company; otherwise they are a marked
 *   placeholder that says what to add. No slide is ever left empty.
 *
 * All of it is code. Nothing here adds a number the slide (or the
 * founder's own record) does not already carry.
 */

const FIGURES_MAX = 3;
/** A promoted figure's label may be longer than a short stat's. */
const FIRM_LABEL_MAX = 60;
/** A clause longer than this is not read for a figure at all. */
const FIRM_CLAUSE_MAX = 200;

/** "1,200" and "1200" are the same figure; "2.5." is "2.5". */
function figuresOf(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? [])
    .map((figure) => figure.replace(/,/g, "").replace(/\.+$/, ""))
    .filter((figure) => figure.length > 0);
}

const wordsOf = (text: string): string[] =>
  text.split(/\s+/).filter((word) => word.length > 0);

// --- firm figures, after the polish -------------------------------------------

const NUMBER =
  "(?:[$£€₦₹¥₵]\\s?)?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|k|m|bn|million|billion)?";
const GROWTH = new RegExp(
  `\\bfrom\\s+(${NUMBER})\\s+(?:to|into)\\s+(${NUMBER})(?![\\d,])`,
  "iu",
);
const GROWTH_VERBS =
  /\s+(?:grew|rose|increased|went|climbed|jumped|expanded|moved|has grown|have grown|grown)$/i;

/** The decimal value and unit of "₦38m", "96%", "1,140". */
function chartValue(
  written: string,
): { readonly value: string; readonly unit: string } | null {
  const match =
    /^([$£€₦₹¥₵])?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|k|m|bn|million|billion)?$/iu.exec(
      written.trim(),
    );
  if (match === null) return null;
  const value = (match[2] ?? "").replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const currency = match[1];
  const suffix = match[3]?.toLowerCase();
  const short =
    suffix === "million" ? "m" : suffix === "billion" ? "bn" : suffix;
  const unit =
    short === "%"
      ? "%"
      : currency === undefined
        ? (short ?? "count")
        : `${currency}${short ?? ""}`;
  return { value, unit };
}

type Growth = {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly period: string | null;
  readonly clause: string;
};

function growthIn(clause: string): Growth | null {
  if (HEDGED.test(clause)) return null;
  const match = GROWTH.exec(clause);
  if (match === null) return null;
  const from = (match[1] ?? "").trim();
  const to = (match[2] ?? "").trim();
  const a = chartValue(from);
  const b = chartValue(to);
  if (a === null || b === null || a.unit !== b.unit) return null;
  const subject = clause
    .slice(0, match.index)
    .trim()
    .replace(GROWTH_VERBS, "")
    .replace(/^(?:we|our|the)\s+/i, "")
    .trim();
  const after = clause
    .slice(match.index + match[0].length)
    .trim()
    .replace(/[.,;:]+$/, "");
  const period = /^(?:over|in|within|across|during)\s+[\p{L}\s-]{3,40}$/iu.test(
    after,
  )
    ? after
    : null;
  if (subject.length === 0 || /\d/.test(subject)) return null;
  return { from, to, label: subject, period, clause };
}

type Promoted =
  | {
      readonly figure: { readonly value: string; readonly label: string };
      readonly chart?: undefined;
    }
  | { readonly figure?: undefined; readonly chart: QChart };

/**
 * One clause's firm figure, or its movement as a small chart (a tile
 * "590→1,140" only where the slide already has a chart), or null.
 */
function promote(
  clause: string,
  known: ReadonlySet<string>,
  allowChart: boolean,
): Promoted | null {
  const grounded = (text: string) =>
    figuresOf(text).every((figure) => known.has(figure));
  const growth = growthIn(clause);
  if (growth !== null && grounded(`${growth.from} ${growth.to}`)) {
    const from = chartValue(growth.from);
    const to = chartValue(growth.to);
    if (allowChart && from !== null && to !== null) {
      return {
        chart: {
          kind: "COLUMN",
          measure: clampAtWord(capitalise(growth.label), 80),
          unit: from.unit,
          points: [
            { label: "Start", value: from.value },
            {
              label: clampAtWord(
                growth.period === null
                  ? "Now"
                  : capitalise(growth.period.replace(/^over\s+/i, "after ")),
                60,
              ),
              value: to.value,
            },
          ],
          grounding: clampAtWord(`Read from the slide: ${clause}`, 300),
        },
      };
    }
    const label = clampAtWord(
      growth.period === null
        ? growth.label
        : `${growth.label} ${growth.period}`,
      FIRM_LABEL_MAX,
    );
    const value = `${growth.from}→${growth.to}`;
    return value.length > 24
      ? null
      : { figure: { value, label: capitalise(label) } };
  }
  const found = statFigure(clause, {
    clauseMax: FIRM_CLAUSE_MAX,
    labelMax: FIRM_LABEL_MAX,
  });
  if (found === null || !grounded(found.value)) return null;
  return { figure: { value: found.value, label: capitalise(found.label) } };
}

/** A line as clauses: sentences, then "; ", " — " and clause commas. */
function clausesOf(line: string): string[] {
  return line
    .replace(/\s+/g, " ")
    .trim()
    .split(
      /(?<=[.!?])\s+(?=[A-Z0-9₦$£€])|;\s+|\s+[—–]\s+|,\s+(?=(?:and|while|with|which|who|but|serving|reaching|making|helping|up from)\b)|,?\s+(?:and|with|plus)\s+(?=[$£€₦₹¥₵]?\d)/u,
    )
    .map((piece) => piece.replace(/[.;,]+$/, "").trim())
    .filter((piece) => piece.length > 0);
}

const sameFigure = (a: string, b: string): boolean =>
  figuresOf(a).join("|") === figuresOf(b).join("|");

/**
 * After the polish: firm numbers still in sentences are shown large on
 * their slide, and a slide title that is a sentence or states a number the
 * slide does not show becomes a headline consistent with its figures.
 */
export function promoteFirmFigures(
  content: QArtifactContent,
  grounding: readonly string[],
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const known = new Set(figuresOf(grounding.join(" ")));
  const slides = deck.slides.map((slide, index): QSlide => {
    if (index === 0) return slide;
    const topic = slideTopic(content, index);
    if (
      slide.placeholder?.kind === "TEXT" ||
      NO_FIGURES.has(topic) ||
      slide.visual === "FLOW" ||
      slide.layout === "TWO_COLUMN" ||
      slide.layout === "QUOTE" ||
      slide.layout === "CHART"
    ) {
      return slide;
    }
    const figures = [...(slide.figures ?? [])];
    let chart = slide.chart;
    let changed = false;
    const bullets: string[] = [];
    for (const bullet of slide.bullets) {
      const kept: string[] = [];
      for (const clause of clausesOf(bullet)) {
        const promoted = promote(clause, known, chart === undefined);
        if (
          promoted === null ||
          (promoted.figure !== undefined && figures.length >= FIGURES_MAX)
        ) {
          kept.push(clause);
          continue;
        }
        changed = true;
        const figure = promoted.figure;
        if (figure === undefined) {
          chart = promoted.chart;
        } else if (
          !figures.some((shown) => sameFigure(shown.value, figure.value))
        ) {
          figures.push(figure);
        }
      }
      const rest = kept.join("; ");
      // What is left of a line once its figure is shown large: kept when it
      // still says something, dropped when it was only the number.
      if (kept.length === clausesOf(bullet).length) bullets.push(bullet);
      else if (wordsOf(rest).length >= 3) bullets.push(capitalise(rest));
    }
    if (!changed) return withConsistentTitle(slide, topic);
    const next: QSlide = {
      ...slide,
      layout: "BULLETS",
      bullets: bullets.slice(0, 5),
      ...(figures.length === 0
        ? {}
        : { figures: figures.slice(0, FIGURES_MAX) }),
      ...(chart === undefined ? {} : { chart }),
    };
    return withConsistentTitle(next, topic);
  });
  return { ...content, deck: { ...deck, slides } };
}

/**
 * A slide's title agrees with what it shows: a title that is a sentence,
 * or that states a number the slide does not show large, becomes the
 * headline figure (numbers slides) or the slide's subject.
 */
function withConsistentTitle(slide: QSlide, topic: string): QSlide {
  const shown = new Set(
    [
      ...(slide.figures ?? []).map((figure) => figure.value),
      ...(slide.chart?.points ?? []).map((point) => point.value),
    ].flatMap(figuresOf),
  );
  const title = slide.title;
  const stray = figuresOf(title).some((figure) => !shown.has(figure));
  const long = title.length > HEADLINE_MAX;
  if (!stray && !long) return slide;
  const first = slide.figures?.[0];
  const headline =
    first !== undefined &&
    STAT_TOPICS.has(topic) &&
    topic !== SLIDE_TITLES.MARKET
      ? `${first.value} ${first.label.charAt(0).toLowerCase()}${first.label.slice(1)}`
      : undefined;
  const replacement =
    headline !== undefined && headline.length <= HEADLINE_MAX
      ? headline
      : topic.length > 0 && topic !== "cover"
        ? topic
        : clampAtWord(title, HEADLINE_MAX);
  return { ...slide, title: capitalise(replacement) };
}

// --- the founder's own raise and team -----------------------------------------

/** The founder's own round and team, read as the founder (never a model). */
export type OwnDeckFacts = {
  readonly round: {
    /** Exact numeric amount as a decimal string, and its ISO currency. */
    readonly amount: string;
    readonly currency: string;
    readonly instrument: string | null;
    readonly name: string | null;
    readonly useOfFunds: string | null;
  } | null;
  readonly team: readonly {
    readonly name: string;
    readonly role: string | null;
    readonly founder: boolean;
  }[];
};

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  GHS: "₵",
  INR: "₹",
};

/** "150000000" NGN → "₦150m". Display only; the record keeps the exact amount. */
export function formatAmount(amount: string, currency: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const [scaled, suffix] =
    value >= 1e9
      ? [value / 1e9, "bn"]
      : value >= 1e6
        ? [value / 1e6, "m"]
        : value >= 1e3
          ? [value / 1e3, "k"]
          : [value, ""];
  const digits = (Math.round(scaled * 10) / 10).toFixed(1).replace(/\.0$/, "");
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()];
  return symbol === undefined
    ? `${currency.toUpperCase()} ${digits}${suffix}`
    : `${symbol}${digits}${suffix}`;
}

const INSTRUMENT_LABEL: Readonly<Record<string, string>> = {
  SAFE: "SAFE",
  EQUITY: "priced equity",
  CONVERTIBLE: "convertible note",
};

function instrumentLabel(code: string | null): string | null {
  if (code === null) return null;
  const known = INSTRUMENT_LABEL[code.toUpperCase()];
  if (known !== undefined) return known;
  const plain = code.replace(/[._-]+/g, " ").trim();
  return plain.length === 0 || /^other$/i.test(plain) ? null : plain;
}

/** What a placeholder slide asks for, said on the slide itself. */
const PLACEHOLDER_DETAIL: Readonly<Record<string, string>> = {
  [SLIDE_TITLES.CAPITAL_OBJECTIVE]:
    "Not on record yet. Add how much you are raising, the instrument (SAFE, equity or a convertible) and what the money is for.",
  [SLIDE_TITLES.TEAM]:
    "Not on record yet. Add who is on the team, their roles, and a photo of each.",
  [SLIDE_TITLES.TRACTION]:
    "Not on record yet. Add revenue, paying customers or usage, and how it has grown.",
  [SLIDE_TITLES.MARKET]:
    "Not on record yet. Add who buys, how many of them there are, and what they spend.",
  [SLIDE_TITLES.CUSTOMERS]:
    "Not on record yet. Add who your customers are, and any pilots or contracts.",
  [SLIDE_TITLES.FINANCIAL]:
    "Not on record yet. Add revenue, monthly burn and runway.",
};

export function placeholderDetail(title: string): string {
  return (
    PLACEHOLDER_DETAIL[title] ??
    "Not on record yet. Tell Q what belongs here and it will add it."
  );
}

/** Where a new slide for `dimension` reads in the deck (the cover stays first). */
function insertAt(
  content: QArtifactContent,
  slides: readonly QSlide[],
  title: string,
): number {
  const dimension = DECK_ORDER.find((d) => SLIDE_TITLES[d] === title);
  if (dimension === undefined) return slides.length;
  const order = DECK_ORDER.indexOf(dimension);
  let at = 1;
  slides.forEach((slide, index) => {
    const topic =
      slide.section > 0
        ? (content.sections[slide.section]?.heading ?? slide.title)
        : slide.title;
    const own = DECK_ORDER.find((d) => SLIDE_TITLES[d] === topic);
    if (index > 0 && own !== undefined && DECK_ORDER.indexOf(own) < order) {
      at = index + 1;
    }
  });
  return at;
}

/**
 * The founder's own raise and team on their own deck, when the record's
 * findings did not already make those slides. Returns the deck and the
 * statements that ground it (the founder's own records, said plainly).
 */
export function fillOwnSlides(
  content: QArtifactContent,
  facts: OwnDeckFacts,
): {
  readonly content: QArtifactContent;
  readonly grounding: readonly string[];
} {
  const deck = content.deck;
  if (deck === undefined || deck.markIsDraft) {
    return { content, grounding: [] };
  }
  const sections: QArtifactSection[] = [...content.sections];
  const slides: QSlide[] = [...deck.slides];
  const grounding: string[] = [];
  let gaps = [...content.gaps];
  const has = (title: string) =>
    slides.some(
      (slide, index) =>
        index > 0 &&
        slide.placeholder?.kind !== "TEXT" &&
        (slide.section > 0
          ? sections[slide.section]?.heading === title
          : slide.title === title),
    );

  const round = facts.round;
  const amount =
    round === null ? null : formatAmount(round.amount, round.currency);
  if (
    round !== null &&
    amount !== null &&
    !has(SLIDE_TITLES.CAPITAL_OBJECTIVE) &&
    sections.length < 24
  ) {
    const instrument = instrumentLabel(round.instrument);
    const raising = `We are raising ${amount}${instrument === null ? "" : ` on a ${instrument}`}${round.name === null ? "" : ` (${round.name.trim()})`}.`;
    const uses =
      round.useOfFunds === null
        ? []
        : splitStatement(inCompanyVoice(round.useOfFunds)).slice(0, 3);
    grounding.push(raising);
    if (round.useOfFunds !== null) grounding.push(round.useOfFunds);
    const section = sections.length;
    sections.push({
      heading: SLIDE_TITLES.CAPITAL_OBJECTIVE,
      body: [raising, round.useOfFunds ?? ""].join(" ").trim().slice(0, 6_000),
      findings: [],
    });
    slides.splice(
      insertAt(content, slides, SLIDE_TITLES.CAPITAL_OBJECTIVE),
      0,
      {
        layout: "BULLETS",
        title: `Raising ${amount}`.slice(0, 160),
        bullets:
          uses.length > 0
            ? uses.map((use, i) => (i === 0 ? `Use of funds: ${use}` : use))
            : ["Use of funds: add yours"],
        bulletsRight: [],
        figures: [
          {
            value: amount,
            label: instrument === null ? "This round" : capitalise(instrument),
          },
        ],
        section,
      },
    );
    gaps = gaps.filter((gap) => gap !== GAP_LABELS.CAPITAL_OBJECTIVE);
  }

  const team = facts.team
    .filter((member) => member.name.trim().length > 0)
    .slice(0, 5);
  if (team.length > 0 && !has(SLIDE_TITLES.TEAM) && sections.length < 24) {
    const lines = team.map((member) =>
      clampAtWord(
        member.role === null || member.role.trim().length === 0
          ? `${member.name.trim()}${member.founder ? ", founder" : ""}`
          : `${member.name.trim()}, ${member.role.trim()}`,
        180,
      ),
    );
    grounding.push(...lines);
    const section = sections.length;
    sections.push({
      heading: SLIDE_TITLES.TEAM,
      body: lines.map((line) => `${line}.`).join(" "),
      findings: [],
    });
    slides.splice(insertAt(content, slides, SLIDE_TITLES.TEAM), 0, {
      layout: "BULLETS",
      title: SLIDE_TITLES.TEAM,
      bullets: lines,
      bulletsRight: [],
      section,
    });
    gaps = gaps.filter((gap) => gap !== GAP_LABELS.TEAM);
  }
  return {
    content: {
      ...content,
      sections,
      gaps,
      deck: { ...deck, slides: slides.slice(0, 24) },
    },
    grounding,
  };
}

/**
 * No slide is ever empty: a content slide with nothing to show becomes a
 * marked placeholder that says what to add.
 */
export function neverEmptySlides(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    if (index === 0) return slide;
    const empty =
      slide.bullets.length === 0 &&
      slide.bulletsRight.length === 0 &&
      slide.subtitle === undefined &&
      slide.figures === undefined &&
      slide.chart === undefined &&
      slide.image === undefined &&
      slide.attribution === undefined;
    if (!empty) return slide;
    const topic = slideTopic(content, index);
    return {
      ...slide,
      layout: "STATEMENT",
      bullets: [placeholderDetail(topic)],
      placeholder: slide.placeholder ?? {
        kind: "TEXT",
        label: `${topic.length > 0 ? topic : slide.title}: add yours`.slice(
          0,
          90,
        ),
      },
    };
  });
  return { ...content, deck: { ...deck, slides } };
}
