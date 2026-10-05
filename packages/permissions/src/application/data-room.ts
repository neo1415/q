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
  DATA_ROOM_LISTED_LEVELS,
  type CorrelationId,
  type DataRoomInvestorDocument,
  type DataRoomInvestorView,
  type DataRoomLevel,
  type DataRoomOpenDto,
  type DataRoomOwnerView,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext, TransactionManager } from "@capital-q/database";
import {
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
  RelationshipIdSchema,
  type RelationshipEventAppender,
} from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import { actorPrincipal, isPolicyActiveAt, type DisclosurePolicy } from "../contracts/index.js";
import type { DisclosureAccessService } from "./access-service.js";
import type { DisclosurePolicyManager } from "./policy-manager.js";
import type { DisclosurePolicyRepository } from "./ports.js";

/**
 * A company's data room (overnight plan A3, 2026-10-06; research
 * docs/research/2026-10-06/data-room.md).
 *
 * Nothing here is a looser rule than what already exists:
 *   - which investors may know the room exists is the pitch rule (ADR 0041:
 *     media's resolveViewableCompany, through `investorMayFind`);
 *   - a grant to one investor is the existing disclosure policy
 *     (relationship_shared, the relationship as recipient, `view`, with an
 *     expiry), decided for every open by the access service, exactly as
 *     diligence shares are; a diligence share therefore shows here too;
 *   - the level is the founder's per-document choice, stored with its
 *     ADR-001 scope, and never widens anything derived from the file.
 *
 * An investor never receives the title of a document that is neither
 * listed (PUBLIC, ON_REQUEST) nor shared with their relationship: titles
 * leak ("Litigation with X"). Viewing is recorded for the founder and is
 * never an interest, ranking or match signal.
 */

const LEVEL_CHANGED = AuditActionTypeSchema.parse("data_room.level_changed");
const ACCESS_REQUESTED = AuditActionTypeSchema.parse("data_room.access_requested");
const ACCESS_DECIDED = AuditActionTypeSchema.parse("data_room.access_decided");
const RESOURCE_DOCUMENT = AuditResourceTypeSchema.parse("document");
const RESOURCE_RELATIONSHIP = AuditResourceTypeSchema.parse("relationship");

const DAY_MS = 86_400_000;

/** The room's own rows, as the Evidence repository returns them. */
export type DataRoomDocument = {
  readonly documentId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly title: string;
  readonly documentType: string;
  readonly level: DataRoomLevel;
  readonly folderCode: string;
  readonly checklistItemCode: string | null;
  readonly validUntil: string | null;
  readonly pageCount: number | null;
  readonly mimeType: string | null;
  readonly currentVersionId: string | null;
  readonly updatedAt: string;
  readonly version: number;
};

export type DataRoomChecklistEntry = {
  readonly code: string;
  readonly folderCode: string;
  readonly label: string;
  readonly countryLabels: Readonly<Record<string, string>>;
  readonly minStageRank: number;
  readonly countryCodes: readonly string[] | null;
  readonly defaultLevel: DataRoomLevel;
};

export type DataRoomRequestRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly documentId: string | null;
  readonly documentTitle: string | null;
  readonly relationshipId: string;
  readonly investorOrganisationId: string;
  readonly investorOrganisationName: string | null;
  readonly requestedByName: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly decision: "APPROVED" | "DECLINED" | null;
  readonly expiresAt: string | null;
};

