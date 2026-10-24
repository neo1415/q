/**
 * The crop geometry for profile photos and covers, pure so it is tested
 * without a browser. A photo always covers the frame: zoom 1 is the
 * smallest scale at which it does, and the offset is clamped so no empty
 * edge can show. Offsets are the image's top-left corner relative to the
 * frame's, in frame pixels.
 *
 * An organisation's logo may also zoom out until it fits whole
 * (`minZoom` below 1, see `fitZoom`): owner QA 23 Oct found wordmarks
 * stored as their middle letters ("ilo C" for Silo Credit). Along an axis
 * where the image is smaller than the frame it stays centred.
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

/** The zoom (relative to cover) at which the whole image just fits. */
export function fitZoom(image: Size, frame: Size): number {
  const contain = Math.min(
    frame.width / image.width,
    frame.height / image.height,
  );
  return contain / coverScale(image, frame);
}

export function clampCrop(
  state: CropState,
  image: Size,
  frame: Size,
  minZoom: number = MIN_ZOOM,
): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, state.zoom));
  const scale = coverScale(image, frame) * zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  const clamp = (value: number, size: number, span: number) =>
    size <= span
      ? (span - size) / 2
      : Math.min(0, Math.max(span - size, value));
  return {
    zoom,
    x: clamp(state.x, width, frame.width),
    y: clamp(state.y, height, frame.height),
  };
}

/** Centred at `zoom` (1, covering, unless a logo starts whole). */
export function initialCrop(
  image: Size,
  frame: Size,
  zoom: number = MIN_ZOOM,
): CropState {
  const scale = coverScale(image, frame) * zoom;
  return {
    zoom,
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
  minZoom: number = MIN_ZOOM,
): CropState {
  const base = coverScale(image, frame);
  const from = base * state.zoom;
  const to = base * Math.min(MAX_ZOOM, Math.max(minZoom, zoom));
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
    minZoom,
  );
}

/**
 * Where the whole image lands on an output canvas of `output` size: the
 * frame scaled up, so the canvas holds exactly what the frame showed
 * (the canvas clips what falls outside; what the image doesn't cover
 * stays transparent).
 */
export function drawRect(
  state: CropState,
  image: Size,
  frame: Size,
  output: Size,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = coverScale(image, frame) * state.zoom;
  const kx = output.width / frame.width;
  const ky = output.height / frame.height;
  return {
    dx: state.x * kx,
    dy: state.y * ky,
    dw: image.width * scale * kx,
    dh: image.height * scale * ky,
  };
}

/** The source rectangle (in image pixels) the frame shows. */
export function sourceRect(
  state: CropState,
  image: Size,
  frame: Size,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = coverScale(image, frame) * state.zoom;
  return {
    // Offsets are <= 0; max() also normalises -0 to 0.
    sx: Math.max(0, -state.x / scale),
    sy: Math.max(0, -state.y / scale),
    sw: frame.width / scale,
    sh: frame.height / scale,
  };
}
