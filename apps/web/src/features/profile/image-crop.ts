/**
 * The crop geometry for profile photos and covers, pure so it is tested
 * without a browser. The image always covers the frame: zoom 1 is the
 * smallest scale at which it does, and the offset is clamped so no empty
 * edge can show. Offsets are the image's top-left corner relative to the
 * frame's, in frame pixels (so always <= 0).
 */

export type CropState = {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
};

export type Size = { readonly width: number; readonly height: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/** The scale at which the image just covers the frame. */
export function coverScale(image: Size, frame: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

export function clampCrop(
  state: CropState,
  image: Size,
  frame: Size,
): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom));
  const scale = coverScale(image, frame) * zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  const clamp = (value: number, min: number) =>
    Math.min(0, Math.max(min, value));
  return {
    zoom,
    x: clamp(state.x, frame.width - width),
    y: clamp(state.y, frame.height - height),
  };
}

/** Centred at zoom 1. */
export function initialCrop(image: Size, frame: Size): CropState {
  const scale = coverScale(image, frame);
  return {
    zoom: 1,
    x: (frame.width - image.width * scale) / 2,
    y: (frame.height - image.height * scale) / 2,
  };
}

/** Zoom about the frame's centre, keeping what is under it in place. */
export function zoomTo(
  state: CropState,
  zoom: number,
  image: Size,
  frame: Size,
): CropState {
  const base = coverScale(image, frame);
  const from = base * state.zoom;
  const to = base * Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return clampCrop(
    {
      zoom,
      x: cx - ((cx - state.x) / from) * to,
      y: cy - ((cy - state.y) / from) * to,
    },
    image,
    frame,
  );
}

/** The source rectangle (in image pixels) the frame shows. */
export function sourceRect(
  state: CropState,
  image: Size,
  frame: Size,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = coverScale(image, frame) * state.zoom;
  return {
    sx: -state.x / scale,
    sy: -state.y / scale,
    sw: frame.width / scale,
    sh: frame.height / scale,
  };
}
