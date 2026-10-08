import type {
  ModelSensitivity,
  QArtifactContent,
  QArtifactSection,
  QDocumentAudit,
  QDocumentPipelineStage,
  QDocumentRubric,
  QSlide,
  QSlideImage,
} from "@capital-q/contracts";
import { inspectDeck, layOutDeck } from "@capital-q/deck-render";
import type { CompanyIntelligenceDimension } from "@capital-q/q-core";

import type { CompanyIntelligenceResult } from "./contracts.js";
import { illustrateDeck, type StockPhotoPort } from "./deck-photos.js";
import { withKickers } from "./deck-shape.js";
import { tidyDeck } from "./deck-tidy.js";
import { slideTopic, writeDeckSlides } from "./deck-writer.js";
import {
  illustrateWithGenerated,
  type IllustrationPort,
} from "./deck-illustrations.js";
import {
  applyPolish,
  auditDocument,
  brandDeck,
  designDeck,
  keepOnlyGroundedVisuals,
  refineCharts,
  ungroundedFigures,
  type DeckPolisher,
  type StudioBrand,
} from "./document-studio.js";
import { composeInvestmentBrief, inventsFigures } from "./investment-brief.js";
import {
  neverEmptySlides,
  placeholderDetail,
  promoteFirmFigures,
} from "./deck-figures.js";
import { DECK_ORDER, GAP_LABELS, SLIDE_TITLES } from "./pitch-deck.js";

/**
 * The document pipeline (Q room W5, R8; research 2026-10-06 §5.4).
 *
 *   write → design → find assets → check (→ fix, at most twice) → ready
 *
 * Orchestration is code, in a fixed order; the specialists are steps, and
 * none is ever named to the person (they hear the stage lines). Every
 * step takes content and returns content, and a step that cannot run
 * returns what it was given, so a document is never lost to one.
 *
 * What it will not do, whatever the step:
 *
 * - **Invent a number.** The writer works from the record's findings;
 *   what the record does not hold becomes a marked placeholder ("Revenue:
 *   add yours"), never a plausible figure. The checker names any figure
 *   the grounding does not carry, and the fixer removes it.
 * - **Let a model choose how it looks.** The designer is code over
 *   reference data (ADR 0031): a direction, a pairing, a layout per slide.
 * - **Spend without a ceiling.** Pictures come from the person's own
 *   uploads first, then charts from their numbers, then stock photos, and
 *   only then at most six generated images; a billing refusal ends
 *   generation for the document at once (the gateway pauses the key), and
 *   the slide falls back to a stock photo or a placeholder.
 * - **Loop.** The checker's fix loop runs at most two rounds; a document
 *   still short after them ships with its notes shown.
 */

export type DocumentKind = "PITCH_DECK" | "ONE_PAGER" | "MEMO";

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "PITCH_DECK",
  "ONE_PAGER",
  "MEMO",
];

/** Generated pictures per document, whatever the budgets allow. */
export const GENERATED_IMAGES_MAX = 6;
/** Fix rounds the checker may ask for. */
export const FIX_ROUNDS_MAX = 2;
/** The quality bar: at most this many words in a slide's body. */
export const SLIDE_BODY_WORDS_MAX = 40;
/** And a rubric of at least this on every axis. */
export const RUBRIC_PASS = 4;

// --- the writer: placeholders for what the record does not hold -----------

/** The gaps worth a slide of their own in a deck, and what to ask for. */
const PLACEHOLDER_ASKS: Partial<Record<CompanyIntelligenceDimension, string>> =
  {
    MARKET: "Market size and who buys: add yours",
    CUSTOMERS: "Customers and pilots: add yours",
    TRACTION: "Revenue, users or growth: add yours",
    FINANCIAL: "Revenue, burn and runway: add yours",
    TEAM: "Who is on the team: add yours",
    CAPITAL_OBJECTIVE: "How much you are raising, and for what: add yours",
  };

/** Slides whose picture is the person's own (never stock, never drawn). */
const OWN_PICTURE_ASKS: Readonly<Record<string, string>> = {
  [SLIDE_TITLES.TEAM]: "Team photo: drop yours here",
  [SLIDE_TITLES.PRODUCT]: "Product screenshot: drop yours here",
};

function dimensionOfTitle(title: string): CompanyIntelligenceDimension | null {
  for (const dimension of DECK_ORDER) {
    if (SLIDE_TITLES[dimension] === title) return dimension;
  }
  return null;
}

