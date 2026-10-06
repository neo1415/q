import type { BackfillDocumentPagesResult } from "@capital-q/evidence";

/**
 * Q room W3 (R3): every processed paged document has its pages. New
 * extractions write them in the same transaction; this fills in the ones
 * recorded before `evidence.document_pages` existed, from their private
 * artifacts, in bounded rounds at worker start. Idempotent (pages are
 * written once) and never fatal: a failure is one log line.
 */

const ROUND = 200;
const ROUNDS_MAX = 25;

export async function backfillDocumentPagesAtStart(options: {
  readonly backfill: (limit?: number) => Promise<BackfillDocumentPagesResult>;
  readonly logger: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
}): Promise<void> {
  let examined = 0;
  let pagesWritten = 0;
  let failed = 0;
  try {
    for (let round = 0; round < ROUNDS_MAX; round += 1) {
      const result = await options.backfill(ROUND);
      examined += result.examined;
      pagesWritten += result.pagesWritten;
      failed += result.failed;
      // A round that wrote nothing new would only select the same rows.
      if (result.examined < ROUND || result.failed === result.examined) break;
    }
    options.logger.info(
      { examined, pagesWritten, failed },
      "evidence.documents.pages_backfilled_at_start",
    );
  } catch (error: unknown) {
    options.logger.warn(
      {
        examined,
        failure: error instanceof Error ? error.name : "unknown",
      },
      "evidence.documents.pages_backfill_failed",
    );
  }
}
