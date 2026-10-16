import { z } from "zod";

/** DOCS: one picture the server placed on a slide, in slide units. */
export const SlidePictureSchema = z.object({
  slide: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  // A stock photo's CDN or a signed storage URL: https only.
  url: z.string().url().startsWith("https://"),
  alt: z.string().max(200),
  credit: z.string().max(120),
  fit: z.enum(["cover", "contain"]),
});
export type SlidePicture = z.infer<typeof SlidePictureSchema>;

/** The layout's slide size (deck-render SLIDE_WIDTH × SLIDE_HEIGHT). */
const SLIDE_W = 960;
const SLIDE_H = 540;

/** The server's pictures for a deck, each checked on its own (https only). */
export function slidePicturesOf(listed: unknown): readonly SlidePicture[] {
  return (Array.isArray(listed) ? listed : [])
    .slice(0, 48)
    .flatMap((raw: unknown) => {
      const picture = SlidePictureSchema.safeParse(raw);
      return picture.success ? [picture.data] : [];
    });
}

/**
 * DOCS: the slide's pictures, drawn over the slide where the layout put
 * them. A slide shown as an SVG image cannot load pictures itself, so
 * they come straight from where they live: a stock photo from its CDN, a
 * generated one by a short-lived signed URL from private storage (never
 * through this app). Each says where it came from on the picture itself.
 */
export function SlidePictures({
  pictures,
}: {
  readonly pictures: readonly SlidePicture[];
}) {
  return (
    <>
      {pictures.map((picture) => (
        <figure
          key={`${picture.url}:${String(picture.x)}`}
          className="absolute m-0 overflow-hidden"
          style={{
            left: `${String((picture.x / SLIDE_W) * 100)}%`,
            top: `${String((picture.y / SLIDE_H) * 100)}%`,
            width: `${String((picture.width / SLIDE_W) * 100)}%`,
            height: `${String((picture.height / SLIDE_H) * 100)}%`,
          }}
          data-q-slide-picture
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL; an optimiser would proxy it through this app */}
          <img
            src={picture.url}
            alt={picture.alt}
            referrerPolicy="no-referrer"
            className={`size-full ${picture.fit === "contain" ? "object-contain" : "object-cover"}`}
          />
          {picture.credit.length === 0 ? null : (
            <figcaption className="cq-caption absolute bottom-1 start-1 bg-(--cq-surface-raised) px-1.5 py-0.5 text-(--cq-text-secondary)">
              {picture.credit}
            </figcaption>
          )}
        </figure>
      ))}
    </>
  );
}