function dimensionOfGap(gap: string): CompanyIntelligenceDimension | null {
  for (const dimension of DECK_ORDER) {
    if (GAP_LABELS[dimension] === gap) return dimension;
  }
  return null;
}

/**
 * A marked slide for each material gap, in the place the deck reads it.
 * A deck from public sources already says what is not public on its own
 * slide, so it gets none.
 */
export function addGapPlaceholders(
  content: QArtifactContent,
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined || deck.markIsDraft) return content;
  const missing = content.gaps
    .map(dimensionOfGap)
    .filter(
      (dimension): dimension is CompanyIntelligenceDimension =>
        dimension !== null && PLACEHOLDER_ASKS[dimension] !== undefined,
    );
  if (missing.length === 0) return content;
  const slides: QSlide[] = [...deck.slides];
  // A slide's subject is its section's heading (titles may have become
  // headlines by now); a slide without a section of its own, its title.
  const topicOf = (slide: QSlide): string =>
    slide.section > 0
      ? (content.sections[slide.section]?.heading ?? slide.title)
      : slide.title;
  for (const dimension of missing) {
    if (slides.length >= 24) break;
    if (slides.some((slide) => topicOf(slide) === SLIDE_TITLES[dimension])) {
      continue;
    }
    const order = DECK_ORDER.indexOf(dimension);
    // After the last slide that reads before it; the cover stays first.
    let at = 1;
    slides.forEach((slide, index) => {
      const own = dimensionOfTitle(topicOf(slide));
      if (index > 0 && own !== null && DECK_ORDER.indexOf(own) < order) {
        at = index + 1;
      }
    });
    // The slide says what to add, in words as well as in its marked band:
    // a title over an empty page reads as a broken deck (live 2026-10-07).
    slides.splice(at, 0, {
      layout: "STATEMENT",
      title: SLIDE_TITLES[dimension],
      bullets: [placeholderDetail(SLIDE_TITLES[dimension])],
      bulletsRight: [],
      section: 0,
      placeholder: {
        kind: "TEXT",
        label: PLACEHOLDER_ASKS[dimension] ?? "Add yours",
      },
    });
  }
  return { ...content, deck: { ...deck, slides } };
}

// --- the designer: a layout per slide, chosen by code ----------------------

/**
 * The layout each slide's content suits (ADR 0031: code, never a model).
 * A chart is drawn as a chart; a fact still to come is a statement with
 * its marked band; two lists sit side by side. Anything else keeps the
 * composer's choice, which was made from the same content.
 */
export function chooseLayouts(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    if (index === 0) return slide;
    // A chart beside headline figures or lines is drawn under them (deck
    // wave 8); a chart alone is a chart slide.
    if (slide.chart !== undefined) {
      return {
        ...slide,
        layout:
          slide.figures !== undefined || slide.bullets.length > 0
            ? "BULLETS"
            : "CHART",
      };
    }
    if (
      slide.placeholder?.kind === "TEXT" &&
      slide.bullets.length <= 1 &&
      slide.bulletsRight.length === 0
    ) {
      return { ...slide, layout: "STATEMENT" };
    }
    if (slide.bulletsRight.length > 0)
      return { ...slide, layout: "TWO_COLUMN" };
    return slide;
  });
  return { ...content, deck: { ...deck, slides } };
}

// --- the asset finder -------------------------------------------------------

/**
 * The person's own pictures (uploads, product screenshots), as the actor.
 * Absent: none are looked for. Returned pictures are stored copies
 * (`cq-image:` ids, OWN_UPLOAD) the document may show.
 */
export type OwnPicturePort = {
  readonly pictureFor: (input: {
    readonly slideTitle: string;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QSlideImage | null>;
};

/** Where every picture on the deck came from, said in the slide's notes. */
export function creditInNotes(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide): QSlide => {
    const image = slide.image;
    if (image === undefined) return slide;
    const line = `Picture: ${image.credit}`;
    if (slide.note?.includes(line) === true) return slide;
    const note = slide.note === undefined ? line : `${slide.note}\n${line}`;
    return { ...slide, note: note.slice(0, 1_000) };
  });
  return { ...content, deck: { ...deck, slides } };
}

