import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  DECK_READ_AGAIN_MAX,
  deckSectionForReaders,
  orderDeckSections,
  unknownDeckSection,
  type CompanyDeckView,
  type CorrelationId,
  type DataRoomLevel,
  type DeckCoaching,
  type DeckSection,
  type DeckSectionCode,
  type DeckSectionReading,
  type DeckSectionReviewAction,
  type DeckSectionState,
  type DeckSetAside,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
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
const REVIEWED = AuditActionTypeSchema.parse("deck.section_reviewed");
const READ_AGAIN = AuditActionTypeSchema.parse("deck.read_again_requested");
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
  /** F26 (absent from older stores: one reading, no reviews). */
  readonly readingNumber?: number | undefined;
  readonly setAside?: readonly DeckSetAside[] | undefined;
  readonly reviews?: readonly DeckSectionReview[] | undefined;
  readonly readAgain?:
    { readonly used: number; readonly pending: boolean } | undefined;
};

export type DeckSectionReview = {
  readonly section: DeckSectionCode;
  readonly action: DeckSectionReviewAction;
  readonly correction: string | null;
};

/**
 * F26: the founder's review applied to Q's reading, section by section.
 *
 *   DISMISS   "This is wrong": the section reads as unknown (UNCLEAR)
 *   CORRECT   their own words replace Q's summary; Q's contradiction facts
 *             go, the deck's own facts stay (all USER_CLAIM)
 *   CONFIRM   kept as Q read it
 *
 * A whole-reading confirmation confirms every section not otherwise
 * reviewed. Only CONFIRMED and CORRECTED sections reach an investor.
 */
export function reviewedDeckSections(
  sections: readonly DeckSectionReading[],
  reviews: readonly DeckSectionReview[],
  wholeConfirmed: boolean,
): {
  readonly sections: DeckSectionReading[];
  readonly states: DeckSectionState[];
} {
  const latest = new Map(reviews.map((review) => [review.section, review]));
  const out: DeckSectionReading[] = [];
  const states: DeckSectionState[] = [];
  for (const section of sections) {
    const review = latest.get(section.section);
    if (review?.action === "DISMISS") {
      out.push({
        ...unknownDeckSection(section.section, "UNCLEAR"),
        criteria: section.criteria,
      });
      states.push({ section: section.section, state: "DISMISSED" });
    } else if (review?.action === "CORRECT" && review.correction !== null) {
      out.push({
        ...section,
        status: "PRESENT",
        summary: review.correction,
        facts: section.facts.filter(
          (fact) => fact.unknownReason !== "CONTRADICTORY",
        ),
      });
      states.push({ section: section.section, state: "CORRECTED" });
    } else {
      out.push(section);
      states.push({
        section: section.section,
        state:
          review?.action === "CONFIRM" || wholeConfirmed
            ? "CONFIRMED"
            : "PENDING",
      });
    }
  }
  return { sections: out, states };
}

/** What an investor sees: only what the founder confirmed or wrote. */
function forInvestor(
  sections: readonly DeckSectionReading[],
  states: readonly DeckSectionState[],
): DeckSection[] {
  const shown = new Set(
    states
      .filter((s) => s.state === "CONFIRMED" || s.state === "CORRECTED")
      .map((s) => s.section),
  );
  return sections.map((section) =>
    shown.has(section.section)
      ? deckSectionForReaders(section)
      : unknownDeckSection(section.section, "UNCLEAR"),
  );
}

