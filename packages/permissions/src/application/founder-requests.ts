import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  DATA_ROOM_LEVEL_SCOPE,
  type AccessHistoryEntry,
  type CorrelationId,
  type DataRoomLevel,
  type DocumentAccessDto,
  type DocumentAccessLevel,
  type DocumentRequestItem,
  type FolderAccessDto,
  type InvestorQuestion,
  type QuestionSetItem,
  type RequestInboxDto,
  type RequestInboxItem,
  type RequestSource,
  type UtcTimestamp,
  inboxItemOpen,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  RelationshipIdSchema,
  type DiligenceQuestionRecord,
  type DiligenceQuestionRepository,
  type DiligenceRequestRepository,
  type RelationshipEventAppender,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  DisclosurePolicyIdSchema,
  isPolicyActiveAt,
  type DisclosurePolicy,
} from "../contracts/index.js";
import {
  activeGrants,
  type DataRoomCompany,
  type DataRoomDocument,
  type DataRoomService,
  type DataRoomStore,
} from "./data-room.js";
import type { DisclosurePolicyManager } from "./policy-manager.js";
import type { DisclosurePolicyRepository } from "./ports.js";

/**
 * The founder's side of what investors ask for (2026-10-08; design
 * docs/design/2026-10-08/founder-docs): one inbox for named diligence
 * requests, data-room requests and questions from "Assumptions to test";
 * answering each one; and the access editor for a document or a folder.
 *
 * Nothing here is a looser rule than what exists:
 *   - only the company's own team, holding disclosure.manage on it
 *     (`ownerMayManage`), reads the inbox, answers, shares or revokes; for
 *     everyone else every call is the same not-found;
 *   - a share is the existing disclosure policy (relationship_shared, the
 *     relationship as recipient, the level they chose, an expiry), which
 *     the policy manager authorises, audits and announces; revoking is the
 *     policy manager's revoke;
 *   - filing an upload into the data room is the data room's own setLevel
 *     (shared only, so nobody else even sees its title);
 *   - an answer is the founder's claim, recorded through the Knowledge
 *     Write Gate with the question as its provenance; it is never verified
 *     by being said, and attaching a document makes it document-supported,
 *     not true.
 * The investor is told about every answer, share and decline.
 */

const RESOURCE_RELATIONSHIP = AuditResourceTypeSchema.parse("relationship");
const REQUEST_DECLINED = AuditActionTypeSchema.parse(
  "diligence.request_declined",
);
const ACCESS_DECIDED = AuditActionTypeSchema.parse("data_room.access_decided");
const QUESTIONS_SENT = AuditActionTypeSchema.parse("diligence.questions_sent");
const QUESTION_ANSWERED = AuditActionTypeSchema.parse(
  "diligence.question_answered",
);

const DAY_MS = 86_400_000;
/** How long an answer's attached document stays shared. */
const ANSWER_SHARE_DAYS = 30;

export type FounderRequestsRefusal =
  | "NOT_FOUND"
  | "ALREADY_ANSWERED"
  | "NOT_SHAREABLE"
  | "VERSION_CONFLICT";

export type FounderRequestsOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T }
  | { readonly outcome: "REFUSED"; readonly code: FounderRequestsRefusal };

export type FounderRequestsNotice = {
  readonly relationshipId: string;
  readonly actingSide: "INVESTOR" | "COMPANY";
  readonly title: string;
  readonly key: string;
  readonly priority: "NEEDS_YOU" | "UPDATE";
  /** REQUESTS: the founder's inbox item; PROFILE: the investor's view of the company. */
  readonly target: "REQUESTS" | "PROFILE";
};