/** The slides that should show the person's own picture, still without one. */
export function markOwnPictureSpaces(
  content: QArtifactContent,
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide, index): QSlide => {
    const ask = OWN_PICTURE_ASKS[slideTopic(content, index)];
    if (
      ask === undefined ||
      slide.image !== undefined ||
      slide.placeholder !== undefined ||
      slide.chart !== undefined ||
      slide.figures !== undefined ||
      slide.visual !== undefined ||
      // Deck quality: a team set out as people from the founder's own
      // records is drawn as a grid of them, not beside an empty frame.
      (slide.kicker === SLIDE_TITLES.TEAM && slide.bullets.length > 0)
    ) {
      return slide;
    }
    // A statement becomes a short list beside the picture's space: the
    // same words, with room left for theirs.
    return {
      ...slide,
      layout: slide.layout === "TITLE" ? "TITLE" : "BULLETS",
      placeholder: { kind: "IMAGE", label: ask },
    };
  });
  return { ...content, deck: { ...deck, slides } };
}

async function ownPictures(
  content: QArtifactContent,
  port: OwnPicturePort,
  signal: AbortSignal | undefined,
): Promise<QArtifactContent> {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides: QSlide[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const topic = slideTopic(content, index);
    if (slide.image !== undefined || OWN_PICTURE_ASKS[topic] === undefined) {
      slides.push(slide);
      continue;
    }
    const picture = await port
      .pictureFor({ slideTitle: topic, signal })
      .catch(() => null);
    if (picture === null) {
      slides.push(slide);
      continue;
    }
    const { placeholder: _filled, ...rest } = slide;
    slides.push({ ...rest, image: picture });
  }
  return { ...content, deck: { ...deck, slides } };
}

// --- the checker ------------------------------------------------------------

/**
 * One thing to change, typed: what the fixer does is code, and a critic
 * (this checker, or a vision model behind the same contract later) can
 * only ask for one of these, never edit the document itself.
 */
export type DocumentFix =
  | { readonly kind: "SHORTEN_BODY"; readonly slide: number }
  | { readonly kind: "DROP_UNGROUNDED"; readonly slide: number }
  | { readonly kind: "DROP_IMAGE"; readonly slide: number }
  | { readonly kind: "DEDUPE_TITLE"; readonly slide: number }
  | { readonly kind: "SHORTEN_SECTION"; readonly section: number };

