// Types for render.mjs (the validator in apps/workers/test imports it).

import type { DocumentModel, Fixture } from "./documents.mjs";

/** The pdf-lib module, resolved from packages/deck-render. */
export type PdfLib = unknown;

export function loadPdfLib(): Promise<PdfLib>;
export function renderPdf(
  doc: DocumentModel,
  fx: Fixture,
  pdfLib: PdfLib,
): Promise<Uint8Array>;
export function renderCompany(
  fx: Fixture,
  pdfLib: PdfLib,
): Promise<{
  readonly docs: DocumentModel[];
  readonly files: { readonly doc: DocumentModel; readonly bytes: Uint8Array }[];
}>;
