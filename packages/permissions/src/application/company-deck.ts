import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  deckSectionForReaders,
  orderDeckSections,
  type CompanyDeckView,
  type CorrelationId,
  type DataRoomLevel,
  type DeckCoaching,
  type DeckSectionReading,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext, TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { DataRoomCompany } from "./data-room.js";

/**
 * The pitch-deck tab (overnight plan A4-A6).
 *
 *   who sees the deck   the owner; an investor the pitch rule admits (ADR
 *                       0041) when the founder made the deck PUBLIC in the
 *                       data room or opened its download to investors, or
 *                       when it is shared with their relationship (an
 *                       active grant). Nobody else, and "no deck" is the
 *                       same answer as "not shown to you".
 *   download            the founder's ADR 0041 choice, unchanged: false is
 *                       view only, with the reader's name over every slide.
 *   Q's sections        only a reading the founder confirmed (the Write
 *                       Gate), of the deck version being shown, for anyone
 *                       who may see the deck, whether or not it downloads.
 *   coaching            the owner's alone, computed on read by the
 *                       deterministic rubric; never stored, never sent to an
 *                       investor, never read by ranking or matching.
 */

const CONFIRMED = AuditActionTypeSchema.parse("deck.extraction_confirmed");
const RESOURCE_DOCUMENT = AuditResourceTypeSchema.parse("document");

export type CompanyDeckRecord = {
  readonly documentId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly uploadedAt: string;
  readonly downloadAudience: string;
  readonly scanned: boolean;
  readonly level: DataRoomLevel;
};

export type CompanyDeckReading = {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly pageCount: number | null;
  readonly sections: readonly DeckSectionReading[];
  readonly createdAt: string;
  readonly confirmed: boolean;
};

/** Structural: `createPostgresDataRoom()` from Evidence satisfies it. */
export type CompanyDeckStore = {
  readonly currentDeck: (executor: DatabaseExecutor, companyId: string) => Promise<CompanyDeckRecord | null>;
  readonly extractionFor: (executor: DatabaseExecutor, documentVersionId: string) => Promise<CompanyDeckReading | null>;
  readonly confirmExtraction: (
    tx: TransactionContext,
    input: { readonly extractionId: string; readonly tenantId: string; readonly userId: string },
  ) => Promise<boolean>;
};

export type CompanyDeckRefusal = "NOT_FOUND" | "STALE";

