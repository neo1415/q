import sharp from "sharp";

import type {
  ProcessedImage,
  ProfileImageProcessor,
} from "../application/profile-images.js";

/**
 * The profile-image processor: decode untrusted bytes, re-encode a clean
 * rendition. `rotate()` bakes the EXIF orientation into pixels; sharp
 * writes no input metadata (EXIF, GPS, XMP, ICC comments) unless asked
 * with `withMetadata`, which this never calls -- that is the stripping.
 * Pixel and format limits refuse decompression bombs and anything that is
 * not a JPEG, PNG or WebP by its bytes (never by its declared type).
 */

const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp"]);
/** ~40 megapixels: any real photo, and a hard stop for a bomb. */
const MAX_INPUT_PIXELS = 40_000_000;

export function createSharpImageProcessor(): ProfileImageProcessor {
  return {
    process: async (bytes, target): Promise<ProcessedImage | null> => {
      const input = sharp(bytes, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: "error",
        animated: false,
      });
      const meta = await input.metadata().catch(() => null);
      if (
        meta === null ||
        meta.format === undefined ||
        !ACCEPTED_FORMATS.has(meta.format) ||
        meta.width === undefined ||
        meta.height === undefined
      ) {
        return null;
      }
      // Orientation 5-8 swap the axes.
      const orientation = meta.orientation ?? 1;
      const sourceWidth = orientation >= 5 ? meta.height : meta.width;
      const output = await input
        .rotate()
        .resize(target.width, target.height, {
          fit: "cover",
          position: "centre",
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return {
        bytes: new Uint8Array(output.data),
        contentType: "image/webp",
        width: output.info.width,
        height: output.info.height,
        sourceWidth,
      };
    },
  };
}
