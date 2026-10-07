import type {
  QArtifactContent,
  QSlide,
  QSlideImage,
} from "@capital-q/contracts";

/**
 * Generated illustrations for a deck (DOCS; ADR 0031 addendum): where a
 * slide wants a picture and the stock library had none, or the person
 * asked for one.
 *
 * The prompt is built here, by code, from the deck's own words: the
 * slide's title, the cover's one-line description (the record's own
 * opening) and the brand colours. Never a figure, never a person's name,
 * never the team slide, and the gateway appends its standing exclusions
 * (no text, no logos, no real people) to whatever is sent.
 */

export type IllustrationPort = {
  /**
   * One generated image for a slide, filed with its provenance, or null
   * when images are off, the budget is spent, or the provider failed.
   */
  readonly illustrate: (input: {
    readonly prompt: string;
    readonly purpose: "COVER" | "SLIDE";
    readonly alt: string;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QSlideImage | null>;
};

/** The team slide's own title (pitch-deck.ts): people are never drawn. */
const NEVER_ILLUSTRATED: ReadonlySet<string> = new Set(["Team"]);

/**
 * Generated pictures per composed deck by default (the in-run studio); the
 * document pipeline asks for up to six (Q room W5), within the budgets.
 */
export const ILLUSTRATIONS_PER_DECK = 2;

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The prompt for one slide, from the deck's own words only. */
export function illustrationPrompt(input: {
  readonly slideTitle: string;
  readonly description: string | undefined;
  readonly accent: string | undefined;
  readonly cover: boolean;
}): string {
  const about =
    input.description === undefined
      ? ""
      : ` The company: ${oneLine(input.description, 240)}.`;
  const palette =
    input.accent === undefined
      ? "a calm, restrained palette"
      : `a restrained palette led by ${input.accent}`;
  return `${
    input.cover
      ? "A calm, abstract editorial illustration for the cover of an investor deck."
      : `A calm editorial illustration for an investor-deck slide titled "${oneLine(input.slideTitle, 100)}".`
  }${about} Minimal flat style, generous negative space, ${palette}, suitable as a background beside text.`;
}

function wanted(slide: QSlide, index: number): boolean {
  if (slide.image !== undefined) return false;
  // Q room W5: a marked space is the person's to fill.
  if (slide.placeholder !== undefined) return false;
  if (slide.visual !== undefined || slide.figures !== undefined) return false;
  if (NEVER_ILLUSTRATED.has(slide.title)) return false;
  return index === 0 ? slide.layout === "TITLE" : slide.layout === "BULLETS";
}

/**
 * Generated pictures for the slides that want one and have none, cover
 * first, at most `limit`. A slide that gets none keeps its words.
 */
export async function illustrateWithGenerated(
  content: QArtifactContent,
  port: IllustrationPort,
  options: {
    readonly limit?: number | undefined;
    /** Only these slides (1-based); absent: the ones that want a picture. */
    readonly slides?: readonly number[] | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<QArtifactContent> {
  const deck = content.deck;
  if (deck === undefined) return content;
  const limit = options.limit ?? ILLUSTRATIONS_PER_DECK;
  const description = deck.slides[0]?.subtitle;
  const targets = deck.slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide, index }) =>
      options.slides === undefined
        ? wanted(slide, index)
        : options.slides.includes(index + 1) &&
          !NEVER_ILLUSTRATED.has(slide.title) &&
          (slide.layout === "TITLE" || slide.layout === "BULLETS"),
    )
    .slice(0, limit);
  if (targets.length === 0) return content;
  const chosen = new Map<number, QSlideImage>();
  for (const { slide, index } of targets) {
    const cover = index === 0;
    try {
      const image = await port.illustrate({
        prompt: illustrationPrompt({
          slideTitle: slide.title,
          description,
          accent: deck.accent,
          cover,
        }),
        purpose: cover ? "COVER" : "SLIDE",
        alt: oneLine(
          cover
            ? "Abstract illustration for the deck's cover (AI-generated)"
            : `Illustration for "${slide.title}" (AI-generated)`,
          200,
        ),
        signal: options.signal,
      });
      if (image === null) break;
      chosen.set(index, image);
    } catch {
      break;
    }
  }
  if (chosen.size === 0) return content;
  return {
    ...content,
    deck: {
      ...deck,
      slides: deck.slides.map((slide, index) => {
        const image = chosen.get(index);
        return image === undefined ? slide : { ...slide, image };
      }),
    },
  };
}
