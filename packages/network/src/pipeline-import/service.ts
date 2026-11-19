import { randomUUID } from "node:crypto";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  ApplyPipelineImportRequestSchema,
  PIPELINE_IMPORT_LINKS_MAX,
  PIPELINE_IMPORT_PREVIEW_ROWS,
  PIPELINE_PROSPECTS_MAX,
  PipelineImportPreviewSchema,
  PipelineProspectListSchema,
  SIDE_AMOUNT_PATTERN,
  type CorrelationId,
  type DisclosureScope,
  type PipelineImportCounts,
  type PipelineImportLink,
  type PipelineImportMapping,
  type PipelineImportPreview,
  type PipelineImportResult,
  type PipelineImportStage,
  type PipelineProspectList,
} from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  ActorContextRequiredError,
  type ActorContext,
} from "@capital-q/security";

import { createEnsureRelationshipInTransaction } from "../application/ensure-relationship.js";
import { createRelationshipEventAppender } from "../application/append-event.js";
import type { ExpressInterestDependencies } from "../application/express-interest.js";
import { requireRelationshipListingScope } from "../application/relationship-status.js";
import {
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_CRM_STAGE_IMPORTED,
  RELATIONSHIP_EVENT_DEFINITIONS,
} from "../domain/event-registry.js";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "../infrastructure/postgres-repositories.js";
import {
  createPostgresRelationshipNotes,
  type RelationshipNoteRepository,
} from "../infrastructure/postgres-relationship-notes.js";
import {
  createPostgresRelationshipSideDetails,
  type RelationshipSideDetailRepository,
  type RelationshipSideMemberRow,
  type SideDetailValues,
} from "../infrastructure/postgres-relationship-side-details.js";
import {
  headerKey,
  isUsableMapping,
  mapHeadersBySynonyms,
  readPriority,
} from "./columns.js";
import {
  createPostgresPipelineImports,
  type ImportSide,
  type PipelineImportStore,
  type StoredImport,
  type StoredImportRow,
} from "./postgres.js";
import {
  classifyRow,
  countRows,
  fingerprintUuid,
  importFingerprint,
  proposalHash,
  readRows,
  type ImportRowFields,
  type MatchCandidate,
  type ProposedRow,
} from "./proposal.js";
import { readSheet, SheetError, type SheetErrorCode } from "./sheet.js";

/**
 * CRM import (owner decision 106, 2026-11-18): "once they just upload, it
 * reads it and takes over". Prepare -> Approve -> Execute:
 *
 *   prepare  the file (an upload of the actor's own organisation, read only
 *            once its scan is CLEAN) -> deterministic sheet reading -> Q's
 *            proposed column mapping, or the header-synonym mapping -> each
 *            row matched to the ONE canonical counterpart by an authorised
 *            search -> a staged, hashed proposal. Nothing else is written.
 *   apply    with the exact proposal hash and counts the person approved,
 *            under one idempotency key: matched rows become (or reuse) the
 *            canonical relationship, their stage is appended to its history
 *            private to the importing side, their notes become the side's
 *            private notes and their next steps the person's board tasks.
 *            An unmatched row never becomes a canonical company or investor:
 *            it stays the organisation's private prospect.
 *
 * Every step authorises as the actor (requireRelationshipListingScope, the
 * pipeline's own rule); a client-supplied company id is input, never proof.
 */

export type PipelineImportFile =
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
      /** NOT_SCANNED: still being checked; BLOCKED: the scan refused it. */
      readonly code: "NOT_FOUND" | "NOT_SCANNED" | "BLOCKED" | "TOO_LARGE";
    };

/** Evidence's authorised, scan-checked read of the actor's own upload. */
export type PipelineImportFileReader = {
  readonly readOwnFile: (
    actor: ActorContext,
    documentId: string,
  ) => Promise<PipelineImportFile>;
};

/**
 * Q's reading of the sheet's columns, through the model gateway (typed
 * output). Null or anything unusable: the header-synonym mapping is used.
 */
export type PipelineColumnMapper = {
  readonly propose: (input: {
    readonly side: "INVESTOR" | "COMPANY";
    readonly headers: readonly string[];
    /** A few short example values per column, in header order. */
    readonly samples: readonly (readonly string[])[];
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    };
  }) => Promise<Readonly<Partial<Record<string, string>>> | null>;
};