/** Structural: `createPostgresDataRoom()` from Evidence satisfies it. */
export type DataRoomStore = {
  readonly folders: (executor: DatabaseExecutor) => Promise<readonly { code: string; label: string }[]>;
  readonly checklist: (executor: DatabaseExecutor) => Promise<readonly DataRoomChecklistEntry[]>;
  readonly documentsOf: (executor: DatabaseExecutor, companyId: string) => Promise<readonly DataRoomDocument[]>;
  readonly document: (executor: DatabaseExecutor, documentId: string) => Promise<DataRoomDocument | null>;
  readonly setLevel: (
    tx: TransactionContext,
    input: {
      readonly document: DataRoomDocument;
      readonly level: DataRoomLevel;
      readonly folderCode: string;
      readonly checklistItemCode: string | null;
      readonly expectedVersion: number;
      readonly userId: string;
    },
  ) => Promise<{ readonly version: number } | null>;
  readonly insertRequest: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly companyId: string;
      readonly documentId: string | null;
      readonly relationshipId: string;
      readonly investorOrganisationId: string;
      readonly userId: string;
      readonly note: string | null;
      readonly idempotencyKey: string;
    },
  ) => Promise<{ readonly id: string; readonly created: boolean }>;
  readonly requests: (
    executor: DatabaseExecutor,
    filter: { readonly companyId: string; readonly relationshipId?: string | undefined },
  ) => Promise<readonly DataRoomRequestRecord[]>;
  readonly insertDecision: (
    tx: TransactionContext,
    input: {
      readonly requestId: string;
      readonly tenantId: string;
      readonly decision: "APPROVED" | "DECLINED";
      readonly expiresAt: string | null;
      readonly userId: string;
    },
  ) => Promise<boolean>;
  readonly recordView: (
    executor: DatabaseExecutor,
    input: {
      readonly documentId: string;
      readonly tenantId: string;
      readonly investorOrganisationId: string;
      readonly userId: string;
    },
  ) => Promise<void>;
  readonly viewsByOrganisation: (
    executor: DatabaseExecutor,
    companyId: string,
    investorOrganisationId: string,
  ) => Promise<ReadonlyMap<string, string>>;
  /** The company a request was made to, or null. */
  readonly requestCompany: (executor: DatabaseExecutor, requestId: string) => Promise<string | null>;
  readonly openedByCounts: (executor: DatabaseExecutor, companyId: string) => Promise<ReadonlyMap<string, number>>;
};

export type DataRoomCompany = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly countryCode: string | null;
};

export type DataRoomRefusal =
  | "NOT_FOUND"
  | "OWNER_ONLY"
  | "INVESTOR_ONLY"
  | "NOT_REQUESTABLE"
  | "ALREADY_DECIDED"
  | "VERSION_CONFLICT";

export type DataRoomOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T }
  | { readonly outcome: "REFUSED"; readonly code: DataRoomRefusal };

// --- pure parts (tested without a database) ---------------------------------

const STAGE_RANKS: Readonly<Record<string, number>> = {
  pre_seed: 1,
  seed: 2,
  series_a: 3,
  series_b: 4,
};

/** The checklist stage for a declared stage; unknown is treated as seed. */
export function stageRank(stageCode: string | null): number {
  if (stageCode === null) return 2;
  return STAGE_RANKS[stageCode] ?? (stageCode.startsWith("series_") ? 4 : 2);
}

/** The default checklist for this stage and country, in its own words. */
export function checklistFor(
  items: readonly DataRoomChecklistEntry[],
  stageCode: string | null,
  countryCode: string | null,
): readonly (DataRoomChecklistEntry & { readonly words: string })[] {
  const rank = stageRank(stageCode);
  return items
    .filter(
      (item) =>
        item.minStageRank <= rank &&
        (item.countryCodes === null ||
          (countryCode !== null && item.countryCodes.includes(countryCode))),
    )
    .map((item) => ({
      ...item,
      words: (countryCode === null ? undefined : item.countryLabels[countryCode]) ?? item.label,
    }));
}

/** "PDF", "Sheet", "Slides"; null when the type says nothing useful. */
export function fileKind(mimeType: string | null): string | null {
  if (mimeType === null) return null;
  if (mimeType === "application/pdf") return "PDF";
  if (/spreadsheet|excel|csv/.test(mimeType)) return "Sheet";
  if (/presentation|powerpoint|keynote/.test(mimeType)) return "Slides";
  if (/word|document/.test(mimeType)) return "Document";
  if (mimeType.startsWith("image/")) return "Image";
  return null;
}

/**
 * What an investor may know of the room. Listed levels are shown; anything
 * else only when an active grant names their relationship.
 */
