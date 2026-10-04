import { isMatchedRelationshipState } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { InterestService } from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import { createPostgresChatStore, type ChatOutbox } from "./postgres.js";
import { createPostgresChatSafetyStore } from "./safety-postgres.js";
import {
  createChatSafetyService,
  type ChatSafetyAuditPort,
  type ChatSafetyService,
} from "./safety.js";
import {
  createNetworkMeetingActivityWriter,
  createPostgresMeetingDirectory,
  createPostgresScheduleStore,
} from "./schedule/postgres.js";
import {
  createScheduleService,
  type AppEmailPort,
  type CalendarDirectory,
  type ScheduleService,
  type ScheduleServiceDependencies,
} from "./schedule/service.js";
import {
  createChatService,
  type ChatDocumentPort,
  type ChatDownloadPort,
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
      // The match outlives CONNECTED (relationship-state.v2): a thread
      // stays open after a meeting, a pause or a pass.
      connected: isMatchedRelationshipState(view.status.projection.state),
      state: view.status.projection.state,
    };
  };
}

/** The caller's own document, as the Evidence context authorises it. */
export type OwnDocumentLookup = (
  actor: ActorContext,
  documentId: string,
) => Promise<{
  readonly versionId: string;
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
        documentVersionId: document.versionId,
        // The sender's own document: it lives in the sender's tenant.
        documentTenantId: actor.tenantId,
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
  readonly downloads?: ChatDownloadPort | undefined;
  readonly newCorrelationId: () => string;
  /** Announces each new message (`network.relationship.message_sent`). */
  readonly outbox?: ChatOutbox | undefined;
}): ChatService {
  return createChatService({
    store: createPostgresChatStore({
      sql: options.sql,
      transactions: options.transactions,
      outbox: options.outbox,
    }),
    parties: createNetworkChatParties(options.interests),
    documents: createChatDocuments(options.ownDocument),
    downloads: options.downloads,
    newCorrelationId: options.newCorrelationId,
  });
}

/** Block and report (R34 safety): the api composes it with its audit writer. */
export function composeChatSafety(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<InterestService, "relationshipById">;
  readonly audit: ChatSafetyAuditPort;
}): ChatSafetyService {
  return createChatSafetyService({
    store: createPostgresChatSafetyStore({
      sql: options.sql,
      transactions: options.transactions,
    }),
    parties: createNetworkChatParties(options.interests),
    audit: options.audit,
  });
}

/** Meetings, reminders and notifications (BIZ-008): api, q-api, workers. */
export function composeSchedule(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<InterestService, "relationshipById">;
  readonly calendars: CalendarDirectory;
  readonly email: AppEmailPort;
  /** DOCS: the web origin, for links in reminder emails. */
  readonly appOrigin?: string | null | undefined;
  readonly logger?: ScheduleServiceDependencies["logger"];
  /** meet-47: book Q's bot at once when someone asks Q to join a call. */
  readonly onJoinRequested?: ScheduleServiceDependencies["onJoinRequested"];
}): ScheduleService {
  return createScheduleService({
    store: createPostgresScheduleStore({
      sql: options.sql,
      transactions: options.transactions,
    }),
    transactions: options.transactions,
    parties: createNetworkChatParties(options.interests),
    directory: createPostgresMeetingDirectory({ sql: options.sql }),
    calendars: options.calendars,
    activity: createNetworkMeetingActivityWriter(),
    email: options.email,
    appOrigin: options.appOrigin ?? null,
    logger: options.logger,
    onJoinRequested: options.onJoinRequested,
  });
}