/** The person's own work board: a next step from the sheet becomes a task. */
export type PipelineImportTasks = {
  readonly addTask: (
    actor: ActorContext,
    task: {
      readonly title: string;
      readonly notes: string;
      readonly dueOn: string | null;
    },
    options: { readonly idempotencyKey: string; readonly byQ: boolean },
  ) => Promise<boolean>;
};

export type PipelineImportDependencies = Pick<
  ExpressInterestDependencies,
  | "sql"
  | "transactions"
  | "companies"
  | "investors"
  | "outbox"
  | "audit"
  | "authorization"
  | "investorSubject"
  | "companyVisibility"
> & {
  readonly registry?: ExpressInterestDependencies["registry"] | undefined;
  readonly repositories?:
    ExpressInterestDependencies["repositories"] | undefined;
} & {
  readonly files?: PipelineImportFileReader | undefined;
  readonly mapper?: PipelineColumnMapper | undefined;
  readonly tasks?: PipelineImportTasks | undefined;
  readonly store?: PipelineImportStore | undefined;
  readonly notes?: RelationshipNoteRepository | undefined;
  readonly sideDetails?: RelationshipSideDetailRepository | undefined;
};

export type PipelineImportRefusalCode =
  | SheetErrorCode
  | "NOT_FOUND"
  | "NOT_SCANNED"
  | "BLOCKED"
  | "UNAVAILABLE"
  | "NO_NAME_COLUMN"
  | "INVALID_MAPPING"
  | "STALE"
  | "INVALID_RESOLUTION";

export type PipelineImportOutcome<T> =
  | { readonly outcome: "OK"; readonly value: T }
  | {
      readonly outcome: "REFUSED";
      readonly code: PipelineImportRefusalCode;
      /** Plain words for the person. */
      readonly message: string;
    };

export type PipelineImportApplied = {
  readonly importId: string;
  /** True when this key (or an earlier apply) had already run it. */
  readonly replayed: boolean;
  readonly result: PipelineImportResult;
  /** The relationships it linked, for the result's links. */
  readonly relationships: readonly PipelineImportLink[];
};

export type PipelineImportService = {
  readonly prepare: (
    actor: ActorContext,
    input: {
      readonly documentId: string;
      /** A founder's company: their side. Absent: an investor's. */
      readonly companyId?: string | undefined;
      /** The person's own mapping (the import screen). Absent: Q proposes. */
      readonly mapping?: PipelineImportMapping | undefined;
      readonly correlationId: CorrelationId;
    },
  ) => Promise<PipelineImportOutcome<PipelineImportPreview>>;
  /** The organisation's private prospects (rows kept, not on Capital Q). */
  readonly prospects: (
    actor: ActorContext,
    companyId?: string,
  ) => Promise<PipelineProspectList>;
  readonly preview: (
    actor: ActorContext,
    importId: string,
    companyId?: string,
  ) => Promise<PipelineImportOutcome<PipelineImportPreview>>;
  readonly apply: (
    actor: ActorContext,
    input: {
      readonly importId: string;
      /** The file the approved proposal was read from. */
      readonly documentId: string;
      readonly companyId?: string | undefined;
      readonly request: unknown;
      /** Any string: the screen's key or the approved card's; hashed to a UUID. */
      readonly idempotencyKey: string;
      readonly correlationId: CorrelationId;
      readonly byQ: boolean;
    },
  ) => Promise<PipelineImportOutcome<PipelineImportApplied>>;
};

const refused = (
  code: PipelineImportRefusalCode,
  message: string,
): PipelineImportOutcome<never> => ({ outcome: "REFUSED", code, message });

const FILE_WORDS = {
  NOT_FOUND: "That file isn't one of yours, or it no longer exists.",
  NOT_SCANNED:
    "That file is still being checked for safety. Try again in a minute.",
  BLOCKED: "That file did not pass the safety check, so it can't be read.",
  TOO_LARGE: "That file is too large to import.",
} as const;

/** Example values sent per column, and their length. */
const SAMPLE_ROWS = 3;
const SAMPLE_CHARS = 60;

