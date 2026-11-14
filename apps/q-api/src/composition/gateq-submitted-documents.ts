import type { GateQApplicationDocumentPort } from "@capital-q/evidence";
import type {
  SubmittedDocumentReading,
  SubmittedDocumentTextPort,
} from "@capital-q/gateq-intake";

/** Per document and in all: what one answer about an application may read. */
const CHARS_PER_DOCUMENT = 4_000;
const DOCUMENTS_MAX = 6;

/**
 * The documents a founder attached to a submitted GateQ application, as
 * Evidence froze and extracted them (ADR 0067: the exact submitted
 * version and hash, READY and scanned only), for Q's answer to the
 * receiving organisation. The inbox service authorises the gateway and
 * confirms the submission before this is called. Extracted text is
 * withheld when Evidence flagged instruction-like content; each document
 * not read says why, so Q never says "no document was read" when one was
 * attached, nor claims to have read one it was not given.
 */
export function createSubmittedDocumentText(
  evidence: Pick<
    GateQApplicationDocumentPort,
    "frozenDocuments" | "readFrozenDocument"
  >,
): SubmittedDocumentTextPort {
  return {
    read: async (ref) => {
      const frozen = await evidence.frozenDocuments(ref);
      const out: SubmittedDocumentReading[] = [];
      for (const [index, document] of frozen.entries()) {
        if (index >= DOCUMENTS_MAX) {
          out.push({
            title: document.title,
            pageCount: null,
            excerpts: null,
            truncated: false,
            notRead: "beyond what one answer reads",
          });
          continue;
        }
        const read = await evidence
          .readFrozenDocument({
            ...ref,
            documentId: document.documentId,
            versionId: document.versionId,
            sha256: document.sha256,
            maxCharsPerDocument: CHARS_PER_DOCUMENT,
          })
          .catch(() => null);
        out.push(
          read === null
            ? {
                title: document.title,
                pageCount: null,
                excerpts: null,
                truncated: false,
                notRead: "its text is not available",
              }
            : read.instructionRisk
              ? {
                  title: read.title,
                  pageCount: read.pageCount,
                  excerpts: null,
                  truncated: true,
                  notRead: "its text was withheld by the safety check",
                }
              : {
                  title: read.title,
                  pageCount: read.pageCount,
                  excerpts: read.excerpts,
                  truncated: read.truncated,
                  notRead: null,
                },
        );
      }
      return out;
    },
  };
}
