import type { DataRoomLevel, DeckSectionReading } from "@capital-q/contracts";
import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionContext,
} from "@capital-q/database";

/**
 * The data room's and the deck reading's own tables (migrations
 * 20261207110000_data_room, 20261207120000_deck_extractions). Server-only:
 * every caller has already decided who is reading; this file never decides
 * who may see what.
 */

export type DataRoomDocumentRow = {
  readonly documentId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly title: string;
  readonly documentType: string;
  /** No entry: PRIVATE, filed under "other" (or the deck's own folder). */
  readonly level: DataRoomLevel;
  readonly folderCode: string;
  readonly checklistItemCode: string | null;
  readonly validUntil: string | null;
  readonly pageCount: number | null;
  readonly mimeType: string | null;
  readonly currentVersionId: string | null;
  readonly updatedAt: string;
  /** The entry's version; 0 when it has none yet. */
  readonly version: number;
};

export type DataRoomChecklistRow = {
  readonly code: string;
  readonly folderCode: string;
  readonly label: string;
  readonly countryLabels: Readonly<Record<string, string>>;
  readonly minStageRank: number;
  readonly countryCodes: readonly string[] | null;
  readonly defaultLevel: DataRoomLevel;
};

export type DataRoomRequestRow = {
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

export type DeckExtractionRow = {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly pageCount: number | null;
  readonly sections: readonly DeckSectionReading[];
  readonly createdAt: string;
  readonly confirmed: boolean;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const day = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);

type DocRow = {
  document_id: string;
  tenant_id: string;
  company_id: string;
  title: string;
  document_type: string;
  level: DataRoomLevel | null;
  folder_code: string | null;
  checklist_item_code: string | null;
  valid_until: Date | string | null;
  page_count: number | null;
  mime_type: string | null;
  current_version_id: string | null;
  updated_at: Date;
  version: number | null;
};

const toDoc = (row: DocRow): DataRoomDocumentRow => ({
  documentId: row.document_id,
  tenantId: row.tenant_id,
  companyId: row.company_id,
  title: row.title,
  documentType: row.document_type,
  level: row.level ?? "PRIVATE",
  folderCode:
    row.folder_code ??
    (row.document_type === "PITCH_DECK" ? "fundraising" : "other"),
  checklistItemCode:
    row.checklist_item_code ??
    (row.document_type === "PITCH_DECK" ? "pitch_deck" : null),
  validUntil: day(row.valid_until),
  pageCount: row.page_count,
  mimeType: row.mime_type,
  currentVersionId: row.current_version_id,
  updatedAt: iso(row.updated_at),
  version: row.version ?? 0,
});

export function createPostgresDataRoom() {
  const documents = (executor: DatabaseExecutor) => executor`
    select d.id as document_id, d.tenant_id, d.company_id, d.title, d.document_type,
           e.level, e.folder_code, e.checklist_item_code, e.valid_until,
           coalesce(e.page_count, x.page_count) as page_count,
           v.mime_type, d.current_version_id,
           greatest(d.updated_at, coalesce(e.updated_at, d.updated_at)) as updated_at,
           e.version
      from evidence.documents d
      left join evidence.data_room_entries e on e.document_id = d.id
      left join evidence.document_versions v
        on v.id = d.current_version_id and v.tenant_id = d.tenant_id
      left join lateral (
        select page_count from evidence.deck_extractions
         where document_version_id = d.current_version_id
         order by created_at desc limit 1) x on true`;

  return {
    folders: async (executor: DatabaseExecutor) =>
      (
        await executor<{ code: string; label: string }[]>`
          select code, label from evidence.data_room_folders order by sort_order`
      ).map((row) => ({ code: row.code, label: row.label })),

    checklist: async (
      executor: DatabaseExecutor,
    ): Promise<readonly DataRoomChecklistRow[]> =>
      (
        await executor<
          {
            code: string;
            folder_code: string;
            label: string;
            country_labels: Record<string, string>;
            min_stage_rank: number;
            country_codes: string[] | null;
            default_level: DataRoomLevel;
          }[]
        >`
          select code, folder_code, label, country_labels, min_stage_rank,
                 country_codes, default_level
            from evidence.data_room_checklist_items
           order by sort_order`
      ).map((row) => ({
        code: row.code,
        folderCode: row.folder_code,
        label: row.label,
        countryLabels: row.country_labels,
        minStageRank: row.min_stage_rank,
        countryCodes: row.country_codes,
        defaultLevel: row.default_level,
      })),

    /** Every ACTIVE document of one company, with its level (PRIVATE when unset). */
    documentsOf: async (
      executor: DatabaseExecutor,
      companyId: string,
    ): Promise<readonly DataRoomDocumentRow[]> =>
      (
        await executor<DocRow[]>`
          ${documents(executor)}
           where d.company_id = ${companyId} and d.status = 'ACTIVE'
           order by d.created_at, d.id
           limit 500`
      ).map(toDoc),

    document: async (
      executor: DatabaseExecutor,
      documentId: string,
    ): Promise<DataRoomDocumentRow | null> => {
      const rows = await executor<DocRow[]>`
        ${documents(executor)}
         where d.id = ${documentId} and d.status = 'ACTIVE' and d.company_id is not null`;
      const row = rows[0];
      return row === undefined ? null : toDoc(row);
    },

    /**
     * Sets a document's level, optimistically: the version the screen saw
     * (0 for a first filing). Null: someone changed it meanwhile.
     */
    setLevel: async (
      tx: TransactionContext,
      input: {
        readonly document: DataRoomDocumentRow;
        readonly level: DataRoomLevel;
        readonly folderCode: string;
        readonly checklistItemCode: string | null;
        readonly expectedVersion: number;
        readonly userId: string;
      },
    ): Promise<{ readonly version: number } | null> => {
      if (input.expectedVersion === 0) {
        const made = await tx.sql<{ version: number }[]>`
          insert into evidence.data_room_entries
            (document_id, tenant_id, company_id, folder_code, checklist_item_code, level, updated_by_user_id)
          values (${input.document.documentId}, ${input.document.tenantId}, ${input.document.companyId},
                  ${input.folderCode}, ${input.checklistItemCode}, ${input.level}, ${input.userId})
          on conflict (document_id) do nothing
          returning version`;
        return made[0] ?? null;
      }
      const updated = await tx.sql<{ version: number }[]>`
        update evidence.data_room_entries
           set level = ${input.level}, folder_code = ${input.folderCode},
               checklist_item_code = ${input.checklistItemCode},
               updated_by_user_id = ${input.userId}, version = version + 1
         where document_id = ${input.document.documentId}
           and version = ${input.expectedVersion}
        returning version`;
      return updated[0] ?? null;
    },

    insertRequest: async (
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
    ): Promise<{ readonly id: string; readonly created: boolean }> => {
      const made = await tx.sql<{ id: string }[]>`
        insert into evidence.data_room_access_requests
          (tenant_id, company_id, document_id, relationship_id, investor_organisation_id,
           requested_by_user_id, note, idempotency_key)
        values (${input.tenantId}, ${input.companyId}, ${input.documentId}, ${input.relationshipId},
                ${input.investorOrganisationId}, ${input.userId}, ${input.note}, ${input.idempotencyKey})
        on conflict (requested_by_user_id, idempotency_key) do nothing
        returning id`;
      const id = made[0]?.id;
      if (id !== undefined) return { id, created: true };
      const existing = await tx.sql<{ id: string }[]>`
        select id from evidence.data_room_access_requests
         where requested_by_user_id = ${input.userId}
           and idempotency_key = ${input.idempotencyKey}
           and company_id = ${input.companyId}`;
      const replayed = existing[0]?.id;
      if (replayed === undefined) throw new Error("DATA_ROOM_KEY_REUSED");
      return { id: replayed, created: false };
    },

    requests: async (
      executor: DatabaseExecutor,
      filter: {
        readonly companyId: string;
        readonly relationshipId?: string | undefined;
      },
    ): Promise<readonly DataRoomRequestRow[]> => {
      const rows = await executor<
        {
          id: string;
          tenant_id: string;
          company_id: string;
          document_id: string | null;
          document_title: string | null;
          relationship_id: string;
          investor_organisation_id: string;
          investor_organisation_name: string | null;
          requested_by_name: string | null;
          note: string | null;
          created_at: Date;
          decision: "APPROVED" | "DECLINED" | null;
          expires_at: Date | null;
        }[]
      >`
        select r.id, r.tenant_id, r.company_id, r.document_id, d.title as document_title,
               r.relationship_id, r.investor_organisation_id,
               i.display_name as investor_organisation_name,
               nullif(btrim(coalesce(u.display_name,
                      concat_ws(' ', u.given_name, u.family_name))), '') as requested_by_name,
               r.note, r.created_at, k.decision, k.expires_at
          from evidence.data_room_access_requests r
          left join evidence.documents d on d.id = r.document_id
          left join core.investor_organisations i on i.id = r.investor_organisation_id
          left join identity.user_profiles u on u.id = r.requested_by_user_id
          left join evidence.data_room_request_decisions k on k.request_id = r.id
         where r.company_id = ${filter.companyId}
           ${filter.relationshipId === undefined ? executor`` : executor`and r.relationship_id = ${filter.relationshipId}`}
         order by r.created_at desc, r.id
         limit 200`;
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        companyId: row.company_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        relationshipId: row.relationship_id,
        investorOrganisationId: row.investor_organisation_id,
        investorOrganisationName: row.investor_organisation_name,
        requestedByName: row.requested_by_name,
        note: row.note,
        createdAt: iso(row.created_at),
        decision: row.decision,
        expiresAt: row.expires_at === null ? null : iso(row.expires_at),
      }));
    },

    requestCompany: async (
      executor: DatabaseExecutor,
      requestId: string,
    ): Promise<string | null> => {
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
      const rows = await executor<{ company_id: string }[]>`
        select company_id from evidence.data_room_access_requests where id = ${requestId}`;
      return rows[0]?.company_id ?? null;
    },

    insertDecision: async (
      tx: TransactionContext,
      input: {
        readonly requestId: string;
        readonly tenantId: string;
        readonly decision: "APPROVED" | "DECLINED";
        readonly expiresAt: string | null;
        readonly userId: string;
      },
    ): Promise<boolean> => {
      const made = await tx.sql<{ request_id: string }[]>`
        insert into evidence.data_room_request_decisions
          (request_id, tenant_id, decision, expires_at, decided_by_user_id)
        values (${input.requestId}, ${input.tenantId}, ${input.decision},
                ${input.expiresAt}::text::timestamptz, ${input.userId})
        on conflict (request_id) do nothing
        returning request_id`;
      return made.length > 0;
    },

    /** The first open by this person at this investor organisation; once. */
    recordView: async (
      executor: DatabaseExecutor,
      input: {
        readonly documentId: string;
        readonly tenantId: string;
        readonly investorOrganisationId: string;
        readonly userId: string;
      },
    ): Promise<void> => {
      await executor`
        insert into evidence.data_room_views
          (document_id, tenant_id, investor_organisation_id, viewed_by_user_id)
        values (${input.documentId}, ${input.tenantId}, ${input.investorOrganisationId}, ${input.userId})
        on conflict do nothing`;
    },

    /** When their organisation first opened each document. */
    viewsByOrganisation: async (
      executor: DatabaseExecutor,
      companyId: string,
      investorOrganisationId: string,
    ): Promise<ReadonlyMap<string, string>> => {
      const rows = await executor<{ document_id: string; at: Date }[]>`
        select w.document_id, min(w.created_at) as at
          from evidence.data_room_views w
          join evidence.documents d on d.id = w.document_id
         where d.company_id = ${companyId}
           and w.investor_organisation_id = ${investorOrganisationId}
         group by w.document_id`;
      return new Map(rows.map((row) => [row.document_id, iso(row.at)]));
    },

    /** How many investor organisations opened each document (the founder's view). */
    openedByCounts: async (
      executor: DatabaseExecutor,
      companyId: string,
    ): Promise<ReadonlyMap<string, number>> => {
      const rows = await executor<{ document_id: string; n: number }[]>`
        select w.document_id, count(distinct w.investor_organisation_id)::int as n
          from evidence.data_room_views w
          join evidence.documents d on d.id = w.document_id
         where d.company_id = ${companyId}
         group by w.document_id`;
      return new Map(rows.map((row) => [row.document_id, row.n]));
    },

    // --- the deck reading -------------------------------------------------

    /** The company's newest ACTIVE pitch deck with a current version. */
    currentDeck: async (
      executor: DatabaseExecutor,
      companyId: string,
    ): Promise<{
      readonly documentId: string;
      readonly tenantId: string;
      readonly title: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly uploadedAt: string;
      readonly downloadAudience: string;
      readonly scanned: boolean;
      readonly level: DataRoomLevel;
    } | null> => {
      const rows = await executor<
        {
          id: string;
          tenant_id: string;
          title: string;
          version_id: string;
          version_number: number;
          uploaded_at: Date;
          download_audience: string;
          malware_scan_status: string;
          level: DataRoomLevel | null;
        }[]
      >`
        select d.id, d.tenant_id, d.title, v.id as version_id, v.version_number,
               v.uploaded_at, d.download_audience, v.malware_scan_status, e.level
          from evidence.documents d
          join evidence.document_versions v
            on v.id = d.current_version_id and v.tenant_id = d.tenant_id
          left join evidence.data_room_entries e on e.document_id = d.id
         where d.company_id = ${companyId}
           and d.document_type = 'PITCH_DECK'
           and d.status = 'ACTIVE'
           and v.malware_scan_status <> 'BLOCKED'
         order by d.updated_at desc, d.id
         limit 1`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            documentId: row.id,
            tenantId: row.tenant_id,
            title: row.title,
            versionId: row.version_id,
            versionNumber: row.version_number,
            uploadedAt: iso(row.uploaded_at),
            downloadAudience: row.download_audience,
            scanned: row.malware_scan_status === "CLEAN",
            level: row.level ?? "PRIVATE",
          };
    },

    /** The newest reading of exactly that version, and whether it was confirmed. */
    extractionFor: async (
      executor: DatabaseExecutor,
      documentVersionId: string,
    ): Promise<DeckExtractionRow | null> => {
      const rows = await executor<
        {
          id: string;
          document_id: string;
          document_version_id: string;
          page_count: number | null;
          sections: DeckSectionReading[];
          created_at: Date;
          confirmed: boolean;
        }[]
      >`
        select x.id, x.document_id, x.document_version_id, x.page_count, x.sections,
               x.created_at, (c.extraction_id is not null) as confirmed
          from evidence.deck_extractions x
          left join evidence.deck_extraction_confirmations c on c.extraction_id = x.id
         where x.document_version_id = ${documentVersionId}
         order by x.prompt_version desc, x.created_at desc
         limit 1`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            documentId: row.document_id,
            documentVersionId: row.document_version_id,
            pageCount: row.page_count,
            sections: row.sections,
            createdAt: iso(row.created_at),
            confirmed: row.confirmed,
          };
    },

    insertExtraction: async (
      executor: DatabaseExecutor,
      input: {
        readonly tenantId: string;
        readonly companyId: string;
        readonly documentId: string;
        readonly documentVersionId: string;
        readonly promptVersion: number;
        readonly schemaVersion: number;
        readonly pageCount: number | null;
        readonly sections: readonly DeckSectionReading[];
      },
    ): Promise<boolean> => {
      const made = await executor<{ id: string }[]>`
        insert into evidence.deck_extractions
          (tenant_id, company_id, document_id, document_version_id, prompt_version,
           schema_version, page_count, sections)
        values (${input.tenantId}, ${input.companyId}, ${input.documentId}, ${input.documentVersionId},
                ${input.promptVersion}, ${input.schemaVersion}, ${input.pageCount},
                ${
                  // Never JSON.stringify(...)::jsonb: postgres.js encodes it
                  // again, the row holds a JSON string, and the table's
                  // jsonb_typeof = 'array' check rejected every reading in
                  // production (Q.08, 2026-10-07).
                  jsonbParam(executor, input.sections)
                })
        on conflict (document_version_id, prompt_version) do nothing
        returning id`;
      return made.length > 0;
    },

    confirmExtraction: async (
      tx: TransactionContext,
      input: {
        readonly extractionId: string;
        readonly tenantId: string;
        readonly userId: string;
      },
    ): Promise<boolean> => {
      const made = await tx.sql<{ extraction_id: string }[]>`
        insert into evidence.deck_extraction_confirmations (extraction_id, tenant_id, confirmed_by_user_id)
        values (${input.extractionId}, ${input.tenantId}, ${input.userId})
        on conflict (extraction_id) do nothing
        returning extraction_id`;
      return made.length > 0;
    },
  };
}

export type PostgresDataRoom = ReturnType<typeof createPostgresDataRoom>;