export function createPipelineImportService(
  options: PipelineImportDependencies,
): PipelineImportService {
  const dependencies = {
    ...options,
    registry:
      options.registry ??
      createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: options.repositories ?? {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  };
  const store = dependencies.store ?? createPostgresPipelineImports();
  const notes = dependencies.notes ?? createPostgresRelationshipNotes();
  const sideDetails =
    dependencies.sideDetails ?? createPostgresRelationshipSideDetails();
  const ensureInTransaction =
    createEnsureRelationshipInTransaction(dependencies);
  const appender = createRelationshipEventAppender(dependencies);

  async function sideOf(
    actor: ActorContext,
    companyId: string | undefined,
  ): Promise<ImportSide> {
    if (actor.organisationId === undefined) {
      throw new ActorContextRequiredError();
    }
    const scope = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    return {
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      party: scope.party,
      partyId: scope.partyId,
    };
  }

  /** Candidates the actor may match, for every row at once. */
  async function candidatesFor(
    actor: ActorContext,
    side: ImportSide,
    keys: readonly string[],
    domains: readonly string[],
  ): Promise<readonly MatchCandidate[]> {
    if (side.party === "COMPANY") {
      return store.investorCandidates(dependencies.sql, side, keys, domains);
    }
    const found = await store.companyCandidates(
      dependencies.sql,
      side,
      keys,
      domains,
    );
    // The network preview's disclosure rule, on top of the SQL's
    // discoverability: a company the investor may not see is no candidate.
    const ids = found.map((candidate) => candidate.id);
    const visibility = dependencies.companyVisibility;
    let visible: ReadonlySet<string>;
    if (visibility.visibleToInvestorAmong !== undefined) {
      visible = await visibility.visibleToInvestorAmong(
        actor,
        ids.map((id) => CompanyIdSchema.parse(id)),
      );
    } else {
      const allowed = new Set<string>();
      for (const id of ids) {
        if (
          await visibility.isVisibleToInvestor(actor, CompanyIdSchema.parse(id))
        ) {
          allowed.add(id);
        }
      }
      visible = allowed;
    }
    return found.filter((candidate) => visible.has(candidate.id));
  }

  function previewOf(
    stored: Pick<
      StoredImport,
      | "id"
      | "proposalHash"
      | "fileName"
      | "party"
      | "mapping"
      | "mappingSource"
      | "status"
    >,
    headers: readonly string[] | null,
    rows: readonly StoredImportRow[],
    names: ReadonlyMap<string, string>,
  ): PipelineImportPreview {
    const counts = countStored(rows);
    const mapped = new Set(Object.values(stored.mapping));
    // A stored import keeps its mapping, not the file's headers: its
    // columns then are the mapped ones.
    const columns = headers ?? [...mapped];
    const shown = rows.filter(
      (row, index) =>
        index < PIPELINE_IMPORT_PREVIEW_ROWS || row.status === "AMBIGUOUS",
    );
    return PipelineImportPreviewSchema.parse({
      importId: stored.id,
      proposalHash: stored.proposalHash,
      fileName: stored.fileName,
      side: stored.party,
      mapping: stored.mapping,
      mappingSource: stored.mappingSource,
      columns,
      unmappedColumns: (headers ?? []).filter((h) => !mapped.has(h)),
      counts,
      status: stored.status,
      rows: shown.map((row) => ({
        rowNumber: row.rowNumber,
        name: row.name,
        stage: row.fields.stage ?? null,
        stageLabel: row.fields.stageLabel ?? null,
        match: row.status,
        matched:
          row.matchedId === null
            ? null
            : {
                id: row.matchedId,
                name: names.get(row.matchedId) ?? row.name ?? "",
              },
        candidates: row.candidateIds.map((id) => ({
          id,
          name: names.get(id) ?? "",
        })),
      })),
    });
  }

  async function namesOf(
    party: "INVESTOR" | "COMPANY",
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(ids)];
    const names = new Map<string, string>();
    if (unique.length === 0) return names;
    if (party === "COMPANY") {
      const rows = await dependencies.sql<{ id: string; name: string }[]>`
        select id, display_name as name from core.investor_organisations
         where id = any(${unique}::uuid[])`;
      for (const one of rows) names.set(one.id, one.name);
    } else {
      const rows = await dependencies.sql<{ id: string; name: string }[]>`
        select id, canonical_name as name from core.companies
         where id = any(${unique}::uuid[])`;
      for (const one of rows) names.set(one.id, one.name);
    }
    return names;
  }

  return {
    async prepare(actor, input) {
      const side = await sideOf(actor, input.companyId);
      if (dependencies.files === undefined) {
        return refused(
          "UNAVAILABLE",
          "Importing a pipeline isn't available here yet.",
        );
      }
      const file = await dependencies.files.readOwnFile(
        actor,
        input.documentId,
      );
      if (!file.ok) return refused(file.code, FILE_WORDS[file.code]);

      let sheet;
      try {
        sheet = readSheet(file);
      } catch (error: unknown) {
        if (error instanceof SheetError)
          return refused(error.code, error.message);
        throw error;
      }

      let mapping: PipelineImportMapping | null = null;
      let mappingSource: "Q" | "HEADERS" | "PERSON" = "HEADERS";
      if (input.mapping !== undefined) {
        // The person's own choice on the import screen: used as given, or
        // refused; never mixed with a model's reading.
        if (!isUsableMapping(input.mapping, sheet.headers)) {
          return refused(
            "INVALID_MAPPING",
            "Each column can go to one field only, and one column must name the company or investor.",
          );
        }
        mapping = input.mapping;
        mappingSource = "PERSON";
      } else if (dependencies.mapper !== undefined) {
        const proposed = await dependencies.mapper
          .propose({
            side: side.party,
            headers: sheet.headers,
            samples: sheet.headers.map((_, column) =>
              sheet.rows
                .map((row) => (row[column] ?? "").slice(0, SAMPLE_CHARS))
                .filter((value) => value !== "")
                .slice(0, SAMPLE_ROWS),
            ),
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              correlationId: input.correlationId,
            },
          })
          .catch(() => null);
        if (proposed !== null && isUsableMapping(proposed, sheet.headers)) {
          mapping = proposed;
          mappingSource = "Q";
        }
      }
      mapping ??= mapHeadersBySynonyms(sheet.headers);
      if (mapping === null) {
        return refused(
          "NO_NAME_COLUMN",
          "I couldn't tell which column names the companies or investors. Name that column (for example Company or Investor) and upload it again.",
        );
      }

      const rows = readRows(sheet, mapping);
      const keys = [
        ...new Set(
          rows.flatMap((row) => (row.nameKey === null ? [] : [row.nameKey])),
        ),
      ];
      const domains = [
        ...new Set(
          rows.flatMap((row) => (row.domain === null ? [] : [row.domain])),
        ),
      ];
      const candidates = await candidatesFor(actor, side, keys, domains);
      const proposed: ProposedRow[] = rows.map((row) => ({
        ...row,
        match: classifyRow(row, candidates),
      }));
      const stagedRows = proposed.map((row) => ({
        rowNumber: row.rowNumber,
        name: row.name,
        domain: row.domain,
        fields: row.fields,
        status: row.match.status,
        matchedId: row.match.matchedId,
        candidateIds:
          row.match.status === "AMBIGUOUS"
            ? row.match.candidates.map((candidate) => candidate.id)
            : [],
      }));
      const hash = proposalHash({
        party: side.party,
        partyId: side.partyId,
        documentVersionId: file.documentVersionId,
        mapping,
        rows: stagedRows,
      });
      const importId = randomUUID();
      await dependencies.transactions.run((tx) =>
        store.insertImport(tx.sql, side, {
          id: importId,
          userId: actor.userId,
          documentId: file.documentId,
          documentVersionId: file.documentVersionId,
          fileName: file.fileName.slice(0, 255) || "pipeline",
          sourceFormat: sheet.format,
          rowCount: proposed.length,
          mapping,
          mappingSource,
          proposalHash: hash,
          rows: stagedRows,
        }),
      );
      const names = new Map<string, string>();
      for (const candidate of candidates)
        names.set(candidate.id, candidate.name);
      return {
        outcome: "OK",
        value: previewOf(
          {
            id: importId,
            proposalHash: hash,
            fileName: file.fileName.slice(0, 255) || "pipeline",
            party: side.party,
            mapping,
            mappingSource,
            status: "PREPARED",
          },
          sheet.headers,
          stagedRows.map((row) => ({
            ...row,
            outcome: null,
            relationshipId: null,
          })),
          names,
        ),
      };
    },

    async preview(actor, importId, companyId) {
      const side = await sideOf(actor, companyId);
      const stored = await store.findImport(dependencies.sql, side, importId);
      if (stored === null) return refused("NOT_FOUND", FILE_WORDS.NOT_FOUND);
      const rows = await store.listRows(dependencies.sql, side, importId);
      const names = await namesOf(
        side.party,
        rows.flatMap((row) => [
          ...(row.matchedId === null ? [] : [row.matchedId]),
          ...row.candidateIds,
        ]),
      );
      return { outcome: "OK", value: previewOf(stored, null, rows, names) };
    },

    async prospects(actor, companyId) {
      const side = await sideOf(actor, companyId);
      const rows = await store.prospects(
        dependencies.sql,
        side,
        PIPELINE_PROSPECTS_MAX,
      );
      return PipelineProspectListSchema.parse({
        visibility: "organisation_private",
        items: rows.map((row) => ({
          importId: row.import_id,
          rowNumber: row.row_number,
          name: row.counterpart_name.slice(0, 200),
          website: row.website_domain,
          stage: row.fields.stage ?? null,
          stageLabel: row.fields.stageLabel ?? null,
          priority: row.fields.priority ?? null,
          source: row.fields.source ?? null,
          contactName: row.fields.contactName ?? null,
          amount:
            row.fields.amount !== undefined && row.fields.amount.length <= 40
              ? row.fields.amount
              : null,
          currency: row.fields.currency ?? null,
          fileName: row.file_name,
          importedAt: new Date(row.applied_at).toISOString(),
        })),
      });
    },

    async apply(actor, input) {
      const request = ApplyPipelineImportRequestSchema.parse(input.request);
      const side = await sideOf(actor, input.companyId);
      if (actor.membershipId === undefined)
        throw new ActorContextRequiredError();
      const stored = await store.findImport(
        dependencies.sql,
        side,
        input.importId,
      );
      if (stored === null) return refused("NOT_FOUND", FILE_WORDS.NOT_FOUND);
      const key = fingerprintUuid(
        importFingerprint(["apply", input.idempotencyKey]),
      );
      if (stored.status === "APPLIED" && stored.result !== null) {
        // A retried apply (same key) or a second approval of a finished
        // import: what the first one did, never a second run.
        return {
          outcome: "OK",
          value: {
            importId: stored.id,
            replayed: true,
            result: stored.result,
            relationships: await linksOf(side, stored.id),
          },
        };
      }
      const rows = await store.listRows(dependencies.sql, side, stored.id);
      // The approval binds to the exact proposal: its hash and the counts
      // the card showed.
      if (
        request.proposalHash !== stored.proposalHash ||
        input.documentId !== stored.documentId ||
        !sameCounts(request.counts, countStored(rows))
      ) {
        return refused(
          "STALE",
          "This import changed since it was approved. Review it again.",
        );
      }
      const byRow = new Map(rows.map((row) => [row.rowNumber, row]));
      const choices = new Map<number, string>();
      for (const resolution of request.resolutions) {
        const row = byRow.get(resolution.rowNumber);
        const choice = resolution.choice;
        const valid =
          row !== undefined &&
          !choices.has(resolution.rowNumber) &&
          (choice === "SKIP" ||
            (choice === "KEEP_PRIVATE" && row.status !== "INVALID") ||
            (row.status === "AMBIGUOUS" && row.candidateIds.includes(choice)));
        if (!valid) {
          return refused(
            "INVALID_RESOLUTION",
            `Row ${String(resolution.rowNumber)} can't be resolved that way.`,
          );
        }
        choices.set(resolution.rowNumber, choice);
      }

      const scope: DisclosureScope =
        side.party === "INVESTOR" ? "investor_private" : "founder_private";
      const totals = {
        linked: 0,
        relationshipsCreated: 0,
        keptPrivate: 0,
        skipped: 0,
        stageEvents: 0,
        notes: 0,
        tasks: 0,
        details: 0,
      };
      // A row's owner is matched to an active member of the side's own
      // organisation by name or email, or not set.
      const members = await sideDetails.activeMembers(dependencies.sql, {
        tenantId: side.tenantId,
        organisationId: side.organisationId,
        party: side.party,
        partyId: side.partyId,
      });
      const noteSide = {
        tenantId: side.tenantId,
        organisationId: side.organisationId,
        companyId: side.party === "COMPANY" ? side.partyId : null,
        investorOrganisationId: side.party === "INVESTOR" ? side.partyId : null,
      };

      for (const row of rows) {
        const choice = choices.get(row.rowNumber);
        const target =
          choice !== undefined && choice !== "SKIP" && choice !== "KEEP_PRIVATE"
            ? choice
            : choice === undefined && row.status === "MATCHED"
              ? row.matchedId
              : null;
        const keep =
          choice === "KEEP_PRIVATE" ||
          (choice === undefined && row.status === "NEW");
        if (row.outcome !== null) {
          // Settled by an earlier, interrupted apply: counted, not redone.
          if (row.outcome === "LINKED") totals.linked += 1;
          else if (row.outcome === "KEPT_PRIVATE") totals.keptPrivate += 1;
          else totals.skipped += 1;
          continue;
        }
        if (target !== null) {
          const linked = await linkRow(
            actor,
            side,
            stored,
            row,
            target,
            scope,
            noteSide,
            input.correlationId,
            members,
          );
          if (linked === null) {
            await store.settleRow(
              dependencies.sql,
              side,
              stored.id,
              row.rowNumber,
              "SKIPPED",
              null,
            );
            totals.skipped += 1;
            continue;
          }
          totals.linked += 1;
          if (linked.created) totals.relationshipsCreated += 1;
          if (linked.stage) totals.stageEvents += 1;
          if (linked.note) totals.notes += 1;
          if (linked.details) totals.details += 1;
        } else if (keep) {
          await store.settleRow(
            dependencies.sql,
            side,
            stored.id,
            row.rowNumber,
            "KEPT_PRIVATE",
            null,
          );
          totals.keptPrivate += 1;
        } else {
          await store.settleRow(
            dependencies.sql,
            side,
            stored.id,
            row.rowNumber,
            "SKIPPED",
            null,
          );
          totals.skipped += 1;
          continue;
        }
        const nextStep = row.fields.nextStep ?? null;
        if (
          nextStep !== null &&
          dependencies.tasks !== undefined &&
          row.name !== null
        ) {
          const due = row.fields.nextStepDue ?? null;
          const added = await dependencies.tasks
            .addTask(
              actor,
              {
                title: `${row.name}: ${nextStep}`.slice(0, 300),
                notes: `From your imported pipeline (${stored.fileName}, row ${String(row.rowNumber)}).`,
                dueOn: due,
              },
              {
                idempotencyKey: fingerprintUuid(
                  importFingerprint([
                    "task",
                    actor.userId,
                    side.partyId,
                    row.name,
                    nextStep,
                    due,
                  ]),
                ),
                byQ: input.byQ,
              },
            )
            .catch(() => false);
          if (added) totals.tasks += 1;
        }
      }

      const result: PipelineImportResult = totals;
      const marked = await store.markApplied(
        dependencies.sql,
        side,
        stored.id,
        {
          idempotencyKey: key,
          approvedBy: actor.userId,
          result,
        },
      );
      if (!marked) {
        const finished = await store.findImport(
          dependencies.sql,
          side,
          stored.id,
        );
        if (finished?.result != null) {
          return {
            outcome: "OK",
            value: {
              importId: stored.id,
              replayed: true,
              result: finished.result,
              relationships: await linksOf(side, stored.id),
            },
          };
        }
      }
      return {
        outcome: "OK",
        value: {
          importId: stored.id,
          replayed: false,
          result,
          relationships: await linksOf(side, stored.id),
        },
      };
    },
  };

  function linksOf(
    side: ImportSide,
    importId: string,
  ): Promise<readonly PipelineImportLink[]> {
    return store.linkedRelationships(
      dependencies.sql,
      side,
      importId,
      PIPELINE_IMPORT_LINKS_MAX,
    );
  }

  /**
   * One row onto the ONE canonical relationship, in one short transaction:
   * ensure the pair (created private to the importing side), append its
   * imported stage unless this very row was imported before, keep its notes
   * as the side's private note, set the side's own pipeline fields the row
   * names (stage, owner, source, expected cheque, priority), and settle the
   * row. Null: the counterpart is no longer one the actor may link (hidden
   * since the preview).
   */
  async function linkRow(
    actor: ActorContext,
    side: ImportSide,
    stored: StoredImport,
    row: StoredImportRow,
    counterpartId: string,
    scope: DisclosureScope,
    noteSide: Parameters<RelationshipNoteRepository["insert"]>[1]["side"],
    correlationId: CorrelationId,
    members: readonly RelationshipSideMemberRow[],
  ): Promise<{
    readonly created: boolean;
    readonly stage: boolean;
    readonly note: boolean;
    readonly details: boolean;
  } | null> {
    const companyId = CompanyIdSchema.parse(
      side.party === "INVESTOR" ? counterpartId : side.partyId,
    );
    const investorId = InvestorOrganisationIdSchema.parse(
      side.party === "INVESTOR" ? side.partyId : counterpartId,
    );
    if (side.party === "INVESTOR") {
      const visible = await dependencies.companyVisibility.isVisibleToInvestor(
        actor,
        companyId,
      );
      if (!visible) return null;
    }
    const company =
      await dependencies.companies.findCanonicalCompany(companyId);
    const investor =
      await dependencies.investors.findCanonicalInvestorOrganisation(
        investorId,
      );
    if (company === null || investor === null) return null;
    const fields = row.fields;
    const label = fields.stageLabel ?? null;
    const stage: PipelineImportStage = fields.stage ?? "UNKNOWN";
    const stageDate = fields.stageDate ?? null;
    const body = noteBody(stored.fileName, row);
    return dependencies.transactions.run(async (tx) => {
      const ensured = await ensureInTransaction(
        tx,
        {
          actor,
          companyId,
          investorOrganisationId: investorId,
          source: { type: "MANUAL", id: `crm_import:${stored.id}` },
          visibilityScope: scope,
          correlationId,
        },
        { company, investor },
      );
      const relationshipId = ensured.relationship.id;
      let stageWritten = false;
      if (label !== null) {
        const fingerprint = importFingerprint([
          "stage",
          side.party,
          side.partyId,
          relationshipId,
          stage,
          label,
          stageDate,
        ]);
        if (!(await store.hasStageEvent(tx.sql, relationshipId, fingerprint))) {
          await appender.append(tx, {
            relationshipId,
            eventType: RELATIONSHIP_EVENT_CRM_STAGE_IMPORTED,
            actor: { type: actor.actorType, id: actor.userId },
            source: { type: "MANUAL", id: `crm_import:${stored.id}` },
            visibilityScope: scope,
            payload: {
              importId: stored.id,
              rowNumber: row.rowNumber,
              stage,
              label,
              stageDate,
              fingerprint,
            },
            correlationId,
          });
          stageWritten = true;
        }
      }
      let noteWritten = false;
      if (body !== null && actor.membershipId !== undefined) {
        const noteId = fingerprintUuid(
          importFingerprint([
            "note",
            side.organisationId,
            relationshipId,
            body,
          ]),
        );
        const existing = await notes.findOwn(
          tx.sql,
          noteId,
          relationshipId,
          noteSide,
        );
        if (existing === null) {
          noteWritten =
            (await notes.insert(tx.sql, {
              id: noteId,
              relationshipId,
              side: noteSide,
              userId: actor.userId,
              membershipId: actor.membershipId,
              body,
              supersedesNoteId: null,
            })) !== null;
        }
      }
      // The side's own pipeline fields: only what the row names, merged
      // onto what the side already keeps (the file is their approved claim).
      const values = sideValuesOf(row.fields, members);
      const details =
        Object.keys(values).length > 0 &&
        (await sideDetails.write(tx.sql, {
          relationshipId,
          side,
          userId: actor.userId,
          expectedRevision: null,
          values,
        })) !== null;
      await store.settleRow(
        tx.sql,
        side,
        stored.id,
        row.rowNumber,
        "LINKED",
        relationshipId,
      );
      return {
        details,
        created: ensured.created,
        stage: stageWritten,
        note: noteWritten,
      };
    });
  }
}

