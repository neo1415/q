import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  RelationshipIdSchema,
  type DiligenceQuestionRecord,
  type DiligenceQuestionRepository,
  type DiligenceRequestRepository,
  type InterestService,
  type RelationshipEventAppender,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import {
  actorPrincipal,
  DisclosurePolicyIdSchema,
  type DisclosurePolicy,
} from "../contracts/index.js";
import type { DisclosureAccessService } from "./access-service.js";
import type { DisclosurePolicyManager } from "./policy-manager.js";
import type { DisclosurePolicyRepository } from "./ports.js";

/**
 * A minimal diligence area (post-meeting audit item 5, 2026-10-02; doc 10:
 * a minimal gated document area). It opens on a relationship once diligence
 * has started (relationship-state.v2 reached IN_DILIGENCE) and closes on a
 * pass.
 *
 * Sharing is the existing disclosure machinery, never a looser rule: the
 * founder shares one of their own documents with THIS relationship as a
 * relationship_shared disclosure policy (the policy manager authorises
 * disclosure.manage on the owning organisation, audits and announces it),
 * and revokes it the same way. A download is decided by the access service
 * for the person asking, then minted as a short-lived signed URL straight
 * from storage. One investor never sees another relationship's shares: a
 * relationship_shared policy admits only that relationship's parties.
 *
 * Requests are the investor's: a title and an optional note, append-only;
 * the founder answers one by sharing a document, which records which share
 * fulfilled it. Each request and each share is a relationship event both
 * sides read, with the other side told.
 */

export type DiligenceDocumentPort = {
  /** One of the actor's own documents, as Evidence authorises it. */
  readonly ownDocument: (
    actor: ActorContext,
    documentId: string,
  ) => Promise<DiligenceDocument | null>;
  /** A document by id, permission-neutral, for a share already authorised. */
  readonly canonical: (documentId: string) => Promise<DiligenceDocument | null>;
  /** A short-lived signed download of an already-authorised version. */
  readonly signedDownload: (
    document: DiligenceDocument,
    disposition?: "INLINE" | "ATTACHMENT",
  ) => Promise<{
    readonly url: string;
    readonly expiresAt: string;
    /** False for a NOT_SCANNED file (ADR 0042). Absent: scanned. */
    readonly scanned?: boolean | undefined;
  }>;
  /**
   * Finishes the founder's own upload through Evidence (the documents
   * screen's own step), returning the new document's id. Absent: upload
   * and share in one step is not offered.
   */
  readonly completeUpload?:
    | ((command: {
        readonly actor: ActorContext;
        readonly uploadSessionId: string;
        readonly idempotencyKey: string;
        readonly correlationId: CorrelationId;
      }) => Promise<{ readonly documentId: string }>)
    | undefined;
};

export type DiligenceDocument = {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string | null;
  readonly title: string;
  readonly documentType: string;
  readonly currentVersionId: string | null;
  /** False when its current version was never virus-scanned (ADR 0042). */
  readonly scanned?: boolean | undefined;
};

export type DiligenceView = {
  readonly relationshipId: string;
  readonly side: "INVESTOR" | "COMPANY";
  /** Diligence has started and the investor has not passed. */
  readonly open: boolean;
  readonly shares: readonly {
    readonly policyId: string;
    readonly documentId: string;
    readonly title: string;
    readonly documentType: string;
    readonly sharedAt: string;
    /** False: "Not virus-scanned yet" beside it (ADR 0042). */
    readonly scanned: boolean;
    /** When someone on the investor's side first opened it; null: not yet. */
    readonly viewedAt: string | null;
    /**
     * Q's one-line summary of the shared version, from its own text; null
     * until the worker has read it. Shown labelled as Q's, never as fact.
     */
    readonly qSummary: string | null;
  }[];
  readonly requests: readonly {
    readonly requestId: string;
    readonly title: string;
    readonly note: string | null;
    readonly requestedAt: string;
    /** Who asked (their profile's name); null when it names nobody. */
    readonly requestedByName: string | null;
    readonly status: "OPEN" | "FULFILLED" | "DECLINED";
    /** The founder's note when declined (2026-10-08). */
    readonly declineNote: string | null;
    readonly fulfilledBy: {
      readonly documentId: string;
      readonly title: string | null;
    } | null;
    /** The questions this request carried, with answers; null: none. */
    readonly questions: readonly DiligenceRequestQuestion[] | null;
  }[];
};