export function projectForInvestor(
  documents: readonly DataRoomDocument[],
  context: {
    /** documentId -> the grant's expiry (null: none), active grants only. */
    readonly grants: ReadonlyMap<string, string | null>;
    /** Documents with an open request; "*": everything on request. */
    readonly openRequests: ReadonlySet<string>;
    readonly views: ReadonlyMap<string, string>;
  },
): DataRoomInvestorDocument[] {
  return documents.flatMap((document): DataRoomInvestorDocument[] => {
    const granted = context.grants.has(document.documentId);
    const listed = DATA_ROOM_LISTED_LEVELS.includes(document.level);
    if (!granted && !listed) return [];
    const access: DataRoomInvestorDocument["access"] =
      granted || document.level === "PUBLIC"
        ? "OPEN"
        : context.openRequests.has(document.documentId) || context.openRequests.has("*")
          ? "REQUESTED"
          : "REQUESTABLE";
    return [
      {
        documentId: document.documentId,
        title: document.title,
        folderCode: document.folderCode,
        shownAs:
          document.level === "PUBLIC" ? "PUBLIC" : granted ? "SHARED" : "ON_REQUEST",
        access,
        kind: fileKind(document.mimeType),
        pageCount: document.pageCount,
        updatedAt: document.updatedAt,
        validUntil: document.validUntil,
        openedAt: context.views.get(document.documentId) ?? null,
        accessEndsAt:
          document.level === "PUBLIC" ? null : (context.grants.get(document.documentId) ?? null),
      },
    ];
  });
}

/** Active grants of a relationship, by document, with their expiry. */
export function activeGrants(
  policies: readonly DisclosurePolicy[],
  now: UtcTimestamp,
): Map<string, string | null> {
  const grants = new Map<string, string | null>();
  for (const policy of policies) {
    if (policy.resource.type !== "document" || !isPolicyActiveAt(policy, now)) continue;
    const previous = grants.get(policy.resource.id);
    // The longest-lasting grant wins; no expiry beats any expiry.
    if (
      !grants.has(policy.resource.id) ||
      policy.expiresAt === null ||
      (previous !== null && previous !== undefined && policy.expiresAt > previous)
    ) {
      grants.set(policy.resource.id, policy.expiresAt);
    }
  }
  return grants;
}

// --- the service ---------------------------------------------------------------

