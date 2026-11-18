import type { ActorContext } from "@capital-q/security";

import { DocumentIdSchema } from "../contracts/index.js";
import type { DocumentWithVersion } from "./document-use-cases.js";
import type { PrivateDocumentStorageProvider } from "./storage-port.js";

/**
 * The bytes of one upload of the actor's own organisation, for a server
 * workflow that parses it deterministically (the CRM import, decision 106).
 * Read only once the malware scan says CLEAN: a pending, unscanned,
 * blocked or failed scan is refused, never read "for now". Authorisation is
 * Evidence's own document read (the actor's organisation, DOCUMENT_VIEW);
 * any refusal there reads as not found.
 */

export type OwnScannedFile =
  | {
      readonly ok: true;
      readonly documentId: string;
      readonly documentVersionId: string;
      readonly fileName: string;
      readonly mimeType: string;
      readonly bytes: Uint8Array;
    }
  | {
      readonly ok: false;
      readonly code: "NOT_FOUND" | "NOT_SCANNED" | "BLOCKED" | "TOO_LARGE";
    };

export function createOwnScannedFileReader(dependencies: {
  readonly getDocumentWithVersion: (query: {
    readonly actor: ActorContext;
    readonly documentId: ReturnType<typeof DocumentIdSchema.parse>;
  }) => Promise<DocumentWithVersion>;
  readonly storage: Pick<PrivateDocumentStorageProvider, "openObjectStream">;
  /** The largest file read; larger is TOO_LARGE before any byte is read. */
  readonly maxBytes: number;
}) {
  return {
    readOwnFile: async (
      actor: ActorContext,
      documentId: string,
    ): Promise<OwnScannedFile> => {
      const id = DocumentIdSchema.safeParse(documentId);
      if (!id.success) return { ok: false, code: "NOT_FOUND" };
      const found = await dependencies
        .getDocumentWithVersion({ actor, documentId: id.data })
        .catch(() => null);
      const version = found?.currentVersion ?? null;
      if (found === null || version === null) {
        return { ok: false, code: "NOT_FOUND" };
      }
      if (version.malwareScanStatus === "BLOCKED") {
        return { ok: false, code: "BLOCKED" };
      }
      if (version.malwareScanStatus !== "CLEAN") {
        return { ok: false, code: "NOT_SCANNED" };
      }
      if (version.sizeBytes > dependencies.maxBytes) {
        return { ok: false, code: "TOO_LARGE" };
      }
      const stream = await dependencies.storage.openObjectStream({
        bucket: version.storageBucket,
        key: version.storageKey,
      });
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of stream.body) {
        total += chunk.byteLength;
        if (total > dependencies.maxBytes)
          return { ok: false, code: "TOO_LARGE" };
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return {
        ok: true,
        documentId: found.document.id,
        documentVersionId: version.id,
        fileName: version.originalFilename,
        mimeType: version.mimeType,
        bytes,
      };
    },
  };
}
