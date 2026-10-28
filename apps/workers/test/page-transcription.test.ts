import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { ParserOutputSchema } from "@capital-q/evidence/contracts";
import { planChunks } from "@capital-q/q-knowledge";

import {
  mergeTranscriptions,
  unreadPagesOf,
} from "../src/documents/transcription.js";
import {
  createImageExtractor,
  createPdfExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { imageToJpeg, pdfPagesToJpeg } from "../src/parser/page-render.js";
import { pdfjsAssetOptions } from "../src/parser/pdfjs-assets.js";
import { buildPlacedPdf } from "./support/pdf.js";

/**
 * Scanned and picture-only pages (deck reading 2026-10-28): the extractor
 * names them, the sandbox can picture them, and transcribed text lands on
 * its page marked as transcribed. No model is called here.
 */

const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

async function loadPdf(bytes: Uint8Array) {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs: unknown = await import(specifier);
  const getDocument = (pdfjs as { getDocument: (o: unknown) => unknown })
    .getDocument;
  const task = getDocument({
    data: bytes,
    ...pdfjsAssetOptions(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  }) as { promise: Promise<never>; destroy: () => Promise<void> };
  const document = (await task.promise) as unknown as {
    numPages: number;
    getPage: (n: number) => Promise<never>;
  };
  return {
    numPages: document.numPages,
    getPage: (n: number) => document.getPage(n),
    destroy: () => task.destroy(),
  };
}

const scan = buildPlacedPdf([
  [{ x: 72, y: 700, text: "Kora Health: clinic records that file themselves" }],
  // A picture-only page: a page number and nothing else.
  [{ x: 300, y: 40, text: "2" }],
  [],
]);

function pngBytes(width: number, height: number): Buffer {
  const anchor = createRequire(import.meta.url).resolve(
    "pdfjs-dist/package.json",
  );
  const canvas = createRequire(anchor)("@napi-rs/canvas") as {
    createCanvas: (
      w: number,
      h: number,
    ) => {
      getContext: (k: "2d") => {
        fillStyle: string;
        fillRect: (x: number, y: number, w: number, h: number) => void;
      };
      toBuffer: (mime: "image/png") => Buffer;
    };
  };
  const drawn = canvas.createCanvas(width, height);
  const ctx = drawn.getContext("2d");
  ctx.fillStyle = "#336699";
  ctx.fillRect(0, 0, width, height);
  return drawn.toBuffer("image/png");
}

describe("low-text pages are named by the extractor", () => {
  it("records the pages whose text layer is (nearly) empty", async () => {
    const output = await createPdfExtractor(loadPdf).extract(scan, context);
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    expect(output.metadata.lowTextPages).toEqual([2, 3]);
  });

  it("reads an uploaded PNG or JPEG as one picture page, never as unsupported", async () => {
    const image = createImageExtractor();
    expect(
      image.supports({
        mimeType: "image/png",
        filename: "a.png",
        sizeBytes: 1,
      }),
    ).toBe(true);
    const output = await image.extract(pngBytes(20, 10), context);
    expect(output).toMatchObject({
      blocks: [],
      metadata: { parser: "image", pageCount: 1, lowTextPages: [1] },
    });
    // Bytes that are not what the type claims are refused.
    await expect(
      image.extract(Buffer.from("not an image at all"), context),
    ).rejects.toThrow();
  });
});

describe("pictures for transcription are bounded JPEGs", () => {
  it("draws only the named pages of a PDF", async () => {
    const images = await pdfPagesToJpeg(new Uint8Array(scan), [2, 3, 99], {
      maxLongSide: 800,
      maxBytes: 200_000,
    });
    expect([...images.keys()]).toEqual([2, 3]);
    for (const jpeg of images.values()) {
      expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
      expect(jpeg.byteLength).toBeLessThanOrEqual(200_000);
    }
  });

  it("shrinks a large upload to the long-side bound", async () => {
    const jpeg = await imageToJpeg(pngBytes(4000, 2000), {
      maxLongSide: 1_000,
      maxBytes: 300_000,
    });
    expect(jpeg).not.toBeNull();
    expect(jpeg?.byteLength).toBeLessThanOrEqual(300_000);
  });
});

describe("transcribed text lands on its page, marked as transcribed", () => {
  it("merges in page order, renumbers, and chunks on the right page", async () => {
    const output = await createPdfExtractor(loadPdf).extract(scan, context);
    const merged = mergeTranscriptions(output, [
      { page: 3, text: "The ask\n\nUSD 3m seed", legible: true },
    ]);
    expect(ParserOutputSchema.safeParse(merged).success).toBe(true);
    expect(merged.blocks.map((b) => b.locator.index)).toEqual(
      merged.blocks.map((_b, at) => at),
    );
    const transcribed = merged.blocks.filter((b) => b.transcribed === true);
    expect(transcribed.map((b) => b.locator.page)).toEqual([3, 3]);
    expect(merged.metadata.transcribedPages).toEqual([3]);
    expect(unreadPagesOf(merged)).toEqual([2]);
    const ask = planChunks(merged.blocks).chunks.find((c) =>
      c.content.includes("USD 3m seed"),
    );
    expect(ask?.locator.pageStart).toBe(3);
  });

  it("an empty transcription changes nothing", async () => {
    const output = await createPdfExtractor(loadPdf).extract(scan, context);
    expect(
      mergeTranscriptions(output, [{ page: 2, text: "  ", legible: false }]),
    ).toBe(output);
    expect(unreadPagesOf(output)).toEqual([2, 3]);
  });
});
