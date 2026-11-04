/**
 * Acceptance 2026-11-04 (J5): company logos in Q's comparison read as
 * black squares -- the pictures themselves were opaque black with a dark
 * mark ("Mi" in near-black red on black), so no tile behind them helps.
 * A logo whose every part is dark tells the reader nothing; the avatar
 * treats it as no picture and moves on (the next picture, else initials).
 *
 * Pure judgement over RGBA samples, composited onto the light logo tile
 * (a transparent logo is drawn there, so its clear pixels count as the
 * tile, never as black). A white-on-black mark has light content and is
 * kept; only "dark on dark" is refused.
 */

/** Relative luminance of an sRGB byte triple, 0 (black) to 1 (white). */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Below this, a composited pixel reads as black. */
const DARK = 0.03;
/** At least this share of dark pixels makes a dark picture. */
const DARK_SHARE = 0.55;
/** Content lighter than this is a readable mark on the dark ground. */
const LIGHT_CONTENT = 0.18;

export function isUnreadableLogo(rgba: ArrayLike<number>): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return false;
  let dark = 0;
  let lightest = 0;
  for (let i = 0; i < pixels; i += 1) {
    const a = (rgba[i * 4 + 3] ?? 0) / 255;
    // Over the light tile: clear pixels are the tile's own near-white.
    const over = (c: number) => (rgba[i * 4 + c] ?? 0) * a + 250 * (1 - a);
    const l = luminance(over(0), over(1), over(2));
    if (l < DARK) dark += 1;
    if (l > lightest) lightest = l;
  }
  return dark / pixels >= DARK_SHARE && lightest < LIGHT_CONTENT;
}

/** The sample's side: enough to judge, cheap to read. */
const SAMPLE = 24;

/**
 * Reads a logo's pixels where the browser allows it (the image is served
 * with CORS, as storage is) and judges them. "unknown" whenever it cannot
 * read them: the picture then stays exactly as it was shown.
 */
export function probeLogo(
  src: string,
): Promise<"unreadable" | "ok" | "unknown"> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve("unknown");
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context === null) {
          resolve("unknown");
          return;
        }
        context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
        const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
        resolve(isUnreadableLogo(data) ? "unreadable" : "ok");
      } catch {
        // A canvas tainted by an image without CORS: nothing to judge.
        resolve("unknown");
      }
    };
    image.onerror = () => resolve("unknown");
    image.src = src;
  });
}