export type FounderRequestsDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly store: Pick<
    DataRoomStore,
    "folders" | "documentsOf" | "document" | "requests" | "requestCompany" | "insertDecision"
  >;
  readonly dataRoom: Pick<DataRoomService, "setLevel" | "decide">;
  readonly diligenceRequests: Pick<
    DiligenceRequestRepository,
    "listForCompany" | "find" | "fulfil" | "decline"
  >;
  readonly questions: DiligenceQuestionRepository;
  readonly company: (companyId: string) => Promise<DataRoomCompany | null>;
  /** The actor may manage this company's documents (owner org + disclosure.manage). */
  readonly ownerMayManage: (
    actor: ActorContext,
    company: DataRoomCompany,
  ) => Promise<boolean>;
  /** The relationship's own company and investor, or null. */
  readonly relationship: (relationshipId: string) => Promise<{
    readonly companyId: string;
    readonly tenantId: string;
    readonly investorOrganisationId: string;
  } | null>;
  /** The company's relationships, with the investor organisation's name. */
  readonly relationshipsOf: (companyId: string) => Promise<
    readonly {
      readonly relationshipId: string;
      readonly investorOrganisationName: string;
    }[]
  >;
  readonly investorOf: (
    actor: ActorContext,
  ) => Promise<{ readonly investorOrganisationId: string } | null>;
  readonly relationshipOf: (
    companyId: string,
    investorOrganisationId: string,
  ) => Promise<string | null>;
  readonly policies: Pick<DisclosurePolicyManager, "grant" | "revoke">;
  readonly policyRepository: Pick<
    DisclosurePolicyRepository,
    "findAllForResource" | "findById" | "findUnrevokedForRecipient"
  >;
  readonly appender: RelationshipEventAppender;
  readonly audit: MaterialActionAuditWriter;
  /** Records an answer through the Knowledge Write Gate. Absent: words only. */
  readonly answers?:
    | {
        readonly record: (command: {
          readonly actor: ActorContext;
          readonly companyId: string;
          readonly questionId: string;
          readonly about: string | null;
          readonly answer: string;
          readonly correlationId: CorrelationId;
        }) => Promise<{
          readonly evidenceItemId: string | null;
          readonly knowledgeObjectId: string | null;
        }>;
      }
    | undefined;
  readonly notify?:
    | ((input: FounderRequestsNotice) => Promise<unknown>)
    | undefined;
  readonly newCorrelationId: () => CorrelationId;
  readonly now?: (() => UtcTimestamp) | undefined;
};

// --- pure parts (tested without a database) ---------------------------------

/** Open first, then newest. */
export function sortInbox(
  items: readonly RequestInboxItem[],
): RequestInboxItem[] {
  const at = (item: RequestInboxItem) =>
    item.kind === "DOCUMENT_REQUEST" ? item.requestedAt : item.askedAt;
  return [...items].sort((a, b) => {
    const open = Number(inboxItemOpen(b)) - Number(inboxItemOpen(a));
    return open !== 0 ? open : at(b).localeCompare(at(a));
  });
}

export function inboxCounts(items: readonly RequestInboxItem[]) {
  let open = 0;
  let answered = 0;
  let declined = 0;
  for (const item of items) {
    if (inboxItemOpen(item)) open += 1;
    else if (item.kind === "DOCUMENT_REQUEST" && item.status === "DECLINED")
      declined += 1;
    else answered += 1;
  }
  return { open, answered, declined };
}

/** Questions grouped by the send they came in (its diligence request or chat message). */
export function questionSets(
  records: readonly DiligenceQuestionRecord[],
  titleOf: (documentId: string) => string | null,
): QuestionSetItem[] {
  const sets = new Map<string, DiligenceQuestionRecord[]>();
  for (const record of records) {
    const set = sets.get(record.sentRef) ?? [];
    set.push(record);
    sets.set(record.sentRef, set);
  }
  return [...sets.entries()].map(([sentRef, set]) => {
    const ordered = [...set].sort((a, b) => a.position - b.position);
    const first = ordered[0];
    if (first === undefined) throw new Error("EMPTY_QUESTION_SET");
    return {
      kind: "QUESTIONS",
      itemId: sentRef,
      relationshipId: first.relationshipId,
      investorOrganisationName: first.investorOrganisationName,
      requesterName: first.askedByName,
      askedAt: first.askedAt,
      questions: ordered.map((record) => toQuestion(record, titleOf)),
    };
  });
}

export function toQuestion(
  record: DiligenceQuestionRecord,
  titleOf: (documentId: string) => string | null,
): InvestorQuestion {
  return {
    questionId: record.id,
    position: record.position,
    question: record.question,
    assumptionId: record.assumptionId,
    assumptionLabel: record.assumptionLabel,
    askedAt: record.askedAt,
    answer:
      record.answer === null
        ? null
        : {
            answerId: record.answer.id,
            text: record.answer.text,
            answeredAt: record.answer.answeredAt,
            truthClass: "USER_CLAIM",
            evidenceStatus: record.answer.evidenceStatus,
            documents: record.answer.documentIds.flatMap((documentId) => {
              const title = titleOf(documentId);
              return title === null ? [] : [{ documentId, title }];
            }),
          },
  };
}

