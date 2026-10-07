import type { QArtifactContent, QSlide } from "@capital-q/contracts";

import { SLIDE_TITLES } from "./pitch-deck.js";

/**
 * The deck writer's deterministic pass (live 2026-10-07, wave 5b).
 *
 * The first live deck read like a summary, not a deck: every content slide
 * was one long paragraph in the record's narrator voice ("Ledgerline is
 * described as…", "The deck estimates…"), and the words step that would
 * have fixed it was lost to one long field. This pass makes real slides
 * whether or not a model ever touches them:
 *
 * - the company's own voice: narrator phrasing is rewritten ("The deck
 *   estimates X" → "We estimate X") with the fact, figure and qualifier
 *   unchanged;
 * - short bullets: a long statement is split at sentence and clause
 *   boundaries into two to four lines;
 * - numbers shown as numbers: short clauses that carry a figure become
 *   headline figures (the STAT tiles the renderer already draws), each
 *   value written exactly as the record writes it.
 *
 * It adds nothing: every word on a slide is a word from the slide's own
 * section findings (or the composer's line), and every figure is one the
 * grounding already carries. Unknown stays unknown: a placeholder slide is
 * never touched.
 */

/** Statements longer than this are split into bullets. */
const SPLIT_OVER_CHARS = 90;
/** One statement becomes at most this many bullets. */
const PIECES_MAX = 4;
const SLIDE_BULLETS_MAX = 5;
const BULLET_MAX = 180;
/** A clause this short that carries a figure reads as a stat. */
const STAT_CLAUSE_MAX = 70;
const FIGURES_MAX = 3;
const FIGURE_VALUE_MAX = 24;
const FIGURE_LABEL_MAX = 90;
export const HEADLINE_MAX = 60;

/** Where the slide's subject sits, whatever its title now says. */
export function slideTopic(content: QArtifactContent, index: number): string {
  const slide = content.deck?.slides[index];
  if (slide === undefined) return "";
  if (index === 0) return "cover";
  const heading =
    slide.section > 0 ? content.sections[slide.section]?.heading : undefined;
  return heading ?? slide.title;
}

/** Topics whose numbers are worth showing large even when there is one. */
export const STAT_TOPICS: ReadonlySet<string> = new Set([
  SLIDE_TITLES.TRACTION,
  SLIDE_TITLES.FINANCIAL,
  SLIDE_TITLES.CUSTOMERS,
  SLIDE_TITLES.CAPITAL_OBJECTIVE,
  SLIDE_TITLES.MARKET,
]);
/** Topics whose slides are never reshaped into figures. */
export const NO_FIGURES: ReadonlySet<string> = new Set([SLIDE_TITLES.TEAM]);

// --- voice ------------------------------------------------------------------

const NARRATOR =
  "(?:the |this |our )?(?:pitch deck|deck|company|founders?|team|record|materials?|documents?|submission|profile)";

/** "estimates" → "estimate": the verb in the first person plural. */
function plural(verb: string): string {
  const lower = verb.toLowerCase();
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|o)es$/.test(lower)) return lower.slice(0, -2);
  return lower.endsWith("s") ? lower.slice(0, -1) : lower;
}

export function capitalise(text: string): string {
  const first = text.charAt(0);
  return first.length === 0 ? text : `${first.toUpperCase()}${text.slice(1)}`;
}

/**
 * One line in the company's own voice. Only the narrator's frame changes:
 * what is claimed, its figures and its qualifiers stay as written.
 */
export function inCompanyVoice(line: string): string {
  let next = line.replace(/\s+/g, " ").trim();
  // "X is described as Y" → "X is Y".
  next = next.replace(
    /\b(is|are|was|were)\s+(?:described|presented|positioned|characteri[sz]ed|framed|pitched|billed|portrayed)\s+as\s+(?:being\s+)?/gi,
    "$1 ",
  );
  // "According to the deck, X" → "X".
  next = next.replace(new RegExp(`^according to ${NARRATOR},?\\s*`, "i"), "");
  next = next.replace(
    new RegExp(`,?\\s*according to ${NARRATOR}\\b`, "gi"),
    "",
  );
  // "The deck estimates X" → "We estimate X": a forecast stays a forecast.
  next = next.replace(
    new RegExp(
      `^${NARRATOR}\\s+(estimates?|projects?|expects?|plans?|aims?|intends?|targets?|believes?|forecasts?|anticipates?|hopes?|seeks?|wants?)\\b`,
      "i",
    ),
    (_match, verb: string) => `We ${plural(verb)}`,
  );
  // "The company states that X" → "X": the frame is the narrator's.
  next = next.replace(
    new RegExp(
      `^${NARRATOR}\\s+(?:states?|says?|reports?|claims?|notes?|mentions?|indicates?|describes?|explains?|highlights?|outlines?|asserts?|cites?)(?:\\s+that)?[,:]?\\s+`,
      "i",
    ),
    "",
  );
  // "Our stated model" / "The documented strategy" → "Our model": the
  // qualifier is the narrator's distance from the record, not the company's.
  next = next.replace(
    /\b(?:our|the)\s+(?:stated|documented|reported|described|declared)\s+/gi,
    (match: string) => (/^the/i.test(match) ? "The " : "Our "),
  );
  return capitalise(next.trim());
}

