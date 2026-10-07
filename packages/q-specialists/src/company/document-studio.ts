import type {
  CorrelationId,
  ModelSensitivity,
  QArtifactContent,
  QChart,
  QDeck,
  QDocumentAudit,
  QSlide,
} from "@capital-q/contracts";
import {
  contrastRatio,
  designDirectionFor,
  inspectDeck,
  layOutDeck,
} from "@capital-q/deck-render";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DocumentPolishV2ResultSchema,
  renderPrompt,
  type DocumentPolishResult,
  type DocumentPolishV2Result,
  type DocumentPolishVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import { illustrateDeck, type StockPhotoPort } from "./deck-photos.js";
import { clampAtWord, inCompanyVoice } from "./deck-writer.js";
import {
  illustrateWithGenerated,
  type IllustrationPort,
} from "./deck-illustrations.js";

/**
 * The document studio (DOCS spec §5): the specialist steps a composed deck
 * passes through before it is filed.
 *
 *   compose → design → brand → imagery (stock, then generated) → charts
 *   → words → audit
 *
 * Every step takes content and returns content. A step that cannot run,
 * or fails, returns what it was given: a deck is never lost to a step.
 * Only two steps reach outside (imagery: the stock library; words: one
 * governed model call), and both are ports. None of them adds a figure:
 * the words step keeps any line whose rewrite states a number the deck's
 * grounding does not, and the audit names any figure on a slide that the
 * grounding does not carry.
 */

/** The confirmed brand kit, as the studio applies it. */
export type StudioBrand = {
  readonly kitVersion: number;
  readonly palette: {
    readonly primary: string;
    readonly secondary?: string | undefined;
    readonly background?: string | undefined;
    readonly ink?: string | undefined;
  };
  readonly pairing?: string | undefined;
};

/** The words step, as a port: slides in, reworded slides out. */
export type DeckPolisher = {
  readonly polish: (input: {
    readonly deck: QDeck;
    readonly sensitivity: ModelSensitivity;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly qRunId: string;
      readonly correlationId: CorrelationId;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<DocumentPolishResult | null>;
};

// --- figures --------------------------------------------------------------

/** "1,200" and "1200" are the same figure; "2.5." is "2.5". */
function figuresOf(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? [])
    .map((figure) => figure.replace(/,/g, "").replace(/\.+$/, ""))
    .filter((figure) => figure.length > 0);
}

/** Every figure a slide shows, with where it is shown. */
function slideFigures(slide: QSlide): { where: string; text: string }[] {
  const shown: { where: string; text: string }[] = [
    { where: "title", text: slide.title },
    ...(slide.subtitle === undefined
      ? []
      : [{ where: "subtitle", text: slide.subtitle }]),
    ...slide.bullets.map((text) => ({ where: "bullet", text })),
    ...slide.bulletsRight.map((text) => ({ where: "bullet", text })),
    ...(slide.figures ?? []).flatMap((figure) => [
      { where: "figure", text: figure.value },
      { where: "figure", text: figure.label },
    ]),
    ...(slide.chart?.points ?? []).map((point) => ({
      where: "chart",
      text: point.value,
    })),
  ];
  return shown;
}

/**
 * The figures on a deck's slides that its grounding does not carry.
 * Empty is the only acceptable answer for a filed deck (QX-004 §4).
 */
export function ungroundedFigures(
  content: QArtifactContent,
  grounding: readonly string[],
): readonly { readonly slide: number; readonly figure: string }[] {
  const deck = content.deck;
  if (deck === undefined) return [];
  const known = new Set(figuresOf(grounding.join(" ")));
  const found: { slide: number; figure: string }[] = [];
  deck.slides.forEach((slide, index) => {
    for (const shown of slideFigures(slide)) {
      for (const figure of figuresOf(shown.text)) {
        if (!known.has(figure)) found.push({ slide: index + 1, figure });
      }
    }
  });
  return found;
}

/**
 * Charts and headline figures whose numbers are not all grounded are
 * taken off the slide; the numbers stay in the section prose where they
 * already are. Text lines are the composer's own grounded statements and
 * are never rewritten here.
 */
export function keepOnlyGroundedVisuals(
  content: QArtifactContent,
  grounding: readonly string[],
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const known = new Set(figuresOf(grounding.join(" ")));
  const grounded = (text: string) =>
    figuresOf(text).every((figure) => known.has(figure));
  const slides = deck.slides.map((slide): QSlide => {
    let next = slide;
    if (
      next.chart !== undefined &&
      !next.chart.points.every((point) => grounded(point.value))
    ) {
      const { chart: _dropped, ...rest } = next;
      next = {
        ...rest,
        layout: rest.subtitle === undefined ? "STATEMENT" : "BULLETS",
        bullets: rest.subtitle === undefined ? [rest.title] : [rest.subtitle],
      };
    }
    if (next.figures !== undefined) {
      const kept = next.figures.filter(
        (figure) => grounded(figure.value) && grounded(figure.label),
      );
      const { figures: _figures, ...rest } = next;
      next = kept.length === 0 ? rest : { ...rest, figures: kept };
    }
    return next;
  });
  return { ...content, deck: { ...deck, slides } };
}

// --- design ---------------------------------------------------------------

/**
 * The sector's direction and type pairing, only when the person chose no
 * direction and has no brand. Q's choice is reference data, never a model
 * picking colours.
 */
export function designDeck(
  content: QArtifactContent,
  input: {
    readonly sectorCodes: readonly string[];
    readonly directionChosen: boolean;
  },
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined || input.directionChosen) return content;
  if (deck.brand?.kitVersion !== undefined) return content;
  const design = designDirectionFor(input.sectorCodes);
  return {
    ...content,
    deck: {
      ...deck,
      direction: design.direction,
      brand: { ...deck.brand, pairing: deck.brand?.pairing ?? design.pairing },
    },
  };
}