export type DiligenceRequestQuestion = {
  readonly questionId: string;
  readonly question: string;
  readonly assumptionId: string | null;
  readonly assumptionLabel: string | null;
  readonly answer: {
    readonly text: string;
    readonly answeredAt: string;
    readonly truthClass: "USER_CLAIM";
    readonly evidenceStatus: "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
  } | null;
};

/**
 * The questions a diligence request carried (its id is their send's
 * reference), in the order asked. A request that carried questions is
 * answered by their answers, not by a document.
 */
export function questionsByRequest(
  records: readonly DiligenceQuestionRecord[],
): Map<string, DiligenceRequestQuestion[]> {
  const out = new Map<string, DiligenceRequestQuestion[]>();
  for (const record of [...records].sort((a, b) => a.position - b.position)) {
    const set = out.get(record.sentRef) ?? [];
    set.push({
      questionId: record.id,
      question: record.question,
      assumptionId: record.assumptionId,
      assumptionLabel: record.assumptionLabel,
      answer:
        record.answer === null
          ? null
          : {
              text: record.answer.text,
              answeredAt: record.answer.answeredAt,
              truthClass: "USER_CLAIM",
              evidenceStatus: record.answer.evidenceStatus,
            },
    });
    out.set(record.sentRef, set);
  }
  return out;
}

export type DiligenceRefusal =
  "NOT_FOUND" | "NOT_OPEN" | "COMPANY_ONLY" | "INVESTOR_ONLY" | "NOT_SHAREABLE";

export type DiligenceOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T }
  | { readonly outcome: "REFUSED"; readonly code: DiligenceRefusal };

const ACTION_REQUESTED = AuditActionTypeSchema.parse(
  "diligence.document_requested",
);
const RESOURCE_RELATIONSHIP = AuditResourceTypeSchema.parse("relationship");