/**
 * What an imported row sets on the side's own pipeline fields. Each value
 * only when the row gives it exactly: an UNKNOWN stage keeps the label
 * only, an owner must be the one member of the side's organisation with
 * that name, an amount needs its currency, a priority must read as one. What
 * cannot be read stays in the row's note, never guessed.
 */
export function sideValuesOf(
  fields: ImportRowFields,
  members: readonly Pick<
    RelationshipSideMemberRow,
    "membership_id" | "user_id" | "name"
  >[],
): SideDetailValues {
  const values: {
    -readonly [K in keyof SideDetailValues]: SideDetailValues[K];
  } = {};
  if (fields.stageLabel !== undefined) {
    values.stageLabel = fields.stageLabel.slice(0, 80);
    values.stage =
      fields.stage === undefined || fields.stage === "UNKNOWN"
        ? null
        : fields.stage;
  }
  const owner = fields.owner?.trim();
  if (owner !== undefined && owner !== "") {
    const key = headerKey(owner);
    // Two members of the same name are no match: never a guess.
    const named = members.filter(
      (one) => key !== "" && headerKey(one.name) === key,
    );
    const member = named.length === 1 ? named[0] : undefined;
    if (member !== undefined) {
      values.owner = {
        membershipId: member.membership_id,
        userId: member.user_id,
      };
    }
  }
  const source = fields.source?.trim();
  if (source !== undefined && source !== "") {
    values.source = source.slice(0, 200);
  }
  if (
    fields.amount !== undefined &&
    fields.currency !== undefined &&
    SIDE_AMOUNT_PATTERN.test(fields.amount) &&
    /[1-9]/.test(fields.amount)
  ) {
    values.expected = { amount: fields.amount, currency: fields.currency };
  }
  if (fields.priority !== undefined) {
    const priority = readPriority(fields.priority);
    if (priority !== null) values.priority = priority;
  }
  return values;
}