/** A document's share history, newest first: shared, revoked, expired. */
export function accessHistory(
  policies: readonly DisclosurePolicy[],
  nameOf: (relationshipId: string) => string | null,
  now: UtcTimestamp,
): AccessHistoryEntry[] {
  const entries: AccessHistoryEntry[] = [];
  for (const policy of policies) {
    if (policy.recipient?.type !== "RELATIONSHIP") continue;
    const name = nameOf(policy.recipient.id);
    const base = {
      investorOrganisationName: name,
      accessLevel: policy.accessLevel,
    };
    entries.push({ ...base, at: policy.createdAt, what: "SHARED" });
    if (policy.revokedAt !== null) {
      entries.push({ ...base, at: policy.revokedAt, what: "REVOKED" });
    } else if (policy.expiresAt !== null && policy.expiresAt <= now) {
      entries.push({ ...base, at: policy.expiresAt, what: "EXPIRED" });
    }
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
}

// --- the service ---------------------------------------------------------------

export function createFounderRequestsService(
  dependencies: FounderRequestsDependencies,
) {
  const { sql, store, transactions } = dependencies;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const refused = <T>(
    code: FounderRequestsRefusal,
  ): FounderRequestsOutcome<T> => ({ outcome: "REFUSED", code });
  const quietly = <T>(promise: Promise<T>, fallback: T) =>
    promise.catch(() => fallback);
  const notifyQuietly = (input: FounderRequestsNotice) =>
    dependencies.notify?.(input).catch(() => undefined);
  const expiryAfter = (days: number) =>
    new Date(Date.parse(now()) + days * DAY_MS).toISOString();

  /** The company, when the actor is its own team with disclosure.manage. */
  async function ownCompany(
    actor: ActorContext,
    companyId: string,
  ): Promise<DataRoomCompany | null> {
    const company = await quietly(dependencies.company(companyId), null);
    if (company === null || company.organisationId !== actor.organisationId)
      return null;
    return (await quietly(dependencies.ownerMayManage(actor, company), false))
      ? company
      : null;
  }

  async function ownDocument(
    actor: ActorContext,
    documentId: string,
  ): Promise<{
    readonly company: DataRoomCompany;
    readonly document: DataRoomDocument;
  } | null> {
    const document = await quietly(store.document(sql, documentId), null);
    if (document === null) return null;
    const company = await ownCompany(actor, document.companyId);
    return company === null ? null : { company, document };
  }

  async function names(companyId: string) {
    const relationships = await quietly(
      dependencies.relationshipsOf(companyId),
      [],
    );
    const byId = new Map(
      relationships.map((r) => [r.relationshipId, r.investorOrganisationName]),
    );
    return { relationships, nameOf: (id: string) => byId.get(id) ?? null };
  }

  /** Files a document in a folder (shared only when new); its level otherwise stays. */
  async function file(
    actor: ActorContext,
    document: DataRoomDocument,
    folderCode: string | undefined,
    correlationId: CorrelationId,
  ): Promise<boolean> {
    const folder =
      folderCode ?? (document.version > 0 ? document.folderCode : "other");
    if (document.version > 0 && folder === document.folderCode) return true;
    const filed = await dependencies.dataRoom.setLevel({
      actor,
      documentId: document.documentId,
      level: document.version === 0 ? "SHARED_ONLY" : document.level,
      folderCode: folder,
      ...(document.version > 0 ? { expectedVersion: document.version } : {}),
      correlationId,
    });
    return filed.outcome === "OK";
  }

  async function grant(
    actor: ActorContext,
    input: {
      readonly documentId: string;
      readonly relationshipId: string;
      readonly accessLevel: DocumentAccessLevel;
      readonly expiresAt: string;
      readonly correlationId: CorrelationId;
    },
  ): Promise<string | null> {
    const granted = await dependencies.policies.grant({
      actor,
      resource: { type: "document", id: input.documentId },
      scopeType: "relationship_shared",
      recipient: { type: "RELATIONSHIP", id: input.relationshipId },
      accessLevel: input.accessLevel,
      expiresAt: input.expiresAt,
      correlationId: input.correlationId,
    });
    return granted.outcome === "REDUNDANT" ? null : granted.policy.id;
  }

  const documentItems = async (
    company: DataRoomCompany,
    nameOf: (id: string) => string | null,
    vehicles: ReadonlySet<string>,
    documents: readonly DataRoomDocument[],
  ): Promise<DocumentRequestItem[]> => {
    const filed = new Map(
      documents
        .filter((document) => document.version > 0)
        .map((document) => [document.documentId, document]),
    );
    const titles = new Map(documents.map((d) => [d.documentId, d.title]));
    const inRoom = (documentId: string | null | undefined) => {
      const document =
        documentId === null || documentId === undefined
          ? undefined
          : filed.get(documentId);
      return document === undefined
        ? null
        : { documentId: document.documentId, folderCode: document.folderCode };
    };
    const [roomRequests, named] = await Promise.all([
      store.requests(sql, { companyId: company.id }),
      dependencies.diligenceRequests.listForCompany(sql, company.id),
    ]);
    const fromRoom = roomRequests.map(
      (request): DocumentRequestItem => ({
        kind: "DOCUMENT_REQUEST",
        itemId: request.id,
        source: "DATA_ROOM",
        requestId: request.id,
        relationshipId: request.relationshipId,
        investorOrganisationName:
          request.investorOrganisationName ?? nameOf(request.relationshipId),
        requesterName: request.requestedByName,
        title: (request.documentTitle ?? "Everything on request").slice(0, 300),
        note: request.note,
        requestedAt: request.createdAt,
        status:
          request.decision === null
            ? "OPEN"
            : request.decision === "APPROVED"
              ? "SHARED"
              : "DECLINED",
        declineNote: request.declineNote ?? null,
        sharedDocument: request.fulfilledDocument ?? null,
        accessEndsAt: request.expiresAt,
        dataRoom: inRoom(
          request.fulfilledDocument?.documentId ?? request.documentId,
        ),
      }),
    );
    const fromDiligence = named
      // A send of questions is shown as its questions, not as a request.
      .filter((request) => !vehicles.has(request.id))
      .map(
        (request): DocumentRequestItem => ({
          kind: "DOCUMENT_REQUEST",
          itemId: request.id,
          source: "DILIGENCE",
          requestId: request.id,
          relationshipId: request.relationshipId,
          investorOrganisationName: nameOf(request.relationshipId),
          requesterName: request.requestedByName,
          title: request.title,
          note: request.note,
          requestedAt: request.createdAt,
          status:
            request.fulfilment !== null
              ? "SHARED"
              : request.decline !== null
                ? "DECLINED"
                : "OPEN",
          declineNote: request.decline?.note ?? null,
          sharedDocument:
            request.fulfilment === null
              ? null
              : {
                  documentId: request.fulfilment.documentId,
                  title:
                    titles.get(request.fulfilment.documentId) ?? "Document",
                },
          accessEndsAt: null,
          dataRoom: inRoom(request.fulfilment?.documentId),
        }),
      );
    return [...fromRoom, ...fromDiligence];
  };

  return {
    /** Everything investors asked this company for; null: one not-found for everyone else. */
    inbox: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<RequestInboxDto | null> => {
      const company = await ownCompany(actor, companyId);
      if (company === null) return null;
      const [{ nameOf }, documents, questions, folders] = await Promise.all([
        names(company.id),
        store.documentsOf(sql, company.id),
        dependencies.questions.listForCompany(sql, company.id),
        store.folders(sql),
      ]);
      const titles = new Map(documents.map((d) => [d.documentId, d.title]));
      const vehicles = new Set(questions.map((q) => q.sentRef));
      const items = sortInbox([
        ...(await documentItems(company, nameOf, vehicles, documents)),
        ...questionSets(questions, (id) => titles.get(id) ?? null),
      ]);
      return {
        companyId: company.id,
        items,
        counts: inboxCounts(items),
        folders: [...folders],
      };
    },

    /**
     * Shares one of the company's documents (just uploaded, or one it has)
     * for a request, at the level and for the time the founder chose, and
     * files it in the data room (shared only when it was not filed).
     */
    fulfil: async (command: {
      readonly actor: ActorContext;
      readonly source: RequestSource;
      readonly requestId: string;
      readonly documentId: string;
      readonly folderCode?: string | undefined;
      readonly accessLevel: DocumentAccessLevel;
      readonly days: number;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      FounderRequestsOutcome<{
        readonly requestId: string;
        readonly status: "SHARED";
      }>
    > => {
      const own = await ownDocument(command.actor, command.documentId);
      if (own === null) return refused("NOT_FOUND");
      const { company, document } = own;
      if (document.currentVersionId === null) return refused("NOT_SHAREABLE");
      // The request, of this same company, still waiting.
      let request: {
        readonly id: string;
        readonly tenantId: string;
        readonly relationshipId: string;
        readonly title: string;
      };
      if (command.source === "DATA_ROOM") {
        const found = (await store.requests(sql, { companyId: company.id })).find(
          (candidate) => candidate.id === command.requestId,
        );
        if (found === undefined) return refused("NOT_FOUND");
        if (found.decision !== null) return refused("ALREADY_ANSWERED");
        request = {
          id: found.id,
          tenantId: found.tenantId,
          relationshipId: found.relationshipId,
          title: found.documentTitle ?? "their request",
        };
      } else {
        const found = await quietly(
          dependencies.diligenceRequests.find(sql, command.requestId),
          null,
        );
        const relationship =
          found === null
            ? null
            : await quietly(
                dependencies.relationship(found.relationshipId),
                null,
              );
        if (
          found === null ||
          relationship === null ||
          relationship.companyId !== company.id
        )
          return refused("NOT_FOUND");
        if (found.fulfilment !== null || found.decline !== null)
          return refused("ALREADY_ANSWERED");
        request = {
          id: found.id,
          tenantId: relationship.tenantId,
          relationshipId: found.relationshipId,
          title: found.title,
        };
      }
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      if (!(await file(command.actor, document, command.folderCode, correlationId)))
        return refused("VERSION_CONFLICT");
      const expiresAt = expiryAfter(command.days);
      const policyId = await grant(command.actor, {
        documentId: document.documentId,
        relationshipId: request.relationshipId,
        accessLevel: command.accessLevel,
        expiresAt,
        correlationId,
      });
      // A document every investor who can find the company already opens
      // grants nothing more; a named request still needs a share to point to.
      if (policyId === null) return refused("NOT_SHAREABLE");
      const relationshipId = RelationshipIdSchema.parse(request.relationshipId);
      const recorded = await transactions.run(async (tx) => {
        const answered =
          command.source === "DATA_ROOM"
            ? await store.insertDecision(tx, {
                requestId: request.id,
                tenantId: request.tenantId,
                decision: "APPROVED",
                expiresAt,
                userId: command.actor.userId,
                fulfilledDocumentId: document.documentId,
              })
            : await dependencies.diligenceRequests.fulfil(tx, {
                requestId: request.id,
                tenantId: request.tenantId,
                disclosurePolicyId: policyId,
                documentId: document.documentId,
                userId: command.actor.userId,
              });
        if (!answered) return false;
        await dependencies.appender.append(
          tx,
          command.source === "DATA_ROOM"
            ? {
                relationshipId,
                eventType: RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
                actor: { type: "HUMAN", id: command.actor.userId },
                source: { type: "MANUAL", id: request.id },
                visibilityScope: "relationship_shared",
                payload: {
                  requestId: request.id,
                  documentIds: [document.documentId],
                  disclosurePolicyIds: [policyId],
                  expiresAt,
                },
                correlationId,
              }
            : {
                relationshipId,
                eventType: RELATIONSHIP_EVENT_DOCUMENT_SHARED,
                actor: { type: "HUMAN", id: command.actor.userId },
                source: { type: "MANUAL", id: policyId },
                visibilityScope: "relationship_shared",
                payload: {
                  documentId: document.documentId,
                  disclosurePolicyId: policyId,
                  requestId: request.id,
                },
                correlationId,
              },
        );
        await dependencies.audit.record(tx, {
          ...auditActorFromContext(command.actor),
          auditEventId: createAuditEventId(),
          actionType: ACCESS_DECIDED,
          resourceType: RESOURCE_RELATIONSHIP,
          resourceId: request.relationshipId,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            requestId: request.id,
            source: command.source,
            decision: "SHARED",
            documentId: document.documentId,
            accessLevel: command.accessLevel,
            expiresAt,
          },
          correlationId,
        });
        return true;
      });
      if (!recorded) return refused("ALREADY_ANSWERED");
      await notifyQuietly({
        relationshipId: request.relationshipId,
        actingSide: "COMPANY",
        title: `{actor} shared ${document.title} for your request`.slice(0, 200),
        key: request.id,
        priority: "NEEDS_YOU",
        target: "PROFILE",
      });
      return { outcome: "OK", value: { requestId: request.id, status: "SHARED" } };
    },

    /** Declines a request, with an optional note the investor sees. */
    decline: async (command: {
      readonly actor: ActorContext;
      readonly source: RequestSource;
      readonly requestId: string;
      readonly note?: string | null | undefined;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      FounderRequestsOutcome<{
        readonly requestId: string;
        readonly status: "DECLINED";
      }>
    > => {
      const note = command.note?.trim().slice(0, 1000) || null;
      if (command.source === "DATA_ROOM") {
        const decided = await dependencies.dataRoom.decide({
          actor: command.actor,
          requestId: command.requestId,
          decision: "DECLINE",
          note,
          correlationId: command.correlationId,
        });
        if (decided.outcome === "OK")
          return {
            outcome: "OK",
            value: { requestId: command.requestId, status: "DECLINED" },
          };
        return refused(
          decided.code === "ALREADY_DECIDED" ? "ALREADY_ANSWERED" : "NOT_FOUND",
        );
      }
      const request = await quietly(
        dependencies.diligenceRequests.find(sql, command.requestId),
        null,
      );
      const relationship =
        request === null
          ? null
          : await quietly(dependencies.relationship(request.relationshipId), null);
      if (request === null || relationship === null) return refused("NOT_FOUND");
      if ((await ownCompany(command.actor, relationship.companyId)) === null)
        return refused("NOT_FOUND");
      if (request.fulfilment !== null || request.decline !== null)
        return refused("ALREADY_ANSWERED");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const recorded = await transactions.run(async (tx) => {
        const inserted = await dependencies.diligenceRequests.decline(tx, {
          requestId: request.id,
          tenantId: relationship.tenantId,
          note,
          userId: command.actor.userId,
        });
        if (inserted) {
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: REQUEST_DECLINED,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: request.relationshipId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: { requestId: request.id, withNote: note !== null },
            correlationId,
          });
        }
        return inserted;
      });
      if (!recorded) return refused("ALREADY_ANSWERED");
      await notifyQuietly({
        relationshipId: request.relationshipId,
        actingSide: "COMPANY",
        title: `{actor} declined your request for ${request.title}`.slice(0, 200),
        key: request.id,
        priority: "UPDATE",
        target: "PROFILE",
      });
      return {
        outcome: "OK",
        value: { requestId: request.id, status: "DECLINED" },
      };
    },

    /** Who can see one document, what it is set to, and its history. */
    documentAccess: async (
      actor: ActorContext,
      documentId: string,
    ): Promise<DocumentAccessDto | null> => {
      const own = await ownDocument(actor, documentId);
      if (own === null) return null;
      const { document } = own;
      const [{ relationships, nameOf }, policies] = await Promise.all([
        names(document.companyId),
        dependencies.policyRepository.findAllForResource(sql, {
          type: "document",
          id: document.documentId,
        }),
      ]);
      const at = now();
      return {
        documentId: document.documentId,
        title: document.title.slice(0, 300),
        folderCode: document.folderCode,
        level: document.level,
        visibilityScope: DATA_ROOM_LEVEL_SCOPE[document.level],
        version: Math.max(document.version, 1),
        grants: policies
          .filter(
            (policy) =>
              policy.recipient?.type === "RELATIONSHIP" &&
              isPolicyActiveAt(policy, at),
          )
          .map((policy) => ({
            policyId: policy.id,
            relationshipId: policy.recipient?.id ?? "",
            investorOrganisationName: nameOf(policy.recipient?.id ?? ""),
            accessLevel: policy.accessLevel,
            grantedAt: policy.createdAt,
            expiresAt: policy.expiresAt,
          }))
          .slice(0, 200),
        history: accessHistory(policies, nameOf, at),
        candidates: relationships.slice(0, 200),
      };
    },

    /** Who can see a folder's documents, investor by investor. */
    folderAccess: async (
      actor: ActorContext,
      companyId: string,
      folderCode: string,
    ): Promise<FolderAccessDto | null> => {
      const company = await ownCompany(actor, companyId);
      if (company === null) return null;
      const [folders, documents, { relationships }] = await Promise.all([
        store.folders(sql),
        store.documentsOf(sql, company.id),
        names(company.id),
      ]);
      const folder = folders.find((candidate) => candidate.code === folderCode);
      if (folder === undefined) return null;
      const inFolder = documents.filter((d) => d.folderCode === folderCode);
      const ids = new Set(inFolder.map((d) => d.documentId));
      const find = dependencies.policyRepository.findUnrevokedForRecipient;
      const investors = await Promise.all(
        relationships.map(async (relationship) => {
          const grants =
            find === undefined
              ? new Map<string, string | null>()
              : activeGrants(
                  await find(sql, {
                    resourceType: "document",
                    recipient: {
                      type: "RELATIONSHIP",
                      id: relationship.relationshipId,
                    },
                  }),
                  now(),
                );
          return {
            relationshipId: relationship.relationshipId,
            investorOrganisationName: relationship.investorOrganisationName,
            documents: [...grants.keys()].filter((id) => ids.has(id)).length,
          };
        }),
      );
      return {
        folderCode: folder.code,
        label: folder.label,
        documents: inFolder.map((d) => ({
          documentId: d.documentId,
          title: d.title.slice(0, 300),
          level: d.level,
        })),
        investors: investors.filter((investor) => investor.documents > 0),
        candidates: relationships.slice(0, 200),
      };
    },

    /** Shares documents (one, or a folder's) with one of the company's relationships. */
    share: async (command: {
      readonly actor: ActorContext;
      readonly companyId?: string | undefined;
      readonly documentId?: string | undefined;
      readonly folderCode?: string | undefined;
      readonly relationshipId: string;
      readonly accessLevel: DocumentAccessLevel;
      readonly days: number;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<FounderRequestsOutcome<{ readonly changed: number }>> => {
      let company: DataRoomCompany | null = null;
      let documents: readonly DataRoomDocument[] = [];
      if (command.documentId !== undefined) {
        const own = await ownDocument(command.actor, command.documentId);
        if (own === null) return refused("NOT_FOUND");
        company = own.company;
        documents = [own.document];
      } else if (
        command.companyId !== undefined &&
        command.folderCode !== undefined
      ) {
        company = await ownCompany(command.actor, command.companyId);
        if (company === null) return refused("NOT_FOUND");
        documents = (await store.documentsOf(sql, company.id)).filter(
          (d) => d.folderCode === command.folderCode,
        );
      }
      if (company === null) return refused("NOT_FOUND");
      // Only one of this company's own relationships.
      const relationship = await quietly(
        dependencies.relationship(command.relationshipId),
        null,
      );
      if (relationship === null || relationship.companyId !== company.id)
        return refused("NOT_FOUND");
      const shareable = documents.filter((d) => d.currentVersionId !== null);
      if (shareable.length === 0) return refused("NOT_SHAREABLE");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const expiresAt = expiryAfter(command.days);
      let changed = 0;
      for (const document of shareable) {
        const policyId = await grant(command.actor, {
          documentId: document.documentId,
          relationshipId: command.relationshipId,
          accessLevel: command.accessLevel,
          expiresAt,
          correlationId,
        });
        if (policyId === null) continue;
        changed += 1;
        await transactions.run((tx) =>
          dependencies.appender.append(tx, {
            relationshipId: RelationshipIdSchema.parse(command.relationshipId),
            eventType: RELATIONSHIP_EVENT_DOCUMENT_SHARED,
            actor: { type: "HUMAN", id: command.actor.userId },
            source: { type: "MANUAL", id: policyId },
            visibilityScope: "relationship_shared",
            payload: {
              documentId: document.documentId,
              disclosurePolicyId: policyId,
            },
            correlationId,
          }),
        );
      }
      if (changed > 0) {
        const first = shareable[0];
        await notifyQuietly({
          relationshipId: command.relationshipId,
          actingSide: "COMPANY",
          title: (shareable.length === 1 && first !== undefined
            ? `{actor} shared ${first.title} with you`
            : `{actor} shared ${String(changed)} documents with you`
          ).slice(0, 200),
          key: `${correlationId}:${command.relationshipId}`,
          priority: "UPDATE",
          target: "PROFILE",
        });
      }
      return { outcome: "OK", value: { changed } };
    },

    /** Sets every document in a folder to one level. */
    setFolderLevel: async (command: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly folderCode: string;
      readonly level: DataRoomLevel;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<FounderRequestsOutcome<{ readonly changed: number }>> => {
      const company = await ownCompany(command.actor, command.companyId);
      if (company === null) return refused("NOT_FOUND");
      const documents = (await store.documentsOf(sql, company.id)).filter(
        (d) => d.folderCode === command.folderCode && d.level !== command.level,
      );
      let changed = 0;
      for (const document of documents) {
        const set = await dependencies.dataRoom.setLevel({
          actor: command.actor,
          documentId: document.documentId,
          level: command.level,
          folderCode: document.folderCode,
          ...(document.version > 0 ? { expectedVersion: document.version } : {}),
          correlationId: command.correlationId,
        });
        if (set.outcome === "OK") changed += 1;
      }
      return { outcome: "OK", value: { changed } };
    },

    /** Takes one share back (the policy manager revokes and audits it). */
    revoke: async (command: {
      readonly actor: ActorContext;
      readonly policyId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<FounderRequestsOutcome<{ readonly changed: number }>> => {
      const id = DisclosurePolicyIdSchema.safeParse(command.policyId);
      if (!id.success) return refused("NOT_FOUND");
      const policy = await quietly(
        dependencies.policyRepository.findById(sql, id.data),
        null,
      );
      if (policy === null || policy.resource.type !== "document")
        return refused("NOT_FOUND");
      if ((await ownDocument(command.actor, policy.resource.id)) === null)
        return refused("NOT_FOUND");
      const revoked = await dependencies.policies.revoke({
        actor: command.actor,
        disclosurePolicyId: id.data,
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
      });
      return {
        outcome: "OK",
        value: { changed: revoked.outcome === "REVOKED" ? 1 : 0 },
      };
    },

    /** The investor's questions, as sent (their exact wording), recorded once. */
    recordQuestions: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly sentVia: "DILIGENCE_REQUEST" | "CHAT_MESSAGE";
      readonly sentRef: string;
      readonly idempotencyKey: string;
      readonly questions: readonly {
        readonly question: string;
        readonly assumptionId: string | null;
        readonly assumptionLabel: string | null;
      }[];
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<FounderRequestsOutcome<{ readonly questionIds: readonly string[] }>> => {
      const [relationship, investor] = await Promise.all([
        quietly(dependencies.relationship(command.relationshipId), null),
        quietly(dependencies.investorOf(command.actor), null),
      ]);
      // Only the relationship's own investor side asks.
      if (
        relationship === null ||
        investor === null ||
        investor.investorOrganisationId !== relationship.investorOrganisationId
      )
        return refused("NOT_FOUND");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const made = await transactions.run(async (tx) => {
        const inserted = await dependencies.questions.insertMany(tx, {
          tenantId: relationship.tenantId,
          relationshipId: command.relationshipId,
          companyId: relationship.companyId,
          userId: command.actor.userId,
          sentVia: command.sentVia,
          sentRef: command.sentRef,
          idempotencyKey: command.idempotencyKey,
          questions: command.questions.slice(0, 5),
        });
        if (inserted.created) {
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: QUESTIONS_SENT,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: command.relationshipId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: { questions: inserted.ids.length, via: command.sentVia },
            correlationId,
          });
        }
        return inserted;
      });
      if (made.created) {
        // Same key as the diligence request's own notice: one notice, which
        // opens this set of questions in the founder's inbox.
        await notifyQuietly({
          relationshipId: command.relationshipId,
          actingSide: "INVESTOR",
          title: (made.ids.length === 1
            ? "{actor} asked you a question"
            : `{actor} asked you ${String(made.ids.length)} questions`
          ).slice(0, 200),
          key: command.sentRef,
          priority: "NEEDS_YOU",
          target: "REQUESTS",
        });
      }
      return { outcome: "OK", value: { questionIds: made.ids } };
    },

    /**
     * The founder answers one question: their words, and up to five of the
     * company's documents as evidence (each shared with the asker, view
     * only, 30 days). Recorded as their claim through the Write Gate.
     */
    answer: async (command: {
      readonly actor: ActorContext;
      readonly questionId: string;
      readonly answer: string;
      readonly documentIds: readonly string[];
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      FounderRequestsOutcome<{
        readonly answerId: string;
        readonly evidenceStatus: "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
        readonly recorded: boolean;
      }>
    > => {
      const question = await quietly(
        dependencies.questions.find(sql, command.questionId),
        null,
      );
      if (question === null) return refused("NOT_FOUND");
      const company = await ownCompany(command.actor, question.companyId);
      if (company === null) return refused("NOT_FOUND");
      const words = command.answer.trim().slice(0, 2000);
      if (words.length === 0) return refused("NOT_SHAREABLE");
      const documentIds = [...new Set(command.documentIds)].slice(0, 5);
      // Each attachment is one of THIS company's documents with a file.
      for (const documentId of documentIds) {
        const document = await quietly(store.document(sql, documentId), null);
        if (
          document === null ||
          document.companyId !== company.id ||
          document.currentVersionId === null
        )
          return refused("NOT_SHAREABLE");
      }
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const expiresAt = expiryAfter(ANSWER_SHARE_DAYS);
      for (const documentId of documentIds) {
        await grant(command.actor, {
          documentId,
          relationshipId: question.relationshipId,
          accessLevel: "view",
          expiresAt,
          correlationId,
        });
      }
      // The Write Gate first (outside the answer's transaction, like every
      // evidence write); a refusal or failure still sends the words.
      const knowledge =
        dependencies.answers === undefined
          ? { evidenceItemId: null, knowledgeObjectId: null }
          : await quietly(
              dependencies.answers.record({
                actor: command.actor,
                companyId: company.id,
                questionId: question.id,
                about: question.assumptionLabel,
                answer: words,
                correlationId,
              }),
              { evidenceItemId: null, knowledgeObjectId: null },
            );
      const made = await transactions.run(async (tx) => {
        const inserted = await dependencies.questions.insertAnswer(tx, {
          questionId: question.id,
          tenantId: question.tenantId,
          answer: words,
          documentIds,
          evidenceItemId: knowledge.evidenceItemId,
          knowledgeObjectId: knowledge.knowledgeObjectId,
          userId: command.actor.userId,
          idempotencyKey: command.idempotencyKey,
        });
        if (inserted.created) {
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: QUESTION_ANSWERED,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: question.relationshipId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              questionId: question.id,
              documents: documentIds.length,
              recorded: knowledge.knowledgeObjectId !== null,
            },
            correlationId,
          });
        }
        return inserted;
      });
      if (made.created) {
        await notifyQuietly({
          relationshipId: question.relationshipId,
          actingSide: "COMPANY",
          title: `{actor} answered your question`.slice(0, 200),
          key: made.id,
          priority: "NEEDS_YOU",
          target: "PROFILE",
        });
      }
      return {
        outcome: "OK",
        value: {
          answerId: made.id,
          evidenceStatus:
            documentIds.length > 0 ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED",
          recorded: knowledge.knowledgeObjectId !== null,
        },
      };
    },

    /** An investor's own questions to one company, with the founder's answers. */
    investorQuestions: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<readonly InvestorQuestion[] | null> => {
      const investor = await quietly(dependencies.investorOf(actor), null);
      if (investor === null) return null;
      const relationshipId = await quietly(
        dependencies.relationshipOf(companyId, investor.investorOrganisationId),
        null,
      );
      if (relationshipId === null) return [];
      const records = await dependencies.questions.listForRelationship(
        sql,
        relationshipId,
      );
      // Only titles of documents shared with this relationship are named.
      const find = dependencies.policyRepository.findUnrevokedForRecipient;
      const grants =
        find === undefined
          ? new Map<string, string | null>()
          : activeGrants(
              await find(sql, {
                resourceType: "document",
                recipient: { type: "RELATIONSHIP", id: relationshipId },
              }),
              now(),
            );
      const titles = new Map<string, string>();
      for (const record of records) {
        for (const documentId of record.answer?.documentIds ?? []) {
          if (!grants.has(documentId) || titles.has(documentId)) continue;
          const document = await quietly(store.document(sql, documentId), null);
          if (document !== null) titles.set(documentId, document.title);
        }
      }
      return records.map((record) =>
        toQuestion(record, (id) => titles.get(id) ?? null),
      );
    },
  };
}

export type FounderRequestsService = ReturnType<
  typeof createFounderRequestsService
>;