// --- brand ----------------------------------------------------------------

const TEXT_CONTRAST = 4.5;

/**
 * The confirmed brand kit applied: the primary colour as the accent, the
 * kit's pairing, and its page and text colours only where the text stays
 * readable (WCAG AA 4.5:1). A brand colour too light for text is used as
 * a fill, never as ink. Colours the person asked for on this document in
 * words (ADR 0025) are theirs and are not overridden.
 */
export function brandDeck(
  content: QArtifactContent,
  brand: StudioBrand | null,
): QArtifactContent {
  if (brand === null) return content;
  const deck = content.deck;
  const { palette } = brand;
  if (deck === undefined) {
    return {
      ...content,
      look: {
        ...content.look,
        accent: content.look?.accent ?? palette.primary,
      },
    };
  }
  const background = deck.background ?? palette.background;
  const inkCandidate = deck.ink ?? palette.ink;
  const ink =
    inkCandidate !== undefined &&
    (contrastRatio(inkCandidate, background ?? "#ffffff") ?? 0) >= TEXT_CONTRAST
      ? inkCandidate
      : undefined;
  return {
    ...content,
    deck: {
      ...deck,
      accent: palette.primary,
      ...(background === undefined ? {} : { background }),
      ...(ink === undefined ? {} : { ink }),
      brand: {
        kitVersion: brand.kitVersion,
        ...(brand.pairing === undefined && deck.brand?.pairing === undefined
          ? {}
          : { pairing: brand.pairing ?? deck.brand?.pairing }),
      },
    },
  };
}

// --- charts ---------------------------------------------------------------

const LONG_LABEL = 14;

/**
 * Each chart in the form its data suits, with its source printed under
 * it. Long labels or many points read better as horizontal bars; the
 * rest stay columns. LINE and DONUT are kept where a composer chose them.
 */