function countStored(
  rows: readonly Pick<StoredImportRow, "status">[],
): PipelineImportCounts {
  return countRows(rows.map((row) => ({ match: { status: row.status } })));
}

function sameCounts(a: PipelineImportCounts, b: PipelineImportCounts): boolean {
  return (
    a.rows === b.rows &&
    a.matched === b.matched &&
    a.ambiguous === b.ambiguous &&
    a.new === b.new &&
    a.invalid === b.invalid
  );
}

const NOTE_LABELS: readonly (readonly [keyof ImportRowFields, string])[] = [
  ["contactName", "Contact"],
  ["contactTitle", "Title"],
  ["contactEmail", "Email"],
  ["owner", "Owner"],
  ["source", "Source"],
  ["round", "Round"],
  ["amount", "Amount"],
  ["valuation", "Valuation"],
  ["sector", "Sector"],
  ["location", "Location"],
  ["priority", "Priority"],
  ["addedOn", "Added"],
  ["lastContactOn", "Last contact"],
  ["passReason", "Pass reason"],
  ["tags", "Tags"],
];

/**
 * The side's private note for an imported row: what the sheet said, as the
 * importer's own record (never evidence, never Q context), within the
 * notes table's 4,000 characters. Null when the row says nothing more.
 */
export function noteBody(
  fileName: string,
  row: Pick<StoredImportRow, "rowNumber" | "fields">,
): string | null {
  const fields = row.fields;
  const lines: string[] = [];
  for (const [field, label] of NOTE_LABELS) {
    const value = fields[field];
    if (typeof value !== "string" || value === "") continue;
    lines.push(
      field === "amount" && fields.currency !== undefined
        ? `${label}: ${fields.currency} ${value}`
        : `${label}: ${value}`,
    );
  }
  if (fields.unread !== undefined) {
    for (const [field, value] of Object.entries(fields.unread)) {
      lines.push(`${field} (as written): ${value}`);
    }
  }
  if (typeof fields.notes === "string" && fields.notes !== "") {
    lines.push("", fields.notes);
  }
  if (lines.length === 0) return null;
  const head = `Imported from ${fileName}, row ${String(row.rowNumber)}.`;
  return `${head}\n${lines.join("\n")}`.slice(0, 4000);
}
