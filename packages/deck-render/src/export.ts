import type {
  QArtifactExportFormat,
  QArtifactVersion,
} from "@capital-q/contracts";

import { documentFromArtifact, documentToPdf } from "./document.js";
import { fetchSlideImages, type GeneratedImageReader } from "./images.js";
import { layOutDeck } from "./layout.js";
import { deckToPdf } from "./pdf.js";
import { deckToPptx } from "./pptx.js";
import type { BrandInput } from "./theme.js";

/**
 * One stored version as a file (BIZ-001).
 *
 * The single place that decides which renderer draws which artifact in
 * which format, so a route does not grow one branch per type. A version
 * with a deck is slides: its PDF is one page per slide and it also
 * writes as PowerPoint. Every other version is a document: its PDF is
 * the document layout, and PowerPoint is not offered, because a brief
 * turned into slides would be a second composition nobody asked for.
 */

export type ArtifactFile = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly extension: string;
};

export const EXPORT_CONTENT_TYPES: Readonly<
  Record<QArtifactExportFormat, string>
> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The formats this version can be written as. Content decides, not the type code. */
export function exportFormatsForVersion(
  version: QArtifactVersion,
): readonly QArtifactExportFormat[] {
  return version.content.deck === undefined ? ["pdf"] : ["pdf", "pptx"];
}

/**
 * Write `version` as `format`, or `null` when this version has no such
 * file (PowerPoint for a document). Throws only when a renderer fails.
 */
export async function renderArtifactFile(input: {
  readonly type: string;
  readonly version: QArtifactVersion;
  readonly format: QArtifactExportFormat;
  readonly brand?: BrandInput | undefined;
  readonly company?: string | undefined;
  /** DOCS: reads a generated image's bytes for this actor. */
  readonly readGenerated?: GeneratedImageReader | undefined;
}): Promise<ArtifactFile | null> {
  const { version, format } = input;
  const meta = { title: version.title, company: input.company };
  const deck = version.content.deck;
  if (deck !== undefined) {
    const laid = layOutDeck(deck, input.brand);
    const images = await fetchSlideImages(laid, fetch, input.readGenerated);
    const bytes =
      format === "pptx"
        ? await deckToPptx(laid, meta, images)
        : await deckToPdf(laid, meta, images);
    return {
      bytes,
      contentType: EXPORT_CONTENT_TYPES[format],
      extension: format,
    };
  }
  if (format !== "pdf") {
    return null;
  }
  const bytes = await documentToPdf(
    documentFromArtifact({ type: input.type, version }),
    meta,
    input.brand,
  );
  return { bytes, contentType: EXPORT_CONTENT_TYPES.pdf, extension: "pdf" };
}