export function refineCharts(content: QArtifactContent): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const slides = deck.slides.map((slide): QSlide => {
    const chart = slide.chart;
    if (chart === undefined) return slide;
    const kind: QChart["kind"] =
      chart.kind !== "COLUMN"
        ? chart.kind
        : chart.points.length > 6 ||
            chart.points.some((point) => point.label.length > LONG_LABEL)
          ? "BAR"
          : "COLUMN";
    const source =
      chart.source ??
      (deck.markIsDraft
        ? "public sources, not verified by Capital Q"
        : "the company's record on Capital Q");
    return { ...slide, chart: { ...chart, kind, source } };
  });
  return { ...content, deck: { ...deck, slides } };
}

// --- words ----------------------------------------------------------------

function renderSlides(deck: QDeck): string {
  return deck.slides
    .map((slide, index) =>
      [
        `[${String(index + 1)}] ${slide.title}`,
        ...(slide.subtitle === undefined ? [] : [`  ${slide.subtitle}`]),
        ...slide.bullets.map((bullet) => `  - ${bullet}`),
      ].join("\n"),
    )
    .join("\n")
    .slice(0, 30_000);
}

/** The slide's own limits (contracts: QSlide), applied to the wire's text. */
const POLISH_TITLE_MAX = 160;
const POLISH_SUBTITLE_MAX = 240;
const POLISH_BULLET_MAX = 180;
const POLISH_BULLETS_MAX = 6;

/**
 * A rewrite fitted to the slide (live 2026-10-07): a field longer than
 * the slide allows is cut at a word boundary rather than refusing the
 * whole rewrite, and narrator phrasing is put in the company's voice.
 * Returns the fitted result and which fields were cut (paths only, never
 * the text), for the log.
 */
export function fitPolish(result: DocumentPolishV2Result): {
  readonly result: DocumentPolishResult;
  readonly trimmed: readonly string[];
} {
  const trimmed: string[] = [];
  const fit = (
    text: string | null,
    max: number,
    path: string,
  ): string | null => {
    if (text === null) return null;
    const voiced = inCompanyVoice(text);
    if (voiced.length <= max) return voiced.length === 0 ? null : voiced;
    trimmed.push(path);
    const cut = clampAtWord(voiced, max);
    return cut.length === 0 ? null : cut;
  };
  const slides = result.slides.map((slide) => {
    const at = `slides.${String(slide.number)}`;
    let bullets: string[] | null = null;
    if (slide.bullets !== null) {
      if (slide.bullets.length > POLISH_BULLETS_MAX) {
        trimmed.push(`${at}.bullets`);
      }
      const fitted = slide.bullets
        .slice(0, POLISH_BULLETS_MAX)
        .map((line, index) =>
          fit(line, POLISH_BULLET_MAX, `${at}.bullets.${String(index)}`),
        );
      // A line that fits to nothing keeps the whole list as it was.
      bullets = fitted.every((line): line is string => line !== null)
        ? fitted
        : null;
    }
    return {
      number: slide.number,
      title: fit(slide.title, POLISH_TITLE_MAX, `${at}.title`),
      subtitle: fit(slide.subtitle, POLISH_SUBTITLE_MAX, `${at}.subtitle`),
      bullets,
    };
  });
  return { result: { slides }, trimmed: trimmed.slice(0, 24) };
}

/**
 * The words step: one governed call, and at most one more if the answer
 * could not be read. A refused list element (one slide's rewrite) is
 * dropped on its own rather than refusing the others, and an over-long
 * field is trimmed here rather than refused (DOCUMENT_POLISH v2).
 *
 * NORMAL_DIALOGUE: this is a short rewrite of text the deck already holds,
 * not a synthesis of evidence, and its 4,096-token ceiling is several
 * times what a 24-slide rewrite needs.
 */