export function createCompanyDeckService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly store: CompanyDeckStore;
  readonly company: (companyId: string) => Promise<DataRoomCompany | null>;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly investorMayFind: (actor: ActorContext, companyId: string) => Promise<boolean>;
  readonly ownerMayManage: (actor: ActorContext, company: DataRoomCompany) => Promise<boolean>;
  /** An active disclosure grant of this document to the actor's relationship. */
  readonly sharedWithActor: (actor: ActorContext, companyId: string, documentId: string) => Promise<boolean>;
  /** The deterministic rubric (Evidence's coachDeck). */
  readonly coach: (sections: readonly DeckSectionReading[], pageCount: number | null) => DeckCoaching;
  /** A short-lived signed, inline read of exactly that version. */
  readonly signedInline: (deck: CompanyDeckRecord) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  readonly nameOf: (actor: ActorContext) => Promise<string | null>;
  readonly audit: MaterialActionAuditWriter;
  readonly newCorrelationId: () => CorrelationId;
  readonly now?: (() => UtcTimestamp) | undefined;
}) {
  const { sql, store } = dependencies;
  const quietly = <T>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
  const now = dependencies.now ?? (() => new Date().toISOString() as UtcTimestamp);

  async function readerOf(actor: ActorContext, companyId: string) {
    const company = await quietly(dependencies.company(companyId), null);
    if (company === null) return null;
    if (company.organisationId === actor.organisationId) {
      return (await quietly(dependencies.ownerMayManage(actor, company), false))
        ? ({ viewer: "OWNER", company } as const)
        : null;
    }
    if (!(await quietly(dependencies.isInvestor(actor), false))) return null;
    if (!(await quietly(dependencies.investorMayFind(actor, company.id), false))) return null;
    return { viewer: "INVESTOR", company } as const;
  }

  async function deckFor(actor: ActorContext, reader: NonNullable<Awaited<ReturnType<typeof readerOf>>>) {
    const deck = await quietly(store.currentDeck(sql, reader.company.id), null);
    if (deck === null) return null;
    if (reader.viewer === "OWNER") return deck;
    const open =
      deck.level === "PUBLIC" ||
      deck.downloadAudience === "INVESTORS" ||
      (await quietly(dependencies.sharedWithActor(actor, reader.company.id, deck.documentId), false));
    return open ? deck : null;
  }

  return {
    view: async (actor: ActorContext, companyId: string): Promise<CompanyDeckView | null> => {
      const reader = await readerOf(actor, companyId);
      if (reader === null) return null;
      const deck = await deckFor(actor, reader);
      if (deck === null) {
        return { viewer: reader.viewer, companyId: reader.company.id, deck: null, extraction: null, coaching: null };
      }
      const reading = await quietly(store.extractionFor(sql, deck.versionId), null);
      const owner = reader.viewer === "OWNER";
      // The Write Gate: an investor sees only what the founder confirmed.
      const shown = reading !== null && (owner || reading.confirmed) ? reading : null;
      return {
        viewer: reader.viewer,
        companyId: reader.company.id,
        deck: {
          documentId: deck.documentId,
          title: deck.title,
          versionNumber: deck.versionNumber,
          pageCount: reading?.pageCount ?? null,
          uploadedAt: deck.uploadedAt,
          downloadable: deck.downloadAudience === "INVESTORS",
          scanned: deck.scanned,
        },
        extraction:
          shown === null
            ? null
            : {
                extractionId: shown.id,
                readAt: shown.createdAt,
                versionNumber: deck.versionNumber,
                confirmed: shown.confirmed,
                // The rubric never leaves for anyone: stripped here for all.
                sections: orderDeckSections(shown.sections.map(deckSectionForReaders)),
              },
        coaching: owner && reading !== null ? dependencies.coach(reading.sections, reading.pageCount) : null,
      };
    },

    /** The deck for reading, inline, with the reader's name over it when view only. */
    open: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<{ url: string; expiresAt: string; downloadable: boolean; watermark: string | null } | null> => {
      const reader = await readerOf(actor, companyId);
      if (reader === null) return null;
      const deck = await deckFor(actor, reader);
      if (deck === null) return null;
      const link = await dependencies.signedInline(deck);
      const downloadable = reader.viewer === "OWNER" || deck.downloadAudience === "INVESTORS";
      const name = reader.viewer === "INVESTOR" ? await quietly(dependencies.nameOf(actor), null) : null;
      return {
        url: link.url,
        expiresAt: link.expiresAt,
        downloadable,
        watermark:
          reader.viewer === "OWNER" || downloadable
            ? null
            : [name, now().slice(0, 10), "view only"].filter((part) => part !== null).join(" · "),
      };
    },

    /** The founder confirms what Q read from the CURRENT version (the Write Gate). */
    confirm: async (command: {
      readonly actor: ActorContext;
      readonly documentId: string;
      readonly extractionId: string;
      readonly companyId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      | { readonly outcome: "OK"; readonly value: { readonly extractionId: string; readonly confirmed: true } }
      | { readonly outcome: "REFUSED"; readonly code: CompanyDeckRefusal }
    > => {
      const reader = await readerOf(command.actor, command.companyId);
      if (reader === null || reader.viewer !== "OWNER") return { outcome: "REFUSED", code: "NOT_FOUND" };
      const deck = await store.currentDeck(sql, reader.company.id);
      if (deck === null || deck.documentId !== command.documentId) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const reading = await store.extractionFor(sql, deck.versionId);
      // Approval binds to the exact reading on screen: a newer one needs its own.
      if (reading === null || reading.id !== command.extractionId) return { outcome: "REFUSED", code: "STALE" };
      if (!reading.confirmed) {
        const correlationId = command.correlationId ?? dependencies.newCorrelationId();
        await dependencies.transactions.run(async (tx) => {
          const made = await store.confirmExtraction(tx, {
            extractionId: reading.id,
            tenantId: deck.tenantId,
            userId: command.actor.userId,
          });
          if (made) {
            await dependencies.audit.record(tx, {
              ...auditActorFromContext(command.actor),
              auditEventId: createAuditEventId(),
              actionType: CONFIRMED,
              resourceType: RESOURCE_DOCUMENT,
              resourceId: deck.documentId,
              occurredAt: occurredNow(),
              outcome: "SUCCEEDED",
              metadata: { extractionId: reading.id, documentVersionId: deck.versionId },
              correlationId,
            });
          }
        });
      }
      return { outcome: "OK", value: { extractionId: reading.id, confirmed: true } };
    },
  };
}

export type CompanyDeckService = ReturnType<typeof createCompanyDeckService>;
