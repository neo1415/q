import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { InterestService } from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import { createPostgresChatStore } from "./postgres.js";
import {
  createChatService,
  type ChatDocumentPort,
  type ChatPartyResolver,
  type ChatService,
} from "./service.js";

/**
 * Party resolution through Network's public contract, as the caller: the
 * same per-party fold the relationship page shows. A relationship this
 * side can see nothing of is not a thread this side has.
 */
export function createNetworkChatParties(
  interests: Pick<InterestService, "relationshipById">,
): ChatPartyResolver {
  return async (actor, relationshipId) => {
    const view = await interests.relationshipById({ actor, relationshipId });
    if (view === null || view.status === null) return null;
    return {
      side: view.side,
      connected: view.status.projection.state === "CONNECTED",
    };
  };
}

/** The caller's own document, as the Evidence context authorises it. */
export type OwnDocumentLookup = (
  actor: ActorContext,
  documentId: string,
) => Promise<{
  readonly title: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly malwareScanStatus: string;
} | null>;

/** Only a document that has cleared the malware gate may be shared. */
export function createChatDocuments(
  lookup: OwnDocumentLookup,
): ChatDocumentPort {
  return async (actor, documentId) => {
    const document = await lookup(actor, documentId).catch(() => null);
    if (document === null) return { outcome: "NOT_FOUND" };
    if (document.malwareScanStatus !== "CLEAN") return { outcome: "NOT_READY" };
    return {
      outcome: "READY",
      snapshot: {
        documentId,
        title: document.title.slice(0, 300),
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
      },
    };
  };
}

/** The one composition api and q-api share. */
export function composeChat(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<InterestService, "relationshipById">;
  readonly ownDocument: OwnDocumentLookup;
  readonly newCorrelationId: () => string;
}): ChatService {
  return createChatService({
    store: createPostgresChatStore({
      sql: options.sql,
      transactions: options.transactions,
    }),
    parties: createNetworkChatParties(options.interests),
    documents: createChatDocuments(options.ownDocument),
    newCorrelationId: options.newCorrelationId,
  });
}
