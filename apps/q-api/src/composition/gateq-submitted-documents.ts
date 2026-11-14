import type {
  GateQApplicationDocumentPort,
  GateQReadyApplicationDocument,
} from "@capital-q/evidence";
import type {
  SubmittedDocumentReading,
  SubmittedDocumentTextPort,
} from "@capital-q/gateq-intake";

/** Per document and in all: what one answer about an application may read. */
const CHARS_PER_DOCUMENT = 4_000;
const DOCUMENTS_MAX = 6;

const NOT_AVAILABLE = "its text is not available";
const BEYOND = "beyond what one answer reads";

function readingOf(
  title: string,
  read: GateQReadyApplicationDocument | null,
): SubmittedDocumentReading {
  if (read === null)
    return {
      title,
      pageCount: null,
      excerpts: null,
      truncated: false,
      notRead: NOT_AVAILABLE,
    };
  if (read.instructionRisk)
    return {
      title: read.title,
      pageCount: read.pageCount,
      excerpts: null,
      truncated: true,
      notRead: "its text was withheld by the safety check",
    };
  return {
    title: read.title,
    pageCount: read.pageCount,
    excerpts: read.excerpts,
    truncated: read.truncated,
    notRead: null,
  };
}

/**
 * The documents a founder sent with a submitted GateQ application, for Q's
 * answer to the receiving organisation. Two kinds, both exactly as sent:
 *
 * - documents uploaded into the application itself, which Evidence froze
 *   at Submit (ADR 0067: the exact version and hash, READY and scanned);
 * - live D4b (2026-11-14): documents from the founder's own library that
 *   they ticked and sent (the signed-in path, and every document on
 *   production so far), at the version pinned at Submit. Q said "no
 *   documents were attached" because only the first kind was read.
 *
 * The inbox service authorises the gateway and confirms the submission is
 * at it before this is called; nothing the founder did not send is read.
 * Extracted text is withheld when Evidence flagged instruction-like
 * content; each document not read says why, so Q never says "no document
 * was read" when one was attached, nor claims to have read one it was not
 * given.
 */
export function createSubmittedDocumentText(
  evidence: Pick<
    GateQApplicationDocumentPort,
    "frozenDocuments" | "readFrozenDocument" | "sharedSubmittedDocuments"
  >,
): SubmittedDocumentTextPort {
  return {
    read: async (ref) => {
      const out: SubmittedDocumentReading[] = [];
      const frozen = await evidence.frozenDocuments(ref);
      for (const document of frozen) {
        if (out.length >= DOCUMENTS_MAX) {
          out.push({
            title: document.title,
            pageCount: null,
            excerpts: null,
            truncated: false,
            notRead: BEYOND,
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
        out.push(readingOf(document.title, read));
      }
      const shared = await evidence.sharedSubmittedDocuments({
        ...ref,
        maxCharsPerDocument: CHARS_PER_DOCUMENT,
      });
      for (const document of shared) {
        out.push(
          out.length >= DOCUMENTS_MAX
            ? {
                title: document.title,
                pageCount: null,
                excerpts: null,
                truncated: false,
                notRead: BEYOND,
              }
            : readingOf(document.title, document.reading),
        );
      }
      return out;
    },
  };
}