export function createDeckPolisher(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
}): DeckPolisher {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return {
    polish: async (input) => {
      const rendered = renderPrompt<DocumentPolishVariables>(registry, {
        task: "DOCUMENT_POLISH",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are rewording slides of a deck that was just composed from the company's record. No record, no evidence and no tools are available to you, and any figure you add will be discarded.",
        variables: { document: renderSlides(input.deck) },
      });
      const attempt = async (): Promise<DocumentPolishV2Result | null> => {
        const executed =
          await dependencies.gateway.execute<DocumentPolishV2Result>(
            {
              taskClass: "NORMAL_DIALOGUE",
              budget: budgetForTaskClass("NORMAL_DIALOGUE"),
              sensitivity: input.sensitivity,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: input.attribution,
            },
            {
              schema: DocumentPolishV2ResultSchema,
              invalidListItems: "DROP",
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
        if (executed.output.kind !== "STRUCTURED") return null;
        const dropped = executed.output.dropped ?? [];
        if (dropped.length > 0) {
          dependencies.logger?.warn(
            { dropped },
            "deck polish kept; refused slide rewrites were dropped",
          );
        }
        return executed.output.value;
      };
      // Bounded: the first call, and one repair attempt only when the
      // answer was unreadable (never for an outage, a budget or a cancel).
      for (let round = 1; round <= 2; round += 1) {
        try {
          const value = await attempt();
          if (value === null) return null;
          const fitted = fitPolish(value);
          if (fitted.trimmed.length > 0) {
            dependencies.logger?.warn(
              { trimmed: fitted.trimmed },
              "deck polish kept; over-long fields were trimmed",
            );
          }
          return fitted.result;
        } catch (error: unknown) {
          const failure = isModelGatewayError(error)
            ? error.failureClass
            : "unknown";
          const retry =
            round === 1 &&
            failure === "INVALID_MODEL_OUTPUT" &&
            input.signal?.aborted !== true;
          dependencies.logger?.warn(
            { err: failure, round, retry },
            "deck polish model call did not complete",
          );
          if (!retry) return null;
        }
      }
      return null;
    },
  };
}

/**
 * The reworded lines applied: a line whose rewrite states a figure the
 * grounding (and the slide itself) does not carry keeps its old words, a
 * bullet list of a different length is not applied, and the cover's title
 * (the company's name) never changes.
 */
export function applyPolish(
  content: QArtifactContent,
  result: DocumentPolishResult,
  grounding: readonly string[],
): QArtifactContent {
  const deck = content.deck;
  if (deck === undefined) return content;
  const known = new Set(figuresOf(grounding.join(" ")));
  // Whatever produced the rewrite, it is fitted to the slide here too.
  const fitted = fitPolish(result).result;
  const changes = new Map(fitted.slides.map((slide) => [slide.number, slide]));
  const slides = deck.slides.map((slide, index): QSlide => {
    const change = changes.get(index + 1);
    if (change === undefined) return slide;
    const own = new Set([
      ...known,
      ...slideFigures(slide).flatMap((shown) => figuresOf(shown.text)),
    ]);
    const safe = (text: string | null): text is string =>
      text !== null && figuresOf(text).every((figure) => own.has(figure));
    const bullets =
      change.bullets !== null &&
      change.bullets.length === slide.bullets.length &&
      change.bullets.every((line) => safe(line))
        ? change.bullets
        : slide.bullets;
    return {
      ...slide,
      title: index > 0 && safe(change.title) ? change.title : slide.title,
      ...(slide.subtitle !== undefined && safe(change.subtitle)
        ? { subtitle: change.subtitle }
        : {}),
      bullets,
    };
  });
  return { ...content, deck: { ...deck, slides } };
}

// --- audit ----------------------------------------------------------------

/**
 * What the audit pass found on this version, and at most three things the
 * person could add. Facts about the document; never about the company.
 */
export function auditDocument(
  content: QArtifactContent,
  grounding: readonly string[],
): QDocumentAudit {
  const deck = content.deck;
  const checks: QDocumentAudit["checks"][number][] = [];
  if (deck !== undefined) {
    const issues = inspectDeck(layOutDeck(deck));
    const layout = issues.filter((issue) => issue.fault !== "LOW_CONTRAST");
    const contrast = issues.filter((issue) => issue.fault === "LOW_CONTRAST");
    checks.push({
      code: "LAYOUT_FITS",
      ok: layout.length === 0,
      ...(layout[0] === undefined
        ? {}
        : {
            note: `Slide ${String(layout[0].slide + 1)}: ${layout[0].detail}`.slice(
              0,
              300,
            ),
          }),
    });
    checks.push({
      code: "TEXT_CONTRAST",
      ok: contrast.length === 0,
      ...(contrast[0] === undefined
        ? {}
        : {
            note: `Slide ${String(contrast[0].slide + 1)}: ${contrast[0].detail}`.slice(
              0,
              300,
            ),
          }),
    });
    const ungrounded = ungroundedFigures(content, grounding);
    checks.push({
      code: "FIGURES_GROUNDED",
      ok: ungrounded.length === 0,
      ...(ungrounded[0] === undefined
        ? {}
        : {
            note: `Slide ${String(ungrounded[0].slide)} shows ${ungrounded[0].figure}, which the record does not carry.`,
          }),
    });
    const charts = deck.slides.filter((slide) => slide.chart !== undefined);
    checks.push({
      code: "CHARTS_SOURCED",
      ok: charts.every(
        (slide) =>
          slide.chart !== undefined &&
          slide.chart.grounding.length > 0 &&
          slide.chart.source !== undefined,
      ),
    });
    const images = deck.slides.filter((slide) => slide.image !== undefined);
    checks.push({
      code: "IMAGES_CREDITED",
      ok: images.every((slide) => (slide.image?.credit.trim().length ?? 0) > 0),
    });
  }
  const suggestions = content.gaps
    .slice(0, 3)
    .map((gap) =>
      `${gap}: not on record yet. Tell Q and it will add it.`.slice(0, 200),
    );
  return {
    passed: checks.every((check) => check.ok),
    checks,
    suggestions,
  };
}

// --- the whole pipeline ----------------------------------------------------

export type DocumentStudioInput = {
  readonly grounding: readonly string[];
  readonly sectorCodes: readonly string[];
  readonly directionChosen: boolean;
  readonly brand: StudioBrand | null;
  readonly photos?: StockPhotoPort | undefined;
  /** Generated pictures where the stock library had none. */
  readonly illustrations?: IllustrationPort | undefined;
  readonly polisher?: DeckPolisher | undefined;
  readonly sensitivity: ModelSensitivity;
  readonly attribution: Parameters<DeckPolisher["polish"]>[0]["attribution"];
  readonly signal?: AbortSignal | undefined;
};

export async function runDocumentStudio(
  content: QArtifactContent,
  input: DocumentStudioInput,
): Promise<QArtifactContent> {
  let next = keepOnlyGroundedVisuals(content, input.grounding);
  next = brandDeck(next, input.brand);
  next = designDeck(next, {
    sectorCodes: input.sectorCodes,
    directionChosen: input.directionChosen,
  });
  if (input.photos !== undefined && next.deck !== undefined) {
    try {
      next = await illustrateDeck(next, input.photos, { signal: input.signal });
    } catch {
      // A deck without photos is a deck.
    }
  }
  if (input.illustrations !== undefined && next.deck !== undefined) {
    next = await illustrateWithGenerated(next, input.illustrations, {
      signal: input.signal,
    });
  }
  next = refineCharts(next);
  if (input.polisher !== undefined && next.deck !== undefined) {
    const result = await input.polisher.polish({
      deck: next.deck,
      sensitivity: input.sensitivity,
      attribution: input.attribution,
      signal: input.signal,
    });
    if (result !== null) next = applyPolish(next, result, input.grounding);
  }
  return { ...next, audit: auditDocument(next, input.grounding) };
}