/** Structural: `createPostgresDataRoom()` from Evidence satisfies it. */
export type CompanyDeckStore = {
  readonly currentDeck: (
    executor: DatabaseExecutor,
    companyId: string,
  ) => Promise<CompanyDeckRecord | null>;
  readonly extractionFor: (
    executor: DatabaseExecutor,
    documentVersionId: string,
  ) => Promise<CompanyDeckReading | null>;
  /**
   * currentDeck and extractionFor for many at once, by company id and by
   * version id, each exactly as the one-key read (coordinator 2026-10-26:
   * the fit's top read each shown company's deck one query at a time).
   * Optional: the deck service reads one by one without them.
   */
  readonly currentDecks?:
    | ((
        executor: DatabaseExecutor,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, CompanyDeckRecord>>)
    | undefined;
  readonly extractionsFor?:
    | ((
        executor: DatabaseExecutor,
        documentVersionIds: readonly string[],
      ) => Promise<ReadonlyMap<string, CompanyDeckReading>>)
    | undefined;
  readonly confirmExtraction: (
    tx: TransactionContext,
    input: {
      readonly extractionId: string;
      readonly tenantId: string;
      readonly userId: string;
    },
  ) => Promise<boolean>;
  /** F26: absent: per-section review is not offered. */
  readonly reviewSection?: (
    tx: TransactionContext,
    input: {
      readonly extractionId: string;
      readonly tenantId: string;
      readonly userId: string;
      readonly section: DeckSectionCode;
      readonly action: DeckSectionReviewAction;
      readonly correction: string | null;
    },
  ) => Promise<void>;
  /** F26: false when the version's "Read again" budget is spent. */
  readonly requestReadAgain?: (
    tx: TransactionContext,
    input: {
      readonly extractionId: string;
      readonly tenantId: string;
      readonly documentVersionId: string;
      readonly userId: string;
    },
  ) => Promise<boolean>;
};

export type CompanyDeckRefusal = "NOT_FOUND" | "STALE" | "LIMIT";

export function createCompanyDeckService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly store: CompanyDeckStore;
  readonly company: (companyId: string) => Promise<DataRoomCompany | null>;
  /** company for many ids in one read (absent: read one by one). */
  readonly companies?:
    | ((
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, DataRoomCompany>>)
    | undefined;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly investorMayFind: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  /**
   * The same rule for many companies in one evaluation (coordinator
   * 2026-10-26: the fit's top read each shown company's deck, one
   * eligibility evaluation each). Without it, each is asked alone.
   */
  readonly investorMayFindAmong?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlySet<string>>)
    | undefined;
  readonly ownerMayManage: (
    actor: ActorContext,
    company: DataRoomCompany,
  ) => Promise<boolean>;
  /** An active disclosure grant of this document to the actor's relationship. */
  readonly sharedWithActor: (
    actor: ActorContext,
    companyId: string,
    documentId: string,
  ) => Promise<boolean>;
  /** The deterministic rubric (Evidence's coachDeck). */
  readonly coach: (
    sections: readonly DeckSectionReading[],
    pageCount: number | null,
  ) => DeckCoaching;
  /** A short-lived signed, inline read of exactly that version. */
  readonly signedInline: (
    deck: CompanyDeckRecord,
  ) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  readonly nameOf: (actor: ActorContext) => Promise<string | null>;
  readonly audit: MaterialActionAuditWriter;
  readonly newCorrelationId: () => CorrelationId;
  readonly now?: (() => UtcTimestamp) | undefined;
}) {
  const { sql, store } = dependencies;
  const quietly = <T>(promise: Promise<T>, fallback: T) =>
    promise.catch(() => fallback);
  const now = dependencies.now ?? (() => new Date().toISOString());

  async function readerOf(actor: ActorContext, companyId: string) {
    const company = await quietly(dependencies.company(companyId), null);
    if (company === null) return null;
    if (company.organisationId === actor.organisationId) {
      return (await quietly(dependencies.ownerMayManage(actor, company), false))
        ? ({ viewer: "OWNER", company } as const)
        : null;
    }
    if (!(await quietly(dependencies.isInvestor(actor), false))) return null;
    if (
      !(await quietly(dependencies.investorMayFind(actor, company.id), false))
    )
      return null;
    return { viewer: "INVESTOR", company } as const;
  }

  /**
   * readerOf for many companies, deciding exactly as it does one by one:
   * the investor's findability is asked once for all of them.
   */
  async function readersOf(actor: ActorContext, companyIds: readonly string[]) {
    const companiesMany = dependencies.companies;
    const companies =
      companiesMany !== undefined
        ? await quietly(
            companiesMany(companyIds).then((found) =>
              companyIds.map((companyId) => found.get(companyId) ?? null),
            ),
            companyIds.map(() => null),
          )
        : await Promise.all(
            companyIds.map((companyId) =>
              quietly(dependencies.company(companyId), null),
            ),
          );
    const others = companies.filter(
      (company): company is DataRoomCompany =>
        company !== null && company.organisationId !== actor.organisationId,
    );
    const investor =
      others.length > 0 &&
      (await quietly(dependencies.isInvestor(actor), false));
    const among = dependencies.investorMayFindAmong;
    const findable: ReadonlySet<string> = !investor
      ? new Set()
      : among !== undefined
        ? await quietly(
            among(
              actor,
              others.map((company) => company.id),
            ),
            new Set<string>(),
          )
        : new Set(
            (
              await Promise.all(
                others.map(async (company) =>
                  (await quietly(
                    dependencies.investorMayFind(actor, company.id),
                    false,
                  ))
                    ? company.id
                    : null,
                ),
              )
            ).filter((id): id is string => id !== null),
          );
    return Promise.all(
      companies.map(async (company) => {
        if (company === null) return null;
        if (company.organisationId === actor.organisationId) {
          return (await quietly(
            dependencies.ownerMayManage(actor, company),
            false,
          ))
            ? ({ viewer: "OWNER", company } as const)
            : null;
        }
        return findable.has(company.id)
          ? ({ viewer: "INVESTOR", company } as const)
          : null;
      }),
    );
  }

  async function deckFor(
    actor: ActorContext,
    reader: NonNullable<Awaited<ReturnType<typeof readerOf>>>,
    /** The company's current deck, already read (views); else read here. */
    current?: CompanyDeckRecord | null,
  ) {
    const deck =
      current !== undefined
        ? current
        : await quietly(store.currentDeck(sql, reader.company.id), null);
    if (deck === null) return null;
    if (reader.viewer === "OWNER") return deck;
    const open =
      deck.level === "PUBLIC" ||
      deck.downloadAudience === "INVESTORS" ||
      (await quietly(
        dependencies.sharedWithActor(actor, reader.company.id, deck.documentId),
        false,
      ));
    return open ? deck : null;
  }

  async function viewFor(
    actor: ActorContext,
    reader: Awaited<ReturnType<typeof readerOf>>,
    /** Already read for many (views): the deck, then its reading. */
    preloaded?: {
      readonly deck: CompanyDeckRecord | null;
      readonly readings?: ReadonlyMap<string, CompanyDeckReading | null>;
    },
  ): Promise<CompanyDeckView | null> {
    if (reader === null) return null;
    const deck = await deckFor(actor, reader, preloaded?.deck);
    if (deck === null) {
      return {
        viewer: reader.viewer,
        companyId: reader.company.id,
        deck: null,
        extraction: null,
        coaching: null,
      };
    }
    const preread = preloaded?.readings?.get(deck.versionId);
    const reading =
      preread !== undefined
        ? preread
        : await quietly(store.extractionFor(sql, deck.versionId), null);
    const owner = reader.viewer === "OWNER";
    const reviewed =
      reading === null
        ? null
        : reviewedDeckSections(
            reading.sections,
            reading.reviews ?? [],
            reading.confirmed,
          );
    const anyShown =
      reviewed?.states.some(
        (s) => s.state === "CONFIRMED" || s.state === "CORRECTED",
      ) ?? false;
    const allReviewed =
      reviewed?.states.every((s) => s.state !== "PENDING") ?? false;
    // The Write Gate, per section (F26): an investor sees only what the
    // founder confirmed or wrote; the rest reads as unknown.
    const shown = reading !== null && (owner || anyShown) ? reading : null;
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
              confirmed: owner ? shown.confirmed || allReviewed : true,
              // The rubric never leaves for anyone: stripped here for all.
              sections:
                reviewed === null
                  ? orderDeckSections(shown.sections.map(deckSectionForReaders))
                  : owner
                    ? orderDeckSections(
                        reviewed.sections.map(deckSectionForReaders),
                      )
                    : orderDeckSections(
                        forInvestor(reviewed.sections, reviewed.states),
                      ),
              readingNumber: shown.readingNumber ?? 1,
              ...(reviewed === null ? {} : { sectionStates: reviewed.states }),
              ...(owner
                ? {
                    setAside: [...(shown.setAside ?? [])],
                    readAgain: {
                      left: Math.max(
                        0,
                        DECK_READ_AGAIN_MAX - (shown.readAgain?.used ?? 0),
                      ),
                      pending: shown.readAgain?.pending ?? false,
                    },
                  }
                : {}),
            },
      coaching:
        owner && reading !== null
          ? dependencies.coach(reading.sections, reading.pageCount)
          : null,
    };
  }

  return {
    view: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<CompanyDeckView | null> =>
      viewFor(actor, await readerOf(actor, companyId)),

    /** view, for many companies, by company id; the same answer for each. */
    views: async (
      actor: ActorContext,
      companyIds: readonly string[],
    ): Promise<ReadonlyMap<string, CompanyDeckView | null>> => {
      const ids = [...new Set(companyIds)];
      const readers = await readersOf(actor, ids);
      // Coordinator 2026-10-26: the decks, then their readings, each in one
      // read for the companies a reader may see; a failed read is no deck
      // (or no reading), as it is for one.
      const seen = readers.flatMap((reader) =>
        reader === null ? [] : [reader.company.id],
      );
      const currentMany = store.currentDecks;
      const decks: ReadonlyMap<string, CompanyDeckRecord> | null =
        currentMany === undefined || seen.length === 0
          ? null
          : await quietly(
              currentMany(sql, seen),
              new Map<string, CompanyDeckRecord>(),
            );
      const readingsMany = store.extractionsFor;
      const versions =
        decks === null ? [] : [...decks.values()].map((deck) => deck.versionId);
      const readings: ReadonlyMap<string, CompanyDeckReading | null> | null =
        readingsMany === undefined || versions.length === 0
          ? null
          : await quietly(
              readingsMany(sql, versions).then(
                (found) =>
                  new Map(
                    versions.map((versionId) => [
                      versionId,
                      found.get(versionId) ?? null,
                    ]),
                  ),
              ),
              new Map(versions.map((versionId) => [versionId, null])),
            );
      const views = await Promise.all(
        readers.map((reader) =>
          viewFor(
            actor,
            reader,
            decks === null || reader === null
              ? undefined
              : {
                  deck: decks.get(reader.company.id) ?? null,
                  ...(readings === null ? {} : { readings }),
                },
          ),
        ),
      );
      return new Map(ids.map((id, index) => [id, views[index] ?? null]));
    },

    /** The deck for reading, inline, with the reader's name over it when view only. */
    open: async (
      actor: ActorContext,
      companyId: string,
    ): Promise<{
      url: string;
      expiresAt: string;
      downloadable: boolean;
      watermark: string | null;
    } | null> => {
      const reader = await readerOf(actor, companyId);
      if (reader === null) return null;
      const deck = await deckFor(actor, reader);
      if (deck === null) return null;
      const link = await dependencies.signedInline(deck);
      const downloadable =
        reader.viewer === "OWNER" || deck.downloadAudience === "INVESTORS";
      const name =
        reader.viewer === "INVESTOR"
          ? await quietly(dependencies.nameOf(actor), null)
          : null;
      return {
        url: link.url,
        expiresAt: link.expiresAt,
        downloadable,
        watermark:
          reader.viewer === "OWNER" || downloadable
            ? null
            : [name, now().slice(0, 10), "view only"]
                .filter((part) => part !== null)
                .join(" · "),
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
      | {
          readonly outcome: "OK";
          readonly value: {
            readonly extractionId: string;
            readonly confirmed: true;
          };
        }
      | {
          readonly outcome: "REFUSED";
          readonly code: Exclude<CompanyDeckRefusal, "LIMIT">;
        }
    > => {
      const reader = await readerOf(command.actor, command.companyId);
      if (reader === null || reader.viewer !== "OWNER")
        return { outcome: "REFUSED", code: "NOT_FOUND" };
      const deck = await store.currentDeck(sql, reader.company.id);
      if (deck === null || deck.documentId !== command.documentId)
        return { outcome: "REFUSED", code: "NOT_FOUND" };
      const reading = await store.extractionFor(sql, deck.versionId);
      // Approval binds to the exact reading on screen: a newer one needs its own.
      if (reading === null || reading.id !== command.extractionId)
        return { outcome: "REFUSED", code: "STALE" };
      if (!reading.confirmed) {
        const correlationId =
          command.correlationId ?? dependencies.newCorrelationId();
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
              metadata: {
                extractionId: reading.id,
                documentVersionId: deck.versionId,
              },
              correlationId,
            });
          }
        });
      }
      return {
        outcome: "OK",
        value: { extractionId: reading.id, confirmed: true },
      };
    },

    /**
     * F26: the founder reviews ONE section of the reading on screen:
     * confirm it, say it is wrong, or correct it in their own words.
     * Append-only; bound to the exact reading (a newer one needs its own).
     */
    reviewSection: async (command: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly documentId: string;
      readonly extractionId: string;
      readonly section: DeckSectionCode;
      readonly action: DeckSectionReviewAction;
      readonly correction: string | null;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      | {
          readonly outcome: "OK";
          readonly value: {
            readonly extractionId: string;
            readonly section: DeckSectionCode;
            readonly state: DeckSectionState["state"];
          };
        }
      | {
          readonly outcome: "REFUSED";
          readonly code: Exclude<CompanyDeckRefusal, "LIMIT">;
        }
    > => {
      const located = await ownReading(command);
      if ("code" in located) return { outcome: "REFUSED", code: located.code };
      const { deck, reading } = located;
      const reviewSection = store.reviewSection;
      if (reviewSection === undefined)
        return { outcome: "REFUSED", code: "NOT_FOUND" };
      const correction =
        command.action === "CORRECT" ? command.correction : null;
      if (command.action === "CORRECT" && (correction ?? "").trim() === "")
        return { outcome: "REFUSED", code: "NOT_FOUND" };
      await dependencies.transactions.run(async (tx) => {
        await reviewSection(tx, {
          extractionId: reading.id,
          tenantId: deck.tenantId,
          userId: command.actor.userId,
          section: command.section,
          action: command.action,
          correction,
        });
        await dependencies.audit.record(tx, {
          ...auditActorFromContext(command.actor),
          auditEventId: createAuditEventId(),
          actionType: REVIEWED,
          resourceType: RESOURCE_DOCUMENT,
          resourceId: deck.documentId,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          // Never the founder's words: the action and the section only.
          metadata: {
            extractionId: reading.id,
            section: command.section,
            action: command.action,
          },
          correlationId:
            command.correlationId ?? dependencies.newCorrelationId(),
        });
      });
      return {
        outcome: "OK",
        value: {
          extractionId: reading.id,
          section: command.section,
          state:
            command.action === "CONFIRM"
              ? "CONFIRMED"
              : command.action === "DISMISS"
                ? "DISMISSED"
                : "CORRECTED",
        },
      };
    },

    /**
     * F26: the founder asks Q to read the current version again. A new
     * reading is appended by the worker (never an overwrite); two per
     * version at most, held by the database too.
     */
    readAgain: async (command: {
      readonly actor: ActorContext;
      readonly companyId: string;
      readonly documentId: string;
      readonly extractionId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<
      | {
          readonly outcome: "OK";
          readonly value: { readonly requested: true; readonly left: number };
        }
      | { readonly outcome: "REFUSED"; readonly code: CompanyDeckRefusal }
    > => {
      const located = await ownReading(command);
      if ("code" in located) return { outcome: "REFUSED", code: located.code };
      const { deck, reading } = located;
      const request = store.requestReadAgain;
      if (request === undefined)
        return { outcome: "REFUSED", code: "NOT_FOUND" };
      const used = reading.readAgain?.used ?? 0;
      // One waiting already: the same answer, no second model reading.
      if (reading.readAgain?.pending === true) {
        return {
          outcome: "OK",
          value: {
            requested: true,
            left: Math.max(0, DECK_READ_AGAIN_MAX - used),
          },
        };
      }
      if (used >= DECK_READ_AGAIN_MAX)
        return { outcome: "REFUSED", code: "LIMIT" };
      const made = await dependencies.transactions.run(async (tx) => {
        const ok = await request(tx, {
          extractionId: reading.id,
          tenantId: deck.tenantId,
          documentVersionId: deck.versionId,
          userId: command.actor.userId,
        });
        if (ok) {
          await dependencies.audit.record(tx, {
            ...auditActorFromContext(command.actor),
            auditEventId: createAuditEventId(),
            actionType: READ_AGAIN,
            resourceType: RESOURCE_DOCUMENT,
            resourceId: deck.documentId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              extractionId: reading.id,
              documentVersionId: deck.versionId,
            },
            correlationId:
              command.correlationId ?? dependencies.newCorrelationId(),
          });
        }
        return ok;
      });
      if (!made) return { outcome: "REFUSED", code: "LIMIT" };
      return {
        outcome: "OK",
        value: {
          requested: true,
          left: Math.max(0, DECK_READ_AGAIN_MAX - used - 1),
        },
      };
    },
  };

  /** The owner's current reading, exactly the one on their screen. */
  async function ownReading(command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly documentId: string;
    readonly extractionId: string;
  }): Promise<
    | { readonly deck: CompanyDeckRecord; readonly reading: CompanyDeckReading }
    | { readonly code: Exclude<CompanyDeckRefusal, "LIMIT"> }
  > {
    const reader = await readerOf(command.actor, command.companyId);
    if (reader === null || reader.viewer !== "OWNER")
      return { code: "NOT_FOUND" };
    const deck = await store.currentDeck(sql, reader.company.id);
    if (deck === null || deck.documentId !== command.documentId)
      return { code: "NOT_FOUND" };
    const reading = await store.extractionFor(sql, deck.versionId);
    if (reading === null || reading.id !== command.extractionId)
      return { code: "STALE" };
    return { deck, reading };
  }
}

export type CompanyDeckService = ReturnType<typeof createCompanyDeckService>;
