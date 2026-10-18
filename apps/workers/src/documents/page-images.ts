/**
 * Deck wave 8: a PDF's first pages as PNG (base64), for the vision critic.
 *
 * pdf.js draws each page onto the canvas its Node build brings
 * (@napi-rs/canvas), at 1x: a 960x540 slide is about 1.3k input tokens.
 * Loaded lazily through a non-literal specifier, as the parser does, so its
 * browser-shaped types stay out of this build and a worker that never
 * checks a deck never loads it. The PDF is our own render, still treated as
 * data: no eval, no system fonts, no network.
 */

type CanvasLike = { readonly toBuffer: (mime: "image/png") => Buffer };
type PdfPage = {
  readonly getViewport: (options: { readonly scale: number }) => {
    readonly width: number;
    readonly height: number;
  };
  readonly render: (options: Record<string, unknown>) => {
    readonly promise: Promise<void>;
  };
};
type PdfDocument = {
  readonly numPages: number;
  readonly getPage: (n: number) => Promise<PdfPage>;
  readonly canvasFactory: {
    readonly create: (
      width: number,
      height: number,
    ) => { readonly canvas: CanvasLike; readonly context: unknown };
  };
};

export async function pdfPagesToPng(
  pdf: Uint8Array,
  maxPages: number,
  scale = 1,
): Promise<readonly string[]> {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const loaded: unknown = await import(specifier);
  const getDocument = (
    loaded as {
      getDocument?: (options: Record<string, unknown>) => {
        promise: Promise<unknown>;
        destroy: () => Promise<void>;
      };
    }
  ).getDocument;
  if (typeof getDocument !== "function") {
    throw new Error("pdf backend unavailable");
  }
  const task = getDocument({
    // pdf.js may transfer the buffer it is given: a copy keeps ours.
    data: new Uint8Array(pdf),
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const document = (await task.promise) as PdfDocument;
    const pages: string[] = [];
    const count = Math.min(document.numPages, maxPages);
    for (let n = 1; n <= count; n += 1) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = document.canvasFactory.create(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push(canvas.toBuffer("image/png").toString("base64"));
    }
    return pages;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
