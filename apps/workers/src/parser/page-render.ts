import { createRequire } from "node:module";

import { pdfjsAssetOptions } from "./pdfjs-assets.js";

/**
 * Page pictures for transcription, made inside the parser sandbox only:
 * decoding an uploaded image or drawing an uploaded PDF is interpreting
 * untrusted bytes, and that happens nowhere else (doc 15 §28). The output
 * is a bounded JPEG per page, sized so text stays legible (long side about
 * 1600px) while staying under the model contract's image bound.
 *
 * The canvas comes from @napi-rs/canvas, the backend pdf.js itself uses in
 * Node, resolved from pdf.js's own install so no new dependency is added.
 */

export type PageRenderOptions = {
  /** Longest side of the picture, in pixels. */
  readonly maxLongSide: number;
  /** Bytes of one JPEG at most; quality and size step down to fit. */
  readonly maxBytes: number;
};

type Canvas = {
  readonly width: number;
  readonly height: number;
  readonly getContext: (kind: "2d") => {
    fillStyle: string;
    fillRect: (x: number, y: number, w: number, h: number) => void;
    drawImage: (
      image: unknown,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => void;
  };
  readonly toBuffer: (mime: "image/jpeg", quality: number) => Buffer;
};
type CanvasModule = {
  readonly createCanvas: (width: number, height: number) => Canvas;
  readonly loadImage: (data: Buffer) => Promise<{
    readonly width: number;
    readonly height: number;
  }>;
};

function canvasModule(): CanvasModule {
  const anchor = createRequire(import.meta.url).resolve(
    "pdfjs-dist/package.json",
  );
  return createRequire(anchor)("@napi-rs/canvas") as CanvasModule;
}

/** Re-encodes a drawn canvas until the JPEG fits, or gives up (null). */
function fitJpeg(
  draw: (scale: number) => Canvas,
  options: PageRenderOptions,
): Buffer | null {
  for (const [scale, quality] of [
    [1, 82],
    [1, 65],
    [0.75, 65],
    [0.5, 60],
  ] as const) {
    const jpeg = draw(scale).toBuffer("image/jpeg", quality);
    if (jpeg.byteLength <= options.maxBytes) return jpeg;
  }
  return null;
}

/** An uploaded PNG or JPEG, decoded and re-encoded as a bounded JPEG. */
export async function imageToJpeg(
  bytes: Buffer,
  options: PageRenderOptions,
): Promise<Buffer | null> {
  const canvas = canvasModule();
  const image = await canvas.loadImage(bytes);
  if (image.width <= 0 || image.height <= 0) return null;
  const fit = Math.min(
    1,
    options.maxLongSide / Math.max(image.width, image.height),
  );
  return fitJpeg((scale) => {
    const width = Math.max(1, Math.round(image.width * fit * scale));
    const height = Math.max(1, Math.round(image.height * fit * scale));
    const target = canvas.createCanvas(width, height);
    const context = target.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return target;
  }, options);
}

type PdfPage = {
  readonly getViewport: (o: { readonly scale: number }) => {
    readonly width: number;
    readonly height: number;
  };
  readonly render: (o: Record<string, unknown>) => {
    readonly promise: Promise<void>;
  };
  readonly cleanup: () => void;
};

/** The named pages of a PDF, each drawn and encoded as a bounded JPEG. */
export async function pdfPagesToJpeg(
  bytes: Uint8Array,
  pages: readonly number[],
  options: PageRenderOptions,
): Promise<ReadonlyMap<number, Buffer>> {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const loaded: unknown = await import(specifier);
  const getDocument = (
    loaded as {
      getDocument?: (o: Record<string, unknown>) => {
        promise: Promise<unknown>;
        destroy: () => Promise<void>;
      };
    }
  ).getDocument;
  if (typeof getDocument !== "function")
    throw new Error("pdf backend unavailable");
  const task = getDocument({
    data: new Uint8Array(bytes),
    ...pdfjsAssetOptions(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const canvas = canvasModule();
  const out = new Map<number, Buffer>();
  try {
    const document = (await task.promise) as {
      readonly numPages: number;
      readonly getPage: (n: number) => Promise<PdfPage>;
    };
    for (const number of pages) {
      if (number < 1 || number > document.numPages) continue;
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(
        3,
        options.maxLongSide / Math.max(base.width, base.height, 1),
      );
      // Drawn once at full size; smaller attempts are downscaled copies.
      const viewport = page.getViewport({ scale: fit });
      const full = canvas.createCanvas(
        Math.max(1, Math.round(viewport.width)),
        Math.max(1, Math.round(viewport.height)),
      );
      const context = full.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, full.width, full.height);
      await page.render({ canvasContext: context, viewport, canvas: full })
        .promise;
      page.cleanup();
      const jpeg = fitJpeg((scale) => {
        if (scale === 1) return full;
        const smaller = canvas.createCanvas(
          Math.max(1, Math.round(full.width * scale)),
          Math.max(1, Math.round(full.height * scale)),
        );
        smaller
          .getContext("2d")
          .drawImage(full, 0, 0, smaller.width, smaller.height);
        return smaller;
      }, options);
      if (jpeg !== null) out.set(number, jpeg);
    }
  } finally {
    await task.destroy().catch(() => undefined);
  }
  return out;
}
