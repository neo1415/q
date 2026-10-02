import type { DeckAudiencePort } from "@capital-q/app-actions";
import { DocumentIdSchema, type EvidenceService } from "@capital-q/evidence";

/**
 * ADR 0041: the deck-audience action's port, over the Evidence service,
 * which authorises (the owner's own document, document.manage), audits and
 * emits. The action passes an id it already validated as a UUID.
 */
export function deckAudiencePort(
  evidence: Pick<
    EvidenceService,
    "getDocument" | "setDocumentDownloadAudience"
  >,
): DeckAudiencePort {
  return {
    getDocument: ({ actor, documentId }) =>
      evidence.getDocument({
        actor,
        documentId: DocumentIdSchema.parse(documentId),
      }),
    setDocumentDownloadAudience: (command) =>
      evidence.setDocumentDownloadAudience({
        ...command,
        documentId: DocumentIdSchema.parse(command.documentId),
      }),
  };
}
