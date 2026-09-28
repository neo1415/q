import { describe, expect, it } from "vitest";

import {
  clampCrop,
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
});
