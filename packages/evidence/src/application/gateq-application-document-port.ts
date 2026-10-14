import { z } from "zod";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
} from "../contracts/index.js";
import {
  gateqApplicationDocumentStatus,
  type GateQApplicationDocumentStatus,
} from "./gateq-application-evidence.js";

/**
 * The port GateQ intake uses to read and freeze an application's own
 * documents (ADR 0067 §4–§5). Server-side only, and trusted: the caller
 * must already have authorised the guest (`intake.authorise`) and passes
 * the tenant and application it derived from that credential, never ids a
 * request supplied.
 *
 * Extracted text is **data, never instructions**. Excerpts are bounded,
 * labelled with their document, version and page, and withheld entirely
 * when the extraction's instruction-risk scan flagged the document. Only
 * READY documents are returned; UPLOADING, PROCESSING, BLOCKED and FAILED
 * material never leaves Evidence.
 */

export type GateQApplicationDocumentRef = {
  readonly tenantId: string;
  readonly applicationId: string;
};

export type GateQReadyApplicationDocument = {
  readonly documentId: string;
  readonly versionId: string;
  readonly title: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly pageCount: number | null;
  /** NOT_SCANNED is the interim policy's record (ADR 0042), never "clean". */
  readonly malwareStatus: "CLEAN" | "NOT_SCANNED";
  /** True when extraction found instruction-like text; excerpts withheld. */
  readonly instructionRisk: boolean;
  /** Untrusted document content, page-labelled and bounded. */
  readonly excerpts: readonly {
    readonly page: number;
    readonly text: string;
  }[];
  /** True when text beyond the bound (or withheld text) exists. */
  readonly truncated: boolean;
};

export type GateQFrozenApplicationDocument = {
  readonly documentId: string;
  readonly versionId: string;
  readonly title: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly frozenAt: string;
};

export type GateQApplicationDocumentFreeze = {
  /** Exactly what is disclosed with the submission, by version. */
  readonly documents: readonly GateQFrozenApplicationDocument[];
  /** Active documents that were not READY and so were not disclosed. */
  readonly notReady: readonly {
    readonly documentId: string;
    readonly status: Exclude<GateQApplicationDocumentStatus, "READY">;
  }[];
  /** True when an earlier freeze already existed and was returned as is. */
  readonly deduplicated: boolean;
};

export type GateQApplicationDocumentPort = {
  readonly readyDocuments: (
    input: GateQApplicationDocumentRef & {
      readonly maxCharsPerDocument?: number | undefined;
    },
  ) => Promise<readonly GateQReadyApplicationDocument[]>;
  /**
   * Freeze the READY documents' exact current versions into the
   * submission. Call inside the Submit transaction, after the application
   * row is locked and before it is marked SUBMITTED, so a concurrent
   * upload or removal (which takes the same row lock) cannot interleave.
   * Idempotent: a second call returns the first freeze unchanged.
   */
  readonly freezeForSubmission: (
    tx: TransactionContext,
    input: GateQApplicationDocumentRef,
  ) => Promise<GateQApplicationDocumentFreeze>;
  /** The frozen disclosure, for the dossier and the investor's reads. */
  readonly frozenDocuments: (
    input: GateQApplicationDocumentRef,
  ) => Promise<readonly GateQFrozenApplicationDocument[]>;
};

const RefSchema = z
  .object({ tenantId: TenantIdSchema, applicationId: z.string().uuid() })
  .strict();
const DEFAULT_CHARS = 6_000;
const MAX_CHARS = 20_000;
const MAX_PAGES = 60;

const ReadyRow = z.object({
  document_id: DocumentIdSchema,
  version_id: DocumentVersionIdSchema,
  title: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size_bytes: z.coerce.number(),
  malware_scan_status: z.enum(["CLEAN", "NOT_SCANNED"]),
  extraction_id: z.string().uuid(),
  page_count: z.number().int().nullable(),
  instruction_risk_signals: z.number().int(),
});
const FrozenRow = z.object({
  document_id: DocumentIdSchema,
  document_version_id: DocumentVersionIdSchema,
  title: z.string(),
  mime_type: z.string(),
  sha256: z.string(),
  frozen_at: z.coerce.date(),
});

function frozen(row: unknown): GateQFrozenApplicationDocument {
  const r = FrozenRow.parse(row);
  return {
    documentId: r.document_id,
    versionId: r.document_version_id,
    title: r.title,
    contentType: r.mime_type,
    sha256: r.sha256,
    frozenAt: r.frozen_at.toISOString(),
  };
}