/** A second opinion behind the same typed contract (e.g. a vision rubric). */
export type DocumentCritic = {
  /** How many times it may be asked per document (default: every round). */
  readonly rounds?: number | undefined;
  readonly review: (input: {
    readonly content: QArtifactContent;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<readonly DocumentFix[]>;
};

export type DocumentReview = {
  readonly rubric: Omit<QDocumentRubric, "rounds">;
  readonly fixes: readonly DocumentFix[];
  readonly notes: readonly string[];
};

const words = (text: string): number =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

function slideBodyWords(slide: QSlide): number {
  return [slide.subtitle ?? "", ...slide.bullets, ...slide.bulletsRight].reduce(
    (total, line) => total + words(line),
    0,
  );
}

const score = (faults: number): number => Math.max(1, 5 - Math.min(4, faults));

/** Word limits for a section of a general document. */
const SECTION_WORDS_MAX: Readonly<Record<DocumentKind, number>> = {
  PITCH_DECK: 1_000,
  ONE_PAGER: 70,
  MEMO: 260,
};

/** The rubric, computed: content, design and coherence, each 1 to 5. */
export function reviewDocument(
  content: QArtifactContent,
  grounding: readonly string[],
  kind: DocumentKind,
): DocumentReview {
  const fixes: DocumentFix[] = [];
  const notes: string[] = [];
  const deck = content.deck;
  if (deck !== undefined) {
    let contentFaults = 0;
    deck.slides.forEach((slide, index) => {
      if (index > 0 && slideBodyWords(slide) > SLIDE_BODY_WORDS_MAX) {
        contentFaults += 1;
        fixes.push({ kind: "SHORTEN_BODY", slide: index });
        notes.push(
          `Slide ${String(index + 1)} says more than ${String(SLIDE_BODY_WORDS_MAX)} words.`,
        );
      }
    });
    for (const found of ungroundedFigures(content, grounding)) {
      contentFaults += 1;
      // ungroundedFigures counts slides from 1.
      fixes.push({ kind: "DROP_UNGROUNDED", slide: found.slide - 1 });
      notes.push(
        `Slide ${String(found.slide)} shows ${found.figure}, which the record does not carry.`,
      );
    }
    const issues = inspectDeck(layOutDeck(deck));
    for (const issue of issues) {
      const slide = deck.slides[issue.slide];
      if (slide === undefined) continue;
      if (slide.image !== undefined && issue.fault !== "LOW_CONTRAST") {
        fixes.push({ kind: "DROP_IMAGE", slide: issue.slide });
      } else if (
        issue.fault === "CONTENT_DROPPED" ||
        issue.fault === "TOO_DENSE"
      ) {
        fixes.push({ kind: "SHORTEN_BODY", slide: issue.slide });
      }
      notes.push(`Slide ${String(issue.slide + 1)}: ${issue.detail}`);
    }
    const seen = new Set<string>();
    let coherenceFaults = 0;
    deck.slides.forEach((slide, index) => {
      const key = slide.title.trim().toLowerCase();
      if (seen.has(key) && slide.placeholder === undefined) {
        coherenceFaults += 1;
        fixes.push({ kind: "DEDUPE_TITLE", slide: index });
        notes.push(`Two slides are titled "${slide.title}".`);
      }
      seen.add(key);
    });
    return {
      rubric: {
        content: score(contentFaults),
        design: score(issues.length),
        coherence: score(coherenceFaults),
      },
      fixes: dedupe(fixes),
      notes: notes.slice(0, 12),
    };
  }
  // A general document: sections, read at the length the kind allows.
  let contentFaults = 0;
  content.sections.forEach((section, index) => {
    if (words(section.body) > SECTION_WORDS_MAX[kind]) {
      contentFaults += 1;
      fixes.push({ kind: "SHORTEN_SECTION", section: index });
      notes.push(
        `"${section.heading}" runs long for a ${kind === "ONE_PAGER" ? "one-pager" : "memo"}.`,
      );
    }
    if (inventsFigures(section.body, grounding)) {
      contentFaults += 1;
      notes.push(
        `"${section.heading}" states a figure the record does not carry.`,
      );
    }
  });
  const headings = content.sections.map((section) =>
    section.heading.toLowerCase(),
  );
  const coherenceFaults = headings.length - new Set(headings).size;
  return {
    rubric: {
      content: score(contentFaults),
      design: 5,
      coherence: score(coherenceFaults),
    },
    fixes: dedupe(fixes),
    notes: notes.slice(0, 12),
  };
}

function dedupe(fixes: readonly DocumentFix[]): DocumentFix[] {
  const seen = new Set<string>();
  return fixes.filter((fix) => {
    const key = JSON.stringify(fix);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function trimToWords(text: string, max: number): string {
  const kept = text.split(/\s+/).filter((word) => word.length > 0);
  if (kept.length <= max) return text;
  // Whole sentences first; a cut mid-sentence only when one is all there is.
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    const next = `${out}${sentence}`.trim();
    if (words(next) > max) break;
    out = `${next} `;
  }
  return out.trim().length > 0
    ? out.trim()
    : `${kept.slice(0, max).join(" ")}…`;
}

/** The fixer: code applies each typed fix. Nothing here adds content. */
export function applyFixes(
  content: QArtifactContent,
  fixes: readonly DocumentFix[],
  grounding: readonly string[],
  kind: DocumentKind,
): QArtifactContent {
  let next = content;
  const deck = next.deck;
  if (deck !== undefined) {
    const slides = [...deck.slides];
    for (const fix of fixes) {
      if (fix.kind === "SHORTEN_SECTION") continue;
      const slide = slides[fix.slide];
      if (slide === undefined) continue;
      switch (fix.kind) {
        case "SHORTEN_BODY": {
          // Drop the last line until the body fits; never below one line.
          let bullets = [...slide.bullets];
          let right = [...slide.bulletsRight];
          const fits = () =>
            slideBodyWords({ ...slide, bullets, bulletsRight: right }) <=
            SLIDE_BODY_WORDS_MAX;
          while (!fits() && right.length > 0) right = right.slice(0, -1);
          while (!fits() && bullets.length > 1) bullets = bullets.slice(0, -1);
          if (!fits() && bullets[0] !== undefined) {
            bullets = [trimToWords(bullets[0], SLIDE_BODY_WORDS_MAX)];
          }
          slides[fix.slide] = { ...slide, bullets, bulletsRight: right };
          break;
        }
        case "DROP_UNGROUNDED": {
          const known = grounding.join(" ");
          const keep = (line: string) => !inventsFigures(line, [known]);
          const bullets = slide.bullets.filter(keep);
          slides[fix.slide] = {
            ...slide,
            title: keep(slide.title)
              ? slide.title
              : (next.sections[slide.section]?.heading ?? "Overview"),
            bullets,
            bulletsRight: slide.bulletsRight.filter(keep),
            ...(slide.subtitle === undefined || keep(slide.subtitle)
              ? {}
              : { subtitle: undefined }),
          };
          break;
        }
        case "DROP_IMAGE": {
          const { image: _image, ...rest } = slide;
          slides[fix.slide] = rest;
          break;
        }
        case "DEDUPE_TITLE": {
          slides[fix.slide] = {
            ...slide,
            title: `${slide.title} (continued)`.slice(0, 160),
          };
          break;
        }
      }
    }
    next = keepOnlyGroundedVisuals(
      { ...next, deck: { ...deck, slides } },
      grounding,
    );
    return next;
  }
  const sections = next.sections.map((section, index): QArtifactSection =>
    fixes.some((fix) => fix.kind === "SHORTEN_SECTION" && fix.section === index)
      ? { ...section, body: trimToWords(section.body, SECTION_WORDS_MAX[kind]) }
      : section,
  );
  return { ...next, sections };
}

// --- the writer for general documents ---------------------------------------

/**
 * A one-pager or memo, from the same findings a brief is composed from
 * (and so the same refusal to invent a number). Null when the record is
 * too thin to say anything.
 */
export function composeGeneralDocument(input: {
  readonly kind: "ONE_PAGER" | "MEMO";
  readonly companyName: string;
  readonly result: CompanyIntelligenceResult;
}): {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
} | null {
  const brief = composeInvestmentBrief({
    companyName: input.companyName,
    result: input.result,
  });
  if (brief === null) return null;
  const name = input.companyName.slice(0, 120);
  if (input.kind === "MEMO") {
    return {
      ...brief,
      title: `${name} — investment memo`.slice(0, 160),
    };
  }
  // A one-pager: the summary and the five sections an investor reads
  // first, each trimmed to a paragraph, with what is missing named.
  const sections = brief.content.sections.slice(0, 6).map((section) => ({
    ...section,
    body: trimToWords(section.body, SECTION_WORDS_MAX.ONE_PAGER),
  }));
  return {
    title: `${name} — one-pager`.slice(0, 160),
    summary: brief.summary,
    content: { ...brief.content, sections },
  };
}

// --- the whole pipeline -------------------------------------------------------

export type DocumentPipelineInput = {
  readonly kind: DocumentKind;
  /** What the document may say: the record's findings, as statements. */
  readonly grounding: readonly string[];
  readonly sectorCodes: readonly string[];
  readonly directionChosen: boolean;
  readonly brand: StudioBrand | null;
  readonly ownPictures?: OwnPicturePort | undefined;
  readonly photos?: StockPhotoPort | undefined;
  readonly illustrations?: IllustrationPort | undefined;
  /** At most this many generated pictures (capped at six). */
  readonly generatedLimit?: number | undefined;
  readonly polisher?: DeckPolisher | undefined;
  readonly critic?: DocumentCritic | undefined;
  readonly sensitivity: ModelSensitivity;
  readonly attribution: Parameters<DeckPolisher["polish"]>[0]["attribution"];
  /** Told each stage as it starts, for the stage lines and the room. */
  readonly onStage?:
    ((stage: QDocumentPipelineStage) => Promise<void> | void) | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type DocumentPipelineResult = {
  readonly content: QArtifactContent;
  readonly rounds: number;
  readonly passed: boolean;
};

export async function runDocumentPipeline(
  composed: QArtifactContent,
  input: DocumentPipelineInput,
): Promise<DocumentPipelineResult> {
  const stage = async (next: QDocumentPipelineStage) => {
    try {
      await input.onStage?.(next);
    } catch {
      // Progress is a courtesy; the document does not depend on it.
    }
  };

  // 1. Write: grounded visuals only, the words step, marked gaps.
  await stage("WRITING");
  let next = keepOnlyGroundedVisuals(composed, input.grounding);
  // Real slides before any model touches them (and whether or not one
  // does): the company's voice, short bullets, numbers shown large.
  next = writeDeckSlides(next);
  if (input.polisher !== undefined && next.deck !== undefined) {
    const polished = await input.polisher
      .polish({
        deck: next.deck,
        sensitivity: input.sensitivity,
        attribution: input.attribution,
        signal: input.signal,
      })
      .catch(() => null);
    if (polished !== null) next = applyPolish(next, polished, input.grounding);
  }
  // Deck wave 8: firm numbers the polish left in sentences are shown large
  // again, after it, so the words step cannot fold them back into prose.
  next = promoteFirmFigures(next, input.grounding);
  next = addGapPlaceholders(next);

  // 2. Design: brand, the sector's direction, a layout per slide.
  await stage("DESIGNING");
  next = brandDeck(next, input.brand);
  next = designDeck(next, {
    sectorCodes: input.sectorCodes,
    directionChosen: input.directionChosen,
  });
  next = chooseLayouts(next);

  // 3. Assets, in order of preference: their own pictures, charts from
  // their numbers, stock photos, then (only for abstract visuals) at most
  // six generated pictures. What is still missing is a marked space.
  if (next.deck !== undefined) {
    await stage("FINDING_ASSETS");
    if (input.ownPictures !== undefined) {
      next = await ownPictures(next, input.ownPictures, input.signal);
    }
    next = refineCharts(next);
    // Team and product pictures are theirs: marked before the stock and
    // generated steps, which never fill a marked space.
    next = markOwnPictureSpaces(next);
    if (input.photos !== undefined) {
      next = await illustrateDeck(next, input.photos, {
        sectorCodes: input.sectorCodes,
        signal: input.signal,
      }).catch(() => next);
    }
    if (input.illustrations !== undefined) {
      next = await illustrateWithGenerated(next, input.illustrations, {
        limit: Math.min(
          GENERATED_IMAGES_MAX,
          Math.max(0, input.generatedLimit ?? GENERATED_IMAGES_MAX),
        ),
        signal: input.signal,
      });
    }
    next = creditInNotes(next);
  }

  // 4. Check, and fix by code at most twice.
  await stage("CHECKING");
  let rounds = 0;
  let review = reviewDocument(next, input.grounding, input.kind);
  let critiques = 0;
  const critique = async (): Promise<readonly DocumentFix[]> => {
    if (
      input.critic === undefined ||
      critiques >= (input.critic.rounds ?? FIX_ROUNDS_MAX)
    ) {
      return [];
    }
    critiques += 1;
    return await input.critic
      .review({ content: next, signal: input.signal })
      .catch(() => []);
  };
  let extra = await critique();
  const short = (r: DocumentReview) =>
    r.rubric.content < RUBRIC_PASS ||
    r.rubric.design < RUBRIC_PASS ||
    r.rubric.coherence < RUBRIC_PASS;
  // Every typed fix is a rule broken (40 words, a figure off the record,
  // a fault in the layout), so any one of them is worth a round.
  while (rounds < FIX_ROUNDS_MAX && review.fixes.length + extra.length > 0) {
    rounds += 1;
    await stage("FIXING");
    next = applyFixes(
      next,
      [...review.fixes, ...extra],
      input.grounding,
      input.kind,
    );
    review = reviewDocument(next, input.grounding, input.kind);
    extra = rounds < FIX_ROUNDS_MAX ? await critique() : [];
  }

  // Whatever the fixes took away, no slide ships empty; labels are
  // complete phrases and a list of periods is a chart (deck quality).
  next = tidyDeck(next);
  next = neverEmptySlides(next);
  // Deck quality: a takeaway title keeps its topic as the eyebrow.
  next = withKickers(next);
  const base = auditDocument(next, input.grounding);
  const passed = base.passed && !short(review) && review.fixes.length === 0;
  const audit: QDocumentAudit = {
    ...base,
    passed,
    checks: [
      ...base.checks,
      ...(next.deck === undefined
        ? [
            {
              code: "SECTIONS_READABLE",
              ok: review.rubric.content >= RUBRIC_PASS,
              ...(review.notes[0] === undefined
                ? {}
                : { note: review.notes[0].slice(0, 300) }),
            },
          ]
        : [
            {
              code: "SLIDES_CONCISE",
              ok: review.rubric.content >= RUBRIC_PASS,
              ...(passed || review.notes[0] === undefined
                ? {}
                : { note: review.notes[0].slice(0, 300) }),
            },
          ]),
    ].slice(0, 24),
    rubric: { ...review.rubric, rounds },
  };
  await stage("READY");
  return { content: { ...next, audit }, rounds, passed };
}
