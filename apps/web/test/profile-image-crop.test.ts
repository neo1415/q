import { describe, expect, it } from "vitest";

import {
  clampCrop,
  drawRect,
  fitZoom,
  initialCrop,
  sourceRect,
  zoomTo,
} from "@/features/profile/image-crop";

/**
 * The crop behind profile photos (1:1) and covers (4:1): the image always
 * covers the frame, whatever the drag or zoom, and the exported rectangle
 * is exactly what the frame showed.
 */

const photo = { width: 1200, height: 800 };
const square = { width: 300, height: 300 };
const banner = { width: 800, height: 200 };

describe("profile image crop", () => {
  it("starts centred and covering the frame", () => {
    const crop = initialCrop(photo, square);
    expect(crop.zoom).toBe(1);
    expect(sourceRect(crop, photo, square)).toEqual({
      sx: 200,
      sy: 0,
      sw: 800,
      sh: 800,
    });
  });

  it("never lets an empty edge show, however far it is dragged", () => {
    const far = clampCrop({ zoom: 1, x: 500, y: -900 }, photo, banner);
    const rect = sourceRect(far, photo, banner);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(photo.height + 1e-9);
    expect(rect.sw / rect.sh).toBeCloseTo(4);
  });

  it("zooms about the centre and stays inside the image", () => {
    const zoomed = zoomTo(initialCrop(photo, square), 2, photo, square);
    const rect = sourceRect(zoomed, photo, square);
    expect(zoomed.zoom).toBe(2);
    expect(rect.sw).toBeCloseTo(400);
    expect(rect.sx + rect.sw / 2).toBeCloseTo(600);
    expect(zoomTo(zoomed, 9, photo, square).zoom).toBe(3);
  });

  it("a wide logo can be kept whole: it zooms out to fit, centred", () => {
    // Owner QA 23 Oct: "Silo Credit" was stored as "ilo C".
    const wordmark = { width: 1000, height: 250 };
    const min = fitZoom(wordmark, square);
    expect(min).toBeCloseTo(0.25);
    const whole = initialCrop(wordmark, square, min);
    expect(whole).toEqual({ zoom: min, x: 0, y: 112.5 });
    // Dragging can't push a fitted axis off centre.
    expect(
      clampCrop({ zoom: min, x: 40, y: -60 }, wordmark, square, min),
    ).toEqual(whole);
    // Without the logo allowance the zoom stays at cover.
    expect(clampCrop({ zoom: min, x: 0, y: 0 }, wordmark, square).zoom).toBe(1);
  });

  it("draws exactly what the frame shows onto the output canvas", () => {
    const output = { width: 1024, height: 1024 };
    const cover = initialCrop(photo, square);
    expect(drawRect(cover, photo, square, output)).toEqual({
      dx: -256,
      dy: 0,
      dw: 1536,
      dh: 1024,
    });
    const wordmark = { width: 1000, height: 250 };
    const whole = initialCrop(wordmark, square, fitZoom(wordmark, square));
    expect(drawRect(whole, wordmark, square, output)).toEqual({
      dx: 0,
      dy: 384,
      dw: 1024,
      dh: 256,
    });
  });
});