export function createDataRoomService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly store: DataRoomStore;
  readonly company: (companyId: string) => Promise<DataRoomCompany | null>;
  /** The actor's own investor organisation, or null when they are not an investor. */
  readonly investorOf: (
    actor: ActorContext,
  ) => Promise<{ readonly investorOrganisationId: string; readonly name: string } | null>;
  /** ADR 0041's pitch rule: the company is viewable to this investor now. */
  readonly investorMayFind: (actor: ActorContext, companyId: string) => Promise<boolean>;
  /** The actor may manage this company's data room (owner org + data_room.share). */
  readonly ownerMayManage: (actor: ActorContext, company: DataRoomCompany) => Promise<boolean>;
  readonly relationshipOf: (companyId: string, investorOrganisationId: string) => Promise<string | null>;
  /** The canonical relationship, created on first contact (never a parallel record). */
  readonly ensureRelationship: (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly investorOrganisationId: string;
    readonly correlationId: CorrelationId;
  }) => Promise<string>;
  readonly policies: Pick<DisclosurePolicyManager, "grant">;
  readonly policyRepository: Pick<DisclosurePolicyRepository, "findUnrevokedForRecipient">;
  readonly access: Pick<DisclosureAccessService, "canDisclose">;
  /** A short-lived signed, inline read of the document's current, unblocked version. */
  readonly signedInline: (document: DataRoomDocument) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  /** The reader's own name, for the watermark. */
  readonly nameOf: (actor: ActorContext) => Promise<string | null>;
  readonly appender: RelationshipEventAppender;
  readonly audit: MaterialActionAuditWriter;
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
  readonly now?: (() => UtcTimestamp) | undefined;
}) {
  const { sql, store, transactions } = dependencies;
  const now = dependencies.now ?? (() => new Date().toISOString() as UtcTimestamp);
  const refused = <T>(code: DataRoomRefusal): DataRoomOutcome<T> => ({ outcome: "REFUSED", code });
  const quietly = <T>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
  const notifyQuietly = (input: Parameters<NonNullable<typeof dependencies.notify>>[0]) =>
    dependencies.notify?.(input).catch(() => undefined);

  async function grantsOf(relationshipId: string | null): Promise<Map<string, string | null>> {
    const find = dependencies.policyRepository.findUnrevokedForRecipient;
    if (relationshipId === null || find === undefined) return new Map();
    const policies = await find(sql, {
      resourceType: "document",
      recipient: { type: "RELATIONSHIP", id: relationshipId },
    });
    return activeGrants(policies, now());
  }

  /** Owner, investor who can find it, or nobody: decided once per call. */
  async function readerOf(actor: ActorContext, companyId: string) {
    const company = await quietly(dependencies.company(companyId), null);
    if (company === null) return null;
    if (company.organisationId === actor.organisationId) {
      return (await quietly(dependencies.ownerMayManage(actor, company), false))
        ? ({ kind: "OWNER", company } as const)
        : null;
    }
    const investor = await quietly(dependencies.investorOf(actor), null);
    if (investor === null) return null;
    if (!(await quietly(dependencies.investorMayFind(actor, company.id), false))) return null;
    const relationshipId = await quietly(
      dependencies.relationshipOf(company.id, investor.investorOrganisationId),
      null,
    );
    return { kind: "INVESTOR", company, investor, relationshipId } as const;
  }

  const investorView = async (
    reader: Extract<NonNullable<Awaited<ReturnType<typeof readerOf>>>, { kind: "INVESTOR" }>,
  ): Promise<DataRoomInvestorView> => {
    const { company, investor, relationshipId } = reader;
    const [folders, documents, grants, requests, views] = await Promise.all([
      store.folders(sql),
      store.documentsOf(sql, company.id),
      grantsOf(relationshipId),
      relationshipId === null
        ? Promise.resolve([] as readonly DataRoomRequestRecord[])
        : store.requests(sql, { companyId: company.id, relationshipId }),
      store.viewsByOrganisation(sql, company.id, investor.investorOrganisationId),
    ]);
    const openRequests = new Set(
      requests.filter((r) => r.decision === null).map((r) => r.documentId ?? "*"),
    );
    const visible = projectForInvestor(documents, { grants, openRequests, views });
    const used = new Set(visible.map((document) => document.folderCode));
    return {
      viewer: "INVESTOR",
      companyId: company.id,
      folders: folders.filter((folder) => used.has(folder.code)),
      documents: visible,
    };
  };

  const ownerView = async (company: DataRoomCompany): Promise<DataRoomOwnerView> => {
    const [folders, items, documents, requests, opened] = await Promise.all([
      store.folders(sql),
      store.checklist(sql),
      store.documentsOf(sql, company.id),
      store.requests(sql, { companyId: company.id }),
      store.openedByCounts(sql, company.id),
    ]);
    // Who has it now: active grants across every relationship that asked.
    const relationships = [...new Set(requests.map((request) => request.relationshipId))];
    const sharedWith = new Map<string, number>();
    for (const grants of await Promise.all(relationships.map((id) => grantsOf(id)))) {
      for (const documentId of grants.keys()) {
        sharedWith.set(documentId, (sharedWith.get(documentId) ?? 0) + 1);
      }
    }
    const checklist = checklistFor(items, company.stageCode, company.countryCode);
    const filed = new Set(documents.map((document) => document.checklistItemCode));
    return {
      viewer: "OWNER",
      companyId: company.id,
      stageCode: company.stageCode ?? "seed",
      countryCode: company.countryCode,
      folders: [...folders],
      documents: documents.map((document) => ({
        documentId: document.documentId,
        title: document.title,
        folderCode: document.folderCode,
        checklistItemCode: document.checklistItemCode,
        level: document.level,
        visibilityScope: DATA_ROOM_LEVEL_SCOPE[document.level],
        kind: fileKind(document.mimeType),
        pageCount: document.pageCount,
        updatedAt: document.updatedAt,
        validUntil: document.validUntil,
        sharedWith: sharedWith.get(document.documentId) ?? 0,
        openedBy: opened.get(document.documentId) ?? 0,
        version: Math.max(document.version, 1),
      })),
      checklist: checklist.map((item) => ({
        code: item.code,
        folderCode: item.folderCode,
        label: item.words,
        defaultLevel: item.defaultLevel,
        present: filed.has(item.code),
      })),
      requests: requests.map((request) => ({
        requestId: request.id,
        documentId: request.documentId,
        documentTitle: request.documentTitle,
        requesterName: request.requestedByName,
        requesterOrganisationName: request.investorOrganisationName,
        note: request.note,
        requestedAt: request.createdAt,
        status:
          request.decision === null ? "OPEN" : request.decision === "APPROVED" ? "APPROVED" : "DECLINED",
        accessEndsAt: request.expiresAt,
      })),
    };
  };

  return {
    /** The room as this reader may see it; null: one not-found for everyone else. */
    view: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<DataRoomInvestorView | DataRoomOwnerView | null> => {
      const reader = await readerOf(actor, companyId);
      if (reader === null) return null;
      return reader.kind === "OWNER" ? ownerView(reader.company) : investorView(reader);
    },

    /** The founder sets one document's level (and, optionally, its folder). */
    setLevel: async (command: {
      readonly actor: ActorContext;
      readonly documentId: string;
      readonly level: DataRoomLevel;
      readonly folderCode?: string | undefined;
      readonly checklistItemCode?: string | null | undefined;
      readonly expectedVersion?: number | undefined;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DataRoomOutcome<{ readonly documentId: string; readonly level: DataRoomLevel; readonly version: number }>> => {
      const document = await quietly(store.document(sql, command.documentId), null);
      if (document === null) return refused("NOT_FOUND");
      const reader = await readerOf(command.actor, document.companyId);
      if (reader === null) return refused("NOT_FOUND");
      if (reader.kind !== "OWNER") return refused("OWNER_ONLY");
      const correlationId = command.correlationId ?? dependencies.newCorrelationId();
      const expected = command.expectedVersion ?? document.version;
      if (document.version > 0 && document.level === command.level &&
          (command.folderCode === undefined || command.folderCode === document.folderCode)) {
        return { outcome: "OK", value: { documentId: document.documentId, level: document.level, version: document.version } };
      }
      const changed = await transactions.run(async (tx) => {
        const saved = await store.setLevel(tx, {
          document,
          level: command.level,
          folderCode: command.folderCode ?? document.folderCode,
          checklistItemCode:
            command.checklistItemCode === undefined ? document.checklistItemCode : command.checklistItemCode,
          expectedVersion: expected,
          userId: command.actor.userId,
        });
        if (saved === null) return null;
        await dependencies.audit.record(tx, {
          ...auditActorFromContext(command.actor),
          auditEventId: createAuditEventId(),
          actionType: LEVEL_CHANGED,
          resourceType: RESOURCE_DOCUMENT,
          resourceId: document.documentId,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { from: document.level, to: command.level, visibilityScope: DATA_ROOM_LEVEL_SCOPE[command.level] },
          correlationId,
        });
        return saved;
      });
      if (changed === null) return refused("VERSION_CONFLICT");
      return { outcome: "OK", value: { documentId: document.documentId, level: command.level, version: changed.version } };
    },

    /** The investor asks for one on-request document, or all of them. */
    requestAccess: async (command: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly documentId: string | null;
      readonly note?: string | null | undefined;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DataRoomOutcome<{ readonly requestId: string; readonly status: "OPEN" }>> => {
      const reader = await readerOf(command.actor, command.companyId);
      if (reader === null) return refused("NOT_FOUND");
      if (reader.kind !== "INVESTOR") return refused("INVESTOR_ONLY");
      const documents = await store.documentsOf(sql, reader.company.id);
      const requestable = documents.filter((document) => document.level === "ON_REQUEST");
      // Only a title they can already see can be asked for: asking can never
      // confirm that an unlisted document exists.
      if (
        requestable.length === 0 ||
        (command.documentId !== null &&
          !requestable.some((document) => document.documentId === command.documentId))
      ) {
        return refused("NOT_REQUESTABLE");
      }
      const correlationId = command.correlationId ?? dependencies.newCorrelationId();
      const relationshipId =
        reader.relationshipId ??
        (await dependencies.ensureRelationship({
          actor: command.actor,
          companyId: reader.company.id,
          investorOrganisationId: reader.investor.investorOrganisationId,
          correlationId,
        }));
      const note =
        command.note === undefined || command.note === null ? null : command.note.trim().slice(0, 1000) || null;
      const made = await transactions.run(async (tx) => {
        const inserted = await store.insertRequest(tx, {
          tenantId: reader.company.tenantId,
          companyId: reader.company.id,
          documentId: command.documentId,
          relationshipId,
          investorOrganisationId: reader.investor.investorOrganisationId,
          userId: command.actor.userId,
          note,
          idempotencyKey: command.idempotencyKey,
        });
        if (inserted.created) {
          await dependencies.appender.append(tx, {
            relationshipId: RelationshipIdSchema.parse(relationshipId),
            eventType: RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
            actor: { type: "HUMAN", id: command.actor.userId },
            source: { type: "MANUAL", id: inserted.id },
            visibilityScope: "relationship_shared",
            payload: {
              requestId: inserted.id,
              ...(command.documentId === null ? {} : { documentId: command.documentId }),
            },
            correlationId,
          });
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: ACCESS_REQUESTED,
            resourceType: RESOURCE_RELATIONSHIP,
            resourceId: relationshipId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: { requestId: inserted.id, documentId: command.documentId },
            correlationId,
          });
        }
        return inserted;
      });
      if (made.created) {
        const title =
          command.documentId === null
            ? "everything on request"
            : (requestable.find((d) => d.documentId === command.documentId)?.title ?? "a document");
        await notifyQuietly({
          relationshipId,
          actingSide: "INVESTOR",
          title: `{actor} asked for ${title}`.slice(0, 200),
          key: made.id,
          priority: "NEEDS_YOU",
        });
      }
      return { outcome: "OK", value: { requestId: made.id, status: "OPEN" } };
    },

    /**
     * The founder answers a request. Approval grants each requested
     * on-request document to that relationship until the expiry, through
     * the disclosure policy manager (which authorises, audits and announces
     * each grant), then records the decision, one relationship event and one
     * audit row together.
     */
    decide: async (command: {
      readonly actor: ActorContext;
      readonly requestId: string;
      readonly decision: "APPROVE" | "DECLINE";
      readonly days?: number | undefined;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<DataRoomOutcome<{ readonly requestId: string; readonly status: "APPROVED" | "DECLINED" }>> => {
      // Find the request among the actor's own companies only.
      const ownCompanyId = await quietly(store.requestCompany(sql, command.requestId), null);
      if (ownCompanyId === null) return refused("NOT_FOUND");
      const reader = await readerOf(command.actor, ownCompanyId);
      if (reader === null || reader.kind !== "OWNER") return refused("NOT_FOUND");
      const request = (await store.requests(sql, { companyId: ownCompanyId })).find(
        (candidate) => candidate.id === command.requestId,
      );
      if (request === undefined) return refused("NOT_FOUND");
      if (request.decision !== null) return refused("ALREADY_DECIDED");
      const correlationId = command.correlationId ?? dependencies.newCorrelationId();

      if (command.decision === "DECLINE") {
        const recorded = await transactions.run(async (tx) => {
          const inserted = await store.insertDecision(tx, {
            requestId: request.id,
            tenantId: request.tenantId,
            decision: "DECLINED",
            expiresAt: null,
            userId: command.actor.userId,
          });
          if (inserted) {
            await dependencies.audit.record(tx, {
              ...auditActorFromContext(command.actor),
              auditEventId: createAuditEventId(),
              actionType: ACCESS_DECIDED,
              resourceType: RESOURCE_RELATIONSHIP,
              resourceId: request.relationshipId,
              occurredAt: occurredNow(),
              outcome: "SUCCEEDED",
              metadata: { requestId: request.id, decision: "DECLINED" },
              correlationId,
            });
          }
          return inserted;
        });
        return recorded
          ? { outcome: "OK", value: { requestId: request.id, status: "DECLINED" } }
          : refused("ALREADY_DECIDED");
      }

      const days = command.days ?? 30;
      const expiresAt = new Date(Date.parse(now()) + days * DAY_MS).toISOString() as UtcTimestamp;
      const documents = (await store.documentsOf(sql, ownCompanyId)).filter(
        (document) =>
          document.level === "ON_REQUEST" &&
          (request.documentId === null || document.documentId === request.documentId),
      );
      if (documents.length === 0) return refused("NOT_REQUESTABLE");
      // Grants first (each its own audited policy); the decision, event and
      // audit row then commit together. A crash between leaves grants the
      // founder can see and revoke, and the request still open to answer.
      const policyIds: string[] = [];
      for (const document of documents) {
        const granted = await dependencies.policies.grant({
          actor: command.actor,
          resource: { type: "document", id: document.documentId },
          scopeType: "relationship_shared",
          recipient: { type: "RELATIONSHIP", id: request.relationshipId },
          accessLevel: "view",
          expiresAt,
          correlationId,
        });
        if (granted.outcome !== "REDUNDANT") policyIds.push(granted.policy.id);
      }
      const recorded = await transactions.run(async (tx) => {
        const inserted = await store.insertDecision(tx, {
          requestId: request.id,
          tenantId: request.tenantId,
          decision: "APPROVED",
          expiresAt,
          userId: command.actor.userId,
        });
        if (!inserted) return false;
        if (policyIds.length > 0) {
          await dependencies.appender.append(tx, {
            relationshipId: RelationshipIdSchema.parse(request.relationshipId),
            eventType: RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
            actor: { type: "HUMAN", id: command.actor.userId },
            source: { type: "MANUAL", id: request.id },
            visibilityScope: "relationship_shared",
            payload: {
              requestId: request.id,
              documentIds: documents.map((document) => document.documentId),
              disclosurePolicyIds: policyIds,
              expiresAt,
            },
            correlationId,
          });
        }
        await dependencies.audit.record(tx, {
          ...auditActorFromContext(command.actor),
          auditEventId: createAuditEventId(),
          actionType: ACCESS_DECIDED,
          resourceType: RESOURCE_RELATIONSHIP,
          resourceId: request.relationshipId,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { requestId: request.id, decision: "APPROVED", expiresAt, documents: documents.length },
          correlationId,
        });
        return true;
      });
      if (!recorded) return refused("ALREADY_DECIDED");
      await notifyQuietly({
        relationshipId: request.relationshipId,
        actingSide: "COMPANY",
        title: `{actor} shared ${request.documentTitle ?? "their on-request documents"} with you`.slice(0, 200),
        key: request.id,
        priority: "UPDATE",
      });
      return { outcome: "OK", value: { requestId: request.id, status: "APPROVED" } };
    },

    /**
     * Opens one document for reading: the owner, an investor who can find
     * the company (PUBLIC), or one whose relationship holds an active grant
     * (decided again by the access service). View-only: shown inline with
     * the reader's name over it; the first open is recorded for the founder.
     */
    open: async (query: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly documentId: string;
    }): Promise<DataRoomOpenDto | null> => {
      const reader = await readerOf(query.actor, query.companyId);
      if (reader === null) return null;
      const document = await quietly(store.document(sql, query.documentId), null);
      if (document === null || document.companyId !== reader.company.id || document.currentVersionId === null) {
        return null;
      }
      if (reader.kind === "INVESTOR") {
        let allowed = document.level === "PUBLIC";
        if (!allowed && reader.relationshipId !== null) {
          const grants = await grantsOf(reader.relationshipId);
          if (grants.has(document.documentId)) {
            const decision = await dependencies.access.canDisclose({
              principal: actorPrincipal(query.actor),
              resource: { type: "document", id: document.documentId },
              requestedAccess: "view",
            });
            allowed = decision.outcome === "ALLOW";
          }
        }
        if (!allowed) return null;
      }
      const link = await dependencies.signedInline(document);
      let watermark: string | null = null;
      if (reader.kind === "INVESTOR") {
        const name = await quietly(dependencies.nameOf(query.actor), null);
        watermark = [name, reader.investor.name, now().slice(0, 10), "view only"]
          .filter((part): part is string => part !== null && part !== "")
          .join(" · ")
          .slice(0, 200);
        await store
          .recordView(sql, {
            documentId: document.documentId,
            tenantId: document.tenantId,
            investorOrganisationId: reader.investor.investorOrganisationId,
            userId: query.actor.userId,
          })
          .catch(() => undefined);
      }
      return { url: link.url, expiresAt: link.expiresAt, downloadable: false, watermark };
    },
  };
}

export type DataRoomService = ReturnType<typeof createDataRoomService>;
