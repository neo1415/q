import {
  EXTRACTION_LIMITS,
  ParserOutputSchema,
  type ExtractedBlock,
  type ParserOutput,
} from "@capital-q/evidence/contracts";
import type { ModelSensitivity } from "@capital-q/contracts";

/**
 * Transcribed page text, merged into a parse (deck reading 2026-10-28).
 *
 * A page the file's text layer left (nearly) empty, transcribed from its
 * picture, becomes paragraph blocks on that page, each marked
 * `transcribed: true` so the provenance is never lost: a later citation of
 * "page 7" can say the words were read from a picture, not the file. The
 * merged output is renumbered in document order and must still satisfy
 * the extraction contract; when it would not, the original stands.
 */

export type PageTranscriptionInput = {
  readonly page: number;
  readonly text: string;
  readonly legible: boolean;
};

/**
 * The pipeline's port to a vision transcriber (through the model gateway).
 * Null when nothing came back; the pages then stay unread and are reported.
 */
export type DocumentPageTranscriberPort = (input: {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly sensitivity: ModelSensitivity;
  readonly correlationId: string;
  readonly images: readonly {
    readonly page: number;
    readonly mediaType: "image/jpeg";
    readonly dataBase64: string;
  }[];
}) => Promise<readonly PageTranscriptionInput[] | null>;

/** Sensitivities a transcriber may be offered; the gateway still decides. */
export function transcribable(sensitivity: ModelSensitivity): boolean {
  // Material marked highly confidential or restricted is read by no model
  // in the pipeline, as for the document-kind reading.
  return sensitivity !== "HIGHLY_CONFIDENTIAL" && sensitivity !== "RESTRICTED";
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[ \t]+/g, " ").trim())
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, EXTRACTION_LIMITS.maxBlockCharacters));
}

export function mergeTranscriptions(
  output: ParserOutput,
  transcriptions: readonly PageTranscriptionInput[],
): ParserOutput {
  const byPage = new Map<number, string[]>();
  for (const t of transcriptions) {
    const parts = paragraphsOf(t.text);
    if (parts.length > 0) byPage.set(t.page, parts);
  }
  if (byPage.size === 0) return output;

  const pageCount =
    output.metadata.pageCount ??
    Math.max(
      0,
      ...output.blocks.map((b) => b.locator.page ?? 0),
      ...byPage.keys(),
    );
  // Blocks grouped by page, in order; a block with no page stays with the
  // page before it.
  const pages = new Map<number, ExtractedBlock[]>();
  const breaks = new Map<number, ExtractedBlock>();
  let current = 1;
  for (const block of output.blocks) {
    current = block.locator.page ?? current;
    if (block.kind === "page_break") {
      breaks.set(current, block);
      continue;
    }
    const list = pages.get(current) ?? [];
    list.push(block);
    pages.set(current, list);
  }

  const merged: ExtractedBlock[] = [];
  const push = (block: ExtractedBlock): void => {
    merged.push({
      ...block,
      locator: { ...block.locator, index: merged.length },
    });
  };
  for (let page = 1; page <= pageCount; page += 1) {
    for (const block of pages.get(page) ?? []) push(block);
    for (const text of byPage.get(page) ?? []) {
      push({
        kind: "paragraph",
        text,
        transcribed: true,
        locator: { index: 0, page },
      });
    }
    const pageBreak = breaks.get(page);
    if (pageBreak !== undefined) push(pageBreak);
  }

  const candidate: ParserOutput = {
    ...output,
    blocks: merged,
    metadata: {
      ...output.metadata,
      transcribedPages: [...byPage.keys()].sort((a, b) => a - b),
    },
  };
  const checked = ParserOutputSchema.safeParse(candidate);
  return checked.success ? checked.data : output;
}

/** Pages whose text nobody could read: low-text and not transcribed. */
export function unreadPagesOf(output: ParserOutput): readonly number[] {
  const done = new Set(output.metadata.transcribedPages ?? []);
  return (output.metadata.lowTextPages ?? []).filter((p) => !done.has(p));
}