// --- splitting ----------------------------------------------------------------

const CONNECTOR = /^(?:and|while|with|which|who|that|but|also|plus)\s+/i;
/** "most of which file VAT" → "most file VAT": the referent is the line before. */
const PARTITIVE = /^(most|many|some|all) of (?:which|whom|them)\s+/i;

function cleanPiece(piece: string): string {
  return capitalise(
    piece
      .trim()
      .replace(CONNECTOR, "")
      .replace(PARTITIVE, "$1 ")
      .replace(/[\s,;:—–-]+$/u, "")
      .replace(/\.$/, "")
      .trim(),
  );
}

const wordCount = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

/** Cut at a word boundary, never mid-word, with no trailing ellipsis. */
export function clampAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const kept = (space > max * 0.5 ? cut.slice(0, space) : flat.slice(0, max))
    .replace(/[\s,;:—–-]+$/u, "")
    .trim();
  return kept;
}

/**
 * A statement as 1 to 4 short lines: sentences first, then clauses at
 * "; ", " — " and a comma that opens a new clause ("…, founded in 2023").
 * Lists inside a clause ("VAT, payroll and invoicing") are not split.
 */
export function splitStatement(statement: string): string[] {
  const flat = statement.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return [];
  const sentences = flat
    .split(/(?<=[.!?])\s+(?=[A-Z0-9₦$£€"“])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const pieces: string[] = [];
  // A semicolon always separates; a dash or a comma that opens a new
  // clause only in a line too long to read at a glance.
  for (const part of sentences.flatMap((sentence) => sentence.split(/;\s+/))) {
    if (part.length <= SPLIT_OVER_CHARS) {
      pieces.push(part);
      continue;
    }
    pieces.push(
      ...part.split(
        /\s+[—–]\s+|,\s+(?=(?:and|while|with|which|who|but|founded|serving|backed|based|built|used|now|since|across|growing|reaching|making|helping|having|(?:most|many|some|all) of (?:which|whom|them))\b)/iu,
      ),
    );
  }
  // Fragments of a word or two read as mistakes: they rejoin the line before.
  const merged: string[] = [];
  for (const raw of pieces) {
    const piece = cleanPiece(raw);
    if (piece.length === 0) continue;
    const last = merged[merged.length - 1];
    // A short stat ("₦38m MRR") is a line of its own, however short.
    if (last !== undefined && wordCount(piece) < 3 && statIn(piece) === null) {
      merged[merged.length - 1] =
        `${last}, ${piece.charAt(0).toLowerCase()}${piece.slice(1)}`;
      continue;
    }
    merged.push(piece);
  }
  // At most four: the shortest neighbours are joined until it fits.
  while (merged.length > PIECES_MAX) {
    let best = 0;
    for (let i = 1; i < merged.length - 1; i += 1) {
      const pair = (merged[i]?.length ?? 0) + (merged[i + 1]?.length ?? 0);
      const bestPair =
        (merged[best]?.length ?? 0) + (merged[best + 1]?.length ?? 0);
      if (pair < bestPair) best = i;
    }
    const joined = `${merged[best] ?? ""}; ${(merged[best + 1] ?? "").charAt(0).toLowerCase()}${(merged[best + 1] ?? "").slice(1)}`;
    merged.splice(best, 2, joined);
  }
  return merged.map((piece) => clampAtWord(piece, BULLET_MAX));
}

// --- figures --------------------------------------------------------------------

/**
 * A figure worth showing large, as the statement writes it: money with
 * its currency, a percentage, a multiple, or a count of two or more
 * digits. A bare year ("in 2023") is not a stat.
 */
const STAT =
  /(?:[$£€₦₹¥₵]|\b(?:NGN|USD|KES|ZAR|GHS|EUR|GBP)\s?)\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|million|billion|thousand)?\b|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|x|million|billion)\b|\b\d{1,3}(?:,\d{3})+\b|\b\d{2,}\b/iu;

const DATE_LEAD =
  /\b(?:in|since|by|from|until|founded|launched|incorporated|established|started)\s+$/i;

function statIn(
  clause: string,
): { readonly value: string; readonly at: number } | null {
  const source = new RegExp(STAT.source, "giu");
  for (const match of clause.matchAll(source)) {
    const value = match[0].trim();
    const at = match.index;
    const bare = /^\d+$/.test(value);
    if (bare && /^(?:19|20)\d{2}$/.test(value)) continue;
    if (DATE_LEAD.test(clause.slice(0, at))) continue;
    // "24 months", "12 engineers" are counts, but a bare two-digit number
    // with nothing after it is not obviously one.
    if (bare && !/^\s+\p{L}/u.test(clause.slice(at + value.length))) continue;
    if (value.length > FIGURE_VALUE_MAX) continue;
    return { value, at };
  }
  return null;
}

export const HEDGED =
  /\b(?:estimat\w*|about|approximately|approx|around|roughly|nearly|almost|up to|more than|expect\w*|project\w*|forecast\w*|target\w*|plan\w*|aim\w*|goal|could|may|might|will|would|potential\w*|addressable|TAM|SAM|SOM)\b|~/i;

const LEAD_WORDS =
  /^(?:of|in|at|a|an|the|with|and|has|have|had|is|are|was|were|we|our|reached|reaching|hit|grew to|to)\s+/i;
const TRAIL_WORDS =
  /\s+(?:of|at|is|are|was|were|has|have|had|reached|reaching|with|and|to|by|hit|grew to|stands at|totals?)$/i;

/** "1,140 paying businesses" → value "1,140", label "paying businesses". */
export function statFigure(
  clause: string,
  options: { readonly clauseMax?: number; readonly labelMax?: number } = {},
): { readonly value: string; readonly label: string } | null {
  if (clause.length > (options.clauseMax ?? STAT_CLAUSE_MAX)) return null;
  // An estimate, a plan or a target stays in words, where its hedge is
  // read with it: a number shown large reads as a fact.
  if (HEDGED.test(clause)) return null;
  const found = statIn(clause);
  if (found === null) return null;
  const before = clause.slice(0, found.at).trim();
  const after = clause
    .slice(found.at + found.value.length)
    .trim()
    .replace(/^[,;:]\s*/, "");
  const strip = (text: string): string => {
    let out = text.replace(/[.,;:]+$/, "").trim();
    for (let i = 0; i < 3; i += 1) {
      out = out.replace(LEAD_WORDS, "").replace(TRAIL_WORDS, "").trim();
    }
    return out;
  };
  const afterLabel = strip(after);
  const preposition =
    /^(?:to|for|in|by|over|since|from|per|across|within)\b/i.test(after);
  // A subject before the figure ("Ledgerline has") is the company, not
  // what is counted; what follows the figure names the thing counted.
  const label =
    afterLabel.length > 0 && !preposition
      ? afterLabel
      : strip(before).length > 0
        ? strip(`${before} ${preposition ? after : ""}`)
        : afterLabel;
  if (label.length === 0 || /\d/.test(label.replace(/\d{4}/g, ""))) {
    return null;
  }
  return {
    value: found.value,
    label: clampAtWord(label, options.labelMax ?? FIGURE_LABEL_MAX),
  };
}

/** The cover's tagline, in words (the polisher may improve within it). */
export const TAGLINE_WORDS_MAX = 12;

// --- the cover's tagline ------------------------------------------------------

const taglineWords = (text: string): string[] =>
  text.split(/\s+/).filter((word) => word.length > 0);

const TRAILING_STOP =
  /\s+(?:and|or|of|for|to|the|a|an|with|in|on|by|through|that|which|who|its|their|our|from|at|as)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A short tagline from the record's opening, cut at a clause and to at
 * most twelve words: "Ledgerline is bookkeeping and tax software for
 * Nigerian SMEs, sold through accountants." → "Bookkeeping and tax
 * software for Nigerian SMEs". Only the opening's own words.
 */
export function taglineOf(
  opening: string,
  companyName: string,
): string | undefined {
  const first = opening
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s/)[0];
  if (first === undefined || first.length === 0) return undefined;
  let line = inCompanyVoice(first).replace(/[.!?]+$/, "");
  line = line.replace(
    new RegExp(
      `^(?:${escapeRegExp(companyName.trim())}|we)\\s+(?:is|are)\\s+(?:a|an|the)?\\s*`,
      "i",
    ),
    "",
  );
  const clause =
    line.split(
      /\s+[—–]\s+|;\s+|:\s+|\s+\(|,\s+(?=(?:and|which|who|that|while|with|serving|helping|founded|based|built|used|so|sold|backed|now|since)\b)/iu,
    )[0] ?? line;
  let words = taglineWords(clause);
  if (words.length > TAGLINE_WORDS_MAX) {
    words = words.slice(0, TAGLINE_WORDS_MAX);
  }
  let out = words.join(" ").replace(/[\s,;:—–-]+$/u, "");
  for (let i = 0; i < 3; i += 1) out = out.replace(TRAILING_STOP, "");
  out = out.trim();
  return out.length === 0 ? undefined : capitalise(out);
}

export const taglineFits = (text: string): boolean =>
  taglineWords(text).length <= TAGLINE_WORDS_MAX;

// --- the pass -----------------------------------------------------------------

function reshape(
  content: QArtifactContent,
  slide: QSlide,
  index: number,
): QSlide {
  // The section's findings are the full statements behind the slide (the
  // composer's bullets may be cut short); without them, the slide's own lines.
  const section =
    slide.section > 0 ? content.sections[slide.section] : undefined;
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const full = (line: string): string => {
    const short = flat(line).replace(/…$/, "");
    const found = section?.findings.find((finding) =>
      flat(finding.statement).startsWith(short),
    );
    return found === undefined ? line : flat(found.statement);
  };
  const statements = [
    ...(slide.figures ?? []).map((figure) => figure.label),
    ...slide.bullets,
  ]
    .map(full)
    .filter((line, at, all) => all.indexOf(line) === at);
  const topic = slideTopic(content, index);
  const clauses = statements
    .map(inCompanyVoice)
    .flatMap(splitStatement)
    .filter((clause) => clause.length > 0);
  if (clauses.length === 0) return slide;

  const figures: { value: string; label: string }[] = [];
  const bullets: string[] = [];
  const wantsFigures = !NO_FIGURES.has(topic) && slide.visual !== "FLOW";
  const stats = wantsFigures
    ? clauses.map((clause) => ({ clause, figure: statFigure(clause) }))
    : clauses.map((clause) => ({ clause, figure: null }));
  const statCount = stats.filter((entry) => entry.figure !== null).length;
  const showFigures =
    statCount >= 2 || (statCount === 1 && STAT_TOPICS.has(topic));
  for (const { clause, figure } of stats) {
    if (showFigures && figure !== null && figures.length < FIGURES_MAX) {
      figures.push({ value: figure.value, label: figure.label });
      continue;
    }
    if (!bullets.includes(clause)) bullets.push(clause);
  }
  const kept = bullets.slice(0, SLIDE_BULLETS_MAX);
  const first = figures[0];
  // A numbers slide says its headline number in its title.
  const headline =
    first !== undefined &&
    STAT_TOPICS.has(topic) &&
    topic !== SLIDE_TITLES.MARKET
      ? `${first.value} ${first.label}`
      : undefined;
  const { figures: _old, visual, ...rest } = slide;
  // Steps stay steps only while there are two to five of them.
  const flow =
    visual === "FLOW" &&
    kept.length >= 2 &&
    kept.length <= 5 &&
    figures.length === 0;
  return {
    ...rest,
    title:
      headline !== undefined && headline.length <= HEADLINE_MAX
        ? capitalise(headline)
        : slide.title,
    layout: kept.length >= 2 || figures.length > 0 ? "BULLETS" : "STATEMENT",
    bullets: kept,
    ...(figures.length === 0 ? {} : { figures }),
    ...(flow ? { visual: "FLOW" as const } : {}),
  };
}

/**
 * Real slides from what was composed: the company's voice, short bullets,
 * figures shown large. The cover keeps its title (the company's name) and
 * its subtitle only loses the narrator's frame; charts, placeholders and
 * two-column slides keep their shape.
 */
export function writeDeckSlides(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    // Deck wave 8: the cover's subtitle is a short tagline cut from the
    // record's opening, not the whole sentence (a public-source deck's
    // cover line says what it is, and stays as written).
    const tagline =
      index === 0 && !deck.markIsDraft && slide.subtitle !== undefined
        ? taglineOf(slide.subtitle, slide.title)
        : undefined;
    const voiced: QSlide = {
      ...slide,
      ...(slide.subtitle === undefined
        ? {}
        : { subtitle: tagline ?? inCompanyVoice(slide.subtitle) }),
    };
    // A slide written from the founder's own records (deck wave 8: their
    // round, their team) has no findings behind it and is already a slide.
    const own =
      slide.section > 0 &&
      content.sections[slide.section]?.findings.length === 0;
    if (
      index === 0 ||
      own ||
      slide.chart !== undefined ||
      slide.placeholder !== undefined ||
      slide.layout === "TWO_COLUMN" ||
      slide.layout === "QUOTE" ||
      slide.layout === "TITLE" ||
      slide.layout === "CHART"
    ) {
      return {
        ...voiced,
        bullets: slide.bullets.map(inCompanyVoice),
        bulletsRight: slide.bulletsRight.map(inCompanyVoice),
      };
    }
    return reshape(content, voiced, index);
  });
  return { ...content, deck: { ...deck, slides } };
}