export function createDiligenceService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly relationships: Pick<InterestService, "relationshipById">;
  readonly policies: Pick<DisclosurePolicyManager, "grant" | "revoke">;
  readonly policyRepository: Pick<
    DisclosurePolicyRepository,
    "findUnrevokedForRecipient"
  >;
  readonly access: Pick<DisclosureAccessService, "canDisclose">;
  readonly documents: DiligenceDocumentPort;
  readonly requests: DiligenceRequestRepository;
  /** The investor's questions and answers (2026-10-08). Absent: none shown. */
  readonly questions?:
    Pick<DiligenceQuestionRepository, "listForRelationship"> | undefined;
  readonly appender: RelationshipEventAppender;
  readonly audit: MaterialActionAuditWriter;
  /**
   * The other side is told (best-effort, after the change committed).
   * `{actor}` in the title is the acting side's own name, filled in by the
   * notice writer from the relationship ("Ajopot shared Pitch deck v3").
   */
  readonly notify?:
    | ((input: {
        readonly relationshipId: string;
        readonly actingSide: "INVESTOR" | "COMPANY";
        readonly title: string;
        readonly key: string;
        readonly priority: "NEEDS_YOU" | "UPDATE";
      }) => Promise<unknown>)
    | undefined;
  readonly newCorrelationId: () => CorrelationId;
}) {
  const { sql, transactions, requests, appender } = dependencies;

  async function partyOf(actor: ActorContext, relationshipId: string) {
    const id = RelationshipIdSchema.safeParse(relationshipId);
    if (!id.success) return null;
    const view = await dependencies.relationships
      .relationshipById({ actor, relationshipId: id.data })
      .catch(() => null);
    if (view === null || view.status === null) return null;
    const projection = view.status.projection;
    return {
      relationshipId: id.data,
      side: view.side,
      tenantId: view.status.relationship.tenantId,
      companyId: view.status.relationship.companyId,
      // Opens once diligence started; a pass closes it.
      open:
        projection.state !== "PASSED" &&
        projection.milestones.some(
          (milestone) => milestone.state === "IN_DILIGENCE",
        ),
    };
  }
  type Party = NonNullable<Awaited<ReturnType<typeof partyOf>>>;

  async function sharesOf(party: Party): Promise<readonly DisclosurePolicy[]> {
    const find = dependencies.policyRepository.findUnrevokedForRecipient;
    if (find === undefined) return [];
    return find(sql, {
      resourceType: "document",
      recipient: { type: "RELATIONSHIP", id: party.relationshipId },
    });
  }

  const notifyQuietly = (
    input: Parameters<NonNullable<typeof dependencies.notify>>[0],
  ) => dependencies.notify?.(input).catch(() => undefined);

  const refused = <T>(code: DiligenceRefusal): DiligenceOutcome<T> => ({
    outcome: "REFUSED",
    code,
  });

  /** The founder shares one of their documents, optionally answering a request. */
  const share = async (command: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly documentId: string;
    readonly requestId?: string | undefined;
    readonly correlationId?: CorrelationId | undefined;
  }): Promise<DiligenceOutcome<{ readonly policyId: string }>> => {
    const party = await partyOf(command.actor, command.relationshipId);
    if (party === null) return refused("NOT_FOUND");
    if (party.side !== "COMPANY") return refused("COMPANY_ONLY");
    if (!party.open) return refused("NOT_OPEN");
    const document = await dependencies.documents
      .ownDocument(command.actor, command.documentId)
      .catch(() => null);
    // Their own document, of this relationship's company, with a version.
    if (
      document === null ||
      document.companyId !== party.companyId ||
      document.currentVersionId === null
    ) {
      return refused("NOT_SHAREABLE");
    }
    const request =
      command.requestId === undefined
        ? null
        : await requests.find(sql, command.requestId);
    if (
      command.requestId !== undefined &&
      (request === null || request.relationshipId !== party.relationshipId)
    ) {
      return refused("NOT_FOUND");
    }
    // Declined already (2026-10-08): a share cannot also answer it.
    if (request !== null && request.decline !== null) {
      return refused("NOT_SHAREABLE");
    }
    const correlationId =
      command.correlationId ?? dependencies.newCorrelationId();
    // The existing disclosure rule: owner authority, audit, announcement.
    const granted = await dependencies.policies.grant({
      actor: command.actor,
      resource: { type: "document", id: document.id },
      scopeType: "relationship_shared",
      recipient: { type: "RELATIONSHIP", id: party.relationshipId },
      accessLevel: "view",
      correlationId,
    });
    if (granted.outcome === "REDUNDANT") return refused("NOT_SHAREABLE");
    const policyId = granted.policy.id;
    const recorded = await transactions.run(async (tx) => {
      const fulfilled =
        request === null
          ? false
          : await requests.fulfil(tx, {
              requestId: request.id,
              tenantId: party.tenantId,
              disclosurePolicyId: policyId,
              documentId: document.id,
              userId: command.actor.userId,
            });
      if (granted.outcome === "CREATED" || fulfilled) {
        await appender.append(tx, {
          relationshipId: party.relationshipId,
          eventType: RELATIONSHIP_EVENT_DOCUMENT_SHARED,
          actor: { type: "HUMAN", id: command.actor.userId },
          source: { type: "MANUAL", id: policyId },
          visibilityScope: "relationship_shared",
          payload: {
            documentId: document.id,
            disclosurePolicyId: policyId,
            ...(request === null ? {} : { requestId: request.id }),
          },
          correlationId,
        });
        return true;
      }
      return false;
    });
    if (recorded) {
      await notifyQuietly({
        relationshipId: party.relationshipId,
        actingSide: "COMPANY",
        title: (request === null
          ? `{actor} shared ${document.title}`
          : `{actor} shared ${document.title} for your request`
        ).slice(0, 200),
        key: policyId,
        // An answer to their own request is theirs to open next.
        priority: request === null ? "UPDATE" : "NEEDS_YOU",
      });
    }
    return { outcome: "OK", value: { policyId } };
  };

  const service = {
    view: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
    }): Promise<DiligenceView | null> => {
      const party = await partyOf(query.actor, query.relationshipId);
      if (party === null) return null;
      const [policies, rows, views, asked] = await Promise.all([
        sharesOf(party),
        requests.listForRelationship(sql, party.relationshipId),
        requests.viewsFor(sql, party.relationshipId),
        dependencies.questions === undefined
          ? Promise.resolve([] as readonly DiligenceQuestionRecord[])
          : dependencies.questions
              .listForRelationship(sql, party.relationshipId)
              .catch(() => [] as readonly DiligenceQuestionRecord[]),
      ]);
      const carried = questionsByRequest(asked);
      const titles = new Map<string, DiligenceDocument>();
      await Promise.all(
        [
          ...new Set([
            ...policies.map((policy) => policy.resource.id),
            ...rows.flatMap((row) =>
              row.fulfilment === null ? [] : [row.fulfilment.documentId],
            ),
          ]),
        ].map(async (documentId) => {
          const document = await dependencies.documents
            .canonical(documentId)
            .catch(() => null);
          // Only the relationship's own company's documents are named.
          if (document !== null && document.companyId === party.companyId) {
            titles.set(documentId, document);
          }
        }),
      );
      // Q's summary of exactly the version being shared, only beside a
      // share this reader can already open.
      const summaries = await requests.summariesFor(
        sql,
        policies.flatMap((policy) => {
          const version = titles.get(policy.resource.id)?.currentVersionId;
          return version === undefined || version === null ? [] : [version];
        }),
      );
      return {
        relationshipId: party.relationshipId,
        side: party.side,
        open: party.open,
        shares: policies.flatMap((policy) => {
          const document = titles.get(policy.resource.id);
          return document === undefined
            ? []
            : [
                {
                  policyId: policy.id,
                  documentId: document.id,
                  title: document.title,
                  documentType: document.documentType,
                  sharedAt: policy.createdAt,
                  scanned: document.scanned !== false,
                  viewedAt: views.get(document.id) ?? null,
                  qSummary:
                    document.currentVersionId === null
                      ? null
                      : (summaries.get(document.currentVersionId) ?? null),
                },
              ];
        }),
        requests: rows.map((row) => ({
          requestId: row.id,
          title: row.title,
          note: row.note,
          requestedAt: row.createdAt,
          requestedByName: row.requestedByName,
          status:
            row.fulfilment !== null
              ? "FULFILLED"
              : row.decline !== null
                ? "DECLINED"
                : "OPEN",
          declineNote: row.decline?.note ?? null,
          fulfilledBy:
            row.fulfilment === null
              ? null
              : {
                  documentId: row.fulfilment.documentId,
                  title: titles.get(row.fulfilment.documentId)?.title ?? null,
                },
          questions: carried.get(row.id) ?? null,
        })),
      };
    },

    /** The founder shares one of their documents, optionally answering a request. */
    share,

    /** The founder takes a share back: the investor loses access at once. */
    revoke: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly policyId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DiligenceOutcome<{ readonly revoked: boolean }>> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (party.side !== "COMPANY") return refused("COMPANY_ONLY");
      const id = DisclosurePolicyIdSchema.safeParse(command.policyId);
      if (!id.success) return refused("NOT_FOUND");
      // Only a document share of THIS relationship is revocable here.
      const shares = await sharesOf(party);
      if (!shares.some((policy) => policy.id === id.data)) {
        return refused("NOT_FOUND");
      }
      const result = await dependencies.policies.revoke({
        actor: command.actor,
        disclosurePolicyId: id.data,
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
      });
      return {
        outcome: "OK",
        value: { revoked: result.outcome === "REVOKED" },
      };
    },

    /** The investor asks for a document. */
    request: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly title: string;
      readonly note?: string | null | undefined;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DiligenceOutcome<{ readonly requestId: string }>> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (party.side !== "INVESTOR") return refused("INVESTOR_ONLY");
      if (!party.open) return refused("NOT_OPEN");
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const title = command.title.trim().slice(0, 200);
      const note =
        command.note === undefined || command.note === null
          ? null
          : command.note.trim().slice(0, 1000) || null;
      const made = await transactions.run(async (tx) => {
        const inserted = await requests.insert(tx, {
          tenantId: party.tenantId,
          relationshipId: party.relationshipId,
          userId: command.actor.userId,
          title,
          note,
          idempotencyKey: command.idempotencyKey,
        });
        if (inserted.created) {
          await appender.append(tx, {
            relationshipId: party.relationshipId,
            eventType: RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
            actor: { type: "HUMAN", id: command.actor.userId },
            source: { type: "MANUAL", id: inserted.id },
            visibilityScope: "relationship_shared",
            payload: { requestId: inserted.id },
            correlationId,
          });
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: ACTION_REQUESTED,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: party.relationshipId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: { requestId: inserted.id },
            correlationId,
          });
        }
        return inserted;
      });
      if (made.created) {
        await notifyQuietly({
          relationshipId: party.relationshipId,
          actingSide: "INVESTOR",
          title: `{actor} asked for ${title}`.slice(0, 200),
          key: made.id,
          priority: "NEEDS_YOU",
        });
      }
      return { outcome: "OK", value: { requestId: made.id } };
    },

    /**
     * A shared document, for the person asking: the access service decides
     * (relationship_shared admits only this relationship's parties), then a
     * short-lived signed URL straight from storage.
     */
    download: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly documentId: string;
      /** INLINE opens it in the browser (View); default saves it. */
      readonly disposition?: "INLINE" | "ATTACHMENT" | undefined;
    }): Promise<{
      readonly url: string;
      readonly expiresAt: string;
    } | null> => {
      const party = await partyOf(query.actor, query.relationshipId);
      if (party === null) return null;
      const shares = await sharesOf(party);
      if (!shares.some((policy) => policy.resource.id === query.documentId)) {
        return null;
      }
      const decision = await dependencies.access.canDisclose({
        principal: actorPrincipal(query.actor),
        resource: { type: "document", id: query.documentId },
        requestedAccess: "view",
      });
      if (decision.outcome !== "ALLOW") return null;
      const document = await dependencies.documents.canonical(query.documentId);
      if (document === null || document.companyId !== party.companyId) {
        return null;
      }
      const link = await dependencies.documents.signedDownload(
        document,
        query.disposition ?? "ATTACHMENT",
      );
      // The requester's side opening it is what "Viewed" means; the
      // founder opening their own file is not. Best-effort: a lost write
      // never stops the download.
      if (party.side === "INVESTOR") {
        await requests
          .recordView(sql, {
            relationshipId: party.relationshipId,
            tenantId: party.tenantId,
            documentId: document.id,
            userId: query.actor.userId,
          })
          .catch(() => undefined);
      }
      return link;
    },

    /**
     * Upload and share in one step (founder critique 2026-10-04): the
     * founder's file, already in storage through the documents screen's
     * own upload session, is finished through Evidence and answers this
     * request through the same share as above. Checked before the upload
     * is finished, so a refused request leaves an ordinary document in
     * their Documents and shares nothing.
     */
    uploadAndFulfil: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly requestId: string;
      readonly uploadSessionId: string;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DiligenceOutcome<{ readonly policyId: string }>> => {
      const complete = dependencies.documents.completeUpload;
      if (complete === undefined) return refused("NOT_SHAREABLE");
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (party.side !== "COMPANY") return refused("COMPANY_ONLY");
      if (!party.open) return refused("NOT_OPEN");
      const request = await requests.find(sql, command.requestId);
      if (request === null || request.relationshipId !== party.relationshipId) {
        return refused("NOT_FOUND");
      }
      const correlationId =
        command.correlationId ?? dependencies.newCorrelationId();
      const uploaded = await complete({
        actor: command.actor,
        uploadSessionId: command.uploadSessionId,
        idempotencyKey: command.idempotencyKey,
        correlationId,
      });
      return share({
        actor: command.actor,
        relationshipId: party.relationshipId,
        documentId: uploaded.documentId,
        requestId: request.id,
        correlationId,
      });
    },
  };
  return service;
}

export type DiligenceService = ReturnType<typeof createDiligenceService>;