// Control characters other than tab/newline are stripped: the text is
// rendered as data, and nothing in it should be able to fake a boundary.
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function createGateQApplicationDocumentPort(deps: {
  readonly sql: DatabaseExecutor;
  /** Upper bound on documents returned for one application. */
  readonly maxDocuments?: number | undefined;
}): GateQApplicationDocumentPort {
  const maxDocuments = deps.maxDocuments ?? 20;
  if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1)
    throw new Error("maxDocuments must be a positive integer");

  const readyRows = (
    executor: DatabaseExecutor,
    ref: GateQApplicationDocumentRef,
  ) =>
    executor`
      select d.id as document_id,v.id as version_id,d.title,v.original_filename,v.mime_type,v.sha256,v.size_bytes,
      v.malware_scan_status,x.id as extraction_id,x.page_count,x.instruction_risk_signals
      from evidence.documents d join evidence.document_versions v on v.id=d.current_version_id and v.tenant_id=d.tenant_id
      join lateral (select id,page_count,instruction_risk_signals from evidence.document_extractions e
        where e.document_version_id=v.id and e.tenant_id=d.tenant_id order by e.created_at desc limit 1) x on true
      where d.tenant_id=${ref.tenantId} and d.owner_kind='GATEQ_APPLICATION' and d.gateq_application_id=${ref.applicationId}
      and d.status='ACTIVE' and d.custody_cleanup_started_at is null
      and v.processing_status='COMPLETED' and v.text_extraction_status='COMPLETED' and v.malware_scan_status in ('CLEAN','NOT_SCANNED')
      order by d.created_at,d.id limit ${maxDocuments}`;

  const frozenFor = (
    executor: DatabaseExecutor,
    ref: GateQApplicationDocumentRef,
  ) =>
    executor`
      select g.document_id,g.document_version_id,d.title,v.mime_type,g.sha256,g.frozen_at
      from evidence.gateq_application_document_disclosures g
      join evidence.documents d on d.id=g.document_id and d.tenant_id=g.tenant_id
      join evidence.document_versions v on v.id=g.document_version_id and v.tenant_id=g.tenant_id
      where g.tenant_id=${ref.tenantId} and g.application_id=${ref.applicationId}
      order by g.frozen_at,g.document_id`;

  return {
    readyDocuments: async (input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      const budget = z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .parse(input.maxCharsPerDocument ?? DEFAULT_CHARS);
      const rows = (await readyRows(deps.sql, ref)).map((row) =>
        ReadyRow.parse(row),
      );
      const result: GateQReadyApplicationDocument[] = [];
      for (const r of rows) {
        const instructionRisk = r.instruction_risk_signals > 0;
        const excerpts: { page: number; text: string }[] = [];
        let truncated = instructionRisk;
        if (!instructionRisk) {
          const pages = z
            .array(
              z.object({
                page_number: z.number().int().positive(),
                text: z.string(),
                full_length: z.coerce.number(),
              }),
            )
            .parse(
              await deps.sql`
              select page_number,left(text,${budget}) as text,char_length(text) as full_length
              from evidence.document_pages where tenant_id=${ref.tenantId} and document_version_id=${r.version_id}
              and extraction_id=${r.extraction_id} order by page_number limit ${MAX_PAGES + 1}`,
            );
          let remaining = budget;
          for (const [index, page] of pages.entries()) {
            if (index >= MAX_PAGES || remaining <= 0) {
              truncated = true;
              break;
            }
            const text = clean(page.text).slice(0, remaining);
            if (text.length < page.full_length) truncated = true;
            remaining -= text.length;
            if (text.trim() !== "")
              excerpts.push({ page: page.page_number, text });
          }
        }
        result.push({
          documentId: r.document_id,
          versionId: r.version_id,
          title: r.title,
          fileName: r.original_filename,
          contentType: r.mime_type,
          sha256: r.sha256,
          byteSize: r.size_bytes,
          pageCount: r.page_count,
          malwareStatus: r.malware_scan_status,
          instructionRisk,
          excerpts,
          truncated,
        });
      }
      return result;
    },

    freezeForSubmission: async (tx, input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      const locked = await tx.sql`
        select id from gateq.applications where id=${ref.applicationId} and tenant_id=${ref.tenantId} for update`;
      if (locked.length !== 1) throw new Error("application not found");
      const existing = await frozenFor(tx.sql, ref);
      const active = z
        .array(
          z.object({
            document_id: DocumentIdSchema,
            version_id: DocumentVersionIdSchema.nullable(),
            upload_status: z.string(),
            processing_status: z.string().nullable(),
            malware_scan_status: z.string().nullable(),
            text_extraction_status: z.string().nullable(),
          }),
        )
        .parse(
          await tx.sql`
          select d.id as document_id,v.id as version_id,u.status as upload_status,v.processing_status,v.malware_scan_status,v.text_extraction_status
          from evidence.documents d join evidence.document_upload_sessions u on u.document_id=d.id and u.tenant_id=d.tenant_id
          left join evidence.document_versions v on v.id=d.current_version_id and v.tenant_id=d.tenant_id
          where d.tenant_id=${ref.tenantId} and d.owner_kind='GATEQ_APPLICATION' and d.gateq_application_id=${ref.applicationId}
          and d.status='ACTIVE' and d.custody_cleanup_started_at is null order by d.created_at,d.id`,
        );
      const notReady: {
        documentId: string;
        status: Exclude<GateQApplicationDocumentStatus, "READY">;
      }[] = [];
      for (const row of active) {
        const status = gateqApplicationDocumentStatus({
          uploadStatus: row.upload_status,
          versionId: row.version_id,
          processingStatus: row.processing_status,
          malwareStatus: row.malware_scan_status,
          extractionStatus: row.text_extraction_status,
        });
        if (status !== "READY")
          notReady.push({ documentId: row.document_id, status });
      }
      if (existing.length > 0)
        return {
          documents: existing.map(frozen),
          notReady,
          deduplicated: true,
        };
      for (const row of await readyRows(tx.sql, ref)) {
        const r = ReadyRow.parse(row);
        // The trigger re-derives ownership and readiness from the parents.
        await tx.sql`
          insert into evidence.gateq_application_document_disclosures (tenant_id,application_id,document_id,document_version_id,sha256)
          values (${ref.tenantId},${ref.applicationId},${r.document_id},${r.version_id},${r.sha256})
          on conflict (application_id,document_id) do nothing`;
      }
      return {
        documents: (await frozenFor(tx.sql, ref)).map(frozen),
        notReady,
        deduplicated: false,
      };
    },

    frozenDocuments: async (input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      return (await frozenFor(deps.sql, ref)).map(frozen);
    },
  };
}
