import { z } from "zod";

import type { QTurn } from "../conversation";

/**
 * Q room W5 (R8): the deck surface, in code. Which slides came back from
 * the Q API's drawing, where each placeholder's drop target goes, which
 * placeholder an Upload fills, when the document changed (so the surface
 * reads it again and stays on its slide), and what Q sees of it.
 */

/** The layout's slide size (deck-render SLIDE_WIDTH × SLIDE_HEIGHT). */
export const SLIDE_W = 960;
export const SLIDE_H = 540;

const BoxSchema = z.object({
  slide: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const DeckPictureSchema = BoxSchema.extend({
  url: z.string().url().startsWith("https://"),
  alt: z.string().max(200),
  credit: z.string().max(120),
  fit: z.enum(["cover", "contain"]),
});
export type DeckPicture = z.infer<typeof DeckPictureSchema>;

export const DeckPlaceholderSchema = BoxSchema.extend({
  kind: z.enum(["IMAGE", "TEXT"]),
  label: z.string().max(120),
});
export type DeckPlaceholder = z.infer<typeof DeckPlaceholderSchema>;

export type DeckDrawing = {
  readonly slides: readonly string[];
  readonly pictures: readonly DeckPicture[];
  readonly placeholders: readonly DeckPlaceholder[];
};

/** The Q API's slides answer, validated; null when it is not one. */
export function deckDrawingOf(body: unknown): DeckDrawing | null {
  const parsed = z
    .object({
      slides: z.array(z.string().max(400_000)).max(24),
      images: z.array(z.unknown()).max(200).default([]),
      placeholders: z.array(z.unknown()).max(48).default([]),
    })
    .safeParse(body);
  if (!parsed.success) return null;
  const pictures = parsed.data.images.flatMap((raw) => {
    const one = DeckPictureSchema.safeParse(raw);
    return one.success ? [one.data] : [];
  });
  const placeholders = parsed.data.placeholders.flatMap((raw) => {
    const one = DeckPlaceholderSchema.safeParse(raw);
    return one.success ? [one.data] : [];
  });
  return { slides: parsed.data.slides, pictures, placeholders };
}

/** A box on a slide, as percentages of the slide, for an overlay. */
export function boxStyle(box: z.infer<typeof BoxSchema>): {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
} {
  const pct = (value: number, of: number) =>
    `${String(Math.round((value / of) * 10_000) / 100)}%`;
  return {
    left: pct(box.x, SLIDE_W),
    top: pct(box.y, SLIDE_H),
    width: pct(box.width, SLIDE_W),
    height: pct(box.height, SLIDE_H),
  };
}

/**
 * Which picture space an Upload fills (0-based slide): the one on the
 * slide on screen, else the first one in the deck; null when the deck
 * has none (the file then goes to their data room only).
 */
export function uploadTarget(
  placeholders: readonly DeckPlaceholder[],
  slide: number,
): number | null {
  const pictures = placeholders.filter((box) => box.kind === "IMAGE");
  if (pictures.some((box) => box.slide === slide)) return slide;
  return pictures[0]?.slide ?? null;
}

/**
 * How many times this conversation has filed a version of the document:
 * when it changes, the surface reads the document again (and stays on
 * its slide, or goes where an edit's GO_TO_PAGE says).
 */
export function deckRevisionKey(
  turns: readonly QTurn[],
  artifactId: string,
): number {
  let count = 0;
  for (const turn of turns) {
    if (turn.kind !== "Q") continue;
    for (const block of turn.blocks) {
      if (
        block.kind === "ARTIFACT_REFERENCE" &&
        block.artifactId.toLowerCase() === artifactId.toLowerCase()
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** What Q sees of the open deck: one line, never its content. */
export function deckSeenLine(input: {
  readonly title: string;
  readonly slide: number;
  readonly slides: number;
  readonly version: number | null;
  readonly placeholders: readonly DeckPlaceholder[];
}): string {
  const spaces = input.placeholders.filter(
    (box) => box.slide === input.slide - 1,
  );
  const version =
    input.version === null ? "" : `, version ${String(input.version)}`;
  const here =
    spaces.length === 0
      ? ""
      : `; this slide has a space to fill (${spaces
          .map((box) => box.label)
          .join("; ")})`;
  return `${input.title} open on slide ${String(input.slide)} of ${String(
    input.slides,
  )}${version}${here}`.slice(0, 300);
}

/** Only pictures can go on a slide; anything else goes to the data room. */
export function isSlidePicture(file: {
  readonly type: string;
  readonly size: number;
}): boolean {
  return (
    (file.type === "image/png" || file.type === "image/jpeg") &&
    file.size > 0 &&
    file.size <= 5 * 1024 * 1024
  );
}
